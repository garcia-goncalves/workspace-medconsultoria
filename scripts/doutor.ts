/**
 * DOUTOR — varredura de saúde da aplicação, em navegador real.
 *
 *   pnpm doutor                  → varre a app que está no ar (dev)
 *   pnpm doutor --url http://... → varre outro endereço
 *   pnpm doutor --perfil admin   → entra como ADMIN em vez de ROOT
 *   pnpm doutor --perfil cliente → varre o PORTAL DO CLIENTE
 *
 * SOMENTE LEITURA: navega e inspeciona. Não clica em nada destrutivo, não cria, não apaga,
 * não envia e-mail. Pode rodar quantas vezes quiser, inclusive com o app em uso.
 *
 * Cobre a área da equipe (--perfil root/admin) e o Portal do Cliente (--perfil cliente),
 * em 8 tamanhos de tela — de 320px (celular pequeno) a 1920px.
 *
 * O que detecta:
 *   - página que não carrega, quebra ou fica em branco;
 *   - erro de JavaScript (pageerror) e erro de console;
 *   - valores crus vazando na tela (undefined, NaN, [object Object], Invalid Date…);
 *   - rolagem horizontal (o layout não cabe);
 *   - links quebrados (href para rota inexistente);
 *   - imagem que não carregou;
 *   - texto de UI em inglês (a app é 100% pt-BR);
 *   - campo de formulário sem rótulo (acessibilidade).
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

for (const linha of readFileSync(".env", "utf8").split("\n")) {
  const m = linha.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const arg = (nome: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const BASE = arg("url") ?? process.env.E2E_BASE_URL ?? "http://localhost:4310";
const PERFIL = (arg("perfil") ?? "root").toLowerCase();
const SENHA = process.env.SEED_ROOT_PASSWORD;
const EMAIL =
  PERFIL === "admin"
    ? (process.env.SEED_ADMIN_EMAIL ?? "thais.garcia@medconsultoria.com.br")
    : PERFIL === "cliente"
      ? (process.env.DOUTOR_CLIENTE_EMAIL ?? "cliente@medconsultoria.com.br")
      : (process.env.SEED_ROOT_EMAIL ?? "root@medconsultoria.com.br");
/** A senha do Portal é a de teste; a da equipe vem do .env. */
const SENHA_PERFIL = PERFIL === "cliente" ? (process.env.DOUTOR_CLIENTE_SENHA ?? SENHA) : SENHA;

/** Rotas internas da equipe. */
const ROTAS_EQUIPE = [
  "/", "/leads", "/clientes", "/projetos", "/agenda", "/mensagens", "/documentos",
  "/financeiro", "/ajustes", "/servicos", "/modelos", "/usuarios", "/emails-enviados",
  "/configuracoes", "/sistema",
];

/** O Portal do Cliente é uma página só (PortalLayout + PortalHome), fora do router da equipe. */
const ROTAS_PORTAL = ["/"];

const ROTAS = PERFIL === "cliente" ? ROTAS_PORTAL : ROTAS_EQUIPE;

/**
 * Faixa completa de dispositivos reais, do celular pequeno ao monitor grande.
 * 320 é o menor viewport que ainda importa (iPhone SE 1ª geração / Galaxy Fold fechado).
 */
const TELAS = [
  { nome: "celular-320", w: 320, h: 568 },
  { nome: "celular-360", w: 360, h: 800 },
  { nome: "celular-390", w: 390, h: 844 },
  { nome: "celular-430", w: 430, h: 932 },
  { nome: "tablet-768", w: 768, h: 1024 },
  { nome: "tablet-1024", w: 1024, h: 1366 },
  { nome: "laptop-1440", w: 1440, h: 900 },
  { nome: "desktop-1920", w: 1920, h: 1080 },
];

/** Valores crus que nunca deveriam chegar à tela. */
const VAZAMENTOS = /\b(undefined|NaN|\[object Object\]|Invalid Date)\b/g;

