import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { ROLE_LEVEL, type Role } from "@app/shared";
import type { CreateUsuarioInput, UpdateUsuarioInput, InviteUsuarioInput } from "@app/shared";
import { hashPassword } from "../../lib/password.js";
import { criarToken } from "../../lib/tokens.js";
import { enviarEmailTemplate } from "../emails/enviados.service.js";
import { config } from "../../config.js";
// A tela interna *Equipe e acessos* também cria e desativa conta de Portal. Sem passar por
// estas duas regras, ela furava as travas das ADR-131/137 pela porta dos fundos.
import { papelPortalPadraoDaClinica, assertSobraResponsavel } from "../portal/papel-da-clinica.js";

/** Convite válido por 72h. */
const CONVITE_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Gera o token de convite, "envia" o e-mail e devolve o link (só em modo dev).
 * O template acompanha o PAPEL: CLIENTE recebe as boas-vindas quentes do Portal;
 * a equipe interna recebe o convite padrão do Workspace.
 */
export async function gerarConvite(userId: string, nome: string, email: string, role: Role) {
  const token = await criarToken(userId, "CONVITE", CONVITE_TTL_MS);
  const url = `${config.WEB_ORIGIN}/definir-senha?token=${token}`;
  const template = role === "CLIENTE" ? "portal_boas_vindas" : "convite";
  const { enviado } = await enviarEmailTemplate(template, email, { nome, link: url });
  // Só devolvemos o link ao navegador quando o e-mail NÃO saiu (modo dev ou falha de
  // SMTP) — é o fallback para o admin enviar manualmente. Se enviou, o link é privado.
  return { conviteUrl: enviado ? null : url, emailEnviado: enviado };
}

/**
 * De ONDE veio o pedido de acesso ao Portal. Existe porque **só o cliente que se cadastra
 * sozinho recebe e-mail sem ninguém mandar** (ordem do dono, 26/08/2026 — ADR-128).
 *
 * `AUTOCADASTRO` — o próprio cliente se inscreveu em `/comecar`. Ele está esperando o e-mail
 *   naquele instante; não mandar seria deixá-lo sem porta de entrada.
 * `EQUIPE` — alguém da casa cadastrou, converteu ou contratou por ele. Aqui o e-mail **NÃO sai**:
 *   quem decide quando o cliente é avisado é a Thaís, pelo botão "Enviar acesso" do card.
 * `EQUIPE_COM_AVISO` — alguém da casa cadastrou **e marcou, naquele momento, a caixa "avisar o
 *   cliente agora"**. É o mesmo pedido do botão "Enviar acesso", feito um passo antes. A caixa
 *   nasce **desmarcada**: marcar é um ato, não um descuido.
 *
 * ⚠️ É um parâmetro OBRIGATÓRIO de propósito. A regra anterior morava numa caixinha marcada por
 * padrão, e caixinha marcada por padrão é regra que depende de alguém lembrar de desmarcar —
 * daqui a três meses alguém remarca "por praticidade" e o comportamento volta calado. Obrigando
 * cada chamada a declarar a origem, o compilador cobra a decisão de quem escrever a próxima.
 */
export type OrigemDoAcesso = "AUTOCADASTRO" | "EQUIPE" | "EQUIPE_COM_AVISO";

/**
 * Garante o acesso ao Portal do Cliente: cria a conta CLIENTE pendente ligada ao cliente.
 * Idempotente e best-effort — se já existe conta (por cliente ou por e-mail), não recria nem
 * reenvia (retorna `jaTinhaAcesso`).
 *
 * ⚠️ **O e-mail de boas-vindas NÃO sai quando `origem` é `EQUIPE`.** Ver `OrigemDoAcesso`.
 */
