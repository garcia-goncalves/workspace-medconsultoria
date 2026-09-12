import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { MARCADOR_ANONIMIZADO, emailAnonimizado } from "@app/shared";

/**
 * ELIMINAÇÃO PELO TITULAR (LGPD art. 18, V) — ADR-141.
 *
 * ⚠️ POR QUE ANONIMIZAR E NÃO APAGAR. `excluirDefinitivoCliente` bloqueia diante de
 * QUALQUER vínculo — projeto, documento, conta, credenciamento —, e todo cliente real
 * tem vários. Na prática nenhum era eliminável, e a app não tinha resposta nenhuma para
 * um pedido de eliminação. Anonimizar é a saída que a lei aceita quando existe dever de
 * guarda (contrato assinado, nota fiscal, processo na operadora): a pessoa deixa de ser
 * identificável, as linhas contábeis continuam de pé.
 *
 * ⚠️ O QUE ESTE CÓDIGO NÃO TOCA, DE PROPÓSITO — e a tela precisa dizer isto a quem
 * clica: o CORPO dos documentos já gerados (contrato, proposta) continua com o nome e o
 * CNPJ dentro. É o próprio dever de guarda que justifica manter o dado; reescrever um
 * contrato assinado destruiria a prova, que é pior para os dois lados. Mesma coisa para
 * `Conta` (fiscal), `ActivityLog` (auditoria) e `Assinatura` (IP, hash, traço).
 *
 * ⚠️ EXIGE O CLIENTE ARQUIVADO. Anonimizar quem está em contrato apagaria o CRM do
 * médico no meio de um credenciamento em andamento — perda de trabalho, não conformidade.
 * A ordem é: arquiva, depois anonimiza.
 */
export async function anonimizarCliente(id: string, userId: string) {
  const cliente = await prisma.cliente.findUnique({
    where: { id },
    select: { id: true, nome: true, deletedAt: true, anonimizadoEm: true },
  });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });

  if (cliente.anonimizadoEm) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Este cliente já foi anonimizado em ${cliente.anonimizadoEm.toLocaleDateString("pt-BR")}. Não há mais dado pessoal a remover.`,
    });
  }
  if (!cliente.deletedAt) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `"${cliente.nome}" ainda está ativo. Arquive o cliente primeiro: anonimizar agora apagaria ` +
        "o registro dos médicos no meio de credenciamentos em andamento.",
    });
  }

  const usuarios = await prisma.user.findMany({ where: { clienteId: id }, select: { id: true } });
  const idsUsuarios = usuarios.map((u) => u.id);

  await prisma.$transaction([
    // A ficha
    prisma.cliente.update({
      where: { id },
      data: {
        nome: MARCADOR_ANONIMIZADO,
        cnpj: null,
        email: null,
        telefone: null,
        observacoes: MARCADOR_ANONIMIZADO,
        anonimizadoEm: new Date(),
        anonimizadoPorId: userId,
      },
    }),
    // As pessoas de contato
    prisma.contato.updateMany({
      where: { clienteId: id },
      data: { nome: MARCADOR_ANONIMIZADO, cargo: null, email: null, telefone: null },
    }),
    // Os médicos: nome e número do conselho identificam a pessoa. A linha FICA porque o
    // credenciamento aponta para ela; o que sai é a identidade.
    prisma.profissional.updateMany({
      where: { clienteId: id },
      data: {
        nome: MARCADOR_ANONIMIZADO,
        conselhoNumero: null,
        conselhoUf: null,
        especialidade: null,
        ativo: false,
      },
    }),
    // Os acessos ao Portal. Deixar a conta viva seria dado removido com a porta aberta:
    // além do nome e do e-mail, o acesso cai e as sessões em voo morrem (ADR-140).
    ...usuarios.map((u) =>
      prisma.user.update({
        where: { id: u.id },
        data: {
          nome: MARCADOR_ANONIMIZADO,
          email: emailAnonimizado(u.id),
          ativo: false,
          acessoRevogadoEm: new Date(),
        },
      }),
    ),
    prisma.session.deleteMany({ where: { userId: { in: idsUsuarios } } }),
    prisma.token.deleteMany({ where: { userId: { in: idsUsuarios }, usedAt: null } }),
  ]);

  await prisma.activityLog.create({
    data: {
      userId,
      acao: "cliente.anonimizado",
      entidadeTipo: "cliente",
      entidadeId: id,
      // O nome anterior fica no registro de auditoria de propósito: é a prova de QUAL
      // pedido foi atendido, e a auditoria tem base legal própria.
      dados: { nomeAnterior: cliente.nome, contas: usuarios.length },
    },
  });

  return { ok: true, usuariosRevogados: usuarios.length };
}

/**
 * Os clientes ARQUIVADOS — a lista de onde parte um pedido de eliminação. Vive aqui e não
 * em `clientes.service` porque a ficha e a listagem normais filtram `deletedAt: null`:
 * depois de arquivado, o cliente some de toda tela, e sem esta lista o direito de
 * eliminação existiria só no servidor, sem ninguém conseguir exercê-lo.
 */
export async function listarArquivadosParaPrivacidade() {
  const identidade = await prisma.identidadeInstitucional.findUnique({
    where: { id: "default" },
    select: { retencaoAcervoAnos: true },
  });
  const anos = identidade?.retencaoAcervoAnos ?? 5;

  const clientes = await prisma.cliente.findMany({
    where: { deletedAt: { not: null } },
    orderBy: [{ anonimizadoEm: "asc" }, { deletedAt: "desc" }],
    select: {
      id: true,
      nome: true,
      cnpj: true,
      deletedAt: true,
      anonimizadoEm: true,
      anonimizadoPor: { select: { nome: true } },
      _count: { select: { usuariosPortal: true, contatos: true, profissionais: true, arquivos: true } },
    },
    take: 200,
  });

  // ⚠️ AVISA, NUNCA APAGA. Passado o prazo de guarda, o acervo do médico (diploma, CRM,
  // alvará) aparece marcado — e a decisão de apagar continua sendo de gente. Apagar
  // sozinho o diploma de alguém é pior que guardar demais, e é irreversível.
  const limiteAcervo = new Date();
  limiteAcervo.setFullYear(limiteAcervo.getFullYear() - anos);

  const linhas = clientes.map((c) => ({
    id: c.id,
    nome: c.nome,
    cnpj: c.cnpj,
    arquivadoEm: c.deletedAt,
    anonimizadoEm: c.anonimizadoEm,
    anonimizadoPor: c.anonimizadoPor?.nome ?? null,
    pessoas: c._count.usuariosPortal + c._count.contatos + c._count.profissionais,
    arquivos: c._count.arquivos,
    acervoVencido: !!c.deletedAt && c.deletedAt < limiteAcervo && c._count.arquivos > 0,
  }));
  return { anos, clientes: linhas };
}
