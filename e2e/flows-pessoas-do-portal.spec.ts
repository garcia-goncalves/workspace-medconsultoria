import { test, expect } from "@playwright/test";

/**
 * VÁRIAS PESSOAS POR CLÍNICA — na tela (ADR-131).
 *
 * O que este teste guarda é o que só a TELA mostrou, e que teste de servidor não pega:
 *
 *  1. a pessoa recém-convidada aparece como **"Convidado — ainda não entrou"**, e não como
 *     "acesso revogado". Foi o defeito da primeira rodada: `ativo = false` vale tanto para
 *     quem ainda não criou a senha quanto para quem foi desligado, e a lista dizia à clínica
 *     que tiramos um acesso que acabáramos de dar;
 *  2. quando ninguém fala pela clínica, a tela **avisa** e o convite já vem com "Responsável"
 *     escolhido — sem isso a clínica termina com acesso que não pode aceitar proposta nenhuma,
 *     e nada na tela diz por quê;
 *  3. a recusa do servidor ("a clínica precisa de um responsável") chega ao usuário em
 *     português, e o seletor volta ao valor de verdade em vez de ficar mostrando a mudança
 *     que não aconteceu.
 */
test.describe("Pessoas com acesso ao Portal (ficha do cliente)", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("convidar, promover e a trava do último responsável", async ({ page }) => {
    test.setTimeout(90_000);

    // Um cliente novo, para o teste não depender de quem já tem acesso no banco de demonstração.
    const marca = Date.now().toString().slice(-6);
    const nomeCliente = `Clínica Pessoas ${marca}`;
    await page.goto("/clientes");
    await page.getByRole("button", { name: /Novo cliente/i }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel(/Nome/i).first().fill(nomeCliente);
    await form.getByRole("button", { name: /^Criar cliente$/i }).click();
    // Cadastrar cliente pede confirmação (ADR-25) — a caixa do e-mail nasce desmarcada.
    await page.getByRole("button", { name: /^Cadastrar cliente$/i }).click();
    await expect(page.getByText(nomeCliente).first()).toBeVisible();
    await page.getByText(nomeCliente).first().click();
    await expect(page).toHaveURL(/\/clientes\/[a-z0-9]+/);

    await expect(page.getByRole("heading", { name: "Pessoas com acesso ao Portal" })).toBeVisible();
    await expect(page.getByText(/Ninguém desta clínica tem acesso ao Portal ainda/)).toBeVisible();

    // Clínica sem ninguém: o convite já nasce com "Responsável" escolhido.
    await page.getByRole("button", { name: "Convidar pessoa" }).click();
    const modal = page.getByRole("dialog", { name: /Convidar alguém da clínica/ });
    await expect(modal).toBeVisible();
    await expect(modal.locator("#pessoa-papel")).toHaveValue("RESPONSAVEL");

    await modal.locator("#pessoa-nome").fill("Dra. Helena Martins Prado");
    await modal.locator("#pessoa-email").fill(`helena.${marca}@clinica.teste.local`);
    await modal.getByRole("button", { name: /Enviar convite/ }).click();
    await expect(modal).toHaveCount(0);

    // ⚠️ CONVIDADO, nunca "revogado" — o defeito que só a tela mostrou.
    await expect(page.getByText("Dra. Helena Martins Prado")).toBeVisible();
    await expect(page.getByText("Convidado — ainda não entrou")).toBeVisible();
    await expect(page.getByText("Acesso revogado")).toHaveCount(0);
    // Com um responsável, o aviso de "ninguém fala pela clínica" não aparece.
    await expect(page.getByText(/Ninguém aqui fala pela clínica/)).toHaveCount(0);

    // A trava: rebaixar o único responsável é recusado, em português, e o seletor não mente.
    const papel = page.getByLabel("Papel de Dra. Helena Martins Prado");
    await papel.selectOption("EQUIPE");
    await expect(page.getByText(/A clínica precisa de pelo menos um responsável/)).toBeVisible();
    await expect(papel).toHaveValue("RESPONSAVEL");

    // Uma segunda pessoa: agora o padrão do convite é "Equipe".
    await page.getByRole("button", { name: "Convidar pessoa" }).click();
    const modal2 = page.getByRole("dialog", { name: /Convidar alguém da clínica/ });
    await expect(modal2.locator("#pessoa-papel")).toHaveValue("EQUIPE");
    await modal2.getByRole("button", { name: /Cancelar/ }).click();

    // Nenhum erro de JavaScript na tela.
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(String(e)));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Pessoas com acesso ao Portal" })).toBeVisible();
    expect(erros).toEqual([]);
  });
});
