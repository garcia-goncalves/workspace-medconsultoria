import { useRef, type KeyboardEvent } from "react";
import { Bold, Italic, Heading2, List, ListOrdered, Quote, Link2, Table as TableIcon, Minus } from "lucide-react";
import { cn } from "@app/ui";
import { Textarea } from "../../components/ui/textarea";

/**
 * Editor de documento em Markdown com **barra de formatação** (negrito, título, listas,
 * tabela…) que age sobre a seleção — dá para editar sem conhecer Markdown. Atalhos
 * Ctrl/Cmd+B e Ctrl/Cmd+I. O preview branded fica ao lado (na página).
 */
export function DocumentoEditor({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  /** Aplica uma transformação à seleção atual e restaura o cursor. */
  function apply(fn: (ctx: { start: number; end: number; text: string; selected: string }) => { text: string; start: number; end: number }) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const res = fn({ start, end, text: value, selected: value.slice(start, end) });
    onChange(res.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(res.start, res.end);
    });
  }

  /** Envolve a seleção (negrito/itálico/link). Sem seleção, insere um placeholder. */
  const wrap = (before: string, after = before, placeholder = "texto") =>
    apply(({ start, end, text, selected }) => {
      const inner = selected || placeholder;
      const novo = text.slice(0, start) + before + inner + after + text.slice(end);
      const s = start + before.length;
      return { text: novo, start: s, end: s + inner.length };
    });

  /** Prefixa cada linha selecionada (título/lista/citação). */
  const prefixLines = (make: (i: number) => string) =>
    apply(({ start, end, text }) => {
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const nl = text.indexOf("\n", end);
      const lineEnd = nl === -1 ? text.length : nl;
      const bloco = text.slice(lineStart, lineEnd);
      const novo = bloco
        .split("\n")
        .map((l, i) => make(i) + l)
        .join("\n");
      return { text: text.slice(0, lineStart) + novo + text.slice(lineEnd), start: lineStart, end: lineStart + novo.length };
    });

  /** Insere um bloco (tabela/divisória) em linha própria, no cursor. */
  const insertBlock = (bloco: string) =>
    apply(({ start, text }) => {
      const antesTemQuebra = start === 0 || text[start - 1] === "\n";
      const trecho = (antesTemQuebra ? "" : "\n\n") + bloco + "\n";
      const pos = start + trecho.length;
      return { text: text.slice(0, start) + trecho + text.slice(start), start: pos, end: pos };
    });

  const TABELA = "| Coluna 1 | Coluna 2 |\n| --- | --- |\n| Item | Valor |";

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b") {
      e.preventDefault();
      wrap("**", "**", "negrito");
    } else if (k === "i") {
      e.preventDefault();
      wrap("*", "*", "itálico");
    }
  };

  const grupos: { icon: typeof Bold; title: string; fn: () => void }[][] = [
    [
      { icon: Bold, title: "Negrito (Ctrl+B)", fn: () => wrap("**", "**", "negrito") },
      { icon: Italic, title: "Itálico (Ctrl+I)", fn: () => wrap("*", "*", "itálico") },
    ],
    [
      { icon: Heading2, title: "Título de seção", fn: () => prefixLines(() => "## ") },
      { icon: List, title: "Lista com marcadores", fn: () => prefixLines(() => "- ") },
      { icon: ListOrdered, title: "Lista numerada", fn: () => prefixLines((i) => `${i + 1}. `) },
      { icon: Quote, title: "Citação", fn: () => prefixLines(() => "> ") },
    ],
    [
      { icon: Link2, title: "Link", fn: () => wrap("[", "](https://)", "texto do link") },
      { icon: TableIcon, title: "Tabela", fn: () => insertBlock(TABELA) },
      { icon: Minus, title: "Linha divisória", fn: () => insertBlock("---") },
    ],
  ];

  const palavras = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
        {grupos.map((grupo, gi) => (
          <div key={gi} className="flex items-center gap-0.5">
            {gi > 0 && <span className="mx-1 h-5 w-px bg-border" />}
            {grupo.map((b, i) => (
              <button
                key={i}
                type="button"
                title={b.title}
                onClick={b.fn}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <b.icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        ))}
      </div>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        spellCheck
        placeholder="Escreva o documento. Selecione um trecho e use a barra acima para formatar (ou escreva em Markdown)."
        className="min-h-[62vh] flex-1 resize-none rounded-none border-0 bg-card px-4 py-3 font-mono text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground">
        <span>Formate pela barra ou digite Markdown — a prévia ao lado atualiza sozinha.</span>
        <span className="tabular-nums">{palavras} palavra{palavras === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}
