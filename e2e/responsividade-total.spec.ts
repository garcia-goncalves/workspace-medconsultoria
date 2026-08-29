import { test, expect, type Page } from "@playwright/test";

/**
 * REDE DE PROTEÇÃO do refino de responsividade — 30 rotas × 5 tamanhos.
 *
 * Isto é TDD aplicado a layout: hoje este arquivo REPROVA em vários lugares, de propósito.
 * A lista de falhas de cada rodada É a lista de tarefas do refino. Ao fim da obra, este
 * arquivo passa a aprovar — e vira a rede que impede regressão nas 30 rotas de novo.
 *
 * Cobertura por rota, em cada tamanho:
 *   1. Sem overflow horizontal no documento (tolerância de 20px — igual a responsive.spec.ts,
 *      por causa da variância de fonte no Chromium headless).
 *   2. Nenhum elemento visível estourando a largura da janela em mais de 20px.
 *   3. Zero erro de console (console.error + pageerror) numa carga limpa.
 *   4. (só 360/390, só Portal) nenhum alvo clicável visível menor que 44×44px.
 *   5. (só 360, só Portal) nenhum rótulo truncado (`.truncate`) na barra de navegação.
 *
 * DECISÃO DE ESTRUTURA: um teste por (área × tamanho), com `test.step` por rota — assim o
 * relatório mostra as 24 (ou 6) rotas de cada tamanho em sequência legível. Os ids dinâmicos
 * (`$id`) são resolvidos UMA VEZ no início do teste, direto pela API tRPC (mesma técnica de
 * `e2e/responsive.spec.ts`). Rota dinâmica sem dado no banco NÃO reprova: fica de fora da
 * lista e entra como anotação de "rota pulada" no relatório do Playwright — usar
 * `test.skip()` no meio do teste abortaria as rotas seguintes da mesma bateria, o que é pior
 * do que a rota faltante em si.
 */

const VIEWPORTS = [
  { nome: "celular-360", w: 360, h: 800 },
  { nome: "celular-390", w: 390, h: 844 },
  { nome: "tablet-768", w: 768, h: 1024 },
  { nome: "notebook-1366", w: 1366, h: 768 },
  { nome: "desktop-1920", w: 1920, h: 1080 },
];

const TOLERANCIA_OVERFLOW_PX = 20; // mesma tolerância de responsive.spec.ts
const TOLERANCIA_ESTOURO_PX = 20;
const ALVO_TOQUE_MIN_PX = 44;

// --------------------------------------------------------------------------------------------
// Resolução de ids dinâmicos via tRPC (batch GET), mesma técnica de e2e/responsive.spec.ts.
// --------------------------------------------------------------------------------------------

async function primeiroId(page: Page, procedure: string): Promise<string | null> {
  const url = `/trpc/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: {} } }))}`;
  const res = await page.request.get(url);
  if (!res.ok()) return null;
  const corpo = await res.json().catch(() => null);
  const lista = (corpo?.[0]?.result?.data?.json ?? []) as Array<{ id?: string }>;
  return lista[0]?.id ?? null;
}

interface RotaInterna {
  /** Caminho com `$id` literal quando dinâmico. */
  template: string;
  /** Procedure tRPC que lista o recurso, só para rotas dinâmicas. */
  idDe?: string;
}

const ROTAS_INTERNAS: RotaInterna[] = [
  { template: "/" },
  { template: "/tarefas" },
  { template: "/agenda" },
  { template: "/projetos" },
  { template: "/projetos/$id", idDe: "projetos.list" },
  { template: "/leads" },
  { template: "/clientes" },
  { template: "/clientes/$id", idDe: "clientes.list" },
  { template: "/credenciamentos" },
  { template: "/documentos" },
  { template: "/documentos/$id", idDe: "documentos.list" },
  { template: "/financeiro" },
  { template: "/email" },
  { template: "/mensagens" },
  { template: "/ajustes" },
  { template: "/servicos" },
  { template: "/modelos" },
  { template: "/modelos/$id", idDe: "documentos.modelos.list" },
  { template: "/emails" },
  { template: "/usuarios" },
  { template: "/emails-enviados" },
  { template: "/configuracoes" },
  { template: "/sistema" },
];

const ROTAS_PORTAL = [
  "/portal",
  "/portal/documentos",
  "/portal/credenciamento",
  "/portal/servicos",
  "/portal/suporte",
  "/portal/equipe",
];

interface RotaResolvida {
  url: string;
  nome: string;
}

