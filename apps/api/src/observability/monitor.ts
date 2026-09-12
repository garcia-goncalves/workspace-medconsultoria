import {
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
  constants,
  type EventLoopUtilization,
} from "node:perf_hooks";
import v8 from "node:v8";
import { BUCKET_BOUNDS, percentilBuckets } from "./percentil.js";

/**
 * Coletor de telemetria in-process (stdlib apenas). Mede os sinais que dizem se
 * o app está "rápido e saudável": atraso do event loop (melhor termômetro de
 * lentidão), utilização do loop, memória/heap, CPU, pausas de GC major, e RED
 * (Rate/Errors/Duration) por endpoint tRPC. Amostra a cada 10s num ring buffer.
 */

const NS_PER_MS = 1e6;

// Histograma de atraso do event loop — sempre ligado; zerado a cada amostra.
const eld = monitorEventLoopDelay({ resolution: 10 });
eld.enable();

let eluPrev: EventLoopUtilization = performance.eventLoopUtilization();
let cpuPrev = process.cpuUsage();
let cpuHrPrev = process.hrtime.bigint();

// Pausas de GC "major" (mark-sweep) acumuladas na janela — são as que travam o loop.
let gcMajorMs = 0;
const gcObs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    const kind = (e as unknown as { detail?: { kind?: number } }).detail?.kind;
    if (kind === constants.NODE_PERFORMANCE_GC_MAJOR) gcMajorMs += e.duration;
  }
});
gcObs.observe({ entryTypes: ["gc"] });

// ── RED por endpoint (buckets exponenciais de latência) ──────────────────────
// Os limites e a conta do percentil vivem em `percentil.ts` — testáveis sem carregar este
// módulo, que instala o observador de GC do processo já no import.

interface EndpointStat {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  buckets: number[];
}
const endpoints = new Map<string, EndpointStat>();

// Contadores da janela atual (zerados a cada amostra) para taxa req/erro.
let winReq = 0;
let winErr = 0;

/** Registra uma chamada tRPC (chamado pelo middleware). */
export function recordCall(path: string, ok: boolean, durationMs: number): void {
  let s = endpoints.get(path);
  if (!s) {
    s = { count: 0, errors: 0, totalMs: 0, maxMs: 0, lastMs: 0, buckets: new Array(BUCKET_BOUNDS.length).fill(0) };
    endpoints.set(path, s);
  }
  s.count++;
  if (!ok) s.errors++;
  s.totalMs += durationMs;
  s.lastMs = durationMs;
  if (durationMs > s.maxMs) s.maxMs = durationMs;
  let bi = BUCKET_BOUNDS.findIndex((b) => durationMs <= b);
  if (bi < 0) bi = BUCKET_BOUNDS.length - 1;
  s.buckets[bi] = (s.buckets[bi] ?? 0) + 1;
  winReq++;
  if (!ok) winErr++;
}

// ── Série temporal (ring buffer) ─────────────────────────────────────────────
export interface Amostra {
  ts: number;
  loopP50: number;
  loopP99: number;
  elu: number;
  heapMB: number;
  rssMB: number;
  cpuPct: number;
  gcMs: number;
  req: number;
  err: number;
}
const RING = 60; // 60 × 10s = 10 min de janela ao vivo
const ring: Amostra[] = [];

function amostrar(): void {
  const loopP50 = eld.percentile(50) / NS_PER_MS;
  const loopP99 = eld.percentile(99) / NS_PER_MS;
  eld.reset();

  const elu = performance.eventLoopUtilization(eluPrev).utilization;
  eluPrev = performance.eventLoopUtilization();

  const mem = process.memoryUsage();

  const cpuNow = process.cpuUsage(cpuPrev); // micros desde a última amostra
  const hrNow = process.hrtime.bigint();
  const wallMs = Number(hrNow - cpuHrPrev) / NS_PER_MS;
  cpuPrev = process.cpuUsage();
  cpuHrPrev = hrNow;
  const cpuPct = wallMs > 0 ? ((cpuNow.user + cpuNow.system) / 1000 / wallMs) * 100 : 0;

  ring.push({
    ts: Date.now(),
    loopP50: round1(loopP50),
    loopP99: round1(loopP99),
    elu: Math.round(elu * 100) / 100,
    heapMB: Math.round(mem.heapUsed / 1e6),
    rssMB: Math.round(mem.rss / 1e6),
    cpuPct: Math.round(cpuPct),
    gcMs: Math.round(gcMajorMs),
    req: winReq,
    err: winErr,
  });
  if (ring.length > RING) ring.shift();
  gcMajorMs = 0;
  winReq = 0;
  winErr = 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

let intervalo: NodeJS.Timeout | null = null;
export function startMonitor(): void {
  if (intervalo) return;
  intervalo = setInterval(amostrar, 10_000);
  intervalo.unref();
}

// ── Leitura para o painel ────────────────────────────────────────────────────
export function getSerie(): Amostra[] {
  return [...ring];
}

export interface EndpointResumo {
  path: string;
  count: number;
  errors: number;
  taxaErro: number;
  mediaMs: number;
  p95Ms: number;
  maxMs: number;
}
export function getEndpoints(): EndpointResumo[] {
  const out: EndpointResumo[] = [];
  for (const [path, s] of endpoints) {
    out.push({
      path,
      count: s.count,
      errors: s.errors,
      taxaErro: s.count ? Math.round((s.errors / s.count) * 1000) / 10 : 0,
      mediaMs: s.count ? Math.round(s.totalMs / s.count) : 0,
      p95Ms: percentilBuckets(s.buckets, s.count, 95, s.maxMs),
      maxMs: Math.round(s.maxMs),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Estado instantâneo do processo (para saúde/diagnóstico). */
export function getProcessoAgora() {
  const mem = process.memoryUsage();
  const heap = v8.getHeapStatistics();
  const ultima = ring[ring.length - 1];
  return {
    heapUsadoMB: Math.round(mem.heapUsed / 1e6),
    heapLimiteMB: Math.round(heap.heap_size_limit / 1e6),
    heapUsoPct: Math.round((mem.heapUsed / heap.heap_size_limit) * 100),
    rssMB: Math.round(mem.rss / 1e6),
    loopP99: ultima?.loopP99 ?? 0,
    elu: ultima?.elu ?? 0,
    cpuPct: ultima?.cpuPct ?? 0,
    gcMs: ultima?.gcMs ?? 0,
  };
}

/** Totais e taxa de erro da janela ao vivo (últimos ~minutos do ring). */
export function getResumoTrafego() {
  const recentes = ring.slice(-6); // ~1 min
  const req = recentes.reduce((a, s) => a + s.req, 0);
  const err = recentes.reduce((a, s) => a + s.err, 0);
  let totalReq = 0;
  let totalErr = 0;
  for (const s of endpoints.values()) {
    totalReq += s.count;
    totalErr += s.errors;
  }
  return {
    reqUltimoMin: req,
    errUltimoMin: err,
    taxaErroUltimoMin: req ? Math.round((err / req) * 1000) / 10 : 0,
    totalReq,
    totalErr,
  };
}
