import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { INSTITUCIONAL, rodapeInstitucional } from "@app/shared";

/**
 * Moldura da marca para QUALQUER documento (proposta, contrato, relatório…).
 * O MESMO HTML é usado na tela, no Portal e na impressão → o PDF sai idêntico ao preview
 * (WYSIWYG), sem depender de engine de PDF no servidor.
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

/** CSS da folha — reutilizado na tela e na janela de impressão (self-contained). */
export const DOC_STYLES = `
  .doc-sheet { font-family:${FONTE}; color:${C.corpo}; background:#fff; }
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

  .doc-body { font-size:14.5px; line-height:1.75; color:${C.corpo}; }
  .doc-body h1,.doc-body h2,.doc-body h3 { color:${C.azulEscuro}; font-weight:700; line-height:1.3; margin:24px 0 8px; }
  .doc-body h1 { font-size:19px; } .doc-body h2 { font-size:16.5px; } .doc-body h3 { font-size:14.5px; }
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

  .doc-foot { margin-top:26px; padding-top:14px; border-top:1px solid ${C.borda};
    font-size:11.5px; line-height:1.6; color:${C.muted}; }
  .doc-foot .marca { color:${C.azulEscuro}; font-weight:700; }
  .doc-foot .hash { margin-top:6px; word-break:break-all; }
`;

/**
 * Estilos SÓ da tela (preview/leitura/Portal) — NÃO vão para a impressão nem para o Word
 * (que usam apenas DOC_STYLES + `@page A4`). A folha tem **largura A4** numa escala confortável
 * e **altura natural** (cresce com o conteúdo, nunca corta). Quando o conteúdo passa de uma
 * página A4, uma **linha-guia** marca a quebra a cada altura de folha (visual de "várias folhas").
 * As margens internas são proporcionais (equivalem às margens A4 da impressão: ~18mm × 16mm).
 */
// Geometria da folha A4 na tela (layout FIXO em 620px; um "zoom" encolhe para caber no container,
// sem espremer o conteúdo). A altura de cada página é o A4 real proporcional a essa largura.
const DOC_W = 620;
const PAGE_H = Math.round((DOC_W * 297) / 210); // ≈ 877px — 1 folha A4
const PAD_V = Math.round(DOC_W * 0.085); // margem sup/inf (~18mm)
const PAD_H = Math.round(DOC_W * 0.076); // margem lat (~16mm)
const CONTENT_H = PAGE_H - PAD_V * 2; // altura útil por página
const PAGE_GAP = 22; // espaço ENTRE as folhas (para não ficarem "coladas")

export const PREVIEW_STYLES = `
  .doc-preview { width:100%; }
  .doc-pages { display:flex; flex-direction:column; align-items:center; gap:${PAGE_GAP}px; }
  .doc-preview .doc-sheet {
    width:${DOC_W}px; box-sizing:border-box; min-height:${PAGE_H}px;
    padding:${PAD_V}px ${PAD_H}px; background:#fff; border-radius:3px;
    box-shadow: 0 1px 3px rgba(0,0,0,.06), 0 16px 36px -18px rgba(0,0,0,.32);
  }
  /* Camada de medição: 'fixed' + off-screen para NÃO inflar o scrollHeight de nenhum ancestral
     (senão o modal/preview ganha um "scroll gigante" com a altura do documento inteiro). */
  .doc-measure { position:fixed; left:-99999px; top:0; visibility:hidden; pointer-events:none;
    width:${DOC_W}px; box-sizing:border-box; padding:${PAD_V}px ${PAD_H}px; }
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

/** Markdown (GFM) → HTML seguro (sanitizado). */
/**
 * Cabeçalho de tabela SEM UMA PALAVRA dentro. O Markdown não tem tabela sem cabeçalho, então
 * quem usa a tabela como layout (o par de assinaturas no pé da proposta) é obrigado a deixar
 * a primeira linha vazia — e o estilo da folha pinta todo `th` de azul escuro, o que punha uma
 * tarja azul sólida no PDF que vai para o médico. Some com o cabeçalho quando não há nada a
 * mostrar; cabeçalho com texto continua cabeçalho.
 */
const THEAD_VAZIO = /<thead>\s*<tr>(?:\s*<th[^>]*>(?:\s|&nbsp;)*<\/th>)+\s*<\/tr>\s*<\/thead>/gi;

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

/** HTML interno da folha (cabeçalho + corpo + rodapé) — fonte única p/ tela e impressão. */
export function documentoBrandedHtml(p: DocumentoBrandedProps): string {
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
    </div>
    <h1 class="doc-titulo">${esc(p.titulo)}</h1>
    <div class="doc-body">${renderMarkdown(p.conteudoMarkdown)}</div>
    <div class="doc-foot">
      <span class="marca">${esc(INSTITUCIONAL.nome)}</span> · ${esc(rodapeInstitucional().replace(`${INSTITUCIONAL.nome} · `, ""))}
      ${p.rodapeExtra ? `<div class="hash">${esc(p.rodapeExtra)}</div>` : ""}
    </div>`;
}

