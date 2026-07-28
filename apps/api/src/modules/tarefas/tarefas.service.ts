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
  responsavel: { select: { id: true, nome: true, avatarUrl: true } },
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
  // "Comigo" = sou o responsável · "Deleguei" = eu pedi · "Equipe" = tudo (só gestão).
  let escopo: Record<string, unknown>;
  if (input.aba === "COMIGO") escopo = { responsavelId: ctx.userId };
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
    prisma.tarefa.count({ where: { ...aberta, responsavelId: ctx.userId } }),
    prisma.tarefa.count({ where: { ...aberta, criadoPorId: ctx.userId } }),
  ]);
  return { comigo, deleguei };
}

async function tarefaComAcesso(id: string, ctx: Ctx, opts: { donoApenas?: boolean } = {}) {
  const tarefa = await prisma.tarefa.findFirst({ where: { id, deletedAt: null } });
  if (!tarefa) throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada." });
  const admin = hasRoleLevel(ctx.role as never, "ADMIN");
  const ehDono = tarefa.criadoPorId === ctx.userId;
  const ehResponsavel = tarefa.responsavelId === ctx.userId;
  const permitido = opts.donoApenas ? ehDono || admin : ehDono || ehResponsavel || admin;
  if (!permitido) throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode alterar esta tarefa." });
  return tarefa;
}

/** Avisa o responsável de que uma tarefa foi delegada a ele (não avisa quando é você mesmo). */
async function avisarDelegacao(tarefa: { id: string; titulo: string; responsavelId: string; criadoPorId: string }) {
  if (tarefa.responsavelId === tarefa.criadoPorId) return;
  const dePor = await prisma.user.findUnique({ where: { id: tarefa.criadoPorId }, select: { nome: true } });
  await notificar(
    tarefa.responsavelId,
    "tarefa_delegada",
    { tarefa: tarefa.titulo, dePor: dePor?.nome ?? "Alguém da equipe" },
    { entidadeTipo: "tarefa", entidadeId: tarefa.id },
  );
}

/** Avisa quem pediu de que a tarefa foi concluída (não avisa quando você conclui a sua própria). */
async function avisarConclusao(tarefa: { id: string; titulo: string; responsavelId: string; criadoPorId: string }) {
  if (tarefa.responsavelId === tarefa.criadoPorId) return;
  const porQuem = await prisma.user.findUnique({ where: { id: tarefa.responsavelId }, select: { nome: true } });
  await notificar(
    tarefa.criadoPorId,
    "tarefa_concluida",
    { tarefa: tarefa.titulo, porQuem: porQuem?.nome ?? "O responsável" },
    { entidadeTipo: "tarefa", entidadeId: tarefa.id },
  );
}

export async function createTarefa(input: CreateTarefaInput, ctx: Ctx) {
  const responsavelId = clean(input.responsavelId) ?? ctx.userId;
  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: input.titulo.trim(),
      descricao: clean(input.descricao),
      criadoPorId: ctx.userId,
      responsavelId,
      prazo: input.prazo ?? null,
      prioridade: input.prioridade,
      clienteId: clean(input.clienteId),
      projetoId: clean(input.projetoId),
    },
    include,
  });
  await avisarDelegacao(tarefa);
  return tarefa;
}

export async function updateTarefa(input: UpdateTarefaInput, ctx: Ctx) {
  const atual = await tarefaComAcesso(input.id, ctx);
  const novoResponsavel = input.responsavelId !== undefined ? clean(input.responsavelId) ?? ctx.userId : atual.responsavelId;

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
      responsavelId: novoResponsavel,
      ...(input.prazo !== undefined ? { prazo: input.prazo ?? null } : {}),
      ...(input.prioridade !== undefined ? { prioridade: input.prioridade } : {}),
      ...(input.clienteId !== undefined ? { clienteId: clean(input.clienteId) } : {}),
      ...(input.projetoId !== undefined ? { projetoId: clean(input.projetoId) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      concluidaEm,
    },
    include,
  });

  // Avisa se delegou para uma pessoa nova; avisa quem pediu se acabou de concluir.
  if (novoResponsavel !== atual.responsavelId) await avisarDelegacao(tarefa);
  if (input.status === "CONCLUIDA" && atual.status !== "CONCLUIDA") await avisarConclusao(tarefa);
  return tarefa;
}

export async function setStatus(id: string, status: TarefaStatus, ctx: Ctx) {
  const atual = await tarefaComAcesso(id, ctx);
  const tarefa = await prisma.tarefa.update({
    where: { id },
    data: { status, concluidaEm: status === "CONCLUIDA" ? new Date() : null },
    include,
  });
  if (status === "CONCLUIDA" && atual.status !== "CONCLUIDA") await avisarConclusao(tarefa);
  return tarefa;
}

export async function removeTarefa(id: string, ctx: Ctx) {
  await tarefaComAcesso(id, ctx, { donoApenas: true });
  await prisma.tarefa.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
