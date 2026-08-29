import { createContext, useContext, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@app/ui";

interface TabsContextValue {
  valorAtivo: string;
  selecionar: (valor: string) => void;
  idBase: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(componente: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${componente}> só funciona dentro de <Tabs>.`);
  return ctx;
}

/**
 * Abas acessíveis (`role="tablist"/"tab"/"tabpanel"`). Padrão de composição — `<Tabs>` guarda o
 * valor ativo, `<TabsList>` é a barra, `<TabsTrigger>` cada aba, `<TabsContent>` cada painel.
 * Controlado (`value`+`onValueChange`) ou não-controlado (`defaultValue`).
 */
export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
  className,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (valor: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const [interno, setInterno] = useState(defaultValue ?? "");
  const controlado = value !== undefined;
  const valorAtivo = controlado ? value : interno;
  const idBase = useId();

  const selecionar = (valor: string) => {
    if (!controlado) setInterno(valor);
    onValueChange?.(valor);
  };

  return (
    <TabsContext.Provider value={{ valorAtivo, selecionar, idBase }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

/**
 * A barra de abas. Abaixo de `sm` rola horizontalmente (sem quebrar linha, sem barra de rolagem
 * visível) — é o comportamento pedido para caber em celular sem espremer os rótulos.
 * Navegação por teclado: ←/→ movem o foco entre as abas (roda do fim pro começo e vice-versa);
 * Home/End vão para a 1ª/última. Ativar é sempre com Enter/Espaço (o `<button>` nativo já faz
 * isso sozinho) — mover o foco com a seta NÃO troca a aba sozinho.
 */
export function TabsList({ children, className, "aria-label": ariaLabel }: { children: ReactNode; className?: string; "aria-label"?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const abas = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [])];
    if (!abas.length) return;
    const atual = abas.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    let proximo: number;
    if (e.key === "Home") proximo = 0;
    else if (e.key === "End") proximo = abas.length - 1;
    else if (e.key === "ArrowRight") proximo = atual < 0 ? 0 : (atual + 1) % abas.length;
    else proximo = atual < 0 ? abas.length - 1 : (atual - 1 + abas.length) % abas.length;
    abas[proximo]?.focus();
  };

  return (
    <div
      ref={ref}
      role="tablist"
      // A barra de abas rola na horizontal de propósito quando não cabe — ver `table.tsx`.
      data-rolagem-horizontal
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "flex items-center gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "scroll-smooth",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Uma aba. `contador` mostra um número/rótulo curto ao lado (ex.: "Documentos 12"). */
export function TabsTrigger({
  value,
  children,
  contador,
  disabled,
  className,
}: {
  value: string;
  children: ReactNode;
  contador?: number | string;
  disabled?: boolean;
  className?: string;
}) {
  const { valorAtivo, selecionar, idBase } = useTabsContext("TabsTrigger");
  const ativo = valorAtivo === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${idBase}-tab-${value}`}
      aria-controls={`${idBase}-panel-${value}`}
      aria-selected={ativo}
      disabled={disabled}
      tabIndex={ativo ? 0 : -1}
      onClick={() => selecionar(value)}
      className={cn(
        "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors",
        "hover:text-foreground",
        "focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        ativo && "text-primary",
        className,
      )}
    >
      {children}
      {contador != null && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
            ativo ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {contador}
        </span>
      )}
      {/* Barra indicadora do item ativo — mesma linguagem da barra da sidebar (ADR-94), só que
          embaixo em vez de na lateral. */}
      {ativo && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-blueLight" />}
    </button>
  );
}

/** O conteúdo de uma aba. Só o painel ativo é renderizado. */
export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const { valorAtivo, idBase } = useTabsContext("TabsContent");
  if (valorAtivo !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${value}`}
      aria-labelledby={`${idBase}-tab-${value}`}
      tabIndex={0}
      className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}
    >
      {children}
    </div>
  );
}
