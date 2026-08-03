import { test, expect } from "@playwright/test";

/**
 * ADR-91 — "defina sua senha no primeiro acesso".
 *
 * Uma conta interna criada por outra pessoa (ADMIN digita a senha) nasce sem
 * `senhaTrocadaEm`: no 1º login a app exige que a pessoa defina uma senha só dela antes de
 * usar qualquer coisa. Depois de definida, nunca mais incomoda.
 *
 * A conta é criada DENTRO do teste, então não sofre com o `scripts/e2e-senha-ja-trocada.mjs`
 * (que roda uma vez, logo após o seed, sobre as contas de teste pré-existentes).
 */
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4310";
const SENHA_INICIAL = "SenhaInicial2026";
const SENHA_PROPRIA = "MinhaPropriaSenha2026";

// E-mail único por execução: o teste cria conta e o banco isolado pode ser reaproveitado.
const EMAIL = `primeiro.acesso.${Date.now()}@medconsultoria.com.br`;

test.describe("primeiro acesso: definir a própria senha", () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // sempre deslogado

  test("conta nova é obrigada a definir senha, e só uma vez", async ({ page, playwright }) => {
    // 1) ADMIN cria a conta com uma senha que ELE escolheu (não a pessoa).
    const admin = await playwright.request.newContext({
      baseURL: BASE,
      storageState: "e2e/.auth/admin.json",
    });
    const criar = await admin.post("/trpc/usuarios.create", {
      data: { json: { nome: "Pessoa Primeiro Acesso", email: EMAIL, senha: SENHA_INICIAL, role: "FUNCIONARIO" } },
      headers: { "content-type": "application/json" },
    });
    expect(criar.status(), "ADMIN deve conseguir criar a conta").toBe(200);
    await admin.dispose();

    // 2) 1º login: a app NÃO deixa passar — pede a senha própria.
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(SENHA_INICIAL);
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page.getByRole("heading", { name: /bem-vindo/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/senha inicial/i)).toBeVisible();

    // 3) Define a senha própria → entra na app.
    await page.locator("#senhaAtual").fill(SENHA_INICIAL);
    await page.locator("#novaSenha").fill(SENHA_PROPRIA);
    await page.locator("#confirmar").fill(SENHA_PROPRIA);
    await page.getByRole("button", { name: /salvar e entrar/i }).click();

    await expect(page.getByRole("heading", { name: /bem-vindo/i })).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    // 4) Sai e entra de novo com a senha própria → não incomoda mais.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(SENHA_PROPRIA);
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page.locator('input[type="password"]'), "2º login entra direto").toHaveCount(0, {
      timeout: 20000,
    });
  });
});
