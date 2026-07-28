import { prisma } from "@app/db";
import type { Role } from "@app/shared";
import { hasRoleLevel } from "@app/shared";
import { listEventos } from "../agenda/agenda.service.js";
import { resumo as financeiroResumo } from "../financeiro/contas.service.js";
import { listStages } from "../pipeline/pipeline.service.js";
import { saude } from "../sistema/sistema.service.js";

const DIA = 86_400_000;

/** Conta ocorrências COM HORA que se sobrepõem a outra no mesmo dia (conflito de agenda). */
function contarConflitos(occ: { inicio: Date; fim: Date | null; diaInteiro: boolean }[]): number {
  const timed = occ.filter((e) => !e.diaInteiro);
  const byDay = new Map<string, typeof timed>();
  for (const e of timed) {
    const k = new Date(e.inicio).toDateString();
    const arr = byDay.get(k) ?? [];
    arr.push(e);
    byDay.set(k, arr);
  }
  let count = 0;
  for (const arr of byDay.values()) {
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i]!;
      const ai = +new Date(a.inicio);
      const af = a.fim ? +new Date(a.fim) : ai + 30 * 60000;
      for (let j = 0; j < arr.length; j++) {
        if (i === j) continue;
        const b = arr[j]!;
        const bi = +new Date(b.inicio);
        const bf = b.fim ? +new Date(b.fim) : bi + 30 * 60000;
        if (ai < bf && bi < af) {
          count++;
          break;
        }
      }
    }
  }
  return count;
}

/**
 * Dashboard escopado por papel. Todos recebem a camada pessoal ("meu dia").
 * ADMIN/ROOT recebem também `gestao` (visão da empresa). ROOT recebe ainda
 * `sistema` (saúde técnica). O front decide o que mostrar a partir desses blocos.
 */
