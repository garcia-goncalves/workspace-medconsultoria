import { test, expect, type Locator } from "@playwright/test";

// Bloco 5 — Portal do cliente PELA INTERFACE: preencher briefing (todos os tipos de campo),
// enviar, refresh e persistência; e cancelar um serviço. Usa o serviço/briefing semeado (fixture).
// (login/convite/definir-senha estão em e2e-integration/invites-smtp; mensagem/chamado em realtime-mensagens.)
test.use({ storageState: "e2e/.auth/cliente.json" });

// Os campos do briefing não têm label associado (label solto) → localizo pelo texto do rótulo → div pai.
function campo(d: Locator, rotulo: string): Locator {
  return d.getByText(rotulo, { exact: true }).locator("xpath=..");
}

test.describe.serial("Bloco 5 — Portal (UI)", () => {
  test("briefing: cliente preenche todos os tipos pela UI, envia e persiste", async ({ page }) => {
    await page.goto("/");
    // O briefing pode já ter resposta (outro spec HTTP usa o mesmo requisito) → aceita ambos os rótulos.
    await page.getByRole("button", { name: /Preencher na tela|Revisar resposta/ }).first().click();
    const d = page.getByRole("dialog");
    await expect(d.getByText("Briefing E2E")).toBeVisible();

    // .fill/.check são IDEMPOTENTES (robusto a valores pré-existentes); nada de toggle por .click().
    await campo(d, "Curto").locator("input").fill("Resposta curta UI");
    await campo(d, "Longo").locator("textarea").fill("Linha 1 UI\nLinha 2 UI");
    await campo(d, "Escolha").getByRole("radio").first().check(); // opção "A"
    await campo(d, "Multipla").getByRole("checkbox").nth(0).check(); // X
    await campo(d, "Multipla").getByRole("checkbox").nth(1).uncheck(); // Y desmarcado
    await campo(d, "Multipla").getByRole("checkbox").nth(2).check(); // Z
    await campo(d, "Numero").locator("input").fill("42");
    await campo(d, "SimNao").getByRole("button", { name: "Sim" }).click();
    await campo(d, "Data").locator("input").fill("2026-07-20");

    await d.getByRole("button", { name: "Enviar" }).click();
    await expect(d).toHaveCount(0);

    // Refresh → reabrir (agora "Revisar resposta") → valores persistidos
    await page.reload();
    await page.getByRole("button", { name: "Revisar resposta" }).first().click();
    const d2 = page.getByRole("dialog");
    await expect(campo(d2, "Curto").locator("input")).toHaveValue("Resposta curta UI");
    await expect(campo(d2, "Longo").locator("textarea")).toHaveValue("Linha 1 UI\nLinha 2 UI");
    await expect(campo(d2, "Numero").locator("input")).toHaveValue("42");
    await expect(campo(d2, "Data").locator("input")).toHaveValue("2026-07-20");
    // múltipla escolha: X e Z marcados
    await expect(campo(d2, "Multipla").getByRole("checkbox").nth(0)).toBeChecked(); // X
    await expect(campo(d2, "Multipla").getByRole("checkbox").nth(2)).toBeChecked(); // Z
    await d2.getByRole("button", { name: "Cancelar" }).click();
  });

  test("cancelar serviço pela UI e confirmar estado após refresh", async ({ page }) => {
    await page.goto("/");
    const btnCancelar = page.getByRole("button", { name: "Cancelar serviço" }).first();
    await expect(btnCancelar).toBeVisible();
    await btnCancelar.click();
    // confirmação (useConfirm) → confirmar
    const conf = page.getByRole("dialog").filter({ hasText: /Cancelar/ });
    await conf.getByRole("button", { name: "Cancelar serviço" }).click();
    // Após refresh, o serviço não oferece mais "Cancelar serviço" (foi cancelado)
    await page.reload();
    await expect(page.getByRole("button", { name: "Cancelar serviço" })).toHaveCount(0);
  });
});
