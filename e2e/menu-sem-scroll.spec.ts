import { test, expect } from "@playwright/test";

// O menu lateral NÃO pode rolar (ADR-94). Rolar esconde item de navegação — é o oposto do
// trabalho do menu, e some justamente com os itens de baixo, que a pessoa nem sabe que existem.
// A barra encolhe sozinha por altura de viewport; este teste é a trava disso.
//
// ROOT de propósito: é quem vê MAIS itens (11 + os 4 cabeçalhos de grupo). Se cabe para o ROOT,
// cabe para todo mundo.
test.use({ storageState: "e2e/.auth/root.json" });

// As três primeiras existiam desde o ADR-94. As três últimas entraram em 19/08/2026: o dono
// mandou print do menu ROLANDO, com o "Sistema" cortado, num viewport de ~620px — e a suíte
// passava, porque nunca descia de 720. Janela pequena não é caso exótico: basta o navegador
// com barra de favoritos numa tela de notebook, ou a janela não maximizada.
const TELAS = [
  { nome: "desktop 1920x1080", w: 1920, h: 1080 },
  { nome: "notebook 1366x768", w: 1366, h: 768 },
  { nome: "notebook 1280x720", w: 1280, h: 720 },
  { nome: "janela baixa 1280x660", w: 1280, h: 660 },
  { nome: "janela baixa 1280x620", w: 1280, h: 620 },
  { nome: "janela muito baixa 1280x580", w: 1280, h: 580 },
];

for (const t of TELAS) {
  test(`menu lateral cabe na tela, sem rolagem — ${t.nome}`, async ({ page }) => {
    await page.setViewportSize({ width: t.w, height: t.h });
    await page.goto("/");

    const nav = page.locator("aside nav");
    await expect(nav).toBeVisible();

    const medida = await nav.evaluate((el) => {
      const a = el.querySelector("a")!;
      return {
        precisa: el.scrollHeight,
        tem: el.clientHeight,
        itens: el.querySelectorAll("a").length,
        // Diagnóstico: se o item não encolheu, o degrau de altura não pegou.
        viewport: window.innerHeight,
        alturaItem: (a as HTMLElement).offsetHeight,
      };
    });

    expect(medida.itens, "o ROOT enxerga todos os itens do menu").toBeGreaterThanOrEqual(11);
    expect(
      medida.precisa,
      `o menu precisa de ${medida.precisa}px e só tem ${medida.tem}px — vai aparecer barra de rolagem (viewport ${medida.viewport}px, item ${medida.alturaItem}px)`,
    ).toBeLessThanOrEqual(medida.tem);
  });
}

// A prova de que não basta "não ter barra de rolagem": o item precisa estar DENTRO da janela e
// ser clicável. Roda na tela comum E na mais baixa — foi justamente o último item ("Sistema")
// que sumiu no print de 19/08.
for (const h of [720, 580]) {
  test(`o último item do menu continua clicável, não cortado embaixo — altura ${h}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: h });
    await page.goto("/");

    const ultimo = page.locator("aside nav a").last();
    const caixa = await ultimo.boundingBox();
    expect(caixa, "o último item do menu existe e está renderizado").not.toBeNull();
    expect(caixa!.y + caixa!.height, "o último item cabe acima do rodapé da janela").toBeLessThanOrEqual(h);

    await ultimo.click();
    await expect(page).toHaveURL(/\/sistema$/); // ROOT: o último item é Sistema
  });
}
