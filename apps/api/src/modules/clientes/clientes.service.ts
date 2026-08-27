import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type {
  CreateClienteInput,
  UpdateClienteInput,
  CreateContatoInput,
  CreateNotaInput,
  Role,
} from "@app/shared";
import { SITUACOES_CLIENTE } from "@app/shared";
import { garantirAcessoPortal, convidarUsuario, reenviarConvite } from "../usuarios/usuarios.service.js";
import { acessoAoPortal } from "../../lib/acesso-portal.js";
import { emReais } from "../../lib/dinheiro.js";

/** "" ou espaços → null; caso contrário, texto aparado. */
const clean = (v?: string | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export async function listClientes(search?: string) {
  const s = search?.trim();
  const clientes = await prisma.cliente.findMany({
    where: {
      deletedAt: null,
      // A página Clientes lista só CLIENTES de verdade (ativos/inativos). Prospects,
      // negociação e perdidos são leads — vivem no Funil de vendas, não aqui.
      situacaoComercial: { in: [...SITUACOES_CLIENTE] },
      ...(s
        ? {
            OR: [
              { nome: { contains: s } },
              { email: { contains: s } },
              { cnpj: { contains: s } },
            ],
          }
        : {}),
    },
    orderBy: { nome: "asc" },
    select: {
      id: true,
      nome: true,
      situacaoComercial: true,
      email: true,
      telefone: true,
      cnpj: true,
      responsavelId: true,
      createdAt: true,
      responsavel: { select: { nome: true } },
      _count: {
        select: {
          contatos: true,
          projetos: { where: { deletedAt: null } },
          // "No funil" = tem oportunidade aberta (upsell em andamento) ligada a este cliente.
          leadsPortal: { where: { deletedAt: null, convertidoEmClienteId: null, perdidoEm: null } },
          // Serviços contratados ativos (o que o cliente tem hoje).
          servicosContratados: { where: { status: "ATIVO" } },
        },
      },
      // A CONTA de Portal (ADR-128) — os três estados do card, não só "ativo ou não".
      usuariosPortal: {
        where: { role: "CLIENTE" },
        select: { ativo: true, passwordHash: true, createdAt: true, ultimoAcessoEm: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (clientes.length === 0) return [];

  // Próxima reunião/compromisso de empresa por cliente (1 query agregada, sem N+1).
  const ids = clientes.map((c) => c.id);
  const reunioes = await prisma.evento.groupBy({
    by: ["clienteId"],
    where: {
      clienteId: { in: ids },
      deletedAt: null,
      inicio: { gte: new Date() },
      escopo: "EMPRESA",
      tipo: { in: ["REUNIAO", "COMPROMISSO"] },
    },
    _min: { inicio: true },
  });
  const proxMap = new Map(reunioes.map((r) => [r.clienteId, r._min.inicio]));

  return clientes.map(({ usuariosPortal, ...c }) => {
    const portal = acessoAoPortal(usuariosPortal);
    return {
      ...c,
      proximaReuniao: proxMap.get(c.id) ?? null,
      emFunil: c._count.leadsPortal > 0,
      portalAtivo: portal.estado === "ATIVO",
      portal,
    };
  });
}

/** Indicadores da base de CLIENTES (só ativos/inativos — prospects estão no Funil). */
export async function resumoClientes() {
  const [ativos, inativos, portaisAtivos] = await Promise.all([
    prisma.cliente.count({ where: { deletedAt: null, situacaoComercial: "ATIVO" } }),
    prisma.cliente.count({ where: { deletedAt: null, situacaoComercial: "INATIVO" } }),
    prisma.user.count({ where: { role: "CLIENTE", ativo: true, deletedAt: null, passwordHash: { not: null } } }),
  ]);
  return { total: ativos + inativos, ativos, inativos, portaisAtivos };
}

/**
 * Envia o acesso ao Portal para um cliente (igual ao convite do Funil): cria a conta
 * CLIENTE + convite se ainda não existe; reenvia o link se está pendente; se já tem
 * acesso ativo, avisa. Devolve o link/estado para o diálogo de convite.
 */
export async function convidarPortalCliente(ator: { id: string; role: Role }, clienteId: string) {
  const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, deletedAt: null }, select: { id: true, nome: true, email: true } });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
  if (!cliente.email) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cadastre um e-mail no cliente para enviar o acesso ao Portal." });
  }

  const jaTem = await prisma.user.findFirst({ where: { clienteId, role: "CLIENTE", deletedAt: null } });
  if (jaTem) {
    if (jaTem.passwordHash === null) {
      const r = await reenviarConvite(ator.role, jaTem.id);
      return { email: r.email, conviteUrl: r.conviteUrl, emailEnviado: r.emailEnviado };
    }
    throw new TRPCError({ code: "CONFLICT", message: "Este cliente já tem acesso ativo ao Portal." });
  }

  const { usuario, conviteUrl, emailEnviado } = await convidarUsuario(ator.role, {
    nome: cliente.nome,
    email: cliente.email,
    role: "CLIENTE",
    clienteId,
  });
  return { email: usuario.email, conviteUrl, emailEnviado };
}

/** Ativa/desativa um cliente (toggle manual na ficha) — só faz sentido para clientes de verdade. */
export async function setAtivoCliente(id: string, ativo: boolean, userId: string) {
  const cliente = await prisma.cliente.findFirst({ where: { id, deletedAt: null }, select: { situacaoComercial: true } });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
  if (!SITUACOES_CLIENTE.includes(cliente.situacaoComercial as (typeof SITUACOES_CLIENTE)[number])) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Só é possível ativar/desativar um cliente. Prospects são geridos no Funil." });
  }
  await prisma.cliente.update({ where: { id }, data: { situacaoComercial: ativo ? "ATIVO" : "INATIVO" } });
  await prisma.activityLog.create({
    data: { userId, acao: ativo ? "cliente.ativado" : "cliente.desativado", entidadeTipo: "cliente", entidadeId: id },
  });
  return { ok: true };
}

/** Tudo que se conecta a um cliente — vira o "hub" da ficha. Contas só p/ admin. */
export async function relacionadosCliente(clienteId: string, isAdmin: boolean) {
  const agora = new Date();
  const [projetos, documentos, eventos, contas, leadsOrigem] = await Promise.all([
    prisma.projeto.findMany({
      where: { clienteId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        nome: true,
        status: true,
        // Status dos cartões para calcular o progresso do projeto na ficha.
        cards: { where: { deletedAt: null }, select: { status: true } },
        _count: { select: { cards: { where: { deletedAt: null } } } },
      },
    }),
    prisma.documento.findMany({
      where: { clienteId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 8,
      // Campos para a situação coerente (fluxo + aceite + assinatura) na ficha.
      select: {
        id: true,
        titulo: true,
        status: true,
        propostaStatus: true,
        assinaturaSolicitadaEm: true,
        assinadoEm: true,
        modelo: { select: { tipo: true } },
      },
    }),
    prisma.evento.findMany({
      where: { clienteId, deletedAt: null, inicio: { gte: agora } },
      orderBy: { inicio: "asc" },
      take: 5,
      select: { id: true, titulo: true, inicio: true, tipo: true, linkReuniao: true },
    }),
    isAdmin
      ? prisma.conta.findMany({
          where: { clienteId, deletedAt: null },
          orderBy: { vencimento: "asc" },
          take: 10,
          select: {
            id: true,
            descricao: true,
            tipo: true,
            valor: true,
            vencimento: true,
            pago: true,
            recorrencia: true,
          },
        })
      : Promise.resolve(null),
    // Origem comercial: o(s) lead(s) que originaram este cliente (convertido ou ligado ao
    // Portal) — mostra de onde veio, o que pediu e o histórico comercial.
    prisma.lead.findMany({
      where: { deletedAt: null, OR: [{ convertidoEmClienteId: clienteId }, { clienteId }] },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        origem: true,
        rastreio: true,
        valorEstimado: true,
        createdAt: true,
        convertidoEmClienteId: true,
        convertidoEm: true,
        perdidoEm: true,
        motivoPerda: true,
        pipelineStage: { select: { nome: true } },
        servicos: { select: { id: true, nome: true }, orderBy: { ordem: "asc" } },
      },
    }),
  ]);
  return {
    projetos,
    documentos,
    eventos,
    contas: contas ? contas.map((c) => ({ ...c, valor: c.valor.toNumber() })) : null,
    origem: leadsOrigem.map((l) => ({
      id: l.id,
      origem: l.origem,
      rastreio: l.rastreio,
      valorEstimado: emReais(l.valorEstimado),
      createdAt: l.createdAt,
      convertidoEm: l.convertidoEm,
      servicos: l.servicos,
      etapa: l.pipelineStage.nome,
      status: l.convertidoEmClienteId ? "convertido" : l.perdidoEm ? "perdido" : "em_andamento",
      motivoPerda: l.motivoPerda,
    })),
  };
}

export async function getCliente(id: string) {
  const cliente = await prisma.cliente.findFirst({
    where: { id, deletedAt: null },
    include: {
      contatos: { orderBy: [{ principal: "desc" }, { nome: "asc" }] },
      responsavel: { select: { nome: true } },
      // A CONTA de Portal (ADR-128): o card precisa dos três estados, e para isso precisa saber
      // quando a conta nasceu e quando o cliente entrou pela última vez.
      usuariosPortal: {
        where: { role: "CLIENTE" },
        select: { ativo: true, passwordHash: true, createdAt: true, ultimoAcessoEm: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });

  const notas = await prisma.nota.findMany({
    where: { entidadeTipo: "cliente", entidadeId: id },
    include: { autor: { select: { nome: true } } },
    orderBy: { createdAt: "desc" },
  });

  const { usuariosPortal, ...semConta } = cliente;
  const portal = acessoAoPortal(usuariosPortal);
  return { ...semConta, notas, portalAtivo: portal.estado === "ATIVO", portal };
}

export async function createCliente(
  input: CreateClienteInput,
  userId: string,
  enviarAcessoPortal = false,
) {
  const cliente = await prisma.cliente.create({
    data: {
      nome: input.nome.trim(),
      cnpj: clean(input.cnpj),
      email: clean(input.email),
      telefone: clean(input.telefone),
      observacoes: clean(input.observacoes),
      responsavelId: input.responsavelId || userId,
    },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "cliente.criado", entidadeTipo: "cliente", entidadeId: cliente.id },
  });
  // Cadastro MANUAL: o acesso só é criado — e o e-mail só sai — se a equipe marcar a caixa na
  // confirmação, que hoje nasce **desmarcada** (ADR-128). Sem marcar, nada é criado e nada é
  // enviado; a Thaís avisa o cliente quando quiser, pelo botão "Enviar acesso" da ficha.
  // Best-effort: a criação do cliente não falha se o acesso não puder ser provido.
  if (enviarAcessoPortal && cliente.email) {
    await garantirAcessoPortal(cliente.id, cliente.nome, cliente.email, "EQUIPE_COM_AVISO").catch(() => {});
  }
  return cliente;
}

export async function updateCliente(input: UpdateClienteInput) {
  const { id, ...rest } = input;
  const data: Record<string, unknown> = {};
  if (rest.nome !== undefined) data.nome = rest.nome.trim();
  if (rest.cnpj !== undefined) data.cnpj = clean(rest.cnpj);
  if (rest.email !== undefined) data.email = clean(rest.email);
  if (rest.telefone !== undefined) data.telefone = clean(rest.telefone);
  if (rest.observacoes !== undefined) data.observacoes = clean(rest.observacoes);
  if (rest.responsavelId !== undefined) data.responsavelId = rest.responsavelId || null;
  return prisma.cliente.update({ where: { id }, data });
}

export async function removeCliente(id: string, userId: string) {
  await prisma.cliente.update({ where: { id }, data: { deletedAt: new Date() } });
  // Remove junto as oportunidades ATIVAS ligadas (não convertidas/perdidas) para não
  // ficarem órfãs no board do funil apontando para um cliente removido.
  await prisma.lead.updateMany({
    where: { clienteId: id, deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
    data: { deletedAt: new Date() },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "cliente.removido", entidadeTipo: "cliente", entidadeId: id },
  });
  return { ok: true };
}

/**
 * Exclusão DEFINITIVA (física) — só ROOT. Prioriza a segurança: se houver qualquer
 * vínculo que torne a remoção insegura (projetos, documentos, financeiro, serviços,
 * agenda, acessos ao Portal, arquivos, conversas, leads, respostas), BLOQUEIA e orienta
 * a arquivar. Preserva histórico/financeiro/documentos. Só apaga um cliente "limpo".
 */
export async function excluirDefinitivoCliente(id: string, userId: string) {
  const cliente = await prisma.cliente.findUnique({ where: { id }, select: { id: true, nome: true } });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });

  const [projetos, documentos, contas, servicos, eventos, acessos, arquivosCli, conversas, respostas, leads] = await Promise.all([
    prisma.projeto.count({ where: { clienteId: id } }),
    prisma.documento.count({ where: { clienteId: id } }),
    prisma.conta.count({ where: { clienteId: id } }),
    prisma.clienteServico.count({ where: { clienteId: id } }),
    prisma.evento.count({ where: { clienteId: id } }),
    prisma.user.count({ where: { clienteId: id } }),
    prisma.arquivo.count({ where: { clienteId: id } }),
    prisma.conversa.count({ where: { clienteId: id } }),
    prisma.formularioResposta.count({ where: { clienteId: id } }),
    prisma.lead.count({ where: { OR: [{ clienteId: id }, { convertidoEmClienteId: id }] } }),
  ]);

  const vinculos: Record<string, number> = {
    projetos, documentos, financeiro: contas, serviços: servicos, agenda: eventos,
    "acessos ao Portal": acessos, arquivos: arquivosCli, conversas, "respostas de formulário": respostas, leads,
  };
  const bloqueios = Object.entries(vinculos).filter(([, n]) => n > 0);
  if (bloqueios.length) {
    const detalhe = bloqueios.map(([k, n]) => `${k}: ${n}`).join(", ");
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Exclusão definitiva bloqueada — o cliente tem vínculos (${detalhe}). Arquive o cliente para preservar o histórico.`,
    });
  }

  // Cliente sem vínculos → seguro remover fisicamente (só os contatos, que são dados dele).
  await prisma.$transaction([
    prisma.contato.deleteMany({ where: { clienteId: id } }),
    prisma.cliente.delete({ where: { id } }),
  ]);
  await prisma.activityLog.create({
    data: { userId, acao: "cliente.excluido_definitivo", entidadeTipo: "cliente", entidadeId: id },
  });
  return { ok: true };
}

export function addContato(input: CreateContatoInput) {
  return prisma.contato.create({
    data: {
      clienteId: input.clienteId,
      nome: input.nome.trim(),
      cargo: clean(input.cargo),
      email: clean(input.email),
      telefone: clean(input.telefone),
      principal: input.principal,
    },
  });
}

export async function removeContato(id: string) {
  await prisma.contato.delete({ where: { id } });
  return { ok: true };
}

export function addNota(input: CreateNotaInput, userId: string) {
  return prisma.nota.create({
    data: {
      autorId: userId,
      entidadeTipo: input.entidadeTipo,
      entidadeId: input.entidadeId,
      conteudo: input.conteudo.trim(),
    },
    include: { autor: { select: { nome: true } } },
  });
}

/**
 * Arquiva/desarquiva uma nota da timeline. **Histórico IMUTÁVEL**: nunca edita nem apaga o
 * `conteudo` — só marca/desmarca `arquivadaEm` (some das visões ativas, mas continua registrada).
 * Correção/complemento de uma nota = criar uma NOVA nota (addNota). Ver decisão técnica #2.
 */
export function arquivarNota(notaId: string, userId: string, arquivar: boolean) {
  return prisma.nota.update({
    where: { id: notaId },
    data: arquivar ? { arquivadaEm: new Date(), arquivadaPorId: userId } : { arquivadaEm: null, arquivadaPorId: null },
    include: { autor: { select: { nome: true } } },
  });
}
