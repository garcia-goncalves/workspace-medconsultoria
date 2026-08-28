import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import { prisma, getSlowQueries } from "@app/db";
import { config, isAiEnabled, isEmailReal } from "../../config.js";
import { estaCspLigada } from "../../lib/seguranca-http.js";
import { contarConexoesSocket } from "../../realtime/socket.js";
import { notificar } from "../notificacoes/notificacoes.service.js";
import { statusJobs, scanProativo } from "../../realtime/reminders.js";
import {
  getSerie,
  getEndpoints,
  getProcessoAgora,
  getResumoTrafego,
} from "../../observability/monitor.js";

const DIA = 86_400_000;

const num = (v: unknown): number => (v == null ? 0 : Number(v));

type Nivel = "ok" | "degradado" | "critico";
const RANK: Record<Nivel, number> = { ok: 0, degradado: 1, critico: 2 };
const pior = (a: Nivel, b: Nivel): Nivel => (RANK[a] >= RANK[b] ? a : b);

/** Saúde do processo + banco + tempo real, com status agregado "pior-status-vence". */
export async function saude() {
  const t0 = Date.now();
  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const dbLatenciaMs = Date.now() - t0;
  const proc = getProcessoAgora();
  const trafego = getResumoTrafego();
  const jobs = statusJobs();

  // ── Health por componente (worst-of-N) ──
  const componentes: { nome: string; nivel: Nivel; detalhe: string }[] = [];

  // Banco
  const nivelDb: Nivel = !dbOk ? "critico" : dbLatenciaMs > 400 ? "degradado" : "ok";
  componentes.push({
    nome: "Banco de dados",
    nivel: nivelDb,
    detalhe: dbOk ? `${dbLatenciaMs}ms de latência` : "inacessível",
  });

  // Processo / event loop + heap
  let nivelProc: Nivel = "ok";
  if (proc.loopP99 >= 250 || proc.heapUsoPct >= 90) nivelProc = "critico";
  else if (proc.loopP99 >= 100 || proc.heapUsoPct >= 85) nivelProc = "degradado";
  componentes.push({
    nome: "Processo (event loop)",
    nivel: nivelProc,
    detalhe: `event loop p99 ${proc.loopP99}ms · heap ${proc.heapUsoPct}%`,
  });

  // Jobs (heartbeat): lembrete a cada 1min, scan a cada 10min
  const idadeMin = (d: Date | null) => (d ? (Date.now() - new Date(d).getTime()) / 60000 : Infinity);
  const idadeLembrete = idadeMin(jobs.ultimoLembreteEm);
  const idadeScan = idadeMin(jobs.ultimoScanEm);
  let nivelJobs: Nivel = "ok";
  if (idadeLembrete > 15 || idadeScan > 30) nivelJobs = "critico";
  else if (idadeLembrete > 5 || idadeScan > 25) nivelJobs = "degradado";
  componentes.push({
    nome: "Jobs em segundo plano",
    nivel: nivelJobs,
    detalhe: Number.isFinite(idadeLembrete)
      ? `lembrete há ${Math.round(idadeLembrete)}min · scan há ${Math.round(idadeScan)}min`
      : "ainda não executaram",
  });

  // Erros (janela recente)
  const nivelErros: Nivel =
    trafego.taxaErroUltimoMin >= 20 ? "critico" : trafego.taxaErroUltimoMin >= 5 ? "degradado" : "ok";
  componentes.push({
    nome: "Taxa de erro",
    nivel: nivelErros,
    detalhe: `${trafego.taxaErroUltimoMin}% no último minuto (${trafego.reqUltimoMin} req)`,
  });

  // Tempo real (informativo)
  componentes.push({
    nome: "Tempo real",
    nivel: "ok",
    detalhe: `${contarConexoesSocket()} conexão(ões) ativa(s)`,
  });

  const statusGeral = componentes.reduce<Nivel>((acc, c) => pior(acc, c.nivel), "ok");

  return {
    statusGeral,
    componentes,
    uptimeSeg: Math.floor(process.uptime()),
    nodeVersao: process.version,
    ambiente: config.NODE_ENV,
    memoria: proc,
    db: { ok: dbOk, latenciaMs: dbLatenciaMs },
    trafego,
    conexoesSocket: contarConexoesSocket(),
    iaAtiva: isAiEnabled,
    jobs,
  };
}