/**
 * Inglês que denuncia texto não traduzido. Só palavras que não existem em pt-BR e não são
 * nome próprio/marca — evita falso positivo com "Status", "Email", "Link", "Portal".
 */
const INGLES = /\b(Loading|Submit|Cancel|Delete|Save|Search|Settings|Sign in|Sign out|Not found|Something went wrong|Required|Optional)\b/g;

const ERRO_DE_TELA = /erro ao carregar|algo deu errado|tentar de novo|application error/i;

interface Achado {
  rota: string;
  tela: string;
  tipo: string;
  detalhe: string;
}

const achados: Achado[] = [];
const anotar = (a: Achado) => achados.push(a);

async function entrar(page: Page): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const temForm = await page.locator('input[type="password"]').count();
  if (!temForm) return true; // já autenticado
  if (!SENHA_PERFIL) return false;
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(SENHA_PERFIL);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForTimeout(2500);
  return (await page.locator('input[type="password"]').count()) === 0;
}

/** Rotas válidas conhecidas — para apontar link quebrado sem navegar em cada um. */
const rotasValidas = new Set([...ROTAS, "/esqueci-senha", "/comecar"]);
const ehRotaConhecida = (href: string) =>
  rotasValidas.has(href) ||
  /^\/(clientes|projetos|documentos|modelos|leads|formularios)\/[\w-]+$/.test(href);

