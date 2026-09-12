import { test, expect } from "@playwright/test";

// Bloco 9 — Estado A (IA habilitada com chave válida) PELA UI. Dados fictícios (seed demo).
// A chamada externa real ocorre UMA vez. Verifica loading → resposta e que a chave não vaza à página.
// Os estados B (sem chave), C (IA desabilitada) e D (erro externo) são validados por script/HTTP
// (reinício do app em cada configuração) — ver o relatório do Bloco 9.
test.use({ storageState: "e2e/.auth/admin.json" });

test("IA habilitada: 'Gerar meu plano' mostra loading, retorna resposta e não vaza a chave", async ({ page }) => {
  test.setTimeout(60_000);
  // Depende de GEMINI_API_KEY real (integração externa) — a CI NÃO tem chave por design.
  // Se a IA estiver desabilitada, pula (suíte de integração externa, não a funcional principal).
  const disp = await page.request.get("/trpc/ia.disponivel");
  const disponivel = ((await disp.json()) as { result: { data: { json: { disponivel: boolean } } } }).result.data.json.disponivel;
  test.skip(!disponivel, "IA desabilitada (sem GEMINI_API_KEY) — chamada real roda só com chave");

  await page.goto("/");
  const botao = page.getByRole("button", { name: /Gerar meu plano/i });
  await expect(botao).toBeVisible();
  await botao.click();

  // Loading ("Pensando…") e depois a resposta (o botão vira "Refazer" ao concluir com sucesso).
  await expect(page.getByRole("button", { name: /Refazer|Pensando/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Refazer/i })).toBeVisible({ timeout: 45_000 });

  // A chave do Gemini NUNCA aparece no HTML entregue ao navegador.
  const html = await page.content();
  expect(html).not.toMatch(/AIza[A-Za-z0-9_-]{10,}/);
});
