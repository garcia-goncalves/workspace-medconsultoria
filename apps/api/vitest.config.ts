import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Carrega o .env da raiz do monorepo (SMTP/OpenAI/etc.). Relativo ao cwd (apps/api).
loadEnv({ path: "../../.env" });

// Os testes NUNCA tocam o banco de dev/produção: usam um banco ISOLADO (medconsultoria_test).
// TEST_DATABASE_URL tem prioridade (CI); senão, deriva do DATABASE_URL acrescentando "_test".
function urlDeTeste(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? "";
  try {
    const u = new URL(base);
    if (!u.pathname.endsWith("_test")) u.pathname += "_test";
    return u.toString();
  } catch {
    return base;
  }
}

export default defineConfig({
  test: {
    environment: "node",
    // ⚠️ Este `include` varre TAMBÉM `src/test/*.integration.test.ts` — ou seja, `pnpm test` daqui
    // MANDA E-MAIL REAL e grava/apaga rascunho numa caixa real (é assim de propósito: o CI roda a
    // suíte inteira). Para rodar só unidade, use `pnpm --filter @app/api test:unit`. A armadilha já
    // mordeu em 05/08/2026: um agente rodou `test` achando que era só unidade, e e-mail saiu.
    include: ["src/**/*.test.ts"],
    testTimeout: 20000,
    // Injeta a DATABASE_URL de teste no processo dos testes ANTES de qualquer import de @app/db.
    env: { DATABASE_URL: urlDeTeste(), NODE_ENV: "test" },
    // Um único fork: os testes de integração compartilham o banco de teste (evita corrida).
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