/** Séries temporais + RED por endpoint + queries lentas — para a aba Desempenho. */
export function desempenho() {
  return {
    serie: getSerie(),
    endpoints: getEndpoints(),
    maisLentos: [...getEndpoints()].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 8),
    comErro: getEndpoints()
      .filter((e) => e.errors > 0)
      .sort((a, b) => b.taxaErro - a.taxaErro)
      .slice(0, 8),
    queriesLentas: getSlowQueries(),
  };
}

/** Contadores de uso + crescimento. */
export async function metricas() {
  const d7 = new Date(Date.now() - 7 * DIA);
  const d30 = new Date(Date.now() - 30 * DIA);
  const agora = new Date();
  const [
    porPapelRaw,
    clientes,
    leads,
    projetos,
    cards,
    documentos,
    contas,
    mensagens,
    eventos,
    novos7,
    novos30,
    sessoesAtivas,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], where: { deletedAt: null }, _count: true }),
    prisma.cliente.count({ where: { deletedAt: null } }),
    prisma.lead.count({ where: { deletedAt: null, convertidoEmClienteId: null } }),
    prisma.projeto.count({ where: { deletedAt: null } }),
    prisma.card.count({ where: { deletedAt: null } }),
    prisma.documento.count({ where: { deletedAt: null } }),
    prisma.conta.count({ where: { deletedAt: null } }),
    prisma.mensagem.count({ where: { deletedAt: null } }),
    prisma.evento.count({ where: { deletedAt: null } }),
    prisma.cliente.count({ where: { deletedAt: null, createdAt: { gte: d7 } } }),
    prisma.cliente.count({ where: { deletedAt: null, createdAt: { gte: d30 } } }),
    prisma.session.count({ where: { expiresAt: { gt: agora } } }),
  ]);
  const porPapel: Record<string, number> = {};
  for (const g of porPapelRaw) porPapel[g.role] = g._count;
  return {
    porPapel,
    clientes,
    leads,
    projetos,
    cards,
    documentos,
    contas,
    mensagens,
    eventos,
    novosClientes7: novos7,
    novosClientes30: novos30,
    sessoesAtivas,
  };
}