/**
 * Componente para a TELA (preview/leitura/Portal). Renderiza o documento como **folhas A4
 * SEPARADAS** (paginação real: o conteúdo é distribuído em páginas de altura A4, com espaço
 * entre elas — nunca "coladas"). O layout é fixo em 620px e um `zoom` encolhe o conjunto para
 * caber na largura disponível **sem espremer o conteúdo** (o texto quebra igual em qualquer
 * largura). A **impressão** continua em **A4 real** (`imprimirDocumento` usa `@page A4` + só o
 * `DOC_STYLES`, sem estes estilos de tela).
 */
export function DocumentoBranded(props: DocumentoBrandedProps) {
  const fullHtml = useMemo(() => documentoBrandedHtml(props), [props]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<string[] | null>(null);
  const [zoom, setZoom] = useState(1);

  // Paginação: mede cabeçalho/título/blocos do corpo/rodapé e distribui em folhas A4.
  useLayoutEffect(() => {
    const m = measureRef.current;
    if (!m) return;
    const head = m.querySelector<HTMLElement>(".doc-head");
    const title = m.querySelector<HTMLElement>(".doc-titulo");
    const foot = m.querySelector<HTMLElement>(".doc-foot");
    const body = m.querySelector<HTMLElement>(".doc-body");
    if (!body) {
      setPages([fullHtml]);
      return;
    }

    const contentTop = m.getBoundingClientRect().top + PAD_V;
    const bodyTop = body.getBoundingClientRect().top;
    // Altura consumida por cabeçalho + título (só aparecem na 1ª página).
    const headZone = Math.max(0, bodyTop - contentTop);
    const footH = foot ? foot.offsetHeight + 24 : 0;

    const headHtml = head?.outerHTML ?? "";
    const titleHtml = title?.outerHTML ?? "";
    const footHtml = foot?.outerHTML ?? "";

    // Altura de cada bloco de topo do corpo. TABELAS altas são fatiadas por LINHAS (senão uma
    // tabela maior que a folha estoura o A4 — bug de proposta com muitos serviços). Guardamos o
    // cabeçalho e cada linha medidos, para reconstruir tabelas que cabem em cada página.
    const bodyRectTop = body.getBoundingClientRect().top;
    const bodyRectH = body.getBoundingClientRect().height;
    const kids = Array.from(body.children) as HTMLElement[];
    type Bloco =
      | { tipo: "atomo"; html: string; h: number }
      | { tipo: "tabela"; abre: string; cabecalho: string; cabH: number; linhas: { html: string; h: number }[]; h: number };
    const blocos: Bloco[] = kids.map((c, i) => {
      const top = c.getBoundingClientRect().top - bodyRectTop;
      const prox = kids[i + 1];
      const next = prox ? prox.getBoundingClientRect().top - bodyRectTop : bodyRectH;
      const h = Math.max(1, next - top);
      if (c.tagName === "TABLE") {
        const thead = c.querySelector("thead");
        const tbody = c.querySelector("tbody") ?? c;
        const trs = Array.from(tbody.querySelectorAll(":scope > tr")) as HTMLElement[];
        return {
          tipo: "tabela",
          abre: c.outerHTML.slice(0, c.outerHTML.indexOf(">") + 1), // "<table ...>"
          cabecalho: thead?.outerHTML ?? "",
          cabH: thead ? thead.getBoundingClientRect().height : 0,
          linhas: trs.map((tr) => ({ html: tr.outerHTML, h: tr.getBoundingClientRect().height })),
          h,
        };
      }
      return { tipo: "atomo", html: c.outerHTML, h };
    });

    // Empacota em páginas (a 1ª desconta cabeçalho+título). Cada página guarda o HTML interno do corpo.
    const paginas: string[] = [];
    let cur = "";
    let budget = CONTENT_H - headZone;
    const novaPagina = () => {
      paginas.push(cur);
      cur = "";
      budget = CONTENT_H;
    };
    for (const b of blocos) {
      if (b.tipo === "atomo") {
        if (b.h > budget && cur) novaPagina();
        cur += b.html;
        budget -= b.h;
      } else if (b.h <= budget) {
        cur += `${b.abre}${b.cabecalho}<tbody>${b.linhas.map((l) => l.html).join("")}</tbody></table>`;
        budget -= b.h;
      } else {
        // Tabela maior que a página: fatia por linhas — cada fatia repete o cabeçalho.
        let idx = 0;
        while (idx < b.linhas.length) {
          const primeira = b.linhas[idx];
          if (cur && primeira && budget < b.cabH + primeira.h + 8) novaPagina();
          let frag = `${b.abre}${b.cabecalho}<tbody>`;
          let usado = b.cabH;
          let postas = 0;
          for (let l = b.linhas[idx]; l && (usado + l.h <= budget || postas === 0); l = b.linhas[idx]) {
            frag += l.html;
            usado += l.h;
            idx++;
            postas++;
          }
          cur += `${frag}</tbody></table>`;
          budget -= usado;
          if (idx < b.linhas.length) novaPagina();
        }
      }
    }
    paginas.push(cur);

    // Rodapé fica na última página; se não couber, ganha uma página só para ele.
    const footOwnPage = budget < footH;
    const last = paginas.length - 1;
    const html = paginas.map((inner, p) => {
      const topo = p === 0 ? headHtml + titleHtml : "";
      const base = p === last && !footOwnPage ? footHtml : "";
      return `${topo}<div class="doc-body">${inner}</div>${base}`;
    });
    if (footOwnPage && footHtml) html.push(`<div class="doc-body"></div>${footHtml}`);
    setPages(html);
  }, [fullHtml]);

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
      {/* Camada de medição (oculta) — fonte das alturas para paginar. */}
      <div ref={measureRef} className="doc-measure" dangerouslySetInnerHTML={{ __html: fullHtml }} />
      <div style={{ zoom }}>
        <div className="doc-pages">
          {(pages ?? [fullHtml]).map((html, i) => (
            <div key={i} className="doc-sheet" dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Abre a janela de impressão com a MESMA moldura → "salvar como PDF" sai idêntico ao preview. */
export function imprimirDocumento(props: DocumentoBrandedProps) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>${esc(props.titulo)}</title>
    <style>
      @page { size: A4; margin: 18mm 16mm; }
      * { box-sizing: border-box; }
      body { margin:0; background:#fff; }
      .doc-sheet { padding:0; }
      ${DOC_STYLES}
    </style></head><body>
    <div class="doc-sheet">${documentoBrandedHtml(props)}</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
    </body></html>`);
  w.document.close();
  w.focus();
}

/** Baixa um .doc (HTML que o Word abre) com a mesma moldura. */
export function baixarWordDocumento(props: DocumentoBrandedProps) {
  const html = `<!doctype html><html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
    <head><meta charset="utf-8"><title>${esc(props.titulo)}</title><style>${DOC_STYLES}</style></head>
    <body><div class="doc-sheet">${documentoBrandedHtml(props)}</div></body></html>`;
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${props.titulo}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}
