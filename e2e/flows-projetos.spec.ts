import { test, expect, type Page } from "@playwright/test";
import { lerFixtures } from "./fixtures-helper";

// Cenário 5 — Projetos: cartão (criar), checklist (add+marcar), comentário, timer (start/stop),
// persistência após refresh e mover cartão entre colunas do kanban (dnd-kit / PointerSensor).
test.use({ storageState: "e2e/.auth/admin.json" });

const RUN = `PJ${Date.now().toString().slice(-6)}`;
const CARD = `Cartão ${RUN}`;

async function abrirProjeto(page: Page) {
  // Projeto GARANTIDO pela setup. Antes isto abria "o primeiro projeto do seed", que na verdade
  // só existia porque `flows-comercial` roda antes e converte um lead — dependência de ordem que
  // quebrava a suíte num banco recém-criado.
  await page.goto(`/projetos/${lerFixtures().projetoId}`);
  await expect(page.getByRole("button", { name: "Novo cartão" })).toBeVisible();
}

async function criarCartao(page: Page) {
  await page.getByRole("button", { name: "Novo cartão" }).click();
  const nc = page.getByRole("dialog");
  await nc.locator('input[name="titulo"]').fill(CARD);
  await nc.getByRole("button", { name: "Criar cartão" }).click();
  await expect(nc).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(`^${CARD}`) })).toBeVisible();
}

test("cartão: checklist + comentário + timer persistem após refresh", async ({ page }) => {
  await abrirProjeto(page);
  await criarCartao(page);

  // Abre o painel do cartão (CardPanel = role=dialog após fix de a11y)
  await page.getByRole("button", { name: new RegExp(`^${CARD}`) }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: CARD })).toBeVisible();

  // Checklist: adiciona item e marca (cartão novo → único checkbox é o meu item)
  await panel.getByPlaceholder("Novo item…").fill(`Item ${RUN}`);
  await panel.getByPlaceholder("Novo item…").press("Enter");
  await expect(panel.getByText(`Item ${RUN}`)).toBeVisible();
  await panel.getByRole("checkbox").first().click();
  await expect(panel.getByRole("checkbox").first()).toBeChecked();

  // Comentário
  await panel.getByPlaceholder("Escreva um comentário…").fill(`Coment ${RUN}`);
  await panel.getByRole("button", { name: "Comentar" }).click();
  await expect(panel.getByText(`Coment ${RUN}`)).toBeVisible();

  // Timer start → stop
  await panel.getByRole("button", { name: "Iniciar" }).click();
  await expect(panel.getByRole("button", { name: "Parar" })).toBeVisible();
  await panel.getByRole("button", { name: "Parar" }).click();
  await expect(panel.getByRole("button", { name: "Iniciar" })).toBeVisible();

  // Fecha, recarrega, reabre → tudo persiste
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: new RegExp(`^${CARD}`) }).click();
  const p2 = page.getByRole("dialog");
  await expect(p2.getByText(`Item ${RUN}`)).toBeVisible();
  await expect(p2.getByText(`Coment ${RUN}`)).toBeVisible();
  await expect(p2.getByRole("checkbox").first()).toBeChecked();

  // Limpeza: remove o cartão (botão do cabeçalho) → confirma
  await p2.getByRole("button", { name: "Remover cartão" }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "Remover cartão" });
  await confirm.getByRole("button", { name: "Remover" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${CARD}`) })).toHaveCount(0);
});

test("mover cartão entre colunas persiste após refresh", async ({ page }) => {
  await abrirProjeto(page);
  await criarCartao(page);

  const card = page.getByRole("button", { name: new RegExp(`^${CARD}`) });
  // Coluna destino "Em andamento" — dropar sobre o cabeçalho da coluna.
  const alvo = page.getByText("Em andamento", { exact: false }).first();

  const cb = await card.boundingBox();
  const ab = await alvo.boundingBox();
  if (!cb || !ab) throw new Error("sem bounding box");

  // Sequência de ponteiro do dnd-kit: down → move >6px (ativa) → move até o alvo → up
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 12, cb.y + cb.height / 2 + 12, { steps: 5 });
  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2 + 40, { steps: 10 });
  await page.mouse.up();

  // Recarrega e confirma que o cartão ficou na coluna "Em andamento".
  await page.reload();
  await expect(page.getByRole("button", { name: "Novo cartão" })).toBeVisible();
  // A coluna "Em andamento" agora contém o cartão.
  const colEmAndamento = page.locator("div").filter({ hasText: "Em andamento" }).filter({ has: page.getByRole("button", { name: new RegExp(`^${CARD}`) }) });
  await expect(colEmAndamento.first()).toBeVisible();

  // Limpeza
  await page.getByRole("button", { name: new RegExp(`^${CARD}`) }).click();
  const p = page.getByRole("dialog");
  await p.getByRole("button", { name: "Remover cartão" }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "Remover cartão" });
  await confirm.getByRole("button", { name: "Remover" }).click();
});
