import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { INSTITUCIONAL, rodapeInstitucional } from "@app/shared";
import { empacotarBlocos, type BlocoMedido, type LinhaMedida } from "./paginacao";

/**
 * Moldura da marca para QUALQUER documento (proposta, contrato, relatório…).
 * A tela, o Portal e a IMPRESSÃO usam a MESMA paginação (`paginarDocumento`) → o PDF sai
 * folha por folha igual ao preview, sem depender de engine de PDF no servidor.
 */

export interface DocumentoBrandedProps {
  /** Rótulo do tipo (ex.: "Proposta", "Contrato"). */
  tipo?: string;
  titulo: string;
  clienteNome?: string | null;
  numero?: string | number | null;
  /** Data já formatada (ex.: "11/07/2026"). */
  data?: string | null;
  /** Corpo em Markdown (títulos, listas, tabelas). */
  conteudoMarkdown: string;
  /** Selo de status (ex.: "Assinado", "Aprovado"). */
  statusLabel?: string | null;
  /** Linha extra no rodapé (ex.: código de integridade / validade jurídica). */
  rodapeExtra?: string | null;
}

// Tokens espelhando o e-mail branded (email-template.ts) — mesma identidade.
const C = {
  azulEscuro: "#002463",
  verde: "#30AD73",
  link: "#003591",
  texto: "#1f2b45",
  corpo: "#334155",
  muted: "#64748b",
  borda: "#e2e8f0",
  fundoLeve: "#f8fafc",
};
const FONTE = "'Montserrat', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";

/**
 * Geometria da folha em PIXELS DE A4 REAL (96dpi), não numa escala inventada: 210×297mm com
 * margens de 18mm × 16mm. Medir no mesmo tamanho em que se imprime é o que faz a tela e o PDF
 * concordarem — antes a folha da tela era uma A4 encolhida com a fonte em tamanho normal, então
 * o texto ocupava proporcionalmente MAIS espaço na tela do que no papel.
 * Os valores são arredondados PARA BAIXO da conta em mm, para nunca estourar a caixa do `@page`
 * (1px sobrando vira uma folha em branco no fim do PDF).
 */
const DOC_W = 793; // 210mm
const PAD_V = 68; // 18mm
const PAD_H = 61; // 16mm
const CONTENT_H = 986; // 297mm − 2×18mm
const PAGE_H = CONTENT_H + PAD_V * 2;
const PAGE_GAP = 22; // espaço ENTRE as folhas na tela (para não ficarem "coladas")
// Margens que o CSS aplica em volta do cabeçalho corrido e do rodapé — entram na conta do
// espaço útil, porque `offsetHeight` não inclui margem.
const MARGEM_CORRIDO = 16;
const MARGEM_RODAPE = 22;

