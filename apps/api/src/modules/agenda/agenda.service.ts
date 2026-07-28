import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { CreateEventoInput, UpdateEventoInput, Recorrencia, ConflitoEventoInput } from "@app/shared";
import { enviarEmailTemplate } from "../emails/enviados.service.js";

const clean = (v?: string | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

/** Data/hora do evento em texto pt-BR (fuso de São Paulo) para o e-mail ao cliente. */
function quandoTexto(inicio: Date, diaInteiro: boolean): string {
  const tz = "America/Sao_Paulo";
  if (diaInteiro) {
    return `${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: tz }).format(inicio)} (dia inteiro)`;
  }
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: tz }).format(inicio);
}

function proximo(data: Date, recorrencia: Recorrencia): Date {
  const d = new Date(data);
  if (recorrencia === "DIARIA") d.setDate(d.getDate() + 1);
  else if (recorrencia === "SEMANAL") d.setDate(d.getDate() + 7);
  else if (recorrencia === "MENSAL") d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * Lista ocorrências de eventos no intervalo [inicio, fim], expandindo recorrências.
 * Escopo: eventos da EMPRESA + eventos onde o usuário é DONO ou PARTICIPANTE.
 */
export async function listEventos(rangeInicio: Date, rangeFim: Date, userId: string) {
  const base = await prisma.evento.findMany({
    where: {
      deletedAt: null,
      inicio: { lte: rangeFim },
      OR: [{ escopo: "EMPRESA" }, { donoId: userId }, { participantes: { some: { userId } } }],
    },
    include: {
      cliente: { select: { id: true, nome: true } },
      projeto: { select: { id: true, nome: true } },
      dono: { select: { id: true, nome: true } },
      participantes: { select: { user: { select: { id: true, nome: true } } } },
    },
    orderBy: { inicio: "asc" },
  });

  const duracao = (ev: (typeof base)[number]) =>
    ev.fim ? ev.fim.getTime() - ev.inicio.getTime() : 0;

  const ocorrencia = (ev: (typeof base)[number], inicio: Date) => ({
    occurrenceId: `${ev.id}:${inicio.toISOString()}`,
    eventoId: ev.id,
    titulo: ev.titulo,
    descricao: ev.descricao,
    tipo: ev.tipo,
    escopo: ev.escopo,
    inicio,
    fim: ev.fim ? new Date(inicio.getTime() + duracao(ev)) : null,
    diaInteiro: ev.diaInteiro,
    local: ev.local,
    linkReuniao: ev.linkReuniao,
    recorrencia: ev.recorrencia,
    cliente: ev.cliente,
    projeto: ev.projeto,
    dono: ev.dono,
    participantes: ev.participantes.map((p) => p.user),
    clienteConfirmadoEm: ev.clienteConfirmadoEm,
    // Campos da série base (para edição — editar afeta a série toda).
    clienteId: ev.clienteId,
    projetoId: ev.projetoId,
    recorrenciaAte: ev.recorrenciaAte,
    baseInicio: ev.inicio,
    baseFim: ev.fim,
  });

  const out: ReturnType<typeof ocorrencia>[] = [];
  for (const ev of base) {
    if (ev.recorrencia === "NENHUMA") {
      const fimEv = ev.fim ?? ev.inicio;
      if (ev.inicio <= rangeFim && fimEv >= rangeInicio) out.push(ocorrencia(ev, ev.inicio));
      continue;
    }
    const ate = ev.recorrenciaAte ?? rangeFim;
    let cur = new Date(ev.inicio);
    let guard = 0;
    while (cur <= rangeFim && cur <= ate && guard < 500) {
      if (cur >= rangeInicio) out.push(ocorrencia(ev, new Date(cur)));
      cur = proximo(cur, ev.recorrencia);
      guard++;
    }
  }

  out.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  return out;
}

/** Avisa o cliente por e-mail (best-effort) que a reunião foi agendada/remarcada. */
async function avisarClienteReuniao(clienteId: string | null, titulo: string, inicio: Date, diaInteiro: boolean, link: string | null) {
  if (!clienteId) return;
  try {
    const cli = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, email: true } });
    if (cli?.email) {
      void enviarEmailTemplate("reuniao_agendada", cli.email, {
        nome: cli.nome,
        titulo,
        quando: quandoTexto(inicio, diaInteiro),
        link: link ?? "",
      }).catch(() => {});
    }
  } catch {
    /* aviso ao cliente é best-effort */
  }
}

