import { test, expect, type Page } from "@playwright/test";

/**
 * A QUEBRA DE PÁGINA DOS DOCUMENTOS — auditoria na tela, em TODOS os modelos.
 *
 * Estes defeitos não aparecem em teste de unidade nem em typecheck: eles moram na costura
 * entre a medição do navegador e a folha A4, e quem paga é o cliente que recebe o PDF.
 * O que se prova aqui, folha por folha:
 *   · cabeçalho em TODAS (completo na 1ª, corrido nas demais — nunca a capa repetida);
 *   · rodapé em TODAS, com "Página N de M" quando há mais de uma;
 *   · nada de título sozinho no pé da folha;
 *   · nada de conteúdo estourando a folha (que é o que vira corte no meio de uma linha).
 */
test.use({ storageState: "e2e/.auth/admin.json" });

interface Auditoria {
  folhas: number;
  capasCompletas: number;
  problemas: string[];
}

async function auditarFolhas(page: Page): Promise<Auditoria> {
  return page.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll(".doc-preview .doc-sheet"));
    const problemas: string[] = [];
    sheets.forEach((s, i) => {
      const folha = i + 1;
      const b = s.querySelector(".doc-body");
      const kids = b ? Array.from(b.children) : [];
      const ult = kids[kids.length - 1];
      if (ult && /^H[1-3]$/.test(ult.tagName)) {
        problemas.push(`titulo orfao na folha ${folha}: ${(ult.textContent ?? "").trim().slice(0, 40)}`);
      }
      if (b && b.scrollHeight > b.clientHeight + 1) {
        problemas.push(`conteudo estoura a folha ${folha} em ${b.scrollHeight - b.clientHeight}px`);
      }
      if (!s.querySelector(".doc-foot")) problemas.push(`sem rodape na folha ${folha}`);
      if (!s.querySelector(".doc-head") && !s.querySelector(".doc-head-corrido")) {
        problemas.push(`sem cabecalho na folha ${folha}`);
      }
      if (i > 0 && s.querySelector(".doc-head")) problemas.push(`capa repetida na folha ${folha}`);
      const cont = s.querySelector(".doc-foot .pagina");
      const esperado = `Página ${folha} de ${sheets.length}`;
      const lido = cont ? (cont.textContent ?? "").trim() : null;
      if (sheets.length > 1 && lido !== esperado) {
        problemas.push(`contador errado na folha ${folha}: ${lido ?? "(nenhum)"}`);
      }
    });
    return {
      folhas: sheets.length,
      capasCompletas: sheets.filter((s) => !!s.querySelector(".doc-head")).length,
      problemas,
    };
  });
}

test("todos os modelos quebram em folhas A4 sem defeito de paginação", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/modelos");
  const links = page.locator('a[href^="/modelos/"]');
  await expect(links.first()).toBeVisible({ timeout: 15_000 });
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute("href") as string));
  expect(hrefs.length, "a lista de modelos não pode vir vazia").toBeGreaterThan(10);

  const comProblema: string[] = [];
  let comMaisDeUmaFolha = 0;

  for (const href of hrefs) {
    await page.goto(href);
    await expect(page.locator(".doc-preview .doc-sheet").first(), `${href} precisa desenhar ao menos uma folha`).toBeVisible({
      timeout: 15_000,
    });
    // A repaginação roda de novo quando a fonte termina de carregar — espera assentar.
    await page.waitForTimeout(500);

    const r = await auditarFolhas(page);
    if (r.problemas.length) comProblema.push(`${href} (${r.folhas} folhas): ${r.problemas.join("; ")}`);
    if (r.folhas > 1) {
      comMaisDeUmaFolha++;
      // Num documento de várias folhas, a capa completa sai UMA vez só — as demais levam o
      // cabeçalho corrido. Repetir a capa é o defeito que se lê como "documento repetitivo".
      expect(r.capasCompletas, `${href} repetiu a capa em mais de uma folha`).toBe(1);
    }
  }

  expect(comProblema, `modelos com defeito de paginação:\n  ${comProblema.join("\n  ")}`).toEqual([]);
  expect(comMaisDeUmaFolha, "nenhum modelo passou de 1 folha — a paginação não chegou a ser exercida").toBeGreaterThan(0);
});