export async function garantirAcessoPortal(
  clienteId: string,
  nome: string,
  email: string | null,
  origem: OrigemDoAcesso,
): Promise<{
  criou: boolean;
  jaTinhaAcesso: boolean;
  /**
   * M11: o e-mail já é usado por OUTRA conta (outra clínica ou uma conta interna) — bem
   * diferente de "este cliente já tinha acesso". Continua recusando criar (um e-mail não pode
   * abrir o Portal de duas clínicas — ADR-128/ADR-131), mas agora DIZ qual dos dois motivos foi:
   * `jaTinhaAcesso` (nada a fazer, é o mesmo cliente) ou este campo (o convite não sai porque o
   * e-mail pertence a outro cadastro, e é isso que quem convidou precisa descobrir na tela).
   */
  emailEmUsoPorOutraConta: boolean;
  emailEnviado: boolean;
  conviteUrl: string | null;
}> {
  const nada = { criou: false, jaTinhaAcesso: false, emailEmUsoPorOutraConta: false, emailEnviado: false, conviteUrl: null };
  if (!email) return nada;

  // Já existe conta de Portal para este cliente? (continuidade lead → cliente)
  const doCliente = await prisma.user.findFirst({
    where: { clienteId, role: "CLIENTE", deletedAt: null },
    select: { id: true },
  });
  if (doCliente) return { ...nada, jaTinhaAcesso: true };

  // Já existe QUALQUER usuário com este e-mail? Não duplica acesso — mas o motivo importa:
  // se for de OUTRO cliente (ou conta interna), não é "já tinha acesso", é "e-mail em uso".
  const doEmail = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, clienteId: true },
  });
  if (doEmail) {
    if (doEmail.clienteId !== clienteId) return { ...nada, emailEmUsoPorOutraConta: true };
    return { ...nada, jaTinhaAcesso: true };
  }

  const usuario = await prisma.user.create({
    data: {
      nome: nome.trim(),
      email,
      passwordHash: null,
      ativo: false,
      role: "CLIENTE",
      clienteId,
      // A PRIMEIRA pessoa da clínica é o RESPONSAVEL (ADR-131) — é ela que aceita a proposta que
      // deu origem a esta conta. As seguintes entram pelo convite explícito, onde quem convida
      // escolhe o papel; e não pode ser o contrário: uma clínica cuja única pessoa fosse
      // "equipe" nasceria sem ninguém que pudesse assinar nada.
      papelPortal: "RESPONSAVEL",
    },
    select: { id: true, nome: true, email: true },
  });
  // Cadastro feito pela EQUIPE sem pedir aviso: a conta nasce, o e-mail NÃO sai. O cliente é
  // avisado quando a Thaís quiser, pelo botão "Enviar acesso" do card.
  if (origem === "EQUIPE")
    return { criou: true, jaTinhaAcesso: false, emailEmUsoPorOutraConta: false, emailEnviado: false, conviteUrl: null };
  const r = await gerarConvite(usuario.id, usuario.nome, usuario.email, "CLIENTE");
  return { criou: true, jaTinhaAcesso: false, emailEmUsoPorOutraConta: false, ...r };
}

/** Campos públicos de um usuário (nunca expõe passwordHash). */
const publicSelect = {
  id: true,
  nome: true,
  email: true,
  role: true,
  ativo: true,
  avatarUrl: true,
  clienteId: true,
  createdAt: true,
  // Papel DENTRO da clínica (ADR-131). A coluna "Papel" da tela dizia só "Cliente", e quem
  // olhava não sabia se aquela secretária pode assinar pela clínica. Nulo vale como
  // RESPONSAVEL — são as contas anteriores à regra.
  papelPortal: true,
  cliente: { select: { nome: true } },
} as const;

/** O root "primordial" (config): imutável — nunca perde ROOT, nunca é desativado/excluído. */
function ehRootProtegido(email: string): boolean {
  return email.trim().toLowerCase() === config.ROOT_PROTEGIDO_EMAIL.trim().toLowerCase();
}

/**
 * Impede escalonamento de privilégio. Regra geral: só se atribui papel **estritamente abaixo**
 * do seu (ex.: ADMIN cria Funcionário/Cliente). EXCEÇÃO: o **ROOT** pode atribuir qualquer papel,
 * inclusive ROOT — é ele quem cria/gerencia outros roots.
 */
export function assertPodeAtribuir(atorRole: Role, alvoRole: Role) {
  if (atorRole === "ROOT") return;
  if (ROLE_LEVEL[alvoRole] >= ROLE_LEVEL[atorRole]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Você só pode atribuir papéis abaixo do seu.",
    });
  }
}

/** Garante que o cliente do escopo do Portal existe e não foi removido. */
async function assertClienteValido(clienteId: string) {
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, deletedAt: null },
    select: { id: true },
  });
  if (!cliente) throw new TRPCError({ code: "BAD_REQUEST", message: "Cliente inválido." });
}