/** CSS da folha — reutilizado na tela e na janela de impressão (self-contained). */
export const DOC_STYLES = `
  .doc-sheet { font-family:${FONTE}; color:${C.corpo}; background:#fff;
    display:flex; flex-direction:column; }
  .doc-sheet > .doc-body { flex:1 1 auto; }
  .doc-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px;
    padding:0 0 18px; border-bottom:3px solid ${C.verde}; }
  .doc-head img { height:46px; width:auto; display:block; }
  .doc-brand small { display:block; font-size:11px; font-weight:600; letter-spacing:.06em;
    text-transform:uppercase; color:${C.muted}; margin-top:6px; }
  .doc-meta { text-align:right; font-size:12px; color:${C.muted}; line-height:1.6; }
  .doc-meta .tipo { display:inline-block; background:${C.verde}; color:#fff; font-weight:700;
    font-size:11px; letter-spacing:.04em; text-transform:uppercase; padding:3px 10px; border-radius:999px; margin-bottom:6px; }
  .doc-meta .status { display:inline-block; border:1px solid ${C.borda}; color:${C.azulEscuro};
    font-weight:600; font-size:11px; padding:2px 8px; border-radius:999px; margin-left:6px; }
  .doc-meta b { color:${C.texto}; font-weight:600; }
  .doc-titulo { margin:22px 0 4px; font-size:22px; line-height:1.25; color:${C.azulEscuro}; font-weight:700; }
  .doc-sub { margin:0 0 8px; font-size:13px; color:${C.muted}; }

  /* Cabeçalho das folhas 2, 3, 4… — uma linha fina, para o documento se identificar em
     qualquer folha solta sem repetir a capa inteira. */
  .doc-head-corrido { display:flex; align-items:center; justify-content:space-between; gap:16px;
    margin:0 0 ${MARGEM_CORRIDO}px; padding:0 0 8px; border-bottom:1px solid ${C.borda};
    font-size:11px; color:${C.muted}; }
  .doc-head-corrido img { height:22px; width:auto; display:block; }
  .doc-head-corrido .ident { text-align:right; line-height:1.5; }
  .doc-head-corrido .ident b { color:${C.azulEscuro}; font-weight:700; }

  .doc-body { font-size:14.5px; line-height:1.75; color:${C.corpo}; }
  .doc-body h1,.doc-body h2,.doc-body h3 { color:${C.azulEscuro}; font-weight:700; line-height:1.3; margin:24px 0 8px; }
  .doc-body h1 { font-size:19px; } .doc-body h2 { font-size:16.5px; } .doc-body h3 { font-size:14.5px; }
  .doc-body > *:first-child { margin-top:0; }
  .doc-body p { margin:0 0 12px; }
  .doc-body strong { color:${C.texto}; font-weight:700; }
  .doc-body ul,.doc-body ol { margin:0 0 12px; padding-left:22px; }
  .doc-body li { margin:3px 0; }
  .doc-body a { color:${C.link}; }
  .doc-body hr { border:0; border-top:1px solid ${C.borda}; margin:20px 0; }
  .doc-body blockquote { margin:0 0 12px; padding:8px 14px; border-left:3px solid ${C.verde};
    background:${C.fundoLeve}; color:${C.muted}; }
  .doc-body table { width:100%; border-collapse:collapse; margin:6px 0 16px; font-size:13.5px; }
  .doc-body th { background:${C.azulEscuro}; color:#fff; font-weight:600; text-align:left; padding:9px 12px; }
  .doc-body td { border:1px solid ${C.borda}; padding:8px 12px; vertical-align:top; }
  .doc-body tbody tr:nth-child(even) td { background:${C.fundoLeve}; }

  .doc-foot { margin-top:${MARGEM_RODAPE}px; padding-top:14px; border-top:1px solid ${C.borda};
    font-size:11.5px; line-height:1.6; color:${C.muted}; }
  .doc-foot .linha { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; }
  .doc-foot .marca { color:${C.azulEscuro}; font-weight:700; }
  .doc-foot .pagina { flex:0 0 auto; white-space:nowrap; color:${C.muted}; font-weight:600; }
  .doc-foot .hash { margin-top:6px; word-break:break-all; }
`;

/**
 * Estilos SÓ da tela (preview/leitura/Portal) — NÃO vão para a impressão nem para o Word.
 * A folha tem o tamanho de uma A4 de verdade e um `zoom` encolhe o conjunto para caber no
 * container, sem espremer o conteúdo (o texto quebra igual em qualquer largura).
 */
export const PREVIEW_STYLES = `
  .doc-preview { width:100%; }
  .doc-pages { display:flex; flex-direction:column; align-items:center; gap:${PAGE_GAP}px; }
  .doc-preview .doc-sheet {
    width:${DOC_W}px; box-sizing:border-box; height:${PAGE_H}px;
    padding:${PAD_V}px ${PAD_H}px; background:#fff; border-radius:3px; overflow:hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,.06), 0 16px 36px -18px rgba(0,0,0,.32);
  }
  /* Camada de medição: 'fixed' + off-screen para NÃO inflar o scrollHeight de nenhum ancestral
     (senão o modal/preview ganha um "scroll gigante" com a altura do documento inteiro). */
  .doc-measure { position:fixed; left:-99999px; top:0; visibility:hidden; pointer-events:none;
    display:block; width:${DOC_W}px; box-sizing:border-box; padding:${PAD_V}px ${PAD_H}px; }
`;

