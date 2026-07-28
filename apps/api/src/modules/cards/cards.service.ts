import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type {
  CreateCardInput,
  UpdateCardInput,
  MoveCardInput,
  AddChecklistInput,
} from "@app/shared";
import { notificar } from "../notificacoes/notificacoes.service.js";
import { reconciliarStatusProjeto, reconciliarStatusCard } from "../projetos/projetos.service.js";

const clean = (v?: string | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** Avisa o responsável quando uma tarefa é atribuída a ele por outra pessoa. */
async function notificarAtribuicao(
  card: { id: string; titulo: string; projetoId: string; responsavelId: string | null },
  atribuidoPor: string,
): Promise<void> {
  if (!card.responsavelId || card.responsavelId === atribuidoPor) return;
  const projeto = await prisma.projeto.findUnique({
    where: { id: card.projetoId },
    select: { nome: true },
  });
  await notificar(
    card.responsavelId,
    "tarefa_atribuida",
    { tarefa: card.titulo, projeto: projeto?.nome ?? "" },
    { entidadeTipo: "projeto", entidadeId: card.projetoId },
  );
}

/** Cards do projeto com checklist e agregados de tempo (para o kanban). */
export async function listCards(projetoId: string, userId: string) {
  const cards = await prisma.card.findMany({
    where: { projetoId, deletedAt: null },
    orderBy: [{ status: "asc" }, { ordem: "asc" }],
    include: {
      responsavel: { select: { nome: true } },
      servico: { select: { nome: true } },
      checklist: { orderBy: { ordem: "asc" } },
      timeEntries: true,
    },
  });

  return cards.map((c) => {
    const tempoTotalSeg = c.timeEntries.reduce((s, e) => s + (e.duracaoSeg ?? 0), 0);
    const rodando = c.timeEntries.find((e) => e.userId === userId && e.fim === null);
    const { timeEntries: _te, ...rest } = c;
    return { ...rest, tempoTotalSeg, timerInicio: rodando?.inicio ?? null };
  });
}

export async function createCard(input: CreateCardInput, userId: string) {
  const status = input.status ?? "A_FAZER";
  const max = await prisma.card.aggregate({
    where: { projetoId: input.projetoId, status, deletedAt: null },
    _max: { ordem: true },
  });
  const card = await prisma.card.create({
    data: {
      projetoId: input.projetoId,
      titulo: input.titulo.trim(),
      descricao: clean(input.descricao),
      status,
      prioridade: input.prioridade,
      prazo: input.prazo ?? null,
      ordem: (max._max.ordem ?? -1) + 1,
      // Vazio = o criador vira responsável.
      responsavelId: input.responsavelId || userId,
    },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "card.criado", entidadeTipo: "card", entidadeId: card.id },
  });
  await notificarAtribuicao(card, userId);
  // Um cartão novo (retrabalho) reabre um projeto que estava Concluído.
  await reconciliarStatusProjeto(card.projetoId);
  return card;
}

export async function updateCard(input: UpdateCardInput, userId: string) {
  const { id, ...rest } = input;
  const atual = await prisma.card.findUnique({ where: { id }, select: { responsavelId: true } });

  const data: Record<string, unknown> = {};
  if (rest.titulo !== undefined) data.titulo = rest.titulo.trim();
  if (rest.descricao !== undefined) data.descricao = clean(rest.descricao);
  if (rest.prioridade !== undefined) data.prioridade = rest.prioridade;
  if (rest.prazo !== undefined) data.prazo = rest.prazo ?? null;
  if (rest.responsavelId !== undefined) data.responsavelId = rest.responsavelId || null;

  const card = await prisma.card.update({ where: { id }, data });

  // Notifica só quando o responsável muda para outra pessoa.
  const novoResp = rest.responsavelId !== undefined ? rest.responsavelId || null : undefined;
  if (novoResp !== undefined && novoResp !== atual?.responsavelId) {
    await notificarAtribuicao(card, userId);
  }
  return card;
}

/** Move o card para uma coluna/posição, renumerando o destino. Aplica as automações. */
export async function moveCard(input: MoveCardInput) {
  const card = await prisma.card.findUnique({ where: { id: input.id } });
  if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Cartão não encontrado" });

  const destino = await prisma.card.findMany({
    where: { projetoId: card.projetoId, status: input.status, deletedAt: null, id: { not: input.id } },
    orderBy: { ordem: "asc" },
    select: { id: true },
  });
  const ids = destino.map((d) => d.id);
  const alvo = Math.max(0, Math.min(input.ordem, ids.length));
  ids.splice(alvo, 0, input.id);

  await prisma.$transaction(
    ids.map((id, i) =>
      prisma.card.update({ where: { id }, data: { ordem: i, status: input.status } }),
    ),
  );

  // Ao concluir um cartão, encerra as sessões de tempo abertas dele (não fica rodando).
  if (input.status === "CONCLUIDO" && card.status !== "CONCLUIDO") {
    const abertas = await prisma.timeEntry.findMany({ where: { cardId: input.id, fim: null }, select: { id: true, inicio: true } });
    const fim = new Date();
    for (const t of abertas) {
      await prisma.timeEntry.update({
        where: { id: t.id },
        data: { fim, duracaoSeg: Math.max(0, Math.round((fim.getTime() - t.inicio.getTime()) / 1000)) },
      });
    }
  }

  await reconciliarStatusProjeto(card.projetoId);
  return { ok: true };
}