async function examinar(page: Page, rota: string, tela: string) {
  const erros: string[] = [];
  const onErro = (e: Error) => erros.push(`pageerror: ${e.message.slice(0, 120)}`);
  const onConsole = (m: { type: () => string; text: () => string }) => {
    if (m.type() === "error") erros.push(`console: ${m.text().slice(0, 120)}`);
  };
  page.on("pageerror", onErro);
  page.on("console", onConsole);

  try {
    await page.goto(BASE + rota, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(2200); // dá tempo das queries resolverem
  } catch (e) {
    anotar({ rota, tela, tipo: "não carrega", detalhe: (e as Error).message.slice(0, 100) });
    page.off("pageerror", onErro);
    page.off("console", onConsole);
    return;
  }

  // Expressão em STRING de propósito: o tsx compila funções com um helper `__name` que não
  // existe dentro do navegador, e `page.evaluate(fn)` estoura com "__name is not defined".
  const diag = (await page.evaluate(`(() => {
    var main = document.querySelector("main");
    var texto = main ? main.innerText : "";
    var ache = function (re) { return Array.from(new Set(texto.match(new RegExp(re, "g")) || [])); };
    return {
      vazio: texto.trim().length < 30,
      texto: texto.slice(0, 200),
      vazamentos: ache(${JSON.stringify(VAZAMENTOS.source)}),
      ingles: ache(${JSON.stringify(INGLES.source)}),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      links: Array.from(document.querySelectorAll("a[href^='/']")).map(function (a) { return a.getAttribute("href") || ""; }),
      imagensQuebradas: Array.from(document.querySelectorAll("img"))
        .filter(function (i) { return i.complete && i.naturalWidth === 0; })
        .map(function (i) { return i.getAttribute("src") || "?"; }),
      camposSemRotulo: Array.from(document.querySelectorAll("input, select, textarea")).filter(function (el) {
        var id = el.getAttribute("id");
        var temLabel = id && document.querySelector('label[for="' + id + '"]');
        return !temLabel && !el.getAttribute("aria-label") && !el.getAttribute("placeholder");
      }).length,
    };
  })()`)) as {
    vazio: boolean;
    texto: string;
    vazamentos: string[];
    ingles: string[];
    overflow: number;
    links: string[];
    imagensQuebradas: string[];
    camposSemRotulo: number;
  };

  page.off("pageerror", onErro);
  page.off("console", onConsole);

  if (diag.vazio) anotar({ rota, tela, tipo: "página em branco", detalhe: "conteúdo < 30 caracteres" });
  if (ERRO_DE_TELA.test(diag.texto)) anotar({ rota, tela, tipo: "erro na tela", detalhe: diag.texto.replace(/\s+/g, " ").slice(0, 90) });
  if (diag.vazamentos.length) anotar({ rota, tela, tipo: "valor cru na tela", detalhe: diag.vazamentos.join(", ") });
  if (diag.ingles.length) anotar({ rota, tela, tipo: "texto em inglês", detalhe: diag.ingles.join(", ") });
  if (diag.overflow > 20) anotar({ rota, tela, tipo: "rolagem horizontal", detalhe: `${diag.overflow}px além da tela` });
  if (diag.imagensQuebradas.length) anotar({ rota, tela, tipo: "imagem quebrada", detalhe: diag.imagensQuebradas.join(", ").slice(0, 90) });
  if (diag.camposSemRotulo > 0) anotar({ rota, tela, tipo: "campo sem rótulo", detalhe: `${diag.camposSemRotulo} campo(s) sem label/aria-label/placeholder` });

  const quebrados = [...new Set(diag.links)].filter((h) => h && !ehRotaConhecida(h));
  if (quebrados.length) anotar({ rota, tela, tipo: "link suspeito", detalhe: quebrados.join(", ").slice(0, 120) });

  for (const e of [...new Set(erros)]) anotar({ rota, tela, tipo: "erro de JavaScript", detalhe: e });
}

async function main() {
  console.log(`\n🩺 Doutor — varrendo ${BASE} como ${PERFIL.toUpperCase()} (somente leitura)\n`);

  const saude = await fetch(`${BASE}`).then((r) => r.ok).catch(() => false);
  if (!saude) {
    console.error(`✗ ${BASE} não respondeu. A aplicação está no ar? (\`pnpm dev\`)\n`);
    process.exit(1);
  }

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();

    if (!(await entrar(page))) {
      if (PERFIL === "cliente") {
        console.error(`✗ Não há conta de Portal (${EMAIL}) neste banco.`);
        console.error("  O Portal só pode ser varrido com um cliente que tenha acesso.");
        console.error("  Cadastre um cliente e use 'Enviar acesso ao Portal' na ficha dele.\n");
      } else {
        console.error("✗ Não consegui entrar. Rode `pnpm acessos` para ver o motivo.\n");
      }
      process.exit(1);
    }

    for (const tela of TELAS) {
      await page.setViewportSize({ width: tela.w, height: tela.h });
      process.stdout.write(`  ${tela.nome.padEnd(8)} `);
      for (const rota of ROTAS) {
        const antes = achados.length;
        await examinar(page, rota, tela.nome);
        process.stdout.write(achados.length > antes ? "✗" : "·");
      }
      process.stdout.write("\n");
    }
  } finally {
    await browser?.close();
  }

  console.log(`\n${"─".repeat(78)}`);
  if (!achados.length) {
    console.log(`✓ Nenhum problema encontrado em ${ROTAS.length} rotas × ${TELAS.length} tamanhos de tela.\n`);
    return;
  }

  // Agrupa por tipo: o mesmo defeito costuma aparecer em várias telas.
  const porTipo = new Map<string, Achado[]>();
  for (const a of achados) porTipo.set(a.tipo, [...(porTipo.get(a.tipo) ?? []), a]);

  console.log(`${achados.length} achado(s) em ${porTipo.size} categoria(s):\n`);
  for (const [tipo, lista] of [...porTipo].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`▸ ${tipo.toUpperCase()} (${lista.length})`);
    const vistos = new Set<string>();
    for (const a of lista) {
      const chave = `${a.rota}|${a.detalhe}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const telas = lista.filter((x) => x.rota === a.rota && x.detalhe === a.detalhe).map((x) => x.tela);
      console.log(`    ${a.rota.padEnd(18)} [${telas.join(", ")}]  ${a.detalhe}`);
    }
    console.log("");
  }
  console.log(`${"─".repeat(78)}\n`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`✗ ${e.message}\n`);
  process.exit(1);
});