export async function dashboard(userId: string, role: Role) {
  const isAdmin = hasRoleLevel(role, "ADMIN");
  const isRoot = role === "ROOT";

  const hojeInicio = new Date();
  hojeInicio.setHours(0, 0, 0, 0);
  const hojeFim = new Date();
  hojeFim.setHours(23, 59, 59, 999);
  const amanhaInicio = new Date(hojeInicio.getTime() + DIA);
  const em7 = new Date(hojeInicio.getTime() + 7 * DIA);
  const d7 = new Date(Date.now() - 7 * DIA);
  const d14 = new Date(Date.now() - 14 * DIA);
  const d30 = new Date(Date.now() - 30 * DIA);

  // ───────── Camada pessoal (todos os papéis) ─────────
  const [
    eventosHoje,
    proximosEventos,
    minhasTarefasHoje,
    minhasTarefasCount,
    minhasTarefasAtrasadasCount,
    minhasTarefasConcluidas7,
    minhasTarefasCards,
    minhasTarefasDelegadas,
    tarefasComigoAtrasadasCount,
  ] = await Promise.all([
    listEventos(hojeInicio, hojeFim, userId),
    listEventos(amanhaInicio, em7, userId),
    prisma.card.count({
      where: { deletedAt: null, status: { not: "CONCLUIDO" }, responsavelId: userId, prazo: { gte: hojeInicio, lte: hojeFim } },
    }),
    prisma.card.count({
      where: { deletedAt: null, status: { not: "CONCLUIDO" }, responsavelId: userId },
    }),
    prisma.card.count({
      where: { deletedAt: null, status: { not: "CONCLUIDO" }, responsavelId: userId, prazo: { lt: hojeInicio } },
    }),
    prisma.card.count({
      where: { deletedAt: null, status: "CONCLUIDO", responsavelId: userId, updatedAt: { gte: d7 } },
    }),
    prisma.card.findMany({
      where: { deletedAt: null, status: { not: "CONCLUIDO" }, responsavelId: userId },
      include: { projeto: { select: { id: true, nome: true } } },
      orderBy: { prazo: "asc" },
      take: 30,
    }),
    // Tarefas (delegação interna) que eu preciso fazer — separadas dos cartões de projeto.
    prisma.tarefa.findMany({
      where: { deletedAt: null, status: { not: "CONCLUIDA" }, responsaveis: { some: { userId } } },
      include: { cliente: { select: { id: true, nome: true } }, projeto: { select: { id: true, nome: true } } },
      orderBy: [{ prazo: "asc" }, { createdAt: "desc" }],
      take: 7,
    }),
    prisma.tarefa.count({
      where: { deletedAt: null, status: { not: "CONCLUIDA" }, responsaveis: { some: { userId } }, prazo: { lt: hojeInicio } },
    }),
  ]);

  // Minhas tarefas por urgência: com prazo primeiro (mais próximo/atrasado), depois sem prazo.
  const minhasTarefasLista = [...minhasTarefasCards]
    .sort((a, b) => {
      if (a.prazo && b.prazo) return a.prazo.getTime() - b.prazo.getTime();
      if (a.prazo) return -1;
      if (b.prazo) return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, 7)
    .map((c) => ({ id: c.id, titulo: c.titulo, prazo: c.prazo, prioridade: c.prioridade, status: c.status, projeto: c.projeto }));

  // Pedidos comigo (tarefas de delegação atribuídas a mim) — widget próprio no Início.
  const tarefasComigo = minhasTarefasDelegadas.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    prazo: t.prazo,
    prioridade: t.prioridade,
    cliente: t.cliente,
    projeto: t.projeto,
  }));

  // Conflitos de horário na minha agenda (hoje + próximos 7 dias) — alerta no Início.
  const conflitosAgendaCount = contarConflitos([...eventosHoje, ...proximosEventos]);

  // ───────── Camada de gestão (ADMIN + ROOT) ─────────
  const gestao = isAdmin ? await montarGestao(hojeInicio, em7, d7, d14, d30, { userId, role }) : null;

  // ───────── Camada de sistema (ROOT) ─────────
  const sistema = isRoot ? await montarSistema() : null;

  return {
    role,
    eventosHoje,
    proximosEventos: proximosEventos.slice(0, 6),
    minhasTarefas: minhasTarefasCount,
    minhasTarefasHoje,
    minhasTarefasAtrasadasCount,
    minhasTarefasConcluidas7,
    minhasTarefasLista,
    tarefasComigo,
    tarefasComigoAtrasadasCount,
    conflitosAgendaCount,
    gestao,
    sistema,
  };
}

