import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { CreateProjetoInput, UpdateProjetoInput, CardStatus } from "@app/shared";
import { notificar } from "../notificacoes/notificacoes.service.js";

const clean = (v?: string | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export function listProjetos(clienteId?: string) {
  return prisma.projeto.findMany({
    where: { deletedAt: null, ...(clienteId ? { clienteId } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      cliente: { select: { id: true, nome: true } },
      responsavel: { select: { nome: true } },
      // Cartões (status + prazo) para calcular progresso e atrasos na lista.
      cards: { where: { deletedAt: null }, select: { status: true, prazo: true } },
      // Próxima reunião do projeto (integração Agenda).
      eventos: {
        where: { inicio: { gte: new Date() } },
        orderBy: { inicio: "asc" },
        take: 1,
        select: { id: true, titulo: true, inicio: true },
      },
    },
  });
}

export async function getProjeto(id: string) {
  const projeto = await prisma.projeto.findFirst({
    where: { id, deletedAt: null },
    include: {
      cliente: { select: { id: true, nome: true } },
      responsavel: { select: { nome: true } },
      participantes: {
        include: { user: { select: { id: true, nome: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!projeto) throw new TRPCError({ code: "NOT_FOUND", message: "Projeto não encontrado" });
  return projeto;
}

/** Substitui a lista de participantes do projeto e avisa os recém-adicionados. */
export async function setParticipantes(projetoId: string, userIds: string[], atorId: string) {
  const projeto = await prisma.projeto.findFirst({
    where: { id: projetoId, deletedAt: null },
    select: { id: true, nome: true },
  });
  if (!projeto) throw new TRPCError({ code: "NOT_FOUND", message: "Projeto não encontrado" });

  const atuais = await prisma.projetoParticipante.findMany({
    where: { projetoId },
    select: { userId: true },
  });
  const atuaisSet = new Set(atuais.map((p) => p.userId));
  const novosSet = new Set(userIds);
  const paraRemover = [...atuaisSet].filter((id) => !novosSet.has(id));
  const paraAdicionar = userIds.filter((id) => !atuaisSet.has(id));

  await prisma.$transaction([
    prisma.projetoParticipante.deleteMany({ where: { projetoId, userId: { in: paraRemover } } }),
    prisma.projetoParticipante.createMany({
      data: paraAdicionar.map((userId) => ({ projetoId, userId })),
      skipDuplicates: true,
    }),
  ]);

  for (const userId of paraAdicionar) {
    if (userId === atorId) continue;
    await notificar(
      userId,
      "projeto_participante",
      { projeto: projeto.nome },
      { entidadeTipo: "projeto", entidadeId: projetoId },
    );
  }
  return { ok: true };
}

export async function createProjeto(input: CreateProjetoInput, userId: string) {
  const projeto = await prisma.projeto.create({
    data: {
      clienteId: input.clienteId,
      nome: input.nome.trim(),
      descricao: clean(input.descricao),
      previsaoFim: input.previsaoFim ?? null,
      responsavelId: input.responsavelId || userId,
    },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "projeto.criado", entidadeTipo: "projeto", entidadeId: projeto.id },
  });
  return projeto;
}

export async function updateProjeto(input: UpdateProjetoInput) {
  const { id, ...rest } = input;
  const data: Record<string, unknown> = {};
  if (rest.nome !== undefined) data.nome = rest.nome.trim();
  if (rest.descricao !== undefined) data.descricao = clean(rest.descricao);
  if (rest.status !== undefined) data.status = rest.status;
  if (rest.previsaoFim !== undefined) data.previsaoFim = rest.previsaoFim ?? null;
  if (rest.responsavelId !== undefined) data.responsavelId = rest.responsavelId || null;
  return prisma.projeto.update({ where: { id }, data });
}

export async function removeProjeto(id: string, userId: string) {
  await prisma.projeto.update({ where: { id }, data: { deletedAt: new Date() } });
  await prisma.activityLog.create({
    data: { userId, acao: "projeto.removido", entidadeTipo: "projeto", entidadeId: id },
  });
  return { ok: true };
}

// ── Automação do kanban por serviço ──────────────────────
// Um card gerado de um serviço tem `servicoId` e um checklist com: as ENTREGAS DO CLIENTE
// (exigências obrigatórias — marcam-se sozinhas quando o cliente entrega) + os PASSOS do
// serviço (a equipe marca). O status do card anda sozinho conforme isso.

/**
 * Auto-status do PROJETO: conclui sozinho quando todos os cartões estão em "Concluído" e
 * reabre (ATIVO) se algum sair de "Concluído". Só registra no histórico. (Movido de cards.)
 */
export async function reconciliarStatusProjeto(projetoId: string): Promise<void> {
  const projeto = await prisma.projeto.findUnique({ where: { id: projetoId }, select: { status: true } });
  if (!projeto) return;
  const [total, concluidos] = await Promise.all([
    prisma.card.count({ where: { projetoId, deletedAt: null } }),
    prisma.card.count({ where: { projetoId, deletedAt: null, status: "CONCLUIDO" } }),
  ]);
  const todosConcluidos = total > 0 && concluidos === total;
  if (todosConcluidos && projeto.status === "ATIVO") {
    await prisma.projeto.update({ where: { id: projetoId }, data: { status: "CONCLUIDO" } });
    await prisma.activityLog.create({ data: { userId: null, acao: "projeto.concluido", entidadeTipo: "projeto", entidadeId: projetoId, dados: { auto: true } } });
  } else if (!todosConcluidos && projeto.status === "CONCLUIDO") {
    await prisma.projeto.update({ where: { id: projetoId }, data: { status: "ATIVO" } });
    await prisma.activityLog.create({ data: { userId: null, acao: "projeto.reaberto", entidadeTipo: "projeto", entidadeId: projetoId, dados: { auto: true } } });
  }
}

/** Situação atual das exigências de um serviço para o cliente (documento→arquivo; info/briefing→resposta ENVIADO). */
async function fulfillmentDoServico(clienteId: string, servicoId: string) {
  const requisitos = await prisma.servicoRequisito.findMany({
    where: { servicoId },
    orderBy: { ordem: "asc" },
    select: { id: true, titulo: true, tipo: true, obrigatorio: true },
  });
  const reqIds = requisitos.map((r) => r.id);
  const [arquivos, respostas] = await Promise.all([
    reqIds.length ? prisma.arquivo.findMany({ where: { clienteId, deletedAt: null, requisitoId: { in: reqIds } }, select: { requisitoId: true } }) : Promise.resolve([]),
    reqIds.length ? prisma.formularioResposta.findMany({ where: { clienteId, status: "ENVIADO", requisitoId: { in: reqIds } }, select: { requisitoId: true } }) : Promise.resolve([]),
  ]);
  const comArquivo = new Set(arquivos.map((a) => a.requisitoId));
  const comResposta = new Set(respostas.map((r) => r.requisitoId));
  const atendido = new Map<string, boolean>();
  for (const r of requisitos) atendido.set(r.id, r.tipo === "DOCUMENTO" ? comArquivo.has(r.id) : comResposta.has(r.id));
  return { requisitos, atendido };
}

/**
 * Recalcula o STATUS de um card pela sua checklist e move para a coluna certa (automação):
 * há entrega do cliente pendente → Aguardando cliente; tudo feito → Concluído; algo feito →
 * Em andamento; nada → A fazer. Nunca mexe em "Aguardando terceiros" (coluna manual).
 * Retorna a NOVA coluna quando o card foi movido (para avisar quem marcou), ou null se ficou parado.
 */
export async function reconciliarStatusCard(cardId: string): Promise<CardStatus | null> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, status: true, projetoId: true, checklist: { select: { concluido: true, requisitoId: true } } },
  });
  if (!card || card.status === "AGUARDANDO_TERCEIROS") return null;
  const total = card.checklist.length;
  const feitos = card.checklist.filter((c) => c.concluido).length;
  const pendenteCliente = card.checklist.some((c) => c.requisitoId && !c.concluido);
  const novo: CardStatus = pendenteCliente
    ? "AGUARDANDO_CLIENTE"
    : total > 0 && feitos === total
      ? "CONCLUIDO"
      : feitos > 0
        ? "EM_ANDAMENTO"
        : "A_FAZER";
  if (novo !== card.status) {
    const max = await prisma.card.aggregate({ where: { projetoId: card.projetoId, status: novo, deletedAt: null }, _max: { ordem: true } });
    await prisma.card.update({ where: { id: cardId }, data: { status: novo, ordem: (max._max.ordem ?? -1) + 1 } });
    await reconciliarStatusProjeto(card.projetoId);
    return novo;
  }
  return null;
}

type RoteiroTarefa = { titulo: string; itens: string[] };

/**
 * Cria os cartões de um serviço no projeto: 1 cartão "Do cliente" (exigências obrigatórias,
 * marcam-se sozinhas) + 1 cartão por TAREFA do roteiro do serviço (cada um com seu checklist
 * de passos, marcados pela equipe). Fallback: sem roteiro e sem exigências → 1 cartão com o
 * nome do serviço. Cada cartão nasce em "A fazer"; o status é recalculado logo em seguida.
 */
async function criarCardsDoServico(projetoId: string, servicoId: string, servicoNome: string, clienteId: string, responsavelId: string | null): Promise<void> {
  const [servico, { requisitos, atendido }] = await Promise.all([
    prisma.servico.findUnique({ where: { id: servicoId }, select: { roteiro: true } }),
    fulfillmentDoServico(clienteId, servicoId),
  ]);
  const roteiro: RoteiroTarefa[] = Array.isArray(servico?.roteiro)
    ? (servico!.roteiro as unknown[]).filter((t): t is RoteiroTarefa => !!t && typeof (t as { titulo?: unknown }).titulo === "string")
    : [];
  const obrigatorias = requisitos.filter((r) => r.obrigatorio);

  const maxAgg = await prisma.card.aggregate({ where: { projetoId, status: "A_FAZER", deletedAt: null }, _max: { ordem: true } });
  let ordem = (maxAgg._max.ordem ?? -1) + 1;
  const criados: string[] = [];

  // Cartão das entregas do cliente (só se houver exigências obrigatórias).
  if (obrigatorias.length) {
    const card = await prisma.card.create({
      data: {
        projetoId,
        titulo: "Entregas do cliente",
        servicoId,
        status: "A_FAZER",
        ordem: ordem++,
        responsavelId,
        checklist: { create: obrigatorias.map((r, i) => ({ texto: r.titulo, requisitoId: r.id, concluido: atendido.get(r.id) ?? false, ordem: i })) },
      },
      select: { id: true },
    });
    criados.push(card.id);
  }

  // Um cartão por tarefa do roteiro, com o checklist da tarefa.
  for (const tarefa of roteiro) {
    const itens = (Array.isArray(tarefa.itens) ? tarefa.itens : []).filter((t) => typeof t === "string" && t.trim());
    const card = await prisma.card.create({
      data: {
        projetoId,
        titulo: tarefa.titulo,
        servicoId,
        status: "A_FAZER",
        ordem: ordem++,
        responsavelId,
        checklist: { create: itens.map((texto, i) => ({ texto, ordem: i })) },
      },
      select: { id: true },
    });
    criados.push(card.id);
  }

  // Fallback: nada configurado → um cartão só com o nome do serviço.
  if (!criados.length) {
    const card = await prisma.card.create({
      data: { projetoId, titulo: servicoNome, servicoId, status: "A_FAZER", ordem: ordem++, responsavelId },
      select: { id: true },
    });
    criados.push(card.id);
  }

  for (const id of criados) await reconciliarStatusCard(id);
  // Alinha o status do projeto aos cartões recém-criados (reabre se estava Concluído).
  await reconciliarStatusProjeto(projetoId);
}

/**
 * Automação: ao CONTRATAR um serviço, garante o projeto do cliente e cria os cartões do
 * serviço (roteiro + entregas do cliente). Idempotente (não recria se o serviço já tem
 * cartões no projeto). Cria o projeto se não houver; reabre se estava concluído. Best-effort.
 */
export async function garantirCardDoServicoContratado(clienteId: string, servicoId: string, servicoNome: string, atorId?: string | null): Promise<string> {
  // Um projeto POR SERVIÇO (ADR-38): "<Serviço> — <Cliente>". Se já existe, não recria.
  const existente = await prisma.projeto.findFirst({ where: { clienteId, servicoId, deletedAt: null }, select: { id: true } });
  if (existente) return existente.id;

  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, responsavelId: true } });
  const responsavelId = cliente?.responsavelId ?? atorId ?? null;
  const projeto = await prisma.projeto.create({
    data: { clienteId, servicoId, nome: `${servicoNome} — ${cliente?.nome ?? "Cliente"}`, responsavelId },
    select: { id: true },
  });
  await prisma.activityLog.create({ data: { userId: atorId ?? null, acao: "projeto.criado", entidadeTipo: "projeto", entidadeId: projeto.id } });
  await criarCardsDoServico(projeto.id, servicoId, servicoNome, clienteId, responsavelId);
  return projeto.id;
}

/**
 * Automação: quando o cliente ENTREGA (ou desfaz) uma exigência, sincroniza os itens de
 * checklist ligados a exigências (marcam-se sozinhos) e move o(s) card(s) do serviço.
 */
export async function reconciliarCardsDoServico(clienteId: string, servicoId: string): Promise<void> {
  const cards = await prisma.card.findMany({
    where: { servicoId, deletedAt: null, projeto: { clienteId, deletedAt: null } },
    select: { id: true, checklist: { select: { id: true, concluido: true, requisitoId: true } } },
  });
  if (!cards.length) return;
  const { atendido } = await fulfillmentDoServico(clienteId, servicoId);
  for (const card of cards) {
    for (const item of card.checklist) {
      if (!item.requisitoId) continue;
      const deve = atendido.get(item.requisitoId) ?? false;
      if (item.concluido !== deve) await prisma.checklistItem.update({ where: { id: item.id }, data: { concluido: deve } });
    }
    await reconciliarStatusCard(card.id);
  }
}
