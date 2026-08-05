import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

// E-mails dos papéis-semente (públicos). A SENHA vem só do ambiente: sem valor embutido aqui,
// para o repositório não guardar uma senha que também existe em banco de verdade (05/08/2026).
// Quem preenche é o `playwright.config.ts` (lê o `.env` e deriva de `SEED_ROOT_PASSWORD`).
const PASS: string = process.env.E2E_PASSWORD ?? "";
if (!PASS) throw new Error("Sem senha para os testes: defina SEED_ROOT_PASSWORD no .env (ou E2E_PASSWORD no ambiente).");
export const USERS = {
  root: "root@medconsultoria.com.br",
  admin: "thais.garcia@medconsultoria.com.br",
  funcionario: "func@medconsultoria.com.br",
  cliente: "cliente@medconsultoria.com.br",
} as const;

mkdirSync("e2e/.auth", { recursive: true });

for (const [role, email] of Object.entries(USERS)) {
  setup(`login ${role}`, async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASS);
    await page.getByRole("button", { name: /entrar/i }).click();
    // Sinal de sucesso agnóstico ao papel: some o formulário (equipe → shell; CLIENTE → Portal,
    // que fica na mesma URL /login). Se as credenciais falharem, o campo de senha continua.
    await expect(page.locator('input[type="password"]'), `login ${role} deve concluir`).toHaveCount(0, { timeout: 20000 });
    await page.context().storageState({ path: `e2e/.auth/${role}.json` });
  });
}

// Fixtures determinísticas (briefing + tokens de reset) — sem elas os specs correspondentes
// não têm o que exercitar. Idempotente e com lookup dinâmico do cliente (portável p/ CI).
setup("seed fixtures", async () => {
  // `node` (não `tsx`): funciona só com `pnpm install --frozen-lockfile`, sem ferramenta extra.
  execSync("node scripts/e2e-fixtures.mjs", { stdio: "inherit" });
});
