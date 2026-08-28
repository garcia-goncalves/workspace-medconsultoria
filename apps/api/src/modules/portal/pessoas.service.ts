import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { type PortalPapel } from "@app/shared";
import { gerarConvite } from "../usuarios/usuarios.service.js";
// A regra de "sobra alguém que assina?" mora fora deste arquivo porque a tela interna da Med
// (*Equipe e acessos*) também precisa dela, e importar daqui fecharia ciclo de módulos.
import { assertSobraResponsavel } from "./papel-da-clinica.js";

/**
 * AS PESSOAS DE UMA CLÍNICA, NO PORTAL DO CLIENTE (ADR-131).
 *
 * Uma clínica não é uma pessoa: quem entra é o médico, a secretária, o administrador. Até aqui
 * havia UMA conta por clínica, com a senha circulando entre eles — o que tornava impossível
 * saber quem aceitou uma proposta e dava, sem querer, o poder de cancelar um serviço a quem só
 * precisava anexar um documento.
 *
 * Este arquivo é o único lugar que cria, promove, rebaixa e revoga essas contas. Duas telas o
 * chamam — a ficha do cliente (equipe da Med) e a página "Minha equipe" (o responsável da
 * própria clínica) —, e é de propósito que as duas passem pelas MESMAS regras: se a Thaís não
 * pode deixar a clínica sem responsável, o dono da clínica também não pode.
 *
 * ⚠️ **Toda função aqui recebe `clienteId` e confere o vínculo antes de tocar em qualquer
 * pessoa.** É o mesmo isolamento do `portalProcedure`: sem esta conferência, o dono da Clínica A
 * mandaria o id de alguém da Clínica B e revogaria o acesso de um estranho.
 */

/** Uma pessoa da clínica, como as duas telas a mostram. */
export interface PessoaDoPortal {
  id: string;
  nome: string;
  email: string;
  papel: PortalPapel | null;
  /** `ATIVO` entra hoje · `CONVIDADO` recebeu o convite e nunca definiu senha · `REVOGADO` perdeu o acesso. */
  situacao: "ATIVO" | "CONVIDADO" | "REVOGADO";
  convidadoEm: Date;
  ultimoAcessoEm: Date | null;
  /** Quem deu esse acesso — alguém da Med ou o responsável da própria clínica. */
  convidadoPor: string | null;
}

const selecao = {
  id: true,
  nome: true,
  email: true,
  papelPortal: true,
  ativo: true,
  passwordHash: true,
  acessoRevogadoEm: true,
  createdAt: true,
  ultimoAcessoEm: true,
  convidadoPor: { select: { nome: true } },
} as const;

type LinhaCrua = {
  id: string;
  nome: string;
  email: string;
  papelPortal: PortalPapel | null;
  ativo: boolean;
  passwordHash: string | null;
  acessoRevogadoEm: Date | null;
  createdAt: Date;
  ultimoAcessoEm: Date | null;
  convidadoPor: { nome: string } | null;
};

function paraPessoa(u: LinhaCrua): PessoaDoPortal {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    papel: u.papelPortal,
    // ⚠️ Quem decide "revogado" é o MARCADOR, nunca `ativo` sozinho.
    //
    // Conta convidada e ainda sem senha também nasce inativa — foi o que a primeira rodada de
    // teste pegou: a secretária recém-convidada aparecia como "acesso revogado", dizendo à
    // clínica que tiramos um acesso que acabáramos de dar.
    situacao: u.acessoRevogadoEm ? "REVOGADO" : u.passwordHash && u.ativo ? "ATIVO" : "CONVIDADO",
    convidadoEm: u.createdAt,
    ultimoAcessoEm: u.ultimoAcessoEm,
    convidadoPor: u.convidadoPor?.nome ?? null,
  };
}

/** Todas as pessoas com acesso (ou acesso revogado) ao Portal daquela clínica. */
export async function listarPessoasDoPortal(clienteId: string): Promise<PessoaDoPortal[]> {
  const users = await prisma.user.findMany({
    where: { clienteId, role: "CLIENTE", deletedAt: null },
    select: selecao,
    // Quem manda primeiro, quem saiu por último: a lista responde "quem eu chamo nessa clínica?"
    orderBy: [{ ativo: "desc" }, { papelPortal: "asc" }, { createdAt: "asc" }],
  });
  return users.map(paraPessoa);
}