/** Resolve as rotas internas para a bateria atual, anotando (e pulando) as sem dado. */
async function resolverRotasInternas(page: Page): Promise<RotaResolvida[]> {
  const cache = new Map<string, string | null>();
  const resolvidas: RotaResolvida[] = [];
  for (const rota of ROTAS_INTERNAS) {
    if (!rota.idDe) {
      resolvidas.push({ url: rota.template, nome: rota.template });
      continue;
    }
    if (!cache.has(rota.idDe)) cache.set(rota.idDe, await primeiroId(page, rota.idDe));
    const id = cache.get(rota.idDe) ?? null;
    if (!id) {
      const msg = `pulada — ${rota.template}: ${rota.idDe} não retornou nenhum registro (banco sem dado)`;
      console.warn(`[responsividade-total] ${msg}`);
      test.info().annotations.push({ type: "rota pulada", description: msg });
      continue;
    }
    resolvidas.push({ url: rota.template.replace("$id", id), nome: rota.template });
  }
  return resolvidas;
}

// --------------------------------------------------------------------------------------------
// As 5 verificações, cada uma isolada para a mensagem de falha apontar exatamente o problema.
// --------------------------------------------------------------------------------------------

async function verificarSemOverflowHorizontal(page: Page, url: string, vpNome: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect.soft(overflow, `overflow horizontal do documento em ${url} @ ${vpNome}`).toBeLessThanOrEqual(
    TOLERANCIA_OVERFLOW_PX,
  );
}

async function verificarSemElementoEstourando(page: Page, url: string, vpNome: string) {
  const culpados = await page.evaluate((tolerancia) => {
    const largura = window.innerWidth;
    const achados: Array<{ seletor: string; texto: string; direita: number; excesso: number }> = [];
    // Um filho de contêiner que rola na horizontal POR DESENHO (barra de abas, tabela larga)
    // passa da borda de propósito — é para rolar dentro dele. Reprovar isso faria alguém
    // "consertar" tirando a rolagem, que é justamente a solução.
    //
    // ⚠️ A marca é o atributo `data-rolagem-horizontal`, NUNCA o `overflow-x` calculado: o CSS
    // transforma `visible` em `auto` no eixo oposto assim que um dos dois deixa de ser visível,
    // então TODA lista com `overflow-y-auto` aparece como se rolasse na horizontal. Usar o estilo
    // calculado escondia defeito real (cartões de /clientes e /modelos estourando 36px a 360px).
    const dentroDeAlgoQueRola = (el: HTMLElement) => !!el.parentElement?.closest("[data-rolagem-horizontal]");

    const todos = document.body.querySelectorAll<HTMLElement>("*");
    for (const el of todos) {
      const estilo = getComputedStyle(el);
      if (estilo.display === "none" || estilo.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > largura + tolerancia) {
        if (dentroDeAlgoQueRola(el)) continue;
        let seletor = el.tagName.toLowerCase();
        if (el.id) seletor += `#${el.id}`;
        const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
        if (classes.length) seletor += `.${classes.join(".")}`;
        achados.push({
          seletor,
          texto: (el.textContent ?? "").trim().slice(0, 40),
          direita: Math.round(rect.right),
          excesso: Math.round(rect.right - largura),
        });
      }
    }
    achados.sort((a, b) => b.excesso - a.excesso);
    return achados.slice(0, 8);
  }, TOLERANCIA_ESTOURO_PX);

  const mensagem = culpados
    .map((c) => `${c.seletor} (right=${c.direita}px, excesso=${c.excesso}px, texto="${c.texto}")`)
    .join(" | ");
  expect.soft(culpados.length, `elemento(s) estourando a janela em ${url} @ ${vpNome}: ${mensagem}`).toBe(0);
}

async function verificarZeroErroConsole(page: Page, url: string, vpNome: string) {
  const erros: string[] = [];
  // O 412 (`PRECONDITION_FAILED`) NÃO é defeito: é o crachá que a ADR-135 deu ao erro ESPERADO
  // "esta caixa de e-mail precisa ser reconectada" — a tela já o trata, mostrando o botão
  // *Reconectar*. O navegador registra qualquer resposta fora do 2xx como erro de recurso, então
  // contá-lo aqui reprovaria justamente o comportamento correto. Qualquer outro status continua
  // reprovando.
  const esperado = (t: string) => /Failed to load resource.*412 \(Precondition Failed\)/.test(t);
  const aoConsole = (m: import("@playwright/test").ConsoleMessage) => {
    if (m.type() === "error" && !esperado(m.text())) erros.push(m.text());
  };
  const aoErroDePagina = (e: Error) => erros.push(e.message);
  page.on("console", aoConsole);
  page.on("pageerror", aoErroDePagina);
  try {
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => {});
  } finally {
    page.off("console", aoConsole);
    page.off("pageerror", aoErroDePagina);
  }
  expect.soft(erros, `erro(s) de console em ${url} @ ${vpNome}:\n${erros.join("\n")}`).toEqual([]);
}