export async function createEvento(input: CreateEventoInput, userId: string, avisarCliente = false) {
  const participanteIds = (input.participanteIds ?? []).filter((id) => id && id !== userId);
  const evento = await prisma.evento.create({
    data: {
      titulo: input.titulo.trim(),
      descricao: clean(input.descricao),
      tipo: input.tipo,
      escopo: input.escopo,
      inicio: input.inicio,
      fim: input.fim ?? null,
      diaInteiro: input.diaInteiro,
      local: clean(input.local),
      linkReuniao: clean(input.linkReuniao),
      recorrencia: input.recorrencia,
      recorrenciaAte: input.recorrenciaAte ?? null,
      clienteId: clean(input.clienteId),
      projetoId: clean(input.projetoId),
      donoId: userId,
      participantes: participanteIds.length
        ? { create: participanteIds.map((uid) => ({ userId: uid })) }
        : undefined,
    },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "evento.criado", entidadeTipo: "evento", entidadeId: evento.id },
  });
  if (avisarCliente) {
    await avisarClienteReuniao(evento.clienteId, evento.titulo, evento.inicio, evento.diaInteiro, evento.linkReuniao);
  }
  return evento;
}

/** Evento PESSOAL só pode ser editado/removido pelo próprio dono (a vida particular de um não é de outro). */
async function assertPodeMexerEvento(id: string, userId: string) {
  const ev = await prisma.evento.findFirst({ where: { id, deletedAt: null }, select: { escopo: true, donoId: true } });
  if (!ev) throw new TRPCError({ code: "NOT_FOUND", message: "Evento não encontrado." });
  if (ev.escopo === "PESSOAL" && ev.donoId !== userId)
    throw new TRPCError({ code: "FORBIDDEN", message: "Este é um compromisso pessoal de outra pessoa." });
}

export async function updateEvento(input: UpdateEventoInput, userId: string, avisarCliente = false) {
  const { id, participanteIds, ...rest } = input;
  await assertPodeMexerEvento(id, userId);
  const atual = await prisma.evento.findUnique({ where: { id }, select: { inicio: true } });
  const data: Record<string, unknown> = {};
  if (rest.titulo !== undefined) data.titulo = rest.titulo.trim();
  if (rest.descricao !== undefined) data.descricao = clean(rest.descricao);
  if (rest.tipo !== undefined) data.tipo = rest.tipo;
  if (rest.escopo !== undefined) data.escopo = rest.escopo;
  let remarcou = false;
  if (rest.inicio !== undefined) {
    data.inicio = rest.inicio;
    remarcou = !atual || atual.inicio.getTime() !== rest.inicio.getTime();
    if (remarcou) {
      data.lembreteEnviado = false; // reagenda o lembrete interno
      data.lembreteClienteEnviado = false; // reagenda o lembrete ao cliente
      data.clienteConfirmadoEm = null; // confirmação anterior fica obsoleta
    }
  }
  if (rest.fim !== undefined) data.fim = rest.fim ?? null;
  if (rest.diaInteiro !== undefined) data.diaInteiro = rest.diaInteiro;
  if (rest.local !== undefined) data.local = clean(rest.local);
  if (rest.linkReuniao !== undefined) data.linkReuniao = clean(rest.linkReuniao);
  if (rest.recorrencia !== undefined) data.recorrencia = rest.recorrencia;
  if (rest.recorrenciaAte !== undefined) data.recorrenciaAte = rest.recorrenciaAte ?? null;
  if (rest.clienteId !== undefined) data.clienteId = clean(rest.clienteId);
  if (rest.projetoId !== undefined) data.projetoId = clean(rest.projetoId);

  // Participantes: se vier a lista, substitui o conjunto atual.
  if (participanteIds !== undefined) {
    const donoRow = await prisma.evento.findUnique({ where: { id }, select: { donoId: true } });
    const ids = participanteIds.filter((uid) => uid && uid !== donoRow?.donoId);
    await prisma.eventoParticipante.deleteMany({ where: { eventoId: id } });
    if (ids.length) {
      await prisma.eventoParticipante.createMany({ data: ids.map((uid) => ({ eventoId: id, userId: uid })) });
    }
  }

  const evento = await prisma.evento.update({ where: { id }, data });
  if (avisarCliente && remarcou) {
    await avisarClienteReuniao(evento.clienteId, evento.titulo, evento.inicio, evento.diaInteiro, evento.linkReuniao);
  }
  return evento;
}