/** Sessões ativas (dispositivos logados agora). */
export function sessoes() {
  return prisma.session.findMany({
    where: { expiresAt: { gt: new Date() } },
    include: { user: { select: { nome: true, email: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function revogarSessao(id: string) {
  await prisma.session.deleteMany({ where: { id } });
  return { ok: true };
}

/** Auditoria — feed de ações (sem logins, que são ruído). */
export function atividade() {
  return prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 60,
    include: { user: { select: { nome: true } } },
  });
}

/** Erros agrupados por fingerprint (issues). `ocultos=true` lista só os ocultados (silenciados). */
export function erros(ocultos = false) {
  return prisma.errorLog.findMany({
    where: ocultos ? { ignorado: true } : { ignorado: false },
    orderBy: [{ resolvido: "asc" }, { ultimaVez: "desc" }],
    take: 100,
  });
}

export async function resolverErro(id: string) {
  await prisma.errorLog.update({
    where: { id },
    data: { resolvido: true, resolvidoEm: new Date(), regrediu: false },
  });
  return { ok: true };
}

/** Silencia um erro conhecido/ruído — sai da lista principal e vai para "Ocultos" (reversível). */
export async function ignorarErro(id: string) {
  await prisma.errorLog.update({ where: { id }, data: { ignorado: true, resolvido: true } });
  return { ok: true };
}

/** Reexibe um erro que havia sido ocultado — volta como ABERTO na lista principal. */
export async function reexibirErro(id: string) {
  await prisma.errorLog.update({ where: { id }, data: { ignorado: false, resolvido: false, resolvidoEm: null } });
  return { ok: true };
}

/** Marca TODOS os erros abertos como resolvidos (após uma correção). */
export async function resolverTodosErros() {
  const r = await prisma.errorLog.updateMany({
    where: { resolvido: false, ignorado: false },
    data: { resolvido: true, resolvidoEm: new Date(), regrediu: false },
  });
  return { ok: true, quantidade: r.count };
}

/** Marca TODOS os incidentes abertos como resolvidos. */
export async function resolverTodosIncidentes() {
  const r = await prisma.incidente.updateMany({
    where: { status: { not: "RESOLVIDO" } },
    data: { status: "RESOLVIDO", resolvidoEm: new Date() },
  });
  return { ok: true, quantidade: r.count };
}

/** Dispara a varredura proativa sob demanda (detecta pendências agora). */
export async function rodarVarredura() {
  await scanProativo();
  return { ok: true };
}

/** Avisa o ROOT sobre um bug novo ou uma regressão (uma notificação por evento). */
async function notificarRootErro(titulo: string, resumo: string, errorId: string): Promise<void> {
  const roots = await prisma.user.findMany({
    where: { role: "ROOT", ativo: true, deletedAt: null },
    select: { id: true },
  });
  for (const r of roots) {
    await notificar(r.id, "erro", { titulo, resumo }, { entidadeTipo: "erro", entidadeId: errorId });
  }
}

/** Normaliza a mensagem para agrupar ocorrências idênticas (remove IDs/números/PII). */
function normalizarMensagem(msg: string): string {
  return msg
    .toLowerCase()
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, "<email>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/c[a-z0-9]{24,}/g, "<id>") // cuids
    .replace(/0x[0-9a-f]+/g, "<hex>")
    .replace(/\d+/g, "<n>")
    .trim();
}

/** Primeiro frame do stack que é do nosso código (ignora node_modules/node:). */
function frameDoApp(stack?: string | null): string {
  if (!stack) return "";
  for (const linha of stack.split("\n")) {
    const l = linha.trim();
    if (l.startsWith("at ") && !l.includes("node_modules") && !l.includes("node:")) {
      return l.replace(/:\d+:\d+/g, ""); // tira linha:coluna (variam)
    }
  }
  return "";
}

/** Grava um erro (chamado pelo onError do tRPC). Agrupa por fingerprint. Fire-and-forget. */
export async function registrarErro(data: {
  rota?: string | null;
  mensagem: string;
  stack?: string | null;
  userId?: string | null;
}) {
  const fingerprint = createHash("sha1")
    .update(`${normalizarMensagem(data.mensagem)}|${frameDoApp(data.stack)}|${data.rota ?? ""}`)
    .digest("hex")
    .slice(0, 32);

  const existente = await prisma.errorLog.findUnique({ where: { fingerprint } });
  const agora = new Date();
  const resumo = data.mensagem.slice(0, 140);

  if (!existente) {
    const criado = await prisma.errorLog.create({
      data: {
        fingerprint,
        rota: data.rota ?? null,
        mensagem: data.mensagem.slice(0, 5000),
        stack: data.stack?.slice(0, 8000) ?? null,
        userId: data.userId ?? null,
        ultimaVez: agora,
      },
    });
    await notificarRootErro("Novo erro no sistema", resumo, criado.id).catch(() => {});
    return criado;
  }

  // Ocorrência repetida: soma. Se estava resolvido (e não ignorado), é REGRESSÃO — reabre.
  const regressao = existente.resolvido && !existente.ignorado;
  const atualizado = await prisma.errorLog.update({
    where: { fingerprint },
    data: {
      ocorrencias: { increment: 1 },
      ultimaVez: agora,
      mensagem: data.mensagem.slice(0, 5000),
      stack: data.stack?.slice(0, 8000) ?? null,
      userId: data.userId ?? null,
      ...(regressao ? { resolvido: false, regrediu: true } : {}),
    },
  });
  if (regressao) {
    await notificarRootErro("Erro voltou (regressão)", resumo, atualizado.id).catch(() => {});
  }
  return atualizado;
}

/** Insights do MySQL — tudo em try/catch (privilégios variam em shared hosting). */
export async function banco() {
  const status = async (nome: string): Promise<number | null> => {
    try {
      const rows = await prisma.$queryRawUnsafe<{ Variable_name: string; Value: string }[]>(
        `SHOW GLOBAL STATUS LIKE '${nome}'`,
      );
      return rows[0] ? num(rows[0].Value) : null;
    } catch {
      return null;
    }
  };
  const variavel = async (nome: string): Promise<number | null> => {
    try {
      const rows = await prisma.$queryRawUnsafe<{ Variable_name: string; Value: string }[]>(
        `SHOW VARIABLES LIKE '${nome}'`,
      );
      return rows[0] ? num(rows[0].Value) : null;
    } catch {
      return null;
    }
  };

  const t0 = Date.now();
  let ok = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    ok = false;
  }
  const latenciaMs = Date.now() - t0;

  const [uptime, threadsConectadas, threadsRodando, picoConexoes, maxConnections] = await Promise.all([
    status("Uptime"),
    status("Threads_connected"),
    status("Threads_running"),
    status("Max_used_connections"),
    variavel("max_connections"),
  ]);

  let tabelas: { nome: string; dadosMB: number; indiceMB: number; totalMB: number; linhas: number }[] = [];
  let totalMB = 0;
  try {
    const rows = await prisma.$queryRaw<
      { table_name: string; data_mb: number; index_mb: number; total_mb: number; table_rows: bigint | number }[]
    >`
      SELECT table_name AS table_name,
        ROUND(data_length / 1024 / 1024, 2)  AS data_mb,
        ROUND(index_length / 1024 / 1024, 2) AS index_mb,
        ROUND((data_length + index_length) / 1024 / 1024, 2) AS total_mb,
        table_rows AS table_rows
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
      ORDER BY (data_length + index_length) DESC`;
    tabelas = rows.map((r) => ({
      nome: r.table_name,
      dadosMB: num(r.data_mb),
      indiceMB: num(r.index_mb),
      totalMB: num(r.total_mb),
      linhas: num(r.table_rows),
    }));
    totalMB = Math.round(tabelas.reduce((a, t) => a + t.totalMB, 0) * 100) / 100;
  } catch {
    tabelas = [];
  }

  const usoConexoesPct =
    maxConnections && threadsConectadas ? Math.round((threadsConectadas / maxConnections) * 100) : null;

  // Saúde de índices: tabelas grandes SEM nenhum índice (nem PK) — sinal de alerta.
  let tabelasSemIndice: string[] = [];
  try {
    const rows = await prisma.$queryRaw<{ TABLE_NAME: string }[]>`
      SELECT t.TABLE_NAME
      FROM information_schema.TABLES t
      LEFT JOIN information_schema.STATISTICS s
        ON t.TABLE_SCHEMA = s.TABLE_SCHEMA AND t.TABLE_NAME = s.TABLE_NAME
      WHERE t.TABLE_SCHEMA = DATABASE()
        AND t.TABLE_TYPE = 'BASE TABLE'
        AND s.INDEX_NAME IS NULL
        AND (t.TABLE_ROWS > 1000 OR (t.DATA_LENGTH + t.INDEX_LENGTH) > 5242880)`;
    tabelasSemIndice = rows.map((r) => r.TABLE_NAME);
  } catch {
    tabelasSemIndice = [];
  }

  return {
    ok,
    latenciaMs,
    uptimeSeg: uptime,
    threadsConectadas,
    threadsRodando,
    picoConexoes,
    maxConnections,
    usoConexoesPct,
    totalMB,
    tabelas,
    tabelasSemIndice,
  };
}

/** Incidentes registrados pelo motor de alertas (abertos primeiro). */
export function incidentes() {
  return prisma.incidente.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100 });
}

export async function reconhecerIncidente(id: string) {
  await prisma.incidente.update({
    where: { id },
    data: { status: "RECONHECIDO", reconhecidoEm: new Date() },
  });
  return { ok: true };
}

export async function resolverIncidente(id: string) {
  await prisma.incidente.update({
    where: { id },
    data: { status: "RESOLVIDO", resolvidoEm: new Date() },
  });
  return { ok: true };
}

/** Grade de uptime dos últimos 90 dias, derivada dos incidentes (cor = pior severidade do dia). */
export async function historicoUptime() {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  inicio.setDate(inicio.getDate() - 89);

  const incs = await prisma.incidente.findMany({
    where: { createdAt: { gte: inicio } },
    select: { createdAt: true, severidade: true },
  });

  const porDia = new Map<string, Nivel>();
  for (const i of incs) {
    const chave = new Date(i.createdAt).toISOString().slice(0, 10);
    const nivel: Nivel = i.severidade === "critico" ? "critico" : "degradado";
    porDia.set(chave, pior(porDia.get(chave) ?? "ok", nivel));
  }

  const dias: { dia: string; nivel: Nivel }[] = [];
  let diasOk = 0;
  for (let d = 0; d < 90; d++) {
    const data = new Date(inicio);
    data.setDate(inicio.getDate() + d);
    const chave = data.toISOString().slice(0, 10);
    const nivel = porDia.get(chave) ?? "ok";
    if (nivel === "ok") diasOk++;
    dias.push({ dia: chave, nivel });
  }
  return { dias, uptimePct: Math.round((diasOk / 90) * 1000) / 10 };
}

/** Snapshot de diagnóstico copiável (para suporte). */
export async function diagnostico() {
  const s = await saude();
  const errosAbertos = await prisma.errorLog.count({ where: { resolvido: false } });
  return {
    geradoEm: new Date().toISOString(),
    ambiente: s.ambiente,
    nodeVersao: s.nodeVersao,
    statusGeral: s.statusGeral,
    uptimeSeg: s.uptimeSeg,
    memoria: s.memoria,
    db: s.db,
    trafego: s.trafego,
    componentes: s.componentes,
    errosAbertos,
    jobs: s.jobs,
    endpointsMaisLentos: [...getEndpoints()].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 5),
  };
}

