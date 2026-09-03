import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { hasRoleLevel, type CreateTarefaInput, type UpdateTarefaInput, type ListTarefasInput, type TarefaStatus } from "@app/shared";
import { notificar } from "../notificacoes/notificacoes.service.js";

/** Contexto do usuário logado. */
export type Ctx = { userId: string; role: string };

const clean = (v?: string | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

const include = {
  responsaveis: { include: { user: { select: { id: true, nome: true, avatarUrl: true } } } },
  criadoPor: { select: { id: true, nome: true, avatarUrl: true } },
  cliente: { select: { id: true, nome: true } },
  projeto: { select: { id: true, nome: true } },
} as const;

/** Filtro por situação (o "ABERTAS" some com as concluídas). */
function whereFiltro(filtro: ListTarefasInput["filtro"]) {
  if (filtro === "ABERTAS") return { status: { not: "CONCLUIDA" as TarefaStatus } };
  if (filtro === "CONCLUIDAS") return { status: "CONCLUIDA" as TarefaStatus };
  return {};
}

export async function listTarefas(input: ListTarefasInput, ctx: Ctx) {
  // "Comigo" = sou um dos responsáveis · "Deleguei" = eu pedi · "Equipe" = tudo (só gestão).
  let escopo: Record<string, unknown>;
  if (input.aba === "COMIGO") escopo = { responsaveis: { some: { userId: ctx.userId } } };
  else if (input.aba === "DELEGUEI") escopo = { criadoPorId: ctx.userId };
  else {
    if (!hasRoleLevel(ctx.role as never, "ADMIN"))
      throw new TRPCError({ code: "FORBIDDEN", message: "A visão da equipe é restrita a administradores." });
    escopo = {};
  }

  return prisma.tarefa.findMany({
    where: { deletedAt: null, ...escopo, ...whereFiltro(input.filtro) },
    include,
    // Abertas primeiro; entre elas, quem tem prazo mais próximo; depois as mais recentes.
    orderBy: [{ concluidaEm: "asc" }, { prazo: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

/** Contadores para os selos das abas (o que está aberto em cada visão). */
export async function contarTarefas(ctx: Ctx) {
  const aberta = { deletedAt: null, status: { not: "CONCLUIDA" as TarefaStatus } };
  const [comigo, deleguei] = await Promise.all([
    prisma.tarefa.count({ where: { ...aberta, responsaveis: { some: { userId: ctx.userId } } } }),
    prisma.tarefa.count({ where: { ...aberta, criadoPorId: ctx.userId } }),
  ]);
  return { comigo, deleguei };
}

/** Normaliza a lista de responsáveis: sem vazios/duplicados; vazio = só eu. */
export function normalizarResponsaveis(ids: string[] | undefined, ctx: Ctx): string[] {
  const limpos = [...new Set((ids ?? []).map((x) => x.trim()).filter(Boolean))];
  return limpos.length > 0 ? limpos : [ctx.userId];
}

async function tarefaComAcesso(id: string, ctx: Ctx, opts: { donoApenas?: boolean } = {}) {
  const tarefa = await prisma.tarefa.findFirst({
    where: { id, deletedAt: null },
    include: { responsaveis: { select: { userId: true } } },
  });
  if (!tarefa) throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada." });
  const admin = hasRoleLevel(ctx.role as never, "ADMIN");
  const ehDono = tarefa.criadoPorId === ctx.userId;
  const ehResponsavel = tarefa.responsaveis.some((r) => r.userId === ctx.userId);
  const permitido = opts.donoApenas ? ehDono || admin : ehDono || ehResponsavel || admin;
  if (!permitido) throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode alterar esta tarefa." });
  return tarefa;
}

/** Avisa cada responsável recém-atribuído (menos quem criou/você mesmo). */
export async function avisarDelegacao(tarefa: { id: string; titulo: string; criadoPorId: string }, paraIds: string[]) {
  const destinatarios = [...new Set(paraIds)].filter((uid) => uid !== tarefa.criadoPorId);
  if (destinatarios.length === 0) return;
  const dePor = await prisma.user.findUnique({ where: { id: tarefa.criadoPorId }, select: { nome: true } });
  await Promise.all(
    destinatarios.map((uid) =>
      notificar(
        uid,
        "tarefa_delegada",
        { tarefa: tarefa.titulo, dePor: dePor?.nome ?? "Alguém da equipe" },
        { entidadeTipo: "tarefa", entidadeId: tarefa.id },
      ),
    ),
  );
}

/** Avisa quem pediu de que a tarefa foi concluída (não avisa quando é você mesmo quem pediu). */
async function avisarConclusao(tarefa: { id: string; titulo: string; criadoPorId: string }, porUserId: string) {
  if (porUserId === tarefa.criadoPorId) return;
  const porQuem = await prisma.user.findUnique({ where: { id: porUserId }, select: { nome: true } });
  await notificar(
    tarefa.criadoPorId,
    "tarefa_concluida",
    { tarefa: tarefa.titulo, porQuem: porQuem?.nome ?? "O responsável" },
    { entidadeTipo: "tarefa", entidadeId: tarefa.id },
  );
}

/**
 * O `create` do Prisma, isolado — a ÚNICA montagem de uma tarefa nova nesta casa.
 *
 * ⚠️ **Existe porque há duas portas para criar tarefa, e a regra não pode morar nas duas.** A
 * humana é o `createTarefa` logo abaixo; a outra é a API do agente (CORA-003), que precisa
 * gravar **dentro da própria transação** para a reserva da chave de idempotência e a tarefa
 * entrarem ou não entrarem juntas. Duplicar a montagem seria o modo de falha da ADR-133: dois
 * lugares divergindo, e o segundo ficando para trás sem ninguém notar.
 *
 * Recebe o cliente do Prisma (`prisma` ou o cliente de uma transação) de propósito.
 */
export async function montarTarefa(
  db: Pick<typeof prisma, "tarefa">,
  dados: {
    titulo: string;
    descricao?: string | null;
    criadoPorId: string;
    prazo: Date | null;
    prioridade: CreateTarefaInput["prioridade"];
    clienteId?: string | null;
    projetoId?: string | null;
    responsavelIds: string[];
  },
) {
  return db.tarefa.create({
    data: {
      titulo: dados.titulo.trim(),
      descricao: clean(dados.descricao),
      criadoPorId: dados.criadoPorId,
      prazo: dados.prazo,
      prioridade: dados.prioridade,
      clienteId: clean(dados.clienteId),
      projetoId: clean(dados.projetoId),
      responsaveis: { create: dados.responsavelIds.map((userId) => ({ userId })) },
    },
    include,
  });
}

export async function createTarefa(input: CreateTarefaInput, ctx: Ctx) {
  const responsaveis = normalizarResponsaveis(input.responsavelIds, ctx);
  const tarefa = await montarTarefa(prisma, {
    titulo: input.titulo,
    descricao: input.descricao,
    criadoPorId: ctx.userId,
    prazo: input.prazo ?? null,
    prioridade: input.prioridade,
    clienteId: input.clienteId,
    projetoId: input.projetoId,
    responsavelIds: responsaveis,
  });
  await avisarDelegacao(tarefa, responsaveis);
  return tarefa;
}

export async function updateTarefa(input: UpdateTarefaInput, ctx: Ctx) {
  const atual = await tarefaComAcesso(input.id, ctx);
  const idsAntes = atual.responsaveis.map((r) => r.userId);
  const trocaResponsaveis = input.responsavelIds !== undefined;
  const novosIds = trocaResponsaveis ? normalizarResponsaveis(input.responsavelIds, ctx) : idsAntes;

  // Concluir grava a data; reabrir limpa.
  let concluidaEm = atual.concluidaEm;
  if (input.status && input.status !== atual.status) {
    concluidaEm = input.status === "CONCLUIDA" ? new Date() : null;
  }

  const tarefa = await prisma.tarefa.update({
    where: { id: input.id },
    data: {
      ...(input.titulo !== undefined ? { titulo: input.titulo.trim() } : {}),
      ...(input.descricao !== undefined ? { descricao: clean(input.descricao) } : {}),
      ...(input.prazo !== undefined ? { prazo: input.prazo ?? null } : {}),
      ...(input.prioridade !== undefined ? { prioridade: input.prioridade } : {}),
      ...(input.clienteId !== undefined ? { clienteId: clean(input.clienteId) } : {}),
      ...(input.projetoId !== undefined ? { projetoId: clean(input.projetoId) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      concluidaEm,
      ...(trocaResponsaveis ? { responsaveis: { deleteMany: {}, create: novosIds.map((userId) => ({ userId })) } } : {}),
    },
    include,
  });

  // Avisa só os responsáveis recém-adicionados; avisa quem pediu se acabou de concluir.
  if (trocaResponsaveis) {
    const adicionados = novosIds.filter((uid) => !idsAntes.includes(uid));
    await avisarDelegacao(tarefa, adicionados);
  }
  if (input.status === "CONCLUIDA" && atual.status !== "CONCLUIDA") await avisarConclusao(tarefa, ctx.userId);
  return tarefa;
}

export async function setStatus(id: string, status: TarefaStatus, ctx: Ctx) {
  const atual = await tarefaComAcesso(id, ctx);
  const tarefa = await prisma.tarefa.update({
    where: { id },
    data: { status, concluidaEm: status === "CONCLUIDA" ? new Date() : null },
    include,
  });
  if (status === "CONCLUIDA" && atual.status !== "CONCLUIDA") await avisarConclusao(tarefa, ctx.userId);
  return tarefa;
}

export async function removeTarefa(id: string, ctx: Ctx) {
  await tarefaComAcesso(id, ctx, { donoApenas: true });
  await prisma.tarefa.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