async function verificarAlvosDeToque(page: Page, url: string, vpNome: string) {
  const culpados = await page.evaluate((minimo) => {
    const achados: Array<{ rotulo: string; w: number; h: number }> = [];
    const elems = document.querySelectorAll<HTMLElement>('button, a, [role="button"]');
    for (const el of elems) {
      const estilo = getComputedStyle(el);
      if (estilo.display === "none" || estilo.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue; // nem renderizado
      if (rect.width < minimo || rect.height < minimo) {
        const rotulo =
          el.getAttribute("aria-label")?.trim() ||
          (el.textContent ?? "").trim() ||
          el.getAttribute("title")?.trim() ||
          "(sem rótulo)";
        achados.push({ rotulo: rotulo.slice(0, 50), w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    }
    return achados;
  }, ALVO_TOQUE_MIN_PX);

  const mensagem = culpados.map((c) => `"${c.rotulo}" (${c.w}×${c.h}px)`).join(" | ");
  expect.soft(culpados.length, `alvo(s) de toque menores que ${ALVO_TOQUE_MIN_PX}px em ${url} @ ${vpNome}: ${mensagem}`).toBe(0);
}

async function verificarTextoNaoCortado(page: Page, url: string, vpNome: string) {
  const cortados = await page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll<HTMLElement>('nav[aria-label="Seções do Portal"]'));
    const barra = navs.find((n) => n.offsetParent !== null); // a visível (a outra é a de desktop, oculta)
    if (!barra) return null; // barra não encontrada — não é o defeito que esta checagem procura
    const spans = Array.from(barra.querySelectorAll<HTMLElement>(".truncate"));
    return spans.filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => (s.textContent ?? "").trim());
  });

  if (cortados === null) return; // barra inferior não está nesta página — nada a checar
  expect.soft(cortados, `rótulo(s) cortado(s) na barra de navegação em ${url} @ ${vpNome}: ${cortados.join(", ")}`).toEqual([]);
}

// --------------------------------------------------------------------------------------------
// Orquestração de uma rota (as 5 checagens, na ordem — overflow/estouro/console primeiro,
// pois são as que todo mundo precisa passar; toque/truncamento são condicionais).
// --------------------------------------------------------------------------------------------

async function verificarRota(
  page: Page,
  url: string,
  vp: { nome: string; w: number; h: number },
  opts: { portal: boolean },
) {
  // console + navegação primeiro (a checagem de console PRECISA envolver o goto).
  await verificarZeroErroConsole(page, url, vp.nome);
  await verificarSemOverflowHorizontal(page, url, vp.nome);
  await verificarSemElementoEstourando(page, url, vp.nome);

  const ehMobile = vp.w === 360 || vp.w === 390;
  if (opts.portal && ehMobile) {
    await verificarAlvosDeToque(page, url, vp.nome);
  }
  if (opts.portal && vp.w === 360) {
    await verificarTextoNaoCortado(page, url, vp.nome);
  }
}

// --------------------------------------------------------------------------------------------
// Área interna — equipe (ADMIN), as 23 rotas listadas no pedido do refino.
// --------------------------------------------------------------------------------------------

test.describe("Responsividade total — área interna (ADMIN)", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  for (const vp of VIEWPORTS) {
    test(`rotas internas sem defeito de layout @ ${vp.nome}`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      const rotas = await resolverRotasInternas(page);

      for (const rota of rotas) {
        await test.step(`${rota.nome} @ ${vp.nome}`, async () => {
          await verificarRota(page, rota.url, vp, { portal: false });
        });
      }
    });
  }
});

// --------------------------------------------------------------------------------------------
// Área Portal — cliente, as 6 seções do app do Portal (ADR-139).
// --------------------------------------------------------------------------------------------

test.describe("Responsividade total — Portal do cliente", () => {
  test.use({ storageState: "e2e/.auth/cliente.json" });

  for (const vp of VIEWPORTS) {
    test(`rotas do Portal sem defeito de layout @ ${vp.nome}`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: vp.w, height: vp.h });

      for (const url of ROTAS_PORTAL) {
        await test.step(`${url} @ ${vp.nome}`, async () => {
          await verificarRota(page, url, vp, { portal: true });
        });
      }
    });
  }
});
