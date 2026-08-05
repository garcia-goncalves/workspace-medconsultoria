import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

/**
 * Suíte E2E reproduzível. Roda contra o app em execução (dev: web 4310 / api 4319, ou E2E_BASE_URL).
 * Auth por papel via storageState (e2e/.auth/*.json — NÃO versionado). Ver #2/#5 da finalização.
 * Os e-mails dos papéis-semente são públicos (não são segredo); a SENHA vem só do ambiente.
 *
 * Este config lê `SEED_ROOT_PASSWORD` do `.env` (o Playwright não carrega o `.env` sozinho) e
 * a usa como `E2E_PASSWORD` quando ela não vem explícita — no CI vem, com valor descartável.
 * Antes de 05/08/2026 a senha estava EMBUTIDA nos specs como fallback: em desenvolvimento a
 * suíte dependia daquele literal, então rotacionar a senha do seed a quebrava calada (ADR-98).
 *
 * `__dirname` de propósito: `import.meta.url` marcaria este arquivo como ES module e o
 * Playwright não conseguiria carregá-lo ("exports is not defined in ES module scope").
 */
const ENV = resolve(__dirname, ".env"); // pelo arquivo, não pelo CWD de quem rodou
if (!process.env.E2E_PASSWORD && existsSync(ENV)) {
  // Só a senha entra: copiar o `.env` inteiro levaria SMTP_PASS, OPENAI_API_KEY e afins para
  // dentro dos workers do Playwright sem que a suíte precise de nenhum deles.
  const doArquivo = parse(readFileSync(ENV, "utf8")).SEED_ROOT_PASSWORD;
  if (doArquivo) process.env.E2E_PASSWORD = doArquivo;
}

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4310";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
});
