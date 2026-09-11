import { test, expect, type APIRequestContext } from "@playwright/test";
import { lerFixtures } from "./fixtures-helper";

// Cenário 7 — Mensagens/suporte: um chamado é ESCOPADO ao clienteId da sessão.
// O cliente abre e lê o próprio chamado, NÃO lê o de outro cliente, e a infra
// de tempo real (socket.io) está no ar e responde ao handshake autenticado.
// Respeita `E2E_BASE_URL` (mesma regra do playwright.config): fixar a porta fazia estes
// testes autenticarem numa instância e chamarem OUTRA — 401 no runner de banco isolado.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4310";
const ASSUNTO = `Chamado E2E ${Date.now().toString().slice(-6)}`;

function jsonBody(input: unknown) {
  return { data: { json: input }, headers: { "content-type": "application/json" } };
}
function q(input: unknown) {
  return `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
}
async function dataJson(res: { json: () => Promise<unknown> }) {
  return (await res.json() as { result: { data: { json: unknown } } }).result.data.json;
}

// Regressão: editar/apagar a PRÓPRIA mensagem não pode depender de :hover — em celular/tablet
// não há hover persistente e a pessoa ficaria sem forma de editar/apagar. O botão "⋮" (Opções)
// já usava o padrão certo (`opacity-100 md:opacity-0 md:group-hover:opacity-100`); este teste
// prova que editar/apagar segue o mesmo padrão numa viewport de celular, sem precisar de hover.
test("editar/apagar a própria mensagem fica visível sem hover em tela de celular", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/admin.json", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/mensagens");

  // Abre a primeira conversa da lista (qualquer uma serve — só precisamos mandar uma mensagem própria).
  const primeiraLinha = page.locator("div.group.relative").first();
  await expect(primeiraLinha).toBeVisible({ timeout: 15_000 });
  await primeiraLinha.locator("button").first().click();

  const texto = `Teste toque celular ${Date.now().toString().slice(-6)}`;
  const composer = page.getByPlaceholder("Escreva uma mensagem…");
  await composer.fill(texto);
  await composer.press("Enter");

  const bolha = page.getByText(texto, { exact: true });
  await expect(bolha).toBeVisible({ timeout: 15_000 });

  const grupoMsg = bolha.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group/msg ')]");
  const editar = grupoMsg.getByRole("button", { name: "Editar mensagem" });
  const apagar = grupoMsg.getByRole("button", { name: "Remover mensagem" });

  // Sem tocar/hover em nada: os dois botões já precisam estar visíveis e com opacidade 1.
  await expect(editar).toBeVisible();
  await expect(editar).toHaveCSS("opacity", "1");
  await expect(apagar).toBeVisible();
  await expect(apagar).toHaveCSS("opacity", "1");

  await ctx.close();
});

test("chamado do cliente é isolado por sessão + realtime no ar", async ({ playwright }) => {
  const { outroConversaId: CONVERSA_ALHEIA } = lerFixtures();
  const cliente: APIRequestContext = await playwright.request.newContext({ baseURL: BASE, storageState: "e2e/.auth/cliente.json" });

  // 1. Abre um chamado próprio → conversaId
  const abrir = await cliente.post("/trpc/portal.suporte.abrir", jsonBody({ assunto: ASSUNTO, mensagem: "Mensagem de teste E2E" }));
  expect(abrir.status()).toBe(200);
  const nova = (await dataJson(abrir)) as { id?: string; conversaId?: string };
  const conversaId = nova.conversaId ?? nova.id!;
  expect(conversaId).toBeTruthy();

  // 2. Lê o PRÓPRIO chamado → 200
  const minhas = await cliente.get(`/trpc/portal.suporte.mensagens${q({ conversaId })}`);
  expect(minhas.status()).toBe(200);

  // 3. Lê chamado de OUTRO cliente → erro (ensureChamadoDoCliente bloqueia)
  const alheio = await cliente.get(`/trpc/portal.suporte.mensagens${q({ conversaId: CONVERSA_ALHEIA })}`);
  expect(alheio.status()).toBeGreaterThanOrEqual(400);

  // 4. Realtime: o handshake do socket.io responde com a sessão do cliente autenticado.
  const hs = await cliente.get("/socket.io/?EIO=4&transport=polling");
  expect(hs.status()).toBe(200);
  expect(await hs.text()).toContain("sid");

  await cliente.dispose();
});
