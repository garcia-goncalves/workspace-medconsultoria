import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, X, Search } from "lucide-react";
import { cn } from "@app/ui";
import { useAnchoredStyle } from "./use-anchored-style";

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string | null;
}

/**
 * Autocomplete (typeahead) sobre uma lista de opções. Controlado por `value`
 * (string vazia = nada selecionado). Digitação filtra por rótulo/dica; teclado
 * navega (↑/↓/Enter/Esc). Mantém o visual dos inputs do design system.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Selecione…",
  emptyText = "Nada encontrado.",
  id,
  allowClear = true,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  emptyText?: string;
  id?: string;
  allowClear?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const opcaoId = (i: number) => `${listId}-opt-${i}`;
  // Dropdown flutua em portal (fixed) — não empurra nem rola o modal onde o campo está.
  const dropStyle = useAnchoredStyle(ref, open, 240);

  const selected = options.find((o) => o.value === value) ?? null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) => o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q),
      )
    : options;

  // Fecha ao clicar fora e restaura o texto para o rótulo selecionado.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const alvo = e.target as Node;
      // Considera o campo E o painel flutuante (portal) como "dentro".
      if (ref.current?.contains(alvo) || panelRef.current?.contains(alvo)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => setActive(0), [query, open]);

  const abrir = () => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const escolher = (opt: ComboboxOption) => {
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return abrir();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[active]) escolher(filtered[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="relative" ref={ref}>
      <div
        className={cn(
          "flex h-10 w-full items-center rounded-md border border-input bg-card px-3 text-sm shadow-sm transition-colors",
          disabled ? "cursor-not-allowed opacity-50" : "hover:border-muted-foreground/40",
          open && "border-primary ring-2 ring-primary/20",
        )}
        onClick={abrir}
      >
        {open && <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />}
        <input
          ref={inputRef}
          id={id}
          disabled={disabled}
          value={open ? query : selected?.label ?? ""}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={abrir}
          onKeyDown={onKeyDown}
          className="w-full cursor-pointer bg-transparent outline-none placeholder:text-muted-foreground"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-activedescendant={open && filtered[active] ? opcaoId(active) : undefined}
        />
        {allowClear && value && !open ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            // Alvo de toque de 44×44 (era 20×20) com margem negativa compensando — a técnica do
            // `HintIcon`: o "x" continua do mesmo tamanho e a caixa não cresce. `-mr-3` come o
            // `px-3` da caixa, para o alvo encostar na borda em vez de empurrar o texto.
            className="-my-3 -mr-3 ml-0 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="Limpar"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <ChevronDown className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </div>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            style={dropStyle}
            className="z-[70] animate-scale-in overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">{emptyText}</div>
            ) : (
              filtered.map((opt, i) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                id={opcaoId(i)}
                aria-selected={opt.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => escolher(opt)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                  i === active ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                {opt.hint && (
                  <span className="shrink-0 truncate text-xs text-muted-foreground">{opt.hint}</span>
                )}
                {opt.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