/** Checagens de "precisa de atenção" (técnico + negócio). */
export async function atencao() {
  const agora = new Date();
  const d14 = new Date(Date.now() - 14 * DIA);
  const [
    projetosSemResp,
    clientesSemResp,
    docsRevisao,
    contasVencidas,
    leadsParados,
    usuariosInativos,
    sessoesExpiradas,
    errosAbertos,
  ] = await Promise.all([
    prisma.projeto.count({ where: { deletedAt: null, responsavelId: null } }),
    prisma.cliente.count({ where: { deletedAt: null, responsavelId: null } }),
    prisma.documento.count({ where: { deletedAt: null, status: "EM_REVISAO" } }),
    prisma.conta.count({ where: { deletedAt: null, pago: false, vencimento: { lt: agora } } }),
    prisma.lead.count({
      where: { deletedAt: null, convertidoEmClienteId: null, updatedAt: { lt: d14 } },
    }),
    prisma.user.count({ where: { deletedAt: null, ativo: false } }),
    prisma.session.count({ where: { expiresAt: { lt: agora } } }),
    prisma.errorLog.count({ where: { resolvido: false, ignorado: false } }),
  ]);
  return {
    projetosSemResp,
    clientesSemResp,
    docsRevisao,
    contasVencidas,
    leadsParados,
    usuariosInativos,
    sessoesExpiradas,
    errosAbertos,
  };
}

