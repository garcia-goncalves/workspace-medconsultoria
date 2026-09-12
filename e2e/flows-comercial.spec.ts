import { test, expect } from "@playwright/test";

// CENÁRIO 1 — Operação comercial (UI real, sessão ADMIN). Dados únicos; limpeza no banco depois.
test.use({ storageState: "e2e/.auth/admin.json" });

const RUN = `E2E${Date.now().toString().slice(-6)}`;
const LEAD = `Lead ${RUN}`;
const EMPRESA = `Empresa ${RUN}`;

async function abrirPainel(page) {
  await page.goto("/leads");
  await page.getByPlaceholder(/Buscar por nome/i).fill(RUN);
  const card = page.getByRole("button", { name: LEAD, exact: true });
  await expect(card).toBeVisible();
  await card.click();
  return page.getByRole("complementary"); // painel lateral do lead
}

test.describe.serial("Cenário 1 — comercial", () => {
  test("1. cria lead pela interface", async ({ page }) => {
    await page.goto("/leads");
    await page.getByRole("button", { name: "Novo lead" }).click();
    const dialog = page.getByRole("dialog", { name: "Novo lead" });
    await dialog.getByLabel("Nome *").fill(LEAD);
    await dialog.getByLabel("Empresa").fill(EMPRESA);
    await dialog.getByLabel("E-mail").fill(`${RUN.toLowerCase()}@teste.example`);
    await dialog.getByRole("button", { name: "Gestão Operacional" }).click();
    await dialog.getByRole("button", { name: "Criar lead" }).click();
    await expect(dialog).toHaveCount(0);
    // `exact`: os botoes de acao do card ganharam nome acessivel com o nome do lead dentro
    // ("Editar \"Lead X\""), entao a busca por trecho casa tres botoes.
    await expect(page.getByRole("button", { name: LEAD, exact: true })).toBeVisible();
  });

  test("2. abre o painel, edita e persiste após refresh", async ({ page }) => {
    const painel = await abrirPainel(page);
    await painel.getByRole("button", { name: "Editar", exact: true }).click();
    const edit = page.getByRole("dialog");
    await expect(edit).toBeVisible();
    const novoEmail = `${RUN.toLowerCase()}-edit@teste.example`;
    await edit.getByLabel("E-mail").fill(novoEmail);
    await edit.getByRole("button", { name: /salvar|atualizar/i }).click();
    await expect(edit).toHaveCount(0);
    // refresh e confirma persistência: reabre o Editar e checa o valor do campo
    const painel2 = await abrirPainel(page);
    await painel2.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(page.getByRole("dialog").getByLabel("E-mail")).toHaveValue(novoEmail);
  });

  test("3. converte o lead em cliente e confirma o cliente criado", async ({ page }) => {
    const painel = await abrirPainel(page);
    await painel.getByRole("button", { name: "Converter", exact: true }).click();
    // confirmação (modal)
    await page.getByRole("button", { name: /converter|confirmar|sim/i }).last().click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.goto("/clientes");
    await page.getByPlaceholder(/Buscar/i).first().fill(EMPRESA);
    await expect(page.getByText(EMPRESA).first()).toBeVisible({ timeout: 15000 });
  });
});
