import { test, expect, type Page } from "@playwright/test";

// Cenário 7 (realtime) — DUAS sessões independentes (ADMIN + CLIENTE), Socket.IO real.
// Troca de mensagens de chamado SEM refresh, reconexão após queda, e persistência do histórico.
// Isolamento entre clientes é validado por HTTP em flows-mensagens (só há um CLIENTE-semente).

// O texto da mensagem aparece no balão (texto exato) e na prévia da lista (com prefixo);
// exact:true isola o balão. Espera generosa cobre o tempo de entrega do socket.
function balao(page: Page, texto: string, timeout = 12_000) {
  return expect(page.getByText(texto, { exact: true })).toBeVisible({ timeout });
}

test("chamado cliente↔equipe em tempo real (sem refresh), reconexão e persistência", async ({ browser }) => {
  test.setTimeout(90_000);
  const admCtx = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
  const cliCtx = await browser.newContext({ storageState: "e2e/.auth/cliente.json" });
  const adm = await admCtx.newPage();
  const cli = await cliCtx.newPage();

  const RUN = `RT${Date.now().toString().slice(-6)}`;
  const ASSUNTO = `Chamado ${RUN}`;

  // ── CLIENTE abre um chamado pelo Portal ──
  await cli.goto("/portal/suporte"); // o Suporte virou secao com endereco proprio
  await cli.getByRole("button", { name: "Abrir chamado" }).first().click();
  const modal = cli.getByRole("dialog");
  await modal.getByLabel("Assunto *").fill(ASSUNTO);
  await modal.getByLabel("Mensagem").fill(`${RUN} abertura`);
  await modal.getByRole("button", { name: "Abrir chamado" }).click();
  await expect(modal).toHaveCount(0);
  await balao(cli, `${RUN} abertura`);

  // ── EQUIPE abre /mensagens e localiza o chamado (aparece via listConversas) ──
  await adm.goto("/mensagens");
  const conv = adm.getByRole("button", { name: new RegExp(ASSUNTO) });
  await expect(conv).toBeVisible({ timeout: 20_000 });
  await conv.click();
  await balao(adm, `${RUN} abertura`, 15_000);

  // ── CLIENTE envia → EQUIPE recebe SEM refresh (Socket.IO) ──
  const msgCli = `${RUN} do-cliente`;
  const inputCli = cli.getByPlaceholder("Escreva uma mensagem…");
  await inputCli.fill(msgCli);
  await inputCli.press("Enter");
  const t0 = Date.now();
  await balao(adm, msgCli);
  console.log(`[realtime] equipe recebeu do cliente em ~${Date.now() - t0}ms`);

  // ── EQUIPE responde → CLIENTE recebe SEM refresh ──
  const msgAdm = `${RUN} da-equipe`;
  const inputAdm = adm.getByPlaceholder("Escreva uma mensagem…");
  await inputAdm.fill(msgAdm);
  await inputAdm.press("Enter");
  const t1 = Date.now();
  await balao(cli, msgAdm);
  console.log(`[realtime] cliente recebeu da equipe em ~${Date.now() - t1}ms`);

  // ── Desconexão e reconexão do CLIENTE ──
  await cliCtx.setOffline(true);
  await cli.waitForTimeout(1200);
  await cliCtx.setOffline(false);
  // Após reconectar, uma nova mensagem da equipe chega em tempo real.
  const msgReconexao = `${RUN} pos-reconexao`;
  await inputAdm.fill(msgReconexao);
  await inputAdm.press("Enter");
  await balao(cli, msgReconexao, 20_000);

  // ── Lido/não-lido em tempo real: cliente volta à LISTA; nova msg da equipe marca não-lido ──
  await cli.getByRole("button", { name: /Meus chamados/ }).click();
  const msgNaoLida = `${RUN} nao-lida`;
  await inputAdm.fill(msgNaoLida);
  await inputAdm.press("Enter");
  const linha = cli.getByRole("button", { name: new RegExp(ASSUNTO) });
  await expect(linha.getByText(/^\d+$/), "badge de não-lidas aparece em tempo real").toBeVisible({ timeout: 12_000 });

  // ── Persistência: recarrega os dois lados e o histórico permanece ──
  await cli.reload();
  await cli.getByText(ASSUNTO).first().click(); // Portal volta à lista de chamados após reload
  await balao(cli, msgCli);
  await balao(cli, msgAdm);

  await adm.reload();
  await adm.getByRole("button", { name: new RegExp(ASSUNTO) }).click();
  await balao(adm, msgCli, 15_000);
  await balao(adm, msgReconexao, 15_000);

  await admCtx.close();
  await cliCtx.close();
});
