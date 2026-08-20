import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Carrega o .env da raiz do monorepo (SMTP/OpenAI/etc.). Relativo ao cwd (apps/api).
loadEnv({ path: "../../.env" });

// Os testes NUNCA tocam o banco de dev/produção: usam um banco ISOLADO (medconsultoria_test).
// TEST_DATABASE_URL tem prioridade (CI); senão, deriva do DATABASE_URL acrescentando "_test".
// Valores de partida para quem NÃO tem `.env` — um clone limpo, um runner novo, um colega no
// primeiro dia. Não são segredo: apontam para o MySQL local de desenvolvimento (docker compose)
// e para uma frase qualquer com o tamanho mínimo que o schema exige.
//
// POR QUE ISTO EXISTE (19/08/2026): sem `.env`, `urlDeTeste()` devolvia "" e `SESSION_SECRET`
// não era injetado por ninguém. O `config.ts` valida a env no import e chama `process.exit(1)`
// quando falta algo — então 9 das 34 suítes da API MORRIAM AO CARREGAR, e o placar mostrava
// "5 testes falharam" que não eram defeito nenhum. Suíte que mente assim ensina a ignorá-la.
// Teste de unidade não pode exigir configuração de boot.
const URL_TESTE_PADRAO = "mysql://medconsultoria:medconsultoria@127.0.0.1:3307/medconsultoria_test";
const SEGREDO_TESTE_PADRAO = "segredo-de-teste-sem-valor-em-producao";

function urlDeTeste(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? "";
  try {
    const u = new URL(base);
    if (!u.pathname.endsWith("_test")) u.pathname += "_test";
    return u.toString();
  } catch {
    // `base` vazia ou malformada (sem `.env`). Devolver "" reprovava a validação e derrubava o
    // processo; o padrão local deixa a suíte de unidade rodar. Integração continua precisando de
    // banco de verdade — e agora falha ao CONECTAR, com mensagem legível, em vez de matar tudo.
    return base || URL_TESTE_PADRAO;
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
    // Injeta a configuração mínima ANTES de qualquer import de @app/db ou de `config.ts`.
    // `SESSION_SECRET` entra aqui porque o schema o exige (≥16) e, sem `.env`, ninguém o define
    // — era metade da causa das suítes que morriam ao carregar. Quem já tem valor no ambiente
    // (o CI define os seus) continua com o dele: o `??` só preenche a ausência.
    env: {
      DATABASE_URL: urlDeTeste(),
      SESSION_SECRET: process.env.SESSION_SECRET ?? SEGREDO_TESTE_PADRAO,
      NODE_ENV: "test",
    },
    // Um único fork: os testes de integração compartilham o banco de teste (evita corrida).
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