/**
 * Sanitiza HTML com DOMPurify (allowlist robusto — substitui o antigo blocklist por regex, que
 * era frágil a mutation-XSS/SVG). Remove tags script, handlers "on...", URLs "javascript:",
 * iframe, style, etc. Ver correção de XSS #6 da finalização.
 */
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "iframe", "object", "embed", "link", "meta", "base", "svg", "math"],
    FORBID_ATTR: ["style"],
  });
}

/**
 * Cabeçalho de tabela SEM UMA PALAVRA dentro. O Markdown não tem tabela sem cabeçalho, então
 * quem usa a tabela como layout (o par de assinaturas no pé da proposta) é obrigado a deixar
 * a primeira linha vazia — e o estilo da folha pinta todo `th` de azul escuro, o que punha uma
 * tarja azul sólida no PDF que vai para o médico. Some com o cabeçalho quando não há nada a
 * mostrar; cabeçalho com texto continua cabeçalho.
 */
const THEAD_VAZIO = /<thead>\s*<tr>(?:\s*<th[^>]*>(?:\s|&nbsp;)*<\/th>)+\s*<\/tr>\s*<\/thead>/gi;

/** Markdown (GFM) → HTML seguro (sanitizado). */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md ?? "", { gfm: true, breaks: true, async: false }) as string;
  return sanitize(raw.replace(THEAD_VAZIO, ""));
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Troca os `{{campos}}` de um MODELO por rótulos legíveis, para PREVIEW (sem preencher de
 * verdade). Usado na página do modelo e no diálogo "Novo documento" — assim o usuário vê como
 * o documento vai ficar (e cada modelo, ex.: proposta comercial × credenciamento, fica visível).
 */
export function previewModelo(corpo: string): string {
  return corpo
    .replace(/\{\{\s*servicos\s*\}\}/g, "_(aqui entram os serviços e o investimento que você escolher)_")
    .replace(/\{\{\s*operadoras\s*\}\}/g, "_(aqui entram as operadoras que você selecionar)_")
    .replace(/\{\{\s*apresentacao\s*\}\}/g, "_(aqui entra a apresentação)_")
    .replace(/\{\{\s*cliente\.nome\s*\}\}/g, "[nome do cliente]")
    .replace(/\{\{\s*cliente\.email\s*\}\}/g, "[e-mail do cliente]")
    .replace(/\{\{\s*cliente\.(documento|cnpj)\s*\}\}/g, "[CNPJ]")
    .replace(/\{\{\s*cliente\.telefone\s*\}\}/g, "[telefone]")
    .replace(/\{\{\s*data\s*\}\}/g, "[data]")
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, "[$1]");
}

/** Cabeçalho da 1ª folha — marca, tipo, número, data e cliente. */
function cabecalhoHtml(p: DocumentoBrandedProps): string {
  const meta = [
    p.numero != null ? `Nº <b>${esc(String(p.numero))}</b>` : "",
    p.data ? `Data: <b>${esc(p.data)}</b>` : "",
    p.clienteNome ? `Cliente: <b>${esc(p.clienteNome)}</b>` : "",
  ]
    .filter(Boolean)
    .join("<br>");

  return `
    <div class="doc-head">
      <div class="doc-brand">
        <img src="/logo.png" alt="${esc(INSTITUCIONAL.nome)}">
        <small>${esc(INSTITUCIONAL.tagline)}</small>
      </div>
      <div class="doc-meta">
        ${p.tipo ? `<span class="tipo">${esc(p.tipo)}</span>` : ""}${p.statusLabel ? `<span class="status">${esc(p.statusLabel)}</span>` : ""}
        <div style="margin-top:6px">${meta}</div>
      </div>
    </div>`;
}

