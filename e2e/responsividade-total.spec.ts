import { test, expect, request as pwRequest, type Page, type APIRequestContext } from "@playwright/test";

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

// Mesmo padrão de `playwright.config.ts` (não exportado de lá) — usado só para abrir um
// `APIRequestContext` avulso e autenticado, fora do contexto de navegador da página anônima.
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4310";

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
  { template: "/funil-de-vendas" },
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

// --------------------------------------------------------------------------------------------
// Páginas PÚBLICAS (anônimas, fora do gate de login — ver `apps/web/src/App.tsx`). Antes desta
// rodada, ZERO rota pública era coberta por esta rede — inclusive `/assinar/:token`, onde um bug
// real de responsividade (lista de signatários sem `flex-wrap`) só foi achado por auditoria
// manual (commit `825fa78`), não por este arquivo.
// --------------------------------------------------------------------------------------------

const ROTAS_PUBLICAS_FIXAS = ["/comecar", "/login", "/privacidade"];

/**
 * `/assinar/:token` e `/proposta/:token` NÃO têm dado fixo no banco de teste — nem `db:seed`
 * nem `db:demo` criam documento algum (conferido no código dos dois antes de escrever isto). Sem
 * um token de verdade, essas rotas só mostrariam a tela de "link inválido" (que já tem prova
 * própria em `flows-erros-ux.spec.ts`) — e é exatamente o estado ONDE O BUG DA LISTA DE
 * SIGNATÁRIOS NÃO APARECE, porque ela só desenha com dado real (`d.todas`).
 *
 * Por isso esta função CRIA um documento real (contrato + proposta), pelas mesmas portas que a
 * equipe usa na tela (`documentos.create` → `assinaturas.solicitar` / `propostas.habilitar`),
 * via um `APIRequestContext` autenticado como ADMIN — INDEPENDENTE do contexto anônimo da
 * página, que não pode carregar cookie nenhum. `avisarPorEmail: false` nos dois: a suíte não
 * pode disparar e-mail para o e-mail real do cliente de teste.
 *
 * ⚠️ Roda **uma única vez** por execução da suíte inteira (memorizado em `TOKENS_PUBLICOS`),
 * não uma vez por tamanho de tela — criar documento é efeito colateral no banco, e repeti-lo 5×
 * só multiplicaria lixo sem ganhar cobertura nova.
 *
 * Se o banco de teste não tiver cliente com e-mail, ou os modelos padrão (Contrato/Proposta)
 * não existirem por algum motivo, a função devolve `null` para aquele token — e o teste cai de
 * volta no caso já coberto (link inválido), igual ao padrão de "rota pulada" das rotas dinâmicas
 * internas acima, sem derrubar a bateria inteira.
 */
async function chamarProcedure<T>(
  ctx: APIRequestContext,
  procedure: string,
  input: unknown,
  metodo: "GET" | "POST" = "GET",
): Promise<T | null> {
  try {
    if (metodo === "GET") {
      const url = `/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input ?? {} }))}`;
      const res = await ctx.get(url);
      if (!res.ok()) return null;
      const corpo = await res.json().catch(() => null);
      return (corpo?.result?.data?.json ?? null) as T | null;
    }
    const res = await ctx.post(`/trpc/${procedure}`, { data: { json: input ?? {} } });
    if (!res.ok()) return null;
    const corpo = await res.json().catch(() => null);
    return (corpo?.result?.data?.json ?? null) as T | null;
  } catch {
    return null;
  }
}

