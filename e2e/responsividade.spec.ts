import { test, expect, type Page } from "@playwright/test";
import { lerFixtures } from "./fixtures-helper";

// Bloco 11 — Responsividade FUNCIONAL: em cada viewport, além de não haver overflow horizontal,
// AÇÕES REAIS são CONCLUÍDAS pela interface (criar+salvar lead; ação financeira: criar→marcar→excluir).
test.use({ storageState: "e2e/.auth/admin.json" });

const VIEWPORTS = [
  { nome: "tablet 768x1024", w: 768, h: 1024 },
  { nome: "celular 390x844", w: 390, h: 844 },
  { nome: "celular 360x800", w: 360, h: 800 },
];

async function semOverflow(page: Page) {
  const of = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(of, "sem scroll horizontal").toBeLessThanOrEqual(20); // tolera variância de renderização headless (0 local)
}

for (const vp of VIEWPORTS) {
  test(`fluxos concluídos na interface — ${vp.nome}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: vp.w, height: vp.h });
    const RUN = `RSP${vp.w}${Date.now().toString().slice(-4)}`;

    // 1. Lista de leads sem overflow + modal cabe
    await page.goto("/leads");
    await semOverflow(page);
    await page.getByRole("button", { name: "Novo lead" }).click();
    const d = page.getByRole("dialog");
    await expect(d).toBeVisible();
    const box = await d.boundingBox();
    expect(box!.width, "modal cabe na largura").toBeLessThanOrEqual(vp.w);
    await semOverflow(page);

    // 2. CONCLUIR: preencher e SALVAR o lead
    await d.getByLabel("Nome *").fill(`Lead ${RUN}`);
    await d.getByRole("button", { name: "Criar lead" }).click();
    await expect(d).toHaveCount(0);
    // aparece na lista
    await page.getByPlaceholder(/Buscar por nome/i).fill(RUN);
    await expect(page.getByRole("button", { name: `Lead ${RUN}`, exact: true })).toBeVisible();

    // 3. Ação financeira CONCLUÍDA: criar conta → marcar paga → excluir
    await page.goto("/financeiro");
    await semOverflow(page);
    await page.getByRole("button", { name: "Nova conta" }).click();
    const c = page.getByRole("dialog", { name: "Nova conta" });
    await c.getByLabel("Tipo").selectOption("A pagar");
    await c.getByLabel("Valor *").fill("R$ 50,00");
    await c.getByLabel("Descrição *").fill(`Conta ${RUN}`);
    await c.getByLabel("Vencimento *").fill("2026-07-28");
    await c.getByRole("button", { name: "Criar conta" }).click();
    await expect(c).toHaveCount(0);
    await page.getByRole("button", { name: "Tudo" }).click();
    await page.getByRole("button", { name: "A pagar", exact: true }).first().click();
    // `[data-linha]:visible` em vez de `role="row"`: abaixo de `md` a lista vira CARTÃO (sem
    // tabela), e as DUAS formas ficam no DOM — quem escolhe é o CSS, então o teste precisa
    // olhar só a que está na tela.
    const linha = page.locator("[data-linha]:visible").filter({ hasText: `Conta ${RUN}` });
    await expect(linha).toBeVisible();
    await linha.getByRole("button", { name: "Marcar como paga" }).click();
    // excluir (limpeza)
    await page.getByRole("button", { name: "Todas", exact: true }).click();
    await page.locator("[data-linha]:visible").filter({ hasText: `Conta ${RUN}` }).getByRole("button", { name: `Remover conta "Conta ${RUN}"` }).click();
    await page.getByRole("dialog").filter({ hasText: "Remover conta" }).getByRole("button", { name: "Remover" }).click();

    // 4. Limpeza do lead criado
    await page.goto("/leads");
    await page.getByPlaceholder(/Buscar por nome/i).fill(RUN);
    await page.getByRole("button", { name: `Lead ${RUN}`, exact: true }).click();
    const painel = page.getByRole("complementary");
    await painel.getByRole("button", { name: "Remover", exact: true }).click();
    await page.getByRole("dialog").filter({ hasText: /Remover|Excluir/ }).getByRole("button", { name: /Remover|Excluir/ }).click();
  });

  // Fluxo operacional em mobile: projeto → abrir cartão (modal cabe) → checklist → comentário → limpeza.
  test(`projeto: cartão + checklist concluídos na interface — ${vp.nome}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: vp.w, height: vp.h });
    const RUN = `CRD${vp.w}${Date.now().toString().slice(-4)}`;
    const CARD = `Cartão ${RUN}`;

    // Projeto GARANTIDO pela setup — antes dependia de `flows-comercial` ter rodado antes.
    await page.goto(`/projetos/${lerFixtures().projetoId}`);
    await semOverflow(page);

    // Cria cartão
    await page.getByRole("button", { name: "Novo cartão" }).click();
    const nc = page.getByRole("dialog");
    const box = await nc.boundingBox();
    expect(box!.width, "modal do cartão cabe na largura").toBeLessThanOrEqual(vp.w);
    await nc.locator('input[name="titulo"]').fill(CARD);
    await nc.getByRole("button", { name: "Criar cartão" }).click();
    await expect(nc).toHaveCount(0);

    // Abre o painel do cartão (modal cabe) e conclui checklist + comentário
    // `^`: o botao "Mover \"Cartao X\" para outra coluna" tambem casa o nome do cartao.
    await page.getByRole("button", { name: new RegExp(`^${CARD}`) }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("heading", { name: CARD })).toBeVisible();
    await semOverflow(page);
    await panel.getByPlaceholder("Novo item…").fill(`Item ${RUN}`);
    await panel.getByPlaceholder("Novo item…").press("Enter");
    await expect(panel.getByText(`Item ${RUN}`)).toBeVisible();
    await panel.getByRole("checkbox").first().click();
    await expect(panel.getByRole("checkbox").first()).toBeChecked();
    await panel.getByPlaceholder("Escreva um comentário…").fill(`Coment ${RUN}`);
    await panel.getByRole("button", { name: "Comentar" }).click();
    await expect(panel.getByText(`Coment ${RUN}`)).toBeVisible();

    // Limpeza: remove o cartão
    await panel.getByRole("button", { name: "Remover cartão" }).click();
    await page.getByRole("dialog").filter({ hasText: "Remover cartão" }).getByRole("button", { name: "Remover" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^${CARD}`) })).toHaveCount(0);
  });
}
