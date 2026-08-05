import { test, expect } from "@playwright/test";
import { lerFixtures } from "./fixtures-helper";

/**
 * A conversa com o cliente na ficha (ADR-97) — PELA INTERFACE.
 *
 * Até aqui nenhum e2e tocava a ficha do cliente, e é nela que a promessa desta fase se cumpre ou
 * se quebra. A caixa do fixture é da ADMIN (`scripts/e2e-fixtures.mjs`), por isso os testes rodam
 * logados como ela: "Tirar da ficha" só existe para quem é dono da caixa.
 */
test.describe("E-mail na ficha do cliente", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  const VISIVEL = "Contrato para revisar (E2E)";
  const PARTICULAR = "Conversa particular (E2E)";

  test("o card mostra o que saiu da caixa, com selo de origem — e esconde o que é particular", async ({ page }) => {
    const { emailClienteId } = lerFixtures();
    await page.goto(`/clientes/${emailClienteId}`);

    await expect(page.getByText("Automáticos e das caixas da equipe")).toBeVisible();
    await expect(page.getByText(VISIVEL)).toBeVisible();
    // O selo é o que impede confundir e-mail automático com correspondência escrita por gente.
    await expect(page.getByText(/^Caixa de /)).toBeVisible();
    // Metadado + trecho, NUNCA o corpo: é a decisão de privacidade da fase.
    await expect(page.getByText("segue o contrato para a sua revisão")).toBeVisible();

    // A válvula filtra na CONSULTA, não na tela: o particular não chega nem ao HTML.
    await expect(page.getByText(PARTICULAR)).toHaveCount(0);
  });

  /**
   * A ida e a volta no mesmo teste, de propósito: além de cobrir a válvula inteira, devolver o
   * e-mail à ficha no fim deixa o banco como estava — a suíte pode rodar de novo sem re-semear.
   */
  test("o dono tira o e-mail da ficha e o devolve pela própria caixa", async ({ page }) => {
    const { emailClienteId } = lerFixtures();
    await page.goto(`/clientes/${emailClienteId}`);
    await expect(page.getByText(VISIVEL)).toBeVisible();

    await page.getByRole("button", { name: "Tirar da ficha" }).click();
    const confirmacao = page.getByRole("dialog", { name: "Tirar este e-mail da ficha?" });
    await confirmacao.getByRole("button", { name: "Tirar da ficha" }).click();

    // Some para TODA a equipe, na hora — sem recarregar a página.
    await expect(page.getByText(VISIVEL)).toHaveCount(0);

    // Devolver é do lado da caixa: a ficha só tira.
    await page.goto("/email");
    await page.getByRole("button", { name: new RegExp(VISIVEL.replace(/[()]/g, "\\$&")) }).click();
    await page.getByRole("button", { name: "Devolver à ficha" }).click();
    await expect(page.getByRole("button", { name: "Tirar da ficha" })).toBeVisible();

    await page.goto(`/clientes/${emailClienteId}`);
    await expect(page.getByText(VISIVEL)).toBeVisible();
  });
});
