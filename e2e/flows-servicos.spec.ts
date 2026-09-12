import { test, expect } from "@playwright/test";
import { lerFixtures } from "./fixtures-helper";

// Bloco 7 — Serviços/requisitos/briefings PELA INTERFACE.
// (o cliente PREENCHE o briefing pela UI em flows-portal-ui.spec.ts — Bloco 5.)

// ── ADMIN: autoria — criar serviço, configurar uma exigência e confirmar persistência ──
test.describe("Bloco 7 — Serviços (ADMIN autoria)", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("ADMIN cria serviço, adiciona exigência e persiste após refresh", async ({ page }) => {
    test.setTimeout(60_000);
    const RUN = `SVC${Date.now().toString().slice(-6)}`;
    const NOME = `Serviço E2E ${RUN}`;
    const EXIGENCIA = `Documento ${RUN}`;

    // 1. Novo serviço
    await page.goto("/servicos");
    // Ha dois: o do cabecalho e o do estado vazio. O do cabecalho vem primeiro.
    await page.getByRole("button", { name: "Novo serviço" }).first().click();
    const nc = page.getByRole("dialog", { name: "Novo serviço" });
    await nc.locator("#s-nome").fill(NOME);
    await nc.getByRole("button", { name: "Criar serviço" }).click();
    await expect(nc).toHaveCount(0);

    // 2. O card do serviço aparece → Configurar
    const card = page.locator("div").filter({ hasText: NOME }).filter({ has: page.getByRole("button", { name: "Configurar" }) }).last();
    await card.getByRole("button", { name: "Configurar" }).click();
    const cfg = page.getByRole("dialog", { name: new RegExp(`Configurar.*${RUN}`) });
    await expect(cfg).toBeVisible();

    // 3. Aba "O cliente envia" → adicionar uma exigência
    // As secoes do "Configurar" viraram ABAS (`role="tab"`).
    await cfg.getByRole("tab", { name: "O cliente envia" }).click();
    await cfg.getByPlaceholder(/Documento pedido/i).fill(EXIGENCIA);
    await cfg.getByRole("button", { name: "Adicionar" }).click();
    await expect(cfg.getByText(EXIGENCIA)).toBeVisible();

    // 4. "O cliente envia" é auto-save; o "Fechar" do rodapé apenas fecha (sem pendências → sem aviso).
    //    (o "X" do cabeçalho tem aria-label "Fechar" também; :has-text mira o botão do rodapé.)
    await cfg.locator('button:has-text("Fechar")').click();
    await expect(cfg).toHaveCount(0);

    // 5. Refresh → reabrir Configurar → a exigência persiste
    await page.reload();
    const card2 = page.locator("div").filter({ hasText: NOME }).filter({ has: page.getByRole("button", { name: "Configurar" }) }).last();
    await card2.getByRole("button", { name: "Configurar" }).click();
    const cfg2 = page.getByRole("dialog", { name: new RegExp(`Configurar.*${RUN}`) });
    await cfg2.getByRole("tab", { name: "O cliente envia" }).click();
    await expect(cfg2.getByText(EXIGENCIA)).toBeVisible();
  });

  test("Configurar > Detalhes: Salvar/Cancelar e aviso antes de descartar ao trocar de aba", async ({ page }) => {
    test.setTimeout(60_000);
    const RUN = `SVC${Date.now().toString().slice(-6)}`;
    const NOME = `Serviço Guard ${RUN}`;

    // Cria o serviço e abre "Configurar" (abre na aba Detalhes)
    await page.goto("/servicos");
    await page.getByRole("button", { name: "Novo serviço" }).first().click();
    const nc = page.getByRole("dialog", { name: "Novo serviço" });
    await nc.locator("#s-nome").fill(NOME);
    await nc.getByRole("button", { name: "Criar serviço" }).click();
    await expect(nc).toHaveCount(0);

    const card = page.locator("div").filter({ hasText: NOME }).filter({ has: page.getByRole("button", { name: "Configurar" }) }).last();
    await card.getByRole("button", { name: "Configurar" }).click();
    const cfg = page.getByRole("dialog", { name: new RegExp(`Configurar.*${RUN}`) });
    await expect(cfg).toBeVisible();

    // Sem alteração: Salvar começa DESABILITADO
    const salvar = cfg.getByRole("button", { name: "Salvar", exact: true });
    await expect(salvar).toBeDisabled();

    // Edita o nome → Salvar habilita
    await cfg.locator("#d-nome").fill(`${NOME} EDITADO`);
    await expect(salvar).toBeEnabled();

    // Trocar de aba com edição pendente → PEDE confirmação; "Continuar editando" mantém tudo
    await cfg.getByRole("tab", { name: "Para vender" }).click();
    const aviso = page.getByRole("dialog", { name: "Descartar alterações?" });
    await expect(aviso).toBeVisible();
    await aviso.getByRole("button", { name: "Continuar editando" }).click();
    await expect(aviso).toHaveCount(0);
    await expect(cfg.locator("#d-nome")).toHaveValue(`${NOME} EDITADO`); // não perdeu o texto

    // "Cancelar" reverte a edição e volta a desabilitar Salvar
    await cfg.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(cfg.locator("#d-nome")).toHaveValue(NOME);
    await expect(salvar).toBeDisabled();

    // Agora sem pendência: trocar de aba NÃO pede confirmação
    await cfg.getByRole("tab", { name: "Para vender" }).click();
    await expect(page.getByRole("dialog", { name: "Descartar alterações?" })).toHaveCount(0);
  });
});

// ── FUNCIONARIO: operação — abrir a ficha do cliente, achar o serviço e VER as respostas do briefing ──
test.describe("Bloco 7 — Serviços (FUNCIONARIO operação)", () => {
  test.use({ storageState: "e2e/.auth/funcionario.json" });

  test("FUNCIONARIO vê na ficha as respostas enviadas do briefing (autoria/valores)", async ({ page }) => {
    test.setTimeout(60_000);
    const { outroClienteId } = lerFixtures();

    // Abre a ficha do cliente que tem o briefing ENVIADO (serviço "Servico E2E Briefing")
    await page.goto(`/clientes/${outroClienteId}`);
    const cardServico = page.locator("div").filter({ hasText: "Servico E2E Briefing" }).last();
    await expect(cardServico.getByText("Servico E2E Briefing")).toBeVisible();

    // O requisito de briefing aparece com "Ver respostas" (resposta ENVIADA pelo cliente)
    await page.getByRole("button", { name: "Ver respostas" }).first().click();

    // Dialog só-leitura: título do briefing, "Enviado pelo cliente" (autoria) e os rótulos/valores
    const d = page.getByRole("dialog");
    await expect(d.getByText("Briefing E2E")).toBeVisible();
    await expect(d.getByText("Enviado pelo cliente")).toBeVisible();
    // Rótulos dos campos + um valor enviado (confirma que a equipe LÊ o que o cliente respondeu)
    await expect(d.getByText("Curto", { exact: true })).toBeVisible();
    await expect(d.getByText("Resposta curta FUNC")).toBeVisible();
    await expect(d.getByText("Data", { exact: true })).toBeVisible();
    await expect(d.getByText("2026-07-20")).toBeVisible();
  });
});
