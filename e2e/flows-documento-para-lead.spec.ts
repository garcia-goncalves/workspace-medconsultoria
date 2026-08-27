import { test, expect } from "@playwright/test";

/**
 * DOCUMENTO PARA QUEM AINDA É LEAD (27/08/2026, ordem do dono).
 *
 * O que se prova aqui, e só a tela prova:
 *  1. o seletor do "Novo documento" oferece LEADS quando o tipo é de pré-venda, com a etapa
 *     do funil ao lado (é a etapa que diz à Thaís se cabe propor agora);
 *  2. gerar a proposta para o lead funciona ponta a ponta, o papel sai com o nome da CLÍNICA
 *     (sem o "(Fulano)" que só serve para escolher na lista) e o lead CONTINUA no funil;
 *  3. a proposta aparece no painel do lead — emitir e não achar depois seria a mesma falha
 *     de costura das ADR-105/128;
 *  4. um tipo de PÓS-venda (contrato) não oferece lead nenhum.
 *
 * Os dois casos são testes SEPARADOS de propósito: encadeá-los exigia fechar o dropdown com
 * Esc no meio do caminho, e o Esc fecha o modal inteiro (a pilha de Esc do design system).
 */
test.use({ storageState: "e2e/.auth/admin.json" });

test("proposta para um lead: aparece no seletor, gera e volta no painel do lead", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto("/documentos");
  await page.getByRole("button", { name: "Novo documento" }).click();
  const d = page.getByRole("dialog");

  await d.getByPlaceholder("Escolha o tipo de documento…").fill("Proposta comercial");
  await page.getByRole("option", { name: /Proposta comercial/ }).click();
  await expect(d.getByText("Cliente ou lead")).toBeVisible();

  await d.getByPlaceholder(/Buscar cliente ou lead/).click();
  const opcaoLead = page.locator("[role=listbox]").getByRole("option").filter({ hasText: /Lead ·/ }).first();
  await expect(opcaoLead, "algum lead do funil deve aparecer no seletor").toBeVisible({ timeout: 10_000 });
  const rotuloLead = (await opcaoLead.innerText()).split("\n")[0]!.trim();
  // "Clínica X (Fulano)" → "Clínica X": é o que vai IMPRESSO.
  const nomeNoPapel = (rotuloLead.split("(")[0] ?? rotuloLead).trim();
  await opcaoLead.click();

  // Um serviço qualquer do catálogo — a proposta precisa de pelo menos um item.
  await d.locator("label").filter({ hasText: /Gestão Operacional/ }).first().click();
  await expect(d.getByText(`Cliente: ${nomeNoPapel}`)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /Gerar proposta/ }).click();
  await expect(page).toHaveURL(/\/documentos\/[a-z0-9]+/i, { timeout: 20_000 });
  await expect(page.getByText(nomeNoPapel).first()).toBeVisible();

  // O lead continua NO FUNIL (propor não converte) e a proposta aparece no painel dele.
  await page.goto("/leads");
  const cardDoLead = page.locator("main button").filter({ hasText: nomeNoPapel }).first();
  await expect(cardDoLead, "o lead não pode ter saído do funil ao receber a proposta").toBeVisible({
    timeout: 15_000,
  });
  await cardDoLead.click();
  const painel = page.locator("aside").last();
  await expect(painel.getByText("Documentos", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await expect(painel.getByText(/Proposta comercial/).first()).toBeVisible();
});

test("contrato NÃO oferece lead — quem assina já é cliente", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/documentos");
  await page.getByRole("button", { name: "Novo documento" }).click();
  const d = page.getByRole("dialog");

  await d.getByPlaceholder("Escolha o tipo de documento…").fill("Contrato");
  await page.getByRole("option", { name: /Contrato de presta/ }).click();

  // O rótulo do campo volta a ser só "Cliente".
  await expect(d.getByText("Cliente ou lead")).toHaveCount(0);
  // `focus()` e não `click()`: o clique do Playwright dispara mousedown antes do focus, e o
  // handler de "clicou fora" do Combobox fechava a lista no mesmo gesto que a abria.
  await d.getByPlaceholder("Buscar cliente…").focus();
  // Restrito ao listbox do campo: a página por trás do modal tem `<select>` de filtro, cujos
  // `<option>` escondidos casariam com um `getByRole("option")` solto.
  const lista = page.locator("[role=listbox]");
  await expect(lista.getByRole("option").first()).toBeVisible({ timeout: 10_000 });
  await expect(
    lista.getByRole("option").filter({ hasText: /Lead ·/ }),
    "contrato é pós-venda: nenhum lead pode aparecer",
  ).toHaveCount(0);
});