/**
 * Acha a pessoa E confirma que ela é daquela clínica.
 *
 * ⚠️ O `clienteId` no `where` é a linha que separa "gerenciar a minha equipe" de "mexer na
 * conta de um estranho". Nunca busque por id sozinho aqui.
 */
async function pessoaDaClinica(pessoaId: string, clienteId: string) {
  const pessoa = await prisma.user.findFirst({
    where: { id: pessoaId, clienteId, role: "CLIENTE", deletedAt: null },
    select: selecao,
  });
  if (!pessoa) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Pessoa não encontrada nesta clínica." });
  }
  return pessoa;
}

/** O histórico de tudo que se faz com o acesso de alguém — quem mexeu, em quem, e o quê. */
function registrar(
  autorId: string,
  clienteId: string,
  acao: string,
  dados: Record<string, unknown>,
) {
  return prisma.activityLog.create({
    data: { userId: autorId, acao, entidadeTipo: "cliente", entidadeId: clienteId, dados },
  });
}

export interface ConvidarPessoaInput {
  clienteId: string;
  nome: string;
  email: string;
  papel: PortalPapel;
  /** Quem está convidando: alguém da Med ou o responsável da clínica. */
  autorId: string;
}

/**
 * Convida mais uma pessoa da clínica para o Portal.
 *
 * ⚠️ **Diferente de `garantirAcessoPortal`, aqui o e-mail SEMPRE sai.** Lá o silêncio é a regra,
 * porque a conta nasce como efeito colateral de cadastrar um cliente e quem avisa é a Thaís na
 * hora que ela escolher (ADR-128). Aqui alguém digitou o nome e o e-mail de uma pessoa e apertou
 * "Convidar": o convite É o ato pedido, e uma conta criada sem o convite chegar seria um acesso
 * que ninguém sabe que existe.
 */
export async function convidarPessoaDoPortal(input: ConvidarPessoaInput) {
  const email = input.email.trim().toLowerCase();
  const nome = input.nome.trim();
  if (!nome) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o nome da pessoa." });

  const cliente = await prisma.cliente.findFirst({
    where: { id: input.clienteId, deletedAt: null },
    select: { id: true },
  });
  if (!cliente) throw new TRPCError({ code: "BAD_REQUEST", message: "Cliente inválido." });

  // E-mail é a chave de login do sistema inteiro: se já existe conta com ele — de outra clínica
  // ou da própria equipe da Med —, criar outra deixaria duas contas disputando o mesmo login.
  const jaExiste = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, clienteId: true, acessoRevogadoEm: true },
  });
  if (jaExiste) {
    if (jaExiste.clienteId === input.clienteId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        // ⚠️ De novo o marcador, não `ativo`: quem foi convidado ontem e ainda não criou a senha
        // é `ativo: false`, e ler a coluna crua mandaria a Thaís "devolver" um acesso que nunca
        // foi tirado de ninguém.
        message: jaExiste.acessoRevogadoEm
          ? "Essa pessoa já esteve nesta clínica. Use “Devolver acesso” na lista, em vez de convidar de novo."
          : "Essa pessoa já tem acesso ao Portal desta clínica.",
      });
    }
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Esse e-mail já é usado por outra conta. Use um e-mail diferente para esta pessoa.",
    });
  }

  const pessoa = await prisma.user.create({
    data: {
      nome,
      email,
      passwordHash: null,
      // Nasce inativa e vira ativa quando a pessoa define a senha pelo link — o mesmo caminho de
      // toda conta convidada. Conta ativa sem senha seria uma porta sem fechadura.
      ativo: false,
      role: "CLIENTE",
      clienteId: input.clienteId,
      papelPortal: input.papel,
      convidadoPorId: input.autorId,
    },
    select: { id: true, nome: true, email: true },
  });

  const convite = await gerarConvite(pessoa.id, pessoa.nome, pessoa.email, "CLIENTE");
  await registrar(input.autorId, input.clienteId, "portal.pessoa_convidada", {
    pessoaId: pessoa.id,
    nome,
    email,
    papel: input.papel,
  });
  return { id: pessoa.id, ...convite };
}

/** Promove ou rebaixa alguém dentro da clínica. */
export async function alterarPapelDaPessoa(input: {
  clienteId: string;
  pessoaId: string;
  papel: PortalPapel;
  autorId: string;
}) {
  const pessoa = await pessoaDaClinica(input.pessoaId, input.clienteId);
  await assertSobraResponsavel(input.clienteId, { id: pessoa.id, papel: input.papel });

  await prisma.user.update({ where: { id: pessoa.id }, data: { papelPortal: input.papel } });
  await registrar(input.autorId, input.clienteId, "portal.papel_alterado", {
    pessoaId: pessoa.id,
    nome: pessoa.nome,
    de: pessoa.papelPortal,
    para: input.papel,
  });
  return { ok: true };
}