async function criarDadosParaTokensPublicos(): Promise<{ assinar: string | null; proposta: string | null }> {
  const vazio = { assinar: null, proposta: null };
  let ctx: APIRequestContext;
  try {
    ctx = await pwRequest.newContext({ baseURL: BASE_URL, storageState: "e2e/.auth/admin.json" });
  } catch {
    return vazio;
  }
  try {
    const clientes = await chamarProcedure<Array<{ id: string; email: string | null }>>(ctx, "clientes.list", {});
    const cliente = clientes?.find((c) => !!c.email) ?? null;
    if (!cliente) return vazio;

    const modelos = await chamarProcedure<Array<{ id: string; tipo: string }>>(ctx, "documentos.modelos.list", {});
    const modeloContrato = modelos?.find((m) => m.tipo === "CONTRATO") ?? null;
    const modeloProposta = modelos?.find((m) => m.tipo === "PROPOSTA") ?? null;

    let tokenAssinar: string | null = null;
    if (modeloContrato) {
      const doc = await chamarProcedure<{ id: string }>(
        ctx,
        "documentos.create",
        { modeloId: modeloContrato.id, clienteId: cliente.id, titulo: "[E2E] Contrato — responsividade-total" },
        "POST",
      );
      if (doc?.id) {
        await chamarProcedure(ctx, "assinaturas.solicitar", { documentoId: doc.id, avisarPorEmail: false }, "POST");
        const assinaturas = await chamarProcedure<Array<{ token: string }>>(ctx, "assinaturas.doDocumento", {
          documentoId: doc.id,
        });
        tokenAssinar = assinaturas?.[0]?.token ?? null;
      }
    }

    let tokenProposta: string | null = null;
    if (modeloProposta) {
      const doc = await chamarProcedure<{ id: string }>(
        ctx,
        "documentos.create",
        { modeloId: modeloProposta.id, clienteId: cliente.id, titulo: "[E2E] Proposta — responsividade-total" },
        "POST",
      );
      if (doc?.id) {
        await chamarProcedure(ctx, "propostas.habilitar", { documentoId: doc.id, avisarPorEmail: false }, "POST");
        const status = await chamarProcedure<{ token: string }>(ctx, "propostas.doDocumento", { documentoId: doc.id });
        tokenProposta = status?.token ?? null;
      }
    }
    return { assinar: tokenAssinar, proposta: tokenProposta };
  } finally {
    await ctx.dispose();
  }
}

let tokensPublicosPromise: Promise<{ assinar: string | null; proposta: string | null }> | null = null;
function resolverTokensPublicosUmaVez() {
  if (!tokensPublicosPromise) tokensPublicosPromise = criarDadosParaTokensPublicos();
  return tokensPublicosPromise;
}

// --------------------------------------------------------------------------------------------
// Abas de `/sistema` (ROOT) e modais de catálogo de `/ajustes` (ADMIN+) — antes desta rodada só
// a CARGA INICIAL de cada rota era medida; trocar de aba/abrir modal nunca era exercido. Foi
// assim que o estouro de nome de migração na aba "Manutenção" escapou desta rede.
// --------------------------------------------------------------------------------------------

/** Rótulos das abas de `SistemaPage.tsx` (`ABAS`) — mantidos em sincronia à mão; divergir aqui só
 *  faz o `getByRole("tab", …)` não achar a aba, o que já reprova o teste (falha visível). */
const SISTEMA_ABAS = [
  "Visão geral",
  "Incidentes",
  "Desempenho",
  "Banco",
  "Operação",
  "Erros",
  "Sessões",
  "Atividade",
  "Manutenção",
  "Auditoria",
  "Privacidade",
];

/** Os 4 diálogos de catálogo de `AjustesPage.tsx` (`SECOES`) que abrem NA PRÓPRIA página — os
 *  outros itens (Serviços, Modelos, Mensagens automáticas, Equipe e acessos, E-mails enviados)
 *  navegam para rota própria, já coberta por `ROTAS_INTERNAS`. */
const AJUSTES_DIALOGOS = ["Categorias financeiras", "Origens de leads", "Operadoras e convênios", "Dados da empresa"];

/**
 * Mesmas 3 checagens de `verificarRota` (console/overflow/estouro), mas em volta de uma AÇÃO
 * (trocar de aba, abrir modal) em vez de uma NAVEGAÇÃO — o console precisa ser observado ANTES
 * do clique, e as duas checagens de layout, DEPOIS.
 */