export async function listUsuarios() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { ...publicSelect, passwordHash: true },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });
  // "Pendente" = convidado mas ainda não definiu a senha. Nunca expomos o hash.
  // "protegido" = root primordial (não pode ser rebaixado/desativado/excluído).
  return users.map(({ passwordHash, ...u }) => ({ ...u, pendente: passwordHash === null, protegido: ehRootProtegido(u.email) }));
}

/** Equipe interna ativa (para atribuir responsáveis) — sem clientes de Portal. */
export function listEquipe() {
  return prisma.user.findMany({
    where: { ativo: true, deletedAt: null, role: { not: "CLIENTE" } },
    select: { id: true, nome: true, avatarUrl: true },
    orderBy: { nome: "asc" },
  });
}

export async function createUsuario(atorRole: Role, input: CreateUsuarioInput) {
  assertPodeAtribuir(atorRole, input.role);

  const clienteId = input.clienteId || null;
  if (input.role === "CLIENTE") {
    if (!clienteId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Selecione o cliente para o acesso ao Portal.",
      });
    }
    await assertClienteValido(clienteId);
  }

  const existe = await prisma.user.findUnique({ where: { email: input.email } });
  if (existe) {
    throw new TRPCError({ code: "CONFLICT", message: "Já existe um usuário com este e-mail." });
  }

  return prisma.user.create({
    data: {
      nome: input.nome.trim(),
      email: input.email,
      passwordHash: await hashPassword(input.senha),
      role: input.role,
      clienteId: input.role === "CLIENTE" ? clienteId : null,
      // ⚠️ SEM ESTA LINHA A CONTA NASCIA COM O PAPEL NULO — e nulo vale como RESPONSAVEL
      // (contas anteriores à ADR-131). Ou seja: toda secretária cadastrada pela tela da Med
      // podia aceitar proposta e assinar contrato, desfazendo na origem a trava da ADR-137.
      papelPortal:
        input.role === "CLIENTE" && clienteId ? await papelPortalPadraoDaClinica(clienteId) : null,
    },
    select: publicSelect,
  });
}

/**
 * Convida um usuário: cria o cadastro PENDENTE (sem senha, inativo) e dispara o
 * convite. A pessoa define a própria senha pelo link (fluxo seguro, sem o admin
 * conhecer a senha). Devolve o link só em modo dev.
 */
export async function convidarUsuario(atorRole: Role, input: InviteUsuarioInput) {
  assertPodeAtribuir(atorRole, input.role);

  const clienteId = input.clienteId || null;
  if (input.role === "CLIENTE") {
    if (!clienteId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione o cliente para o acesso ao Portal." });
    }
    await assertClienteValido(clienteId);
  }

  const existe = await prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
  if (existe) {
    throw new TRPCError({ code: "CONFLICT", message: "Já existe um usuário com este e-mail." });
  }

  const usuario = await prisma.user.create({
    data: {
      nome: input.nome.trim(),
      email: input.email,
      passwordHash: null, // pendente até aceitar o convite
      ativo: false,
      role: input.role,
      clienteId: input.role === "CLIENTE" ? clienteId : null,
      // Mesmo motivo de `createUsuario`: papel nulo = quem assina.
      papelPortal:
        input.role === "CLIENTE" && clienteId ? await papelPortalPadraoDaClinica(clienteId) : null,
    },
    select: publicSelect,
  });

  const convite = await gerarConvite(usuario.id, usuario.nome, usuario.email, usuario.role);
  return { usuario, ...convite };
}

/** Reenvia o convite (gera novo link e invalida o anterior) para um usuário ainda pendente. */
export async function reenviarConvite(atorRole: Role, id: string) {
  const alvo = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, nome: true, email: true, role: true, passwordHash: true },
  });
  if (!alvo) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
  }
  if (alvo.passwordHash !== null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Este usuário já definiu a senha." });
  }
  if (ROLE_LEVEL[alvo.role] >= ROLE_LEVEL[atorRole] && atorRole !== "ROOT") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão sobre este usuário." });
  }
  const convite = await gerarConvite(alvo.id, alvo.nome, alvo.email, alvo.role);
  return { ...convite, email: alvo.email };
}