/**
 * Tira o acesso de uma pessoa — sem apagar nada.
 *
 * ⚠️ **Revogar é desativar, nunca excluir.** A conta assina documento, abre chamado e aparece no
 * histórico; apagá-la deixaria "alguém" no lugar do nome de quem agiu, exatamente o defeito que
 * a ADR-109 consertou. A pessoa some da lista de quem pode entrar, e o passado continua dizendo
 * a verdade.
 *
 * As sessões abertas caem junto. O `getUserFromSession` já recusa conta inativa a cada request,
 * então o acesso morre na hora de qualquer forma — apagar as linhas é para a lista de sessões
 * não mentir dizendo que alguém revogado continua conectado.
 */
export async function revogarAcessoDaPessoa(input: {
  clienteId: string;
  pessoaId: string;
  autorId: string;
}) {
  const pessoa = await pessoaDaClinica(input.pessoaId, input.clienteId);
  if (pessoa.id === input.autorId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Você não pode revogar o seu próprio acesso. Peça a outro responsável.",
    });
  }
  await assertSobraResponsavel(input.clienteId, { id: pessoa.id, ativo: false });

  await prisma.user.update({
    where: { id: pessoa.id },
    data: { ativo: false, acessoRevogadoEm: new Date() },
  });
  await prisma.session.deleteMany({ where: { userId: pessoa.id } });
  // ⚠️ E O CONVITE QUE JÁ ESTÁ NA CAIXA DELA? Ele vale 72h, e `aceitarConvite` grava
  // `ativo: true`. Sem apagar o token, revogar o acesso de quem ainda não entrou não revoga
  // nada: bastava ela clicar no link antigo para entrar, ainda marcada como "revogada" na tela.
  await prisma.token.deleteMany({ where: { userId: pessoa.id, usedAt: null } });
  await registrar(input.autorId, input.clienteId, "portal.acesso_revogado", {
    pessoaId: pessoa.id,
    nome: pessoa.nome,
    email: pessoa.email,
  });
  return { ok: true };
}

/**
 * Devolve o acesso a quem foi revogado.
 *
 * Quem já tinha senha volta ATIVO com a mesma senha: ela é dela, não nossa, e forçar troca sem
 * motivo é atrito que ninguém pediu. Quem nunca chegou a criar senha volta ao estado de
 * CONVIDADO e recebe um link novo — o antigo expira em 72h e teria virado um "clique aqui" que
 * não funciona.
 */
export async function devolverAcessoDaPessoa(input: {
  clienteId: string;
  pessoaId: string;
  autorId: string;
}) {
  const pessoa = await pessoaDaClinica(input.pessoaId, input.clienteId);
  const temSenha = !!pessoa.passwordHash;

  await prisma.user.update({
    where: { id: pessoa.id },
    data: { ativo: temSenha, acessoRevogadoEm: null },
  });
  const convite = temSenha
    ? { conviteUrl: null, emailEnviado: false }
    : await gerarConvite(pessoa.id, pessoa.nome, pessoa.email, "CLIENTE");

  await registrar(input.autorId, input.clienteId, "portal.acesso_devolvido", {
    pessoaId: pessoa.id,
    nome: pessoa.nome,
    email: pessoa.email,
  });
  return convite;
}

/** Manda de novo o link para a pessoa criar a senha. Só faz sentido em quem ainda não entrou. */
export async function reenviarConviteDaPessoa(input: {
  clienteId: string;
  pessoaId: string;
  autorId: string;
}) {
  const pessoa = await pessoaDaClinica(input.pessoaId, input.clienteId);
  if (pessoa.passwordHash) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Essa pessoa já criou a senha dela. Se ela esqueceu, use “Esqueci minha senha” na tela de entrada.",
    });
  }
  const convite = await gerarConvite(pessoa.id, pessoa.nome, pessoa.email, "CLIENTE");
  await registrar(input.autorId, input.clienteId, "portal.convite_reenviado", {
    pessoaId: pessoa.id,
    nome: pessoa.nome,
    email: pessoa.email,
  });
  return convite;
}