export async function removeEvento(id: string, userId: string) {
  await assertPodeMexerEvento(id, userId);
  await prisma.evento.update({ where: { id }, data: { deletedAt: new Date() } });
  await prisma.activityLog.create({
    data: { userId, acao: "evento.removido", entidadeTipo: "evento", entidadeId: id },
  });
  return { ok: true };
}

/**
 * Conflitos de horário: eventos (com hora) que se sobrepõem ao intervalo informado,
 * no mesmo dia — na agenda de quem organiza (userId) E na de cada participante convidado.
 * Assim avisamos quando marcamos alguém num horário em que essa pessoa já está ocupada.
 * `participante` = nome da pessoa cuja agenda conflita (null = a sua própria).
 * Usa a expansão de recorrência do listEventos. É só AVISO — nunca bloqueia.
 */
export async function verificarConflitos(input: ConflitoEventoInput, userId: string) {
  const inicio = input.inicio;
  const fim = input.fim ?? new Date(inicio.getTime() + 30 * 60 * 1000);
  const novoIni = inicio.getTime();
  const novoFim = fim.getTime();
  const participanteIds = (input.participanteIds ?? []).filter((id) => id !== userId);

  // Nomes dos participantes (para dizer "de quem" é o conflito).
  const nomes = participanteIds.length
    ? new Map(
        (await prisma.user.findMany({ where: { id: { in: participanteIds } }, select: { id: true, nome: true } })).map(
          (u) => [u.id, u.nome] as const,
        ),
      )
    : new Map<string, string>();

  // "você" primeiro → eventos compartilhados são atribuídos a você; pessoais, ao participante.
  const pessoas: { id: string; nome: string | null }[] = [
    { id: userId, nome: null },
    ...participanteIds.map((id) => ({ id, nome: nomes.get(id) ?? "Participante" })),
  ];

  const vistos = new Set<string>(); // occurrenceId já reportado
  const conflitos: { titulo: string; inicio: Date; fim: Date | null; dono: string | null; participante: string | null }[] = [];
  for (const p of pessoas) {
    const ocorrencias = await listEventos(startOfDay(inicio), endOfDay(fim), p.id);
    for (const o of ocorrencias) {
      if (o.eventoId === input.ignorarId || o.diaInteiro || vistos.has(o.occurrenceId)) continue;
      const oi = new Date(o.inicio).getTime();
      const of = o.fim ? new Date(o.fim).getTime() : oi + 30 * 60 * 1000;
      if (oi < novoFim && novoIni < of) {
        vistos.add(o.occurrenceId);
        conflitos.push({ titulo: o.titulo, inicio: o.inicio, fim: o.fim, dono: o.dono?.nome ?? null, participante: p.nome });
      }
    }
  }
  return conflitos;
}

/** Confirmação de presença do cliente (pelo Portal). Escopado ao clienteId da sessão. */
export async function confirmarPresencaCliente(eventoId: string, clienteId: string) {
  const ev = await prisma.evento.findFirst({
    where: { id: eventoId, clienteId, deletedAt: null, escopo: "EMPRESA" },
    select: { id: true, titulo: true, donoId: true, clienteConfirmadoEm: true, cliente: { select: { nome: true } } },
  });
  if (!ev) return { ok: false as const };
  if (!ev.clienteConfirmadoEm) {
    await prisma.evento.update({ where: { id: ev.id }, data: { clienteConfirmadoEm: new Date() } });
    // Avisa o dono do evento (best-effort — importado dinamicamente para evitar ciclo).
    try {
      const { notificar } = await import("../notificacoes/notificacoes.service.js");
      await notificar(
        ev.donoId,
        "presenca_confirmada",
        { cliente: ev.cliente?.nome ?? "O cliente", evento: ev.titulo },
        { entidadeTipo: "evento", entidadeId: ev.id },
      );
    } catch {
      /* notificação é best-effort */
    }
  }
  return { ok: true as const };
}