export async function updateUsuario(atorId: string, atorRole: Role, input: UpdateUsuarioInput) {
  const alvo = await prisma.user.findUnique({ where: { id: input.id } });
  if (!alvo || alvo.deletedAt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
  }
  // Só se gerencia OUTROS usuários estritamente abaixo do seu papel (a si mesmo
  // sempre — com as restrições de auto-edição abaixo). EXCEÇÃO: o ROOT pode gerir
  // outros ROOTs (pares). Impede tomada de par por quem não é ROOT.
  if (input.id !== atorId && ROLE_LEVEL[alvo.role] >= ROLE_LEVEL[atorRole] && atorRole !== "ROOT") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão sobre este usuário." });
  }
  const protegido = ehRootProtegido(alvo.email);

  const data: {
    nome?: string;
    email?: string;
    role?: Role;
    ativo?: boolean;
    clienteId?: string | null;
    passwordHash?: string;
    acessoRevogadoEm?: Date | null;
  } = {};

  if (input.nome !== undefined) data.nome = input.nome.trim();

  // Troca de e-mail: valida unicidade entre usuários ativos (ignora tombstones de excluídos).
  if (input.email !== undefined && input.email !== alvo.email) {
    const emailEmUso = await prisma.user.findFirst({
      where: { email: input.email, deletedAt: null, id: { not: input.id } },
      select: { id: true },
    });
    if (emailEmUso) {
      throw new TRPCError({ code: "CONFLICT", message: "Já existe um usuário com este e-mail." });
    }
    data.email = input.email;
  }

  // Só valida/aplica papel quando ele realmente muda.
  if (input.role !== undefined && input.role !== alvo.role) {
    if (input.id === atorId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode alterar o próprio papel." });
    }
    if (protegido) {
      throw new TRPCError({ code: "FORBIDDEN", message: "O root principal não pode deixar de ser ROOT." });
    }
    assertPodeAtribuir(atorRole, input.role);
    data.role = input.role;
  }

  if (input.ativo !== undefined) {
    if (input.id === atorId && input.ativo === false) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode desativar a própria conta." });
    }
    if (protegido && input.ativo === false) {
      throw new TRPCError({ code: "FORBIDDEN", message: "O root principal não pode ser desativado." });
    }
    // A MESMA TRAVA DA ADR-131, AGORA TAMBÉM AQUI. A tela do Portal e a ficha do cliente já
    // recusavam deixar a clínica sem ninguém que assine; *Equipe e acessos* não perguntava, e
    // por ela dava para desativar o único responsável — em silêncio.
    if (input.ativo === false && alvo.role === "CLIENTE" && alvo.clienteId) {
      await assertSobraResponsavel(alvo.clienteId, { id: alvo.id, ativo: false });
    }
    data.ativo = input.ativo;
    // ⚠️ `ativo = false` É AMBÍGUO — e por isso desativar aqui não bastava (C8).
    //
    // Conta convidada que ainda não definiu senha TAMBÉM nasce inativa. Quem lê a situação
    // (`pessoas.service`: REVOGADO × CONVIDADO × ATIVO, e o `destinatarioDeAssinatura`) só
    // consegue distinguir os dois estados por `acessoRevogadoEm`. Sem a marca, quem teve o
    // acesso encerrado por esta tela aparecia como "convidado, ainda não entrou" — e a Med
    // ficava esperando o cliente aparecer num acesso que ela mesma tinha fechado.
    //
    // É a segunda porta do mesmo dado: `revogarAcessoDaPessoa` (a tela do Portal) já marcava;
    // *Equipe e acessos* não. Reativar apaga a marca pelo mesmo motivo, e é o que devolve o
    // caminho do convite/redefinição (`recusarSeAcessoRevogado`, em `auth.service`).
    data.acessoRevogadoEm = input.ativo === false ? new Date() : null;
  }

  const finalRole = data.role ?? alvo.role;
  const clienteInformado = input.clienteId !== undefined;
  const finalClienteId = clienteInformado ? input.clienteId || null : alvo.clienteId;

  if (finalRole === "CLIENTE") {
    if (!finalClienteId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cliente é obrigatório para acesso ao Portal.",
      });
    }
    await assertClienteValido(finalClienteId);
    data.clienteId = finalClienteId;
  } else {
    // Papéis internos não pertencem a um cliente.
    data.clienteId = null;
  }

  if (input.novaSenha) data.passwordHash = await hashPassword(input.novaSenha);

  const user = await prisma.user.update({ where: { id: input.id }, data, select: publicSelect });

  // Desativação, troca de senha ou de e-mail invalida as sessões abertas do alvo.
  if (data.ativo === false || data.passwordHash || data.email) {
    await prisma.session.deleteMany({ where: { userId: input.id } });
  }

  // ⚠️ DERRUBAR A SESSÃO NÃO BASTA: o convite vale 72 h e o reset, 1 h. Sem apagar os tokens,
  // quem foi desativado com um link ainda na caixa clicava nele, e `aceitarConvite`/
  // `redefinirSenha` gravam `ativo: true` — a conta desativada voltava a entrar sozinha.
  if (data.ativo === false || data.passwordHash) {
    await prisma.token.deleteMany({ where: { userId: input.id, usedAt: null } });
  }

  return user;
}

