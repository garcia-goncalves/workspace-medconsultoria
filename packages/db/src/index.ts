import { PrismaClient } from "@prisma/client";
import { performance } from "node:perf_hooks";

/** Query mais lenta que isto (ms) é registrada no buffer de diagnóstico. */
const SLOW_QUERY_MS = 300;
const SLOW_MAX = 100;

export interface SlowQuery {
  op: string;
  ms: number;
  ts: number;
}

// Buffer circular EM MEMÓRIA — não gravamos no banco (evita I/O extra no host
// compartilhado) e NUNCA guardamos os valores/params da query (PII: e-mail, CPF…).
const slowBuf: SlowQuery[] = [];

/** Queries lentas recentes (mais nova primeiro), para o painel de Sistema. */
export function getSlowQueries(): SlowQuery[] {
  return [...slowBuf].reverse();
}

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const start = performance.now();
          const result = await query(args);
          const ms = performance.now() - start;
          if (ms > SLOW_QUERY_MS) {
            slowBuf.push({ op: `${model}.${operation}`, ms: Math.round(ms), ts: Date.now() });
            if (slowBuf.length > SLOW_MAX) slowBuf.shift();
          }
          return result;
        },
      },
    },
  });
}

/**
 * Singleton do Prisma Client. Em dev, reaproveita a instância entre hot-reloads
 * para não estourar o pool de conexões do MySQL.
 */
const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
export * from "./seed-guard";
export * from "./senha-escolhida";
export * from "./seed-config";
