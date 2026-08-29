import { test, expect } from "@playwright/test";

// CENÁRIO 8 — Financeiro (UI real). Cria contas únicas; RBAC por perfil.
const RUN = `FIN${Date.now().toString().slice(-6)}`;

test.describe.serial("Cenário 8 — financeiro (ADMIN)", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  async function criarConta(page, tipo: "A pagar" | "A receber", descricao: string, valor: string) {
    await page.goto("/financeiro");
    await page.getByRole("button", { name: "Nova conta" }).click();
    const d = page.getByRole("dialog", { name: "Nova conta" });
    await d.getByLabel("Tipo").selectOption(tipo);
    await d.getByLabel("Valor *").fill(valor);
    await d.getByLabel("Descrição *").fill(descricao);
    await d.getByLabel("Vencimento *").fill("2026-07-28");
    await d.getByRole("button", { name: "Criar conta" }).click();
    await expect(d).toHaveCount(0);
  }

  test("cria conta a receber e a pagar e persiste após refresh", async ({ page }) => {
    await criarConta(page, "A receber", `${RUN} receber`, "R$ 1.500,00");
    await criarConta(page, "A pagar", `${RUN} pagar`, "R$ 800,00");
    await page.goto("/financeiro");
    await page.getByRole("button", { name: "Tudo" }).click();
    // Confere na TABELA. `getByText` solto casava também com o card "Precisa de você" (a conta
    // vence em breve), dando strict-mode violation num banco sem outras contas — o painel só
    // ficava vazio porque, na prática, algum spec anterior já havia enchido o mês.
    await expect(page.getByRole("row").filter({ hasText: `${RUN} receber` })).toBeVisible();
    await page.getByRole("button", { name: "A pagar", exact: true }).first().click();
    await expect(page.getByRole("row").filter({ hasText: `${RUN} pagar` })).toBeVisible();
  });

  test("CRUD via UI: editar+persistir, marcar paga, filtrar e excluir", async ({ page }) => {
    const desc = `${RUN} crud`;
    await criarConta(page, "A pagar", desc, "R$ 150,00");

    await page.goto("/financeiro");
    await page.getByRole("button", { name: "Tudo" }).click();
    await page.getByRole("button", { name: "A pagar", exact: true }).first().click();
    await expect(page.getByRole("row").filter({ hasText: desc })).toBeVisible();

    // Editar valor → 250,00 e confirmar persistência após refresh
    // Os controles da linha trocaram `title` por NOME ACESSIVEL, que ja traz a descricao da conta.
    await page.getByRole("button", { name: `Editar conta "${desc}"` }).click();
    const d = page.getByRole("dialog", { name: "Editar conta" });
    await d.getByLabel("Valor *").fill("R$ 250,00");
    await d.getByRole("button", { name: /Salvar|Atualizar/ }).click();
    await expect(d).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "Tudo" }).click();
    await page.getByRole("button", { name: "A pagar", exact: true }).first().click();
    await expect(page.getByRole("row").filter({ hasText: desc })).toContainText("250,00");

    // Marcar como paga → aparece em "Pagas", some de "Pendentes"
    await page.getByRole("row").filter({ hasText: desc }).getByRole("button", { name: "Marcar como paga" }).click();
    await page.getByRole("button", { name: "Pagas", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: desc })).toBeVisible();
    await page.getByRole("button", { name: "Pendentes", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: desc })).toHaveCount(0);

    // Excluir (via "Todas") e confirmar remoção após refresh
    await page.getByRole("button", { name: "Todas", exact: true }).click();
    await page.getByRole("row").filter({ hasText: desc }).getByRole("button", { name: `Remover conta "${desc}"` }).click();
    await page.getByRole("dialog").filter({ hasText: "Remover conta" }).getByRole("button", { name: "Remover" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Tudo" }).click();
    await page.getByRole("button", { name: "Todas", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: desc })).toHaveCount(0);
  });

  test("carteira Pessoal: conta pessoal aparece só na carteira Pessoal", async ({ page }) => {
    const desc = `${RUN} pessoal`;
    await page.goto("/financeiro");
    await page.getByRole("button", { name: "Nova conta" }).click();
    const d = page.getByRole("dialog", { name: "Nova conta" });
    await d.getByRole("button", { name: "Pessoal", exact: true }).click();
    await d.getByLabel("Tipo").selectOption("A pagar");
    await d.getByLabel("Valor *").fill("R$ 90,00");
    await d.getByLabel("Descrição *").fill(desc);
    await d.getByLabel("Vencimento *").fill("2026-07-28");
    await d.getByRole("button", { name: "Criar conta" }).click();
    await expect(d).toHaveCount(0);

    // Aparece na carteira Pessoal
    await page.getByRole("button", { name: "Pessoal", exact: true }).click();
    await page.getByRole("button", { name: "A pagar", exact: true }).first().click();
    await expect(page.getByRole("row").filter({ hasText: desc })).toBeVisible();
    // NÃO aparece na carteira Empresa (isolamento por carteira)
    await page.getByRole("button", { name: "Empresa", exact: true }).click();
    await page.getByRole("button", { name: "A pagar", exact: true }).first().click();
    await expect(page.getByRole("row").filter({ hasText: desc })).toHaveCount(0);

    // Limpeza
    await page.getByRole("button", { name: "Pessoal", exact: true }).click();
    await page.getByRole("button", { name: "A pagar", exact: true }).first().click();
    await page.getByRole("row").filter({ hasText: desc }).getByRole("button", { name: `Remover conta "${desc}"` }).click();
    await page.getByRole("dialog").filter({ hasText: "Remover conta" }).getByRole("button", { name: "Remover" }).click();
  });
});

test.describe("Cenário 8 — RBAC do Financeiro", () => {
  test("FUNCIONARIO não acessa /financeiro (URL direta)", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/funcionario.json" });
    const page = await ctx.newPage();
    await page.goto("/financeiro");
    await expect(page.getByText("Acesso restrito")).toBeVisible();
    await ctx.close();
  });

  test("CLIENTE não vê o Financeiro (Portal)", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/cliente.json" });
    const page = await ctx.newPage();
    await page.goto("/financeiro");
    await expect(page.getByRole("heading", { name: /Portal/i })).toBeVisible();
    await ctx.close();
  });
});