/** Visão da empresa: financeiro, funil, projetos, equipe, clientes, docs, atividade. */
async function montarGestao(hojeInicio: Date, em7: Date, d7: Date, d14: Date, d30: Date, ctx: { userId: string; role: string }) {
  const d5 = new Date(Date.now() - 5 * DIA); // proposta/assinatura parada há +5 dias
  const [
    fin,
    aVencerAgg,
    aVencerCount,
    stages,
    leadsPorEtapa,
    novosLeads7,
    leadsConvertidos30,
    leadsParados,
    projetosPorStatus,
    projetosSemResp,
    projetosParados,
    aguardandoClienteCards,
    abertasPorResp,
    atrasadasPorResp,
    clientesTotal,
    clientesNovos30,
    clientesProspect,
    clientesQuerendoMais,
    tarefasAtrasadasEquipe,
    docsPendentes,
    docsPendentesCount,
    docsAguardandoClienteCount,
    atividadeRecente,
  ] = await Promise.all([
    financeiroResumo("EMPRESA", ctx),
    prisma.conta.aggregate({
      _sum: { valor: true },
      where: { deletedAt: null, pago: false, tipo: "PAGAR", vencimento: { gte: hojeInicio, lte: em7 } },
    }),
    prisma.conta.count({
      where: { deletedAt: null, pago: false, tipo: "PAGAR", vencimento: { gte: hojeInicio, lte: em7 } },
    }),
    listStages(),
    prisma.lead.groupBy({
      by: ["pipelineStageId"],
      where: { deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
      _count: { _all: true },
      _sum: { valorEstimado: true },
    }),
    prisma.lead.count({ where: { deletedAt: null, createdAt: { gte: d7 } } }),
    prisma.lead.count({ where: { convertidoEmClienteId: { not: null }, updatedAt: { gte: d30 } } }),
    prisma.lead.count({ where: { deletedAt: null, convertidoEmClienteId: null, perdidoEm: null, updatedAt: { lt: d14 } } }),
    prisma.projeto.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.projeto.count({ where: { deletedAt: null, responsavelId: null } }),
    prisma.projeto.count({ where: { deletedAt: null, status: "ATIVO", updatedAt: { lt: d14 } } }),
    prisma.card.findMany({
      where: { deletedAt: null, status: "AGUARDANDO_CLIENTE" },
      select: { projetoId: true },
      distinct: ["projetoId"],
    }),
    prisma.card.groupBy({
      by: ["responsavelId"],
      where: { deletedAt: null, status: { not: "CONCLUIDO" }, responsavelId: { not: null } },
      _count: { _all: true },
    }),
    prisma.card.groupBy({
      by: ["responsavelId"],
      where: { deletedAt: null, status: { not: "CONCLUIDO" }, responsavelId: { not: null }, prazo: { lt: hojeInicio } },
      _count: { _all: true },
    }),
    prisma.cliente.count({ where: { deletedAt: null } }),
    prisma.cliente.count({ where: { deletedAt: null, createdAt: { gte: d30 } } }),
    prisma.cliente.count({ where: { deletedAt: null, situacaoComercial: "PROSPECT" } }),
    // Clientes (ativos/inativos) com oportunidade aberta no funil = upsell em andamento.
    prisma.cliente.count({
      where: {
        deletedAt: null,
        situacaoComercial: { in: ["ATIVO", "INATIVO"] },
        leadsPortal: { some: { deletedAt: null, convertidoEmClienteId: null, perdidoEm: null } },
      },
    }),
    prisma.card.count({ where: { deletedAt: null, status: { not: "CONCLUIDO" }, prazo: { lt: hojeInicio } } }),
    prisma.documento.findMany({
      where: { deletedAt: null, status: { in: ["RASCUNHO", "EM_REVISAO"] } },
      include: { cliente: { select: { nome: true } } },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    prisma.documento.count({ where: { deletedAt: null, status: { in: ["RASCUNHO", "EM_REVISAO"] } } }),
    // Documentos enviados esperando o CLIENTE (aceite de proposta / assinatura) há +5 dias.
    prisma.documento.count({
      where: {
        deletedAt: null,
        OR: [
          { propostaStatus: "PENDENTE", propostaRespondidaEm: null, propostaSolicitadaEm: { lt: d5 } },
          { assinaturaSolicitadaEm: { lt: d5 }, assinadoEm: null },
        ],
      },
    }),
    prisma.activityLog.findMany({
      // "Atividade recente" é um feed de NEGÓCIO (criou cliente, gerou documento…). Eventos
      // técnicos de autenticação — login e os de diagnóstico (login.falhou,
      // login.bloqueado_no_navegador) — não têm o que fazer aqui: poluíam o widget com
      // "Alguém registrou: login bloqueado no navegador". Ficam no painel Sistema → Atividade.
      where: { NOT: { acao: { startsWith: "login" } } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { user: { select: { nome: true } } },
    }),
  ]);

  // Funil por etapa (na ordem do pipeline).
  const etapaMap = new Map(leadsPorEtapa.map((e) => [e.pipelineStageId, e]));
  const funilEtapas = stages.map((s) => {
    const e = etapaMap.get(s.id);
    return { nome: s.nome, count: e?._count._all ?? 0, valor: e?._sum.valorEstimado ?? 0 };
  });
  const funilTotal = funilEtapas.reduce((acc, e) => acc + e.count, 0);
  const funilValor = funilEtapas.reduce((acc, e) => acc + e.valor, 0);

  // Projetos por status.
  const projStatus = { ATIVO: 0, PAUSADO: 0, CONCLUIDO: 0 } as Record<string, number>;
  for (const p of projetosPorStatus) projStatus[p.status] = p._count._all;

  // Carga da equipe (tarefas abertas por responsável, com destaque para atrasadas).
  const respIds = abertasPorResp.map((r) => r.responsavelId).filter((x): x is string => !!x);
  const usuarios = respIds.length
    ? await prisma.user.findMany({ where: { id: { in: respIds } }, select: { id: true, nome: true } })
    : [];
  const nomeById = new Map(usuarios.map((u) => [u.id, u.nome]));
  const atrasadasById = new Map(atrasadasPorResp.map((r) => [r.responsavelId, r._count._all]));
  const equipe = abertasPorResp
    .filter((r) => r.responsavelId)
    .map((r) => ({
      nome: nomeById.get(r.responsavelId!) ?? "—",
      abertas: r._count._all,
      atrasadas: atrasadasById.get(r.responsavelId) ?? 0,
    }))
    .sort((a, b) => b.atrasadas - a.atrasadas || b.abertas - a.abertas)
    .slice(0, 6);
  const equipeMaxAbertas = Math.max(1, ...equipe.map((e) => e.abertas));

  return {
    financeiro: { ...fin, aVencer7: { total: aVencerAgg._sum.valor?.toNumber() ?? 0, count: aVencerCount } },
    funil: {
      etapas: funilEtapas,
      total: funilTotal,
      valor: funilValor,
      novos7: novosLeads7,
      convertidos30: leadsConvertidos30,
      parados: leadsParados,
    },
    projetos: {
      ativos: projStatus.ATIVO ?? 0,
      pausados: projStatus.PAUSADO ?? 0,
      concluidos: projStatus.CONCLUIDO ?? 0,
      aguardandoCliente: aguardandoClienteCards.length,
      semResponsavel: projetosSemResp,
      parados: projetosParados,
    },
    equipe,
    equipeMaxAbertas,
    clientes: { total: clientesTotal, novos30: clientesNovos30, prospects: clientesProspect, querendoMais: clientesQuerendoMais },
    tarefasAtrasadasEquipeCount: tarefasAtrasadasEquipe,
    docsPendentes: docsPendentes.map((d) => ({ id: d.id, titulo: d.titulo, status: d.status, updatedAt: d.updatedAt, cliente: d.cliente })),
    docsPendentesCount,
    docsAguardandoClienteCount,
    atividadeRecente: atividadeRecente.map((a) => ({ id: a.id, acao: a.acao, createdAt: a.createdAt, usuario: a.user?.nome ?? null })),
  };
}

/** Saúde técnica (só ROOT): status, recursos, erros/incidentes abertos, sessões, jobs. */
async function montarSistema() {
  const [s, errosAbertos, incidentesAbertos, sessoesAtivas] = await Promise.all([
    saude(),
    prisma.errorLog.count({ where: { resolvido: false, ignorado: false } }),
    prisma.incidente.count({ where: { status: { in: ["ABERTO", "RECONHECIDO"] } } }),
    prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
  ]);
  const idadeMin = (d: Date | null) => (d ? Math.round((Date.now() - new Date(d).getTime()) / 60000) : null);
  return {
    statusGeral: s.statusGeral,
    heapUsoPct: s.memoria.heapUsoPct,
    loopP99: s.memoria.loopP99,
    db: s.db,
    errosAbertos,
    incidentesAbertos,
    sessoesAtivas,
    conexoesSocket: s.conexoesSocket,
    uptimeSeg: s.uptimeSeg,
    ambiente: s.ambiente,
    nodeVersao: s.nodeVersao,
    idadeLembreteMin: idadeMin(s.jobs.ultimoLembreteEm),
    idadeScanMin: idadeMin(s.jobs.ultimoScanEm),
  };
}