/** Manutenção: limpa sessões expiradas. */
export async function limparSessoesExpiradas() {
  const r = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { removidas: r.count };
}

/** Migrations aplicadas (do metadado do Prisma). */
export async function migracoes() {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at FROM _prisma_migrations
      ORDER BY finished_at DESC LIMIT 40`;
    return rows.map((r) => ({ nome: r.migration_name, aplicadaEm: r.finished_at }));
  } catch {
    return [];
  }
}

/** Configuração (não-secreta) para conferência. */
export function configInfo() {
  return {
    ambiente: config.NODE_ENV,
    apiPort: config.API_PORT,
    webOrigin: config.WEB_ORIGIN,
    iaAtiva: isAiEnabled,
    // Lê o estado REAL do boot, nunca uma constante: por anos esta linha foi `false` enquanto o
    // helmet já publicava a política inteira, e o painel de segurança do ROOT dizia "Desligada".
    cspLigada: estaCspLigada(),
  };
}

const execFileAsync = promisify(execFile);

/**
 * OPERAÇÃO — visibilidade dos backups automáticos, dos reinícios do health-check e do estado dos
 * alertas ao ROOT. Os caminhos vêm do .env do SERVIDOR (`BACKUPS_DIR`/`OPS_DIR`); no dev eles não
 * existem, então a aba mostra "não configurado neste ambiente". Só leitura (ROOT).
 */
export function operacao() {
  const dir = config.BACKUPS_DIR;
  const disponivel = !!dir && existsSync(dir);

  let backups: { total: number; ultimo: { quando: string; tamanho: number } | null; tamanhoTotal: number; retencao: number } | null = null;
  let reinicios: string[] = [];

  if (disponivel && dir) {
    const arquivos = readdirSync(dir)
      .filter((f) => /^auto-db-.*\.sql\.gz$/.test(f))
      .map((f) => {
        const st = statSync(join(dir, f));
        return { nome: f, tamanho: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    backups = {
      total: arquivos.length,
      ultimo: arquivos[0] ? { quando: new Date(arquivos[0].mtime).toISOString(), tamanho: arquivos[0].tamanho } : null,
      tamanhoTotal: arquivos.reduce((s, a) => s + a.tamanho, 0),
      retencao: 14,
    };

    const logHealth = join(dir, "health.log");
    if (existsSync(logHealth)) {
      reinicios = readFileSync(logHealth, "utf8").trim().split("\n").filter(Boolean).slice(-12).reverse();
    }
  }

  return {
    disponivel,
    backups,
    reinicios,
    alertas: {
      // O ROOT já recebe E-MAIL de incidentes e de erros novos/regressões (tipos emailáveis,
      // minRole ROOT). O e-mail de "app fora do ar" vem do cron (fora do app). Ver ADR-87.
      emailReal: isEmailReal,
      tiposAoRoot: ["incidente", "erro"],
    },
  };
}

/** Dispara um backup do banco SOB DEMANDA (executa o script de ops instalado no servidor). ROOT. */
export async function fazerBackup() {
  const ops = config.OPS_DIR;
  if (!ops) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Backup sob demanda só está disponível no servidor (OPS_DIR não configurado)." });
  }
  const script = join(ops, "backup-db.sh");
  if (!existsSync(script)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Script de backup não encontrado no servidor." });
  }
  try {
    const { stdout } = await execFileAsync("bash", [script], { timeout: 120_000 });
    return { ok: true, saida: stdout.trim().split("\n").slice(-3).join("\n") };
  } catch (e) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Falha ao gerar o backup: ${e instanceof Error ? e.message : "erro desconhecido"}` });
  }
}
