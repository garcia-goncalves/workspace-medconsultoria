import { test, expect } from "@playwright/test";

// Bloco 1 do e-mail dentro da aplicação (ADR-95) — PELA INTERFACE.
// O que NÃO se testa aqui, de propósito: o caminho de senha errada. Ele já é coberto uma vez,
// no teste de integração da Tarefa 6, que roda com a credencial real do `.env`. Repetir login
// inválido a cada rodada de CI faria o Dovecot bloquear o IP por força bruta — e aí nem os
// e-mails automáticos da aplicação sairiam.
test.describe("E-mail dentro da aplicação", () => {
  test.use({ storageState: "e2e/.auth/funcionario.json" });

  test("o item E-mail está no menu e leva à página", async ({ page }) => {
    // Regressão do ADR-94: a página existia e a rota respondia, mas o item não aparecia no
    // menu porque o AppLayout tinha uma lista de navegação paralela ao catálogo de páginas.
    await page.goto("/");
    await page.getByRole("navigation").getByRole("link", { name: "E-mail", exact: true }).click();
    await expect(page).toHaveURL(/\/email$/);
  });

  test("convida a plugar a primeira caixa e abre o diálogo", async ({ page }) => {
    await page.goto("/email");

    await expect(page.getByRole("heading", { name: "Seu e-mail, aqui dentro" })).toBeVisible();
    await page.getByRole("button", { name: "Adicionar caixa" }).click();

    const dialogo = page.getByRole("dialog", { name: "Adicionar caixa de e-mail" });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.locator("#cx-email")).toBeVisible();
    // A senha nunca pode ser um campo de texto à vista.
    await expect(dialogo.locator("#cx-senha")).toHaveAttribute("type", "password");
  });

  test("recusa caixa de fora do domínio da empresa, sem tocar na rede", async ({ page }) => {
    await page.goto("/email");
    await page.getByRole("button", { name: "Adicionar caixa" }).click();

    const dialogo = page.getByRole("dialog", { name: "Adicionar caixa de e-mail" });
    // Trava de fase 1 — e também contenção: o servidor IMAP é deduzido do domínio digitado
    // (`mail.<domínio>`), então sem esta recusa dá para apontar a conexão da API para um host
    // interno. O teste não chega a abrir conexão nenhuma: a recusa acontece na validação.
    await dialogo.locator("#cx-email").fill("alguem@gmail.com");
    await dialogo.locator("#cx-senha").fill("irrelevante");
    await dialogo.locator("#cx-nome").fill("Teste E2E");
    await page.getByRole("button", { name: "Conectar" }).click();

    await expect(page.getByText(/só dá para plugar caixas @medconsultoria\.com\.br/i)).toBeVisible();
    await expect(dialogo, "o diálogo continua aberto — nada foi gravado pela metade").toBeVisible();

    // Recarregando, a página segue convidando a plugar a PRIMEIRA caixa.
    await page.goto("/email");
    await expect(page.getByRole("heading", { name: "Seu e-mail, aqui dentro" })).toBeVisible();
  });
});