async function verificarAcaoSemErro(page: Page, acao: () => Promise<void>, contexto: string, vpNome: string) {
  const erros: string[] = [];
  const esperado = (t: string) => /Failed to load resource.*412 \(Precondition Failed\)/.test(t);
  const aoConsole = (m: import("@playwright/test").ConsoleMessage) => {
    if (m.type() === "error" && !esperado(m.text())) erros.push(m.text());
  };
  const aoErroDePagina = (e: Error) => erros.push(e.message);
  page.on("console", aoConsole);
  page.on("pageerror", aoErroDePagina);
  try {
    await acao();
    await page.waitForLoadState("networkidle").catch(() => {});
  } finally {
    page.off("console", aoConsole);
    page.off("pageerror", aoErroDePagina);
  }
  expect.soft(erros, `erro(s) de console em ${contexto} @ ${vpNome}:\n${erros.join("\n")}`).toEqual([]);
  await verificarSemOverflowHorizontal(page, contexto, vpNome);
  await verificarSemElementoEstourando(page, contexto, vpNome);
}

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
    //
    // ⚠️ A MARCA NO TRILHO (a fileira inteira de colunas do Kanban, a tabela larga, a barra de
    // abas) NÃO PODE isentar QUALQUER coisa aninhada lá dentro — achado numa auditoria de
    // 11/09: um `closest()` sem mais nada isentava também o CONTEÚDO INTERNO de cada cartão
    // individual (ex.: um botão sem `flex-wrap` furando a borda do próprio cartão), escondendo
    // um defeito real de layout atrás da isenção do quadro. A isenção certa é só para o
    // conteúdo que fica DENTRO da área que o trilho de fato rola (`scrollWidth`) — colunas mais
    // à direita, células de tabela, abas extras, tudo por desenho; conteúdo que ESCAPA dessa
    // área (a borda direita do próprio trilho) continua sendo defeito, mesmo estando aninhado.
    const dentroDeAlgoQueRola = (el: HTMLElement) => {
      const trilho = el.parentElement?.closest<HTMLElement>("[data-rolagem-horizontal]");
      if (!trilho) return false;
      const trilhoRect = trilho.getBoundingClientRect();
      // Posição do elemento relativa ao INÍCIO do conteúdo rolável do trilho (independe de
      // quanto já foi rolado no momento da medição).
      const direitaRelativa = el.getBoundingClientRect().right - trilhoRect.left + trilho.scrollLeft;
      return direitaRelativa <= trilho.scrollWidth + tolerancia;
    };

    // Texto CORTADO COM RETICÊNCIAS (`truncate`) é desenho, não defeito: o `overflow:hidden` do pai
    // já recorta, e o usuário vê "Clínica São Fran…". Mas os pedaços de texto DENTRO dele continuam
    // medindo a largura completa — `getBoundingClientRect` ignora o recorte —, e apareciam aqui como
    // se estourassem a janela. A marca é a combinação exata do `truncate`: `text-overflow: ellipsis`
    // com `overflow-x: hidden`. ⚠️ Não vale afrouxar para "qualquer ancestral com overflow hidden":
    // aí o teste pararia de ver conteúdo genuinamente cortado fora da tela.
    const dentroDeTextoTruncado = (el: HTMLElement) => {
      let pai = el.parentElement;
      while (pai && pai !== document.body) {
        const e = getComputedStyle(pai);
        if (e.textOverflow === "ellipsis" && e.overflowX === "hidden") return true;
        pai = pai.parentElement;
      }
      return false;
    };

    const todos = document.body.querySelectorAll<HTMLElement>("*");
    for (const el of todos) {
      const estilo = getComputedStyle(el);
      if (estilo.display === "none" || estilo.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > largura + tolerancia) {
        if (dentroDeAlgoQueRola(el) || dentroDeTextoTruncado(el)) continue;
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

async function verificarZeroErroConsole(page: Page, url: string, vpNome: string, permitirNaoEncontrado = false) {
  const erros: string[] = [];
  // O 412 (`PRECONDITION_FAILED`) NÃO é defeito: é o crachá que a ADR-135 deu ao erro ESPERADO
  // "esta caixa de e-mail precisa ser reconectada" — a tela já o trata, mostrando o botão
  // *Reconectar*. O navegador registra qualquer resposta fora do 2xx como erro de recurso, então
  // contá-lo aqui reprovaria justamente o comportamento correto. Qualquer outro status continua
  // reprovando.
  //
  // `permitirNaoEncontrado` é o mesmo raciocínio para o 404 de `assinaturas.porToken`/
  // `propostas.porToken` — SÓ ligado pelas duas rotas de token público, quando o token testado é
  // sintético (não existe de propósito, ver `criarDadosParaTokensPublicos`). Um token que não
  // existe RESPONDER 404 é o comportamento correto (`NOT_FOUND` do tRPC), já tratado na tela com
  // "Link inválido" (`AssinarPage.tsx`/`PropostaPublicaPage.tsx`) — não fica ligado para o resto
  // das rotas, onde um 404 de verdade costuma ser bug.
  const esperado = (t: string) =>
    /Failed to load resource.*412 \(Precondition Failed\)/.test(t) ||
    (permitirNaoEncontrado && /Failed to load resource.*404 \(Not Found\)/.test(t));
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
  // `publica`: páginas públicas (fora do gate de login) — o alvo de toque de 44px importa tanto
  // ali quanto no Portal, e mais: quem abre `/comecar` ou `/assinar/:token` no celular é a
  // pessoa mais provável de estar numa rede ruim e sem paciência para mirar um botão pequeno.
  // `tokenSintetico`: só para `/assinar/:token`/`/proposta/:token` quando o token testado é
  // inventado de propósito (ver `criarDadosParaTokensPublicos`) — o 404 esperado daí não conta
  // como erro de console.
  opts: { portal: boolean; publica?: boolean; tokenSintetico?: boolean },
) {
  // console + navegação primeiro (a checagem de console PRECISA envolver o goto).
  await verificarZeroErroConsole(page, url, vp.nome, opts.tokenSintetico ?? false);
  await verificarSemOverflowHorizontal(page, url, vp.nome);
  await verificarSemElementoEstourando(page, url, vp.nome);

  const ehMobile = vp.w === 360 || vp.w === 390;
  if ((opts.portal || opts.publica) && ehMobile) {
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

// --------------------------------------------------------------------------------------------
// Páginas públicas — anônimo, sem `storageState` (o gate de login nem entra em jogo).
// `/comecar`, `/login` e `/privacidade` são fixas; `/assinar/:token` e `/proposta/:token` usam
// um documento criado sob demanda (ver `criarDadosParaTokensPublicos`), com fallback para um
// token inválido (o mesmo caso já coberto por `flows-erros-ux.spec.ts`) quando a criação falha.
// --------------------------------------------------------------------------------------------

test.describe("Responsividade total — páginas públicas (anônimo)", () => {
  for (const vp of VIEWPORTS) {
    test(`páginas públicas sem defeito de layout @ ${vp.nome}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: vp.w, height: vp.h });

      for (const url of ROTAS_PUBLICAS_FIXAS) {
        await test.step(`${url} @ ${vp.nome}`, async () => {
          await verificarRota(page, url, vp, { portal: false, publica: true });
        });
      }

      const tokens = await resolverTokensPublicosUmaVez();
      if (!tokens.assinar) {
        test.info().annotations.push({
          type: "rota testada só com token inválido",
          description:
            "/assinar/:token — não foi possível criar um documento+assinatura de teste (sem cliente com " +
            "e-mail, ou sem o modelo padrão de Contrato); o caso de 'link inválido' continua coberto.",
        });
      }
      if (!tokens.proposta) {
        test.info().annotations.push({
          type: "rota testada só com token inválido",
          description:
            "/proposta/:token — não foi possível criar um documento+proposta de teste (sem cliente com " +
            "e-mail, ou sem o modelo padrão de Proposta); o caso de 'link inválido' continua coberto.",
        });
      }
      const urlAssinar = `/assinar/${tokens.assinar ?? "token-invalido-e2e-responsividade-total"}`;
      const urlProposta = `/proposta/${tokens.proposta ?? "token-invalido-e2e-responsividade-total"}`;

      await test.step(`${urlAssinar} @ ${vp.nome}`, async () => {
        await verificarRota(page, urlAssinar, vp, { portal: false, publica: true, tokenSintetico: !tokens.assinar });
      });
      await test.step(`${urlProposta} @ ${vp.nome}`, async () => {
        await verificarRota(page, urlProposta, vp, { portal: false, publica: true, tokenSintetico: !tokens.proposta });
      });
    });
  }
});

// --------------------------------------------------------------------------------------------
// `/sistema`, todas as abas (ROOT) — antes, só a aba inicial ("Visão geral") era medida.
// --------------------------------------------------------------------------------------------

test.describe("Responsividade total — Sistema, todas as abas (ROOT)", () => {
  test.use({ storageState: "e2e/.auth/root.json" });

  for (const vp of VIEWPORTS) {
    test(`abas de /sistema sem defeito de layout @ ${vp.nome}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await verificarRota(page, "/sistema", vp, { portal: false });

      for (const aba of SISTEMA_ABAS) {
        await test.step(`/sistema — aba ${aba} @ ${vp.nome}`, async () => {
          await verificarAcaoSemErro(
            page,
            async () => {
              await page.getByRole("tab", { name: aba }).click();
            },
            `/sistema (aba ${aba})`,
            vp.nome,
          );
        });
      }
    });
  }
});

// --------------------------------------------------------------------------------------------
// `/ajustes`, os 4 modais de catálogo abertos NA PRÓPRIA página (ADMIN+) — antes, nenhum modal
// era aberto; o estouro que a auditoria de 11/09 já corrigiu num deles não tinha rede nenhuma.
// --------------------------------------------------------------------------------------------

test.describe("Responsividade total — Ajustes, catálogos (ADMIN)", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  for (const vp of VIEWPORTS) {
    test(`modais de /ajustes sem defeito de layout @ ${vp.nome}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await verificarRota(page, "/ajustes", vp, { portal: false });

      for (const label of AJUSTES_DIALOGOS) {
        await test.step(`/ajustes — modal ${label} @ ${vp.nome}`, async () => {
          await verificarAcaoSemErro(
            page,
            async () => {
              await page.getByRole("button", { name: label }).click();
              await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
            },
            `/ajustes (modal ${label})`,
            vp.nome,
          );
          // Fecha antes do próximo modal — os 4 dividem o mesmo espaço de tela.
          await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog")).toHaveCount(0);
        });
      }
    });
  }
});