/** Quantos registros "vivos" um usuário é responsável — para decidir a transferência ao excluir. */
export async function resumoResponsabilidades(id: string) {
  const [clientes, leads, projetos, tarefas, participacoes] = await Promise.all([
    prisma.cliente.count({ where: { responsavelId: id, deletedAt: null } }),
    prisma.lead.count({ where: { responsavelId: id, deletedAt: null } }),
    prisma.projeto.count({ where: { responsavelId: id, deletedAt: null } }),
    prisma.card.count({ where: { responsavelId: id } }),
    prisma.projetoParticipante.count({ where: { userId: id } }),
  ]);
  const total = clientes + leads + projetos + tarefas;
  return { clientes, leads, projetos, tarefas, participacoes, total };
}

/**
 * Exclui um usuário (soft delete). Não apaga fisicamente: o histórico
 * (documentos, tarefas, atividade, mensagens) permanece atribuído a ele.
 * O e-mail é liberado (tombstone) para poder ser recadastrado.
 *
 * As RESPONSABILIDADES (clientes/leads/projetos/tarefas de que ele é responsável)
 * são transferidas para `transferirParaId`, ou zeradas (sem responsável) se vazio,
 * para nada ficar apontando para um usuário sem acesso.
 */
export async function deleteUsuario(
  atorId: string,
  atorRole: Role,
  id: string,
  transferirParaId?: string,
) {
  if (id === atorId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode excluir a própria conta." });
  }

  const alvo = await prisma.user.findUnique({ where: { id } });
  if (!alvo || alvo.deletedAt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
  }
  // Só se exclui usuário de papel estritamente abaixo do seu. EXCEÇÃO: o ROOT pode excluir
  // outro ROOT (par) — mas NUNCA o root primordial.
  if (ROLE_LEVEL[alvo.role] >= ROLE_LEVEL[atorRole] && atorRole !== "ROOT") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para excluir este usuário." });
  }
  if (ehRootProtegido(alvo.email)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "O root principal não pode ser excluído." });
  }

  // Valida o destino da transferência: membro da equipe ativo (nunca o próprio excluído nem um Cliente).
  const destinoId = transferirParaId || null;
  if (destinoId) {
    if (destinoId === id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Destino inválido para a transferência." });
    }
    const destino = await prisma.user.findFirst({
      where: { id: destinoId, ativo: true, deletedAt: null, role: { not: "CLIENTE" } },
      select: { id: true },
    });
    if (!destino) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha um membro da equipe ativo para receber as responsabilidades." });
    }
  }

  const transferencia = await prisma.$transaction(async (tx) => {
    const [clientes, leads, projetos, tarefas] = await Promise.all([
      tx.cliente.updateMany({ where: { responsavelId: id }, data: { responsavelId: destinoId } }),
      tx.lead.updateMany({ where: { responsavelId: id }, data: { responsavelId: destinoId } }),
      tx.projeto.updateMany({ where: { responsavelId: id }, data: { responsavelId: destinoId } }),
      tx.card.updateMany({ where: { responsavelId: id }, data: { responsavelId: destinoId } }),
    ]);
    // Remove as participações do excluído (evita "membro fantasma" nos projetos).
    await tx.projetoParticipante.deleteMany({ where: { userId: id } });

    await tx.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        ativo: false,
        // Libera o e-mail (mantém o @unique) para permitir recadastro futuro.
        email: `deleted+${Date.now()}+${alvo.email}`.slice(0, 190),
      },
    });
    await tx.session.deleteMany({ where: { userId: id } });

    return {
      clientes: clientes.count,
      leads: leads.count,
      projetos: projetos.count,
      tarefas: tarefas.count,
    };
  });

  return { id, transferido: !!destinoId, ...transferencia };
}