export async function removeCard(id: string) {
  const card = await prisma.card.update({ where: { id }, data: { deletedAt: new Date() }, select: { projetoId: true } });
  // Remover o último cartão pendente pode concluir o projeto (ou reabri-lo, se era o único).
  await reconciliarStatusProjeto(card.projetoId);
  return { ok: true };
}

// ── Detalhe do card (painel) ─────────────────────────────
export async function getCard(id: string, userId: string) {
  const card = await prisma.card.findFirst({
    where: { id, deletedAt: null },
    include: {
      responsavel: { select: { nome: true } },
      checklist: { orderBy: { ordem: "asc" } },
      timeEntries: { orderBy: { inicio: "desc" }, include: { user: { select: { nome: true } } } },
    },
  });
  if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Cartão não encontrado" });

  const comentarios = await prisma.nota.findMany({
    where: { entidadeTipo: "card", entidadeId: id },
    include: { autor: { select: { nome: true } } },
    orderBy: { createdAt: "desc" },
  });
  const tempoTotalSeg = card.timeEntries.reduce((s, e) => s + (e.duracaoSeg ?? 0), 0);
  // Timer rodando é POR USUÁRIO (só o do usuário atual conta como "rodando" para ele).
  const rodando = card.timeEntries.find((e) => e.userId === userId && e.fim === null);
  return { ...card, comentarios, tempoTotalSeg, timerInicio: rodando?.inicio ?? null };
}

// ── Checklist ────────────────────────────────────────────
export async function addChecklist(input: AddChecklistInput) {
  const max = await prisma.checklistItem.aggregate({
    where: { cardId: input.cardId },
    _max: { ordem: true },
  });
  const item = await prisma.checklistItem.create({
    data: { cardId: input.cardId, texto: input.texto.trim(), ordem: (max._max.ordem ?? -1) + 1 },
  });
  // Um item novo (não concluído) reabre um card que estava Concluído.
  await reconciliarStatusCard(input.cardId);
  return item;
}

export async function toggleChecklist(id: string, concluido: boolean) {
  const item = await prisma.checklistItem.findUnique({ where: { id }, select: { cardId: true, requisitoId: true } });
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado" });
  // Itens ligados a uma exigência são entregas do CLIENTE — marcam-se sozinhos, a equipe não altera.
  if (item.requisitoId) return { movidoPara: null };
  await prisma.checklistItem.update({ where: { id }, data: { concluido } });
  // Marcar itens pode mover o card sozinho (automação); devolve a coluna nova para avisar quem marcou.
  const movidoPara = await reconciliarStatusCard(item.cardId);
  return { movidoPara };
}

export async function removeChecklist(id: string) {
  const item = await prisma.checklistItem.findUnique({ where: { id }, select: { cardId: true } });
  await prisma.checklistItem.delete({ where: { id } });
  if (item) await reconciliarStatusCard(item.cardId);
  return { ok: true };
}

// ── Comentários (reusa Nota polimórfica) ─────────────────
export function addComentario(cardId: string, conteudo: string, userId: string) {
  return prisma.nota.create({
    data: { autorId: userId, entidadeTipo: "card", entidadeId: cardId, conteudo: conteudo.trim() },
    include: { autor: { select: { nome: true } } },
  });
}

/** Editar comentário — só o próprio autor. */
export async function editComentario(id: string, conteudo: string, userId: string) {
  const nota = await prisma.nota.findUnique({ where: { id }, select: { autorId: true, entidadeTipo: true } });
  if (!nota || nota.entidadeTipo !== "card") throw new TRPCError({ code: "NOT_FOUND", message: "Comentário não encontrado" });
  if (nota.autorId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode editar seus próprios comentários." });
  return prisma.nota.update({
    where: { id },
    data: { conteudo: conteudo.trim() },
    include: { autor: { select: { nome: true } } },
  });
}

/** Apagar comentário — o próprio autor ou um gestor (ADMIN/ROOT, para moderação). */
export async function removeComentario(id: string, userId: string, isGestor: boolean) {
  const nota = await prisma.nota.findUnique({ where: { id }, select: { autorId: true, entidadeTipo: true } });
  if (!nota || nota.entidadeTipo !== "card") throw new TRPCError({ code: "NOT_FOUND", message: "Comentário não encontrado" });
  if (nota.autorId !== userId && !isGestor) throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode apagar este comentário." });
  await prisma.nota.delete({ where: { id } });
  return { ok: true };
}

// ── Timer ────────────────────────────────────────────────
export async function startTimer(cardId: string, userId: string) {
  const rodando = await prisma.timeEntry.findFirst({ where: { cardId, userId, fim: null } });
  if (rodando) return rodando;
  return prisma.timeEntry.create({ data: { cardId, userId } });
}

export async function stopTimer(cardId: string, userId: string) {
  // Fecha TODAS as sessões abertas do usuário neste card (robustez contra duplicatas).
  const abertas = await prisma.timeEntry.findMany({ where: { cardId, userId, fim: null } });
  if (abertas.length === 0) return { ok: true };
  const fim = new Date();
  await prisma.$transaction(
    abertas.map((e) =>
      prisma.timeEntry.update({
        where: { id: e.id },
        data: { fim, duracaoSeg: Math.max(0, Math.round((fim.getTime() - e.inicio.getTime()) / 1000)) },
      }),
    ),
  );
  return { ok: true };
}
