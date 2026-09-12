import { test, expect } from "@playwright/test";

// Bloco 1b — "Mensagens automáticas" (Ajustes → E-mails): Salvar/Cancelar sem perda
// silenciosa. Editar um template e trocar de categoria/mensagem deve AVISAR antes de descartar.
test.describe("Bloco 1b — Mensagens automáticas (ADMIN)", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("editar template: Salvar/Cancelar e aviso antes de descartar ao trocar de categoria", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/emails");

    // A 1ª mensagem abre sozinha no editor.
    const corpo = page.locator("#campo-corpo");
    await expect(corpo).toBeVisible();
    const original = await corpo.inputValue();

    // Sem alteração: Salvar começa DESABILITADO.
    const salvar = page.getByRole("button", { name: "Salvar", exact: true });
    await expect(salvar).toBeDisabled();

    // Edita o corpo → Salvar habilita.
    await corpo.fill(`${original} [rascunho e2e]`);
    await expect(salvar).toBeEnabled();

    // Trocar de categoria com edição pendente → PEDE confirmação.
    // As categorias viraram ABAS (`role="tab"`), nao botoes.
    await page.getByRole("tab", { name: /Avisos e lembretes/ }).click();
    const aviso = page.getByRole("dialog", { name: "Descartar alterações?" });
    await expect(aviso).toBeVisible();

    // "Continuar editando" mantém tudo (não trocou, texto preservado).
    await aviso.getByRole("button", { name: "Continuar editando" }).click();
    await expect(aviso).toHaveCount(0);
    await expect(corpo).toHaveValue(`${original} [rascunho e2e]`);

    // "Cancelar" reverte a edição e volta a desabilitar Salvar.
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(corpo).toHaveValue(original);
    await expect(salvar).toBeDisabled();

    // Agora sem pendência: trocar de categoria NÃO pede confirmação.
    await page.getByRole("tab", { name: /Avisos e lembretes/ }).click();
    await expect(page.getByRole("dialog", { name: "Descartar alterações?" })).toHaveCount(0);
  });
});