/** Cabeçalho das folhas seguintes — uma linha fina, sem repetir a capa. */
function cabecalhoCorridoHtml(p: DocumentoBrandedProps): string {
  const ident = [p.tipo ? esc(p.tipo) : "", p.numero != null ? `nº ${esc(String(p.numero))}` : ""]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="doc-head-corrido">
      <img src="/logo.png" alt="${esc(INSTITUCIONAL.nome)}">
      <div class="ident"><b>${esc(p.titulo)}</b>${ident ? ` — ${ident}` : ""}</div>
    </div>`;
}

/**
 * Rodapé — vai em TODAS as folhas, com a contagem de páginas. O código de integridade
 * (`rodapeExtra`) sai só na ÚLTIMA: ele identifica o documento inteiro, não a folha.
 */
function rodapeHtml(p: DocumentoBrandedProps, pagina?: { n: number; total: number; ultima: boolean }): string {
  const institucional = `<span class="marca">${esc(INSTITUCIONAL.nome)}</span> · ${esc(rodapeInstitucional().replace(`${INSTITUCIONAL.nome} · `, ""))}`;
  const contador = pagina && pagina.total > 1 ? `<span class="pagina">Página ${pagina.n} de ${pagina.total}</span>` : "";
  const hash = p.rodapeExtra && (!pagina || pagina.ultima) ? `<div class="hash">${esc(p.rodapeExtra)}</div>` : "";
  return `
    <div class="doc-foot">
      <div class="linha"><span>${institucional}</span>${contador}</div>
      ${hash}
    </div>`;
}

/**
 * HTML do documento em FLUXO ÚNICO (sem paginar) — é o que o Word recebe, e é também o que a
 * camada de medição mede. O Word tem a própria paginação; enfiar as nossas folhas lá dentro
 * produziria um arquivo impossível de editar.
 */
export function documentoBrandedHtml(p: DocumentoBrandedProps): string {
  return `${cabecalhoHtml(p)}
    <h1 class="doc-titulo">${esc(p.titulo)}</h1>
    <div class="doc-body">${renderMarkdown(p.conteudoMarkdown)}</div>
    ${rodapeHtml(p)}`;
}

/** Garante que o CSS da folha exista no documento atual (a medição roda fora do React). */
function garantirEstilos(): void {
  if (document.getElementById("doc-branded-styles")) return;
  const st = document.createElement("style");
  st.id = "doc-branded-styles";
  st.textContent = DOC_STYLES + PREVIEW_STYLES;
  document.head.appendChild(st);
}

/**
 * MEDE e PARTE o documento em folhas A4. Devolve o HTML completo de cada folha (cabeçalho +
 * corpo + rodapé com a contagem). É a MESMA função usada pela tela e pela impressão — é assim
 * que o PDF sai igual ao preview, em vez de o navegador cortar onde quiser.
 */
export function paginarDocumento(props: DocumentoBrandedProps): string[] {
  const umaSo = () => [
    `${cabecalhoHtml(props)}<h1 class="doc-titulo">${esc(props.titulo)}</h1>` +
      `<div class="doc-body">${renderMarkdown(props.conteudoMarkdown)}</div>` +
      rodapeHtml(props, { n: 1, total: 1, ultima: true }),
  ];
  if (typeof document === "undefined") return umaSo();

  garantirEstilos();
  const m = document.createElement("div");
  m.className = "doc-measure";
  // O cabeçalho corrido entra DEPOIS do rodapé só para ser medido — assim não desloca o corpo.
  m.innerHTML = `${documentoBrandedHtml(props)}<div>${cabecalhoCorridoHtml(props)}</div>`;
  document.body.appendChild(m);

  try {
    const body = m.querySelector<HTMLElement>(".doc-body");
    const foot = m.querySelector<HTMLElement>(".doc-foot");
    const corrido = m.querySelector<HTMLElement>(".doc-head-corrido");
    if (!body) return umaSo();

    const contentTop = m.getBoundingClientRect().top + PAD_V;
    const bodyTop = body.getBoundingClientRect().top;
    const zonaTopo = Math.max(0, bodyTop - contentTop); // cabeçalho + título, só na 1ª folha
    const alturaRodape = foot ? foot.offsetHeight + MARGEM_RODAPE : 0;
    const alturaCorrido = corrido ? corrido.offsetHeight + MARGEM_CORRIDO : 0;

    const bodyRectH = body.getBoundingClientRect().height;
    const kids = Array.from(body.children) as HTMLElement[];
    const blocos: BlocoMedido[] = kids.map((c, i) => {
      const top = c.getBoundingClientRect().top - bodyTop;
      const prox = kids[i + 1];
      const next = prox ? prox.getBoundingClientRect().top - bodyTop : bodyRectH;
      const h = Math.max(1, next - top);
      if (c.tagName === "TABLE") {
        const thead = c.querySelector("thead");
        const tbody = c.querySelector("tbody") ?? c;
        const trs = Array.from(tbody.querySelectorAll(":scope > tr")) as HTMLElement[];
        const linhas: LinhaMedida[] = trs.map((tr) => ({
          html: tr.outerHTML,
          h: tr.getBoundingClientRect().height,
        }));
        return {
          tipo: "tabela",
          abre: c.outerHTML.slice(0, c.outerHTML.indexOf(">") + 1), // "<table ...>"
          cabecalho: thead?.outerHTML ?? "",
          cabH: thead ? thead.getBoundingClientRect().height : 0,
          linhas,
          h,
        };
      }
      return { tipo: "atomo", html: c.outerHTML, h, titulo: /^H[1-3]$/.test(c.tagName) };
    });

    const corpos = empacotarBlocos(blocos, {
      primeira: Math.max(120, CONTENT_H - zonaTopo - alturaRodape),
      demais: Math.max(120, CONTENT_H - alturaCorrido - alturaRodape),
    });

    const total = corpos.length;
    return corpos.map((inner, i) => {
      const topo =
        i === 0
          ? `${cabecalhoHtml(props)}<h1 class="doc-titulo">${esc(props.titulo)}</h1>`
          : cabecalhoCorridoHtml(props);
      const pe = rodapeHtml(props, { n: i + 1, total, ultima: i === total - 1 });
      return `${topo}<div class="doc-body">${inner}</div>${pe}`;
    });
  } finally {
    m.remove();
  }
}

/**
 * Componente para a TELA (preview/leitura/Portal). Renderiza o documento como **folhas A4
 * separadas**, com cabeçalho e rodapé em todas elas. O layout tem o tamanho de uma A4 real e
 * um `zoom` encolhe o conjunto para caber na largura disponível **sem espremer o conteúdo**.
 */
export function DocumentoBranded({
  tipo,
  titulo,
  clienteNome,
  numero,
  data,
  conteudoMarkdown,
  statusLabel,
  rodapeExtra,
}: DocumentoBrandedProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<string[] | null>(null);
  const [zoom, setZoom] = useState(1);

  /**
   * ⚠️ As props chegam num objeto NOVO a cada render do pai. Depender dele significaria
   * refazer `marked` + `DOMPurify` e repaginar o documento inteiro a cada tecla digitada em
   * QUALQUER campo do diálogo "Novo documento" — que tem a prévia A4 aberta ao lado. Por isso
   * os campos são desmontados e o objeto é remontado por VALOR.
   */
  const doc = useMemo<DocumentoBrandedProps>(
    () => ({ tipo, titulo, clienteNome, numero, data, conteudoMarkdown, statusLabel, rodapeExtra }),
    [tipo, titulo, clienteNome, numero, data, conteudoMarkdown, statusLabel, rodapeExtra],
  );
  const fallback = useMemo(() => documentoBrandedHtml(doc), [doc]);

  useLayoutEffect(() => {
    setPages(paginarDocumento(doc));
  }, [doc]);

  // Fonte que chega depois muda a altura das linhas → repagina quando ela terminar de carregar.
  useEffect(() => {
    let vivo = true;
    document.fonts?.ready.then(() => {
      if (vivo) setPages(paginarDocumento(doc));
    });
    return () => {
      vivo = false;
    };
  }, [doc]);

  // "Zoom" para caber na largura do container (nunca aumenta além de 1 → não espreme).
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const apply = () => setZoom(Math.min(1, wrap.clientWidth / DOC_W));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="doc-preview" ref={wrapRef}>
      <style>{DOC_STYLES}</style>
      <style>{PREVIEW_STYLES}</style>
      <div style={{ zoom }}>
        <div className="doc-pages">
          {(pages ?? [fallback]).map((html, i) => (
            <div key={i} className="doc-sheet" dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Abre a janela de impressão com as MESMAS folhas do preview → "salvar como PDF" sai idêntico
 * ao que a tela mostrou. Cada folha é uma caixa de altura A4 exata com quebra forçada depois;
 * as regras `break-inside` são cinto de segurança para o caso de uma medição sair 1px maior.
 */
export function imprimirDocumento(props: DocumentoBrandedProps) {
  const folhas = paginarDocumento(props);
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>${esc(props.titulo)}</title>
    <base href="${esc(window.location.origin)}/">
    <style>
      @page { size: A4; margin: ${PAD_V}px ${PAD_H}px; }
      * { box-sizing: border-box; }
      html, body { margin:0; padding:0; background:#fff; }
      ${DOC_STYLES}
      .doc-sheet { width:100%; height:${CONTENT_H}px; padding:0; overflow:hidden;
        break-after:page; page-break-after:always; }
      /* A última folha NÃO quebra depois, senão o PDF ganha uma folha em branco no fim.
         Marcada por CLASSE de propósito: \`:last-child\` não casa, porque o último filho do
         corpo da janela de impressão é a tag \`script\`, não a folha. */
      .doc-sheet.ultima { break-after:auto; page-break-after:auto; }
      .doc-body table, .doc-body tr, .doc-body h1, .doc-body h2, .doc-body h3,
      .doc-body li, .doc-body blockquote, .doc-head, .doc-head-corrido, .doc-foot {
        break-inside: avoid; page-break-inside: avoid; }
      .doc-body p { orphans:3; widows:3; }
    </style></head><body>
    ${folhas.map((f, i) => `<div class="doc-sheet${i === folhas.length - 1 ? " ultima" : ""}">${f}</div>`).join("")}
    <script>window.onload=function(){setTimeout(function(){window.print();},350);};</script>
    </body></html>`);
  w.document.close();
  w.focus();
}

/**
 * Baixa um .doc (HTML que o Word abre) com a mesma moldura, em FLUXO ÚNICO — o Word pagina
 * sozinho. As regras de quebra abaixo evitam título órfão e tabela partida lá também.
 */
export function baixarWordDocumento(props: DocumentoBrandedProps) {
  const html = `<!doctype html><html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
    <head><meta charset="utf-8"><title>${esc(props.titulo)}</title><style>${DOC_STYLES}
      @page { size: A4; margin: 18mm 16mm; }
      table, tr, h1, h2, h3 { page-break-inside: avoid; }
      h1, h2, h3 { page-break-after: avoid; }
      p { orphans:3; widows:3; }
    </style></head>
    <body><div class="doc-sheet">${documentoBrandedHtml(props)}</div></body></html>`;
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${props.titulo}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}
