import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@app/ui";

interface AccordionContextValue {
  abertos: string[];
  alternar: (valor: string) => void;
}
const AccordionContext = createContext<AccordionContextValue | null>(null);

interface AccordionItemContextValue {
  valor: string;
  aberto: boolean;
  headerId: string;
  painelId: string;
}
const AccordionItemContext = createContext<AccordionItemContextValue | null>(null);

function useAccordionContext(componente: string): AccordionContextValue {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error(`<${componente}> só funciona dentro de <Accordion>.`);
  return ctx;
}
function useAccordionItemContext(componente: string): AccordionItemContextValue {
  const ctx = useContext(AccordionItemContext);
  if (!ctx) throw new Error(`<${componente}> só funciona dentro de <AccordionItem>.`);
  return ctx;
}

/**
 * Seções recolhíveis. `modo="unica"` mantém só uma aberta por vez (abrir uma fecha a anterior);
 * `modo="multipla"` deixa quantas o usuário quiser. Controlado (`value`+`onValueChange`) ou
 * não-controlado (`defaultValue`) — sempre uma lista dos valores abertos, mesmo em modo `unica`
 * (fica com no máximo 1 item), para não ter duas formas de API por modo.
 *
 * Serve para recolher blocos longos em telas pequenas — não é enfeite.
 */
export function Accordion({
  modo = "unica",
  value,
  defaultValue,
  onValueChange,
  children,
  className,
}: {
  modo?: "unica" | "multipla";
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  children: ReactNode;
  className?: string;
}) {
  const [interno, setInterno] = useState<string[]>(defaultValue ?? []);
  const controlado = value !== undefined;
  const abertos = controlado ? value! : interno;

  const alternar = (valor: string) => {
    const estaAberto = abertos.includes(valor);
    const proximo =
      modo === "unica"
        ? estaAberto
          ? []
          : [valor]
        : estaAberto
          ? abertos.filter((v) => v !== valor)
          : [...abertos, valor];
    if (!controlado) setInterno(proximo);
    onValueChange?.(proximo);
  };

  return (
    <AccordionContext.Provider value={{ abertos, alternar }}>
      <div className={className}>{children}</div>
    </AccordionContext.Provider>
  );
}

/** Uma seção. `value` identifica a seção (usado por `Accordion` para saber o que está aberto). */
export function AccordionItem({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const { abertos } = useAccordionContext("AccordionItem");
  const idBase = useId();
  const aberto = abertos.includes(value);

  return (
    <AccordionItemContext.Provider value={{ valor: value, aberto, headerId: `${idBase}-header`, painelId: `${idBase}-painel` }}>
      <div className={cn("border-b last:border-b-0", className)}>{children}</div>
    </AccordionItemContext.Provider>
  );
}

/** O cabeçalho clicável. Chevron gira ao abrir; embrulhado em `<h3>` (padrão do WAI-ARIA APG). */
export function AccordionTrigger({ children, className }: { children: ReactNode; className?: string }) {
  const { alternar } = useAccordionContext("AccordionTrigger");
  const { valor, aberto, headerId, painelId } = useAccordionItemContext("AccordionTrigger");

  return (
    <h3 className="flex">
      <button
        type="button"
        id={headerId}
        aria-expanded={aberto}
        aria-controls={painelId}
        onClick={() => alternar(valor)}
        className={cn(
          "flex flex-1 items-center justify-between gap-3 py-3 text-left text-sm font-medium text-foreground outline-none transition-colors",
          "hover:text-primary",
          "focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          className,
        )}
      >
        {children}
        <ChevronDown
          aria-hidden
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", aberto && "rotate-180")}
        />
      </button>
    </h3>
  );
}

/**
 * O conteúdo recolhível. A animação de altura é só CSS (`grid-template-rows: 0fr → 1fr`, sem
 * medir `scrollHeight` em JS) — funciona com conteúdo de altura variável e é respeitada pela
 * regra global de `prefers-reduced-motion` (`index.css`).
 *
 * Fechado, o conteúdo fica com `inert`: continua no DOM (para a transição visual acontecer) mas
 * sai do Tab e da leitura de tela — sem isso o Tab entraria em campos escondidos visualmente.
 * `inert` ainda não está tipado no `@types/react` desta versão, por isso é setado direto no DOM.
 */
export function AccordionContent({ children, className }: { children: ReactNode; className?: string }) {
  const { aberto, headerId, painelId } = useAccordionItemContext("AccordionContent");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (aberto) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [aberto]);

  return (
    <div
      ref={ref}
      id={painelId}
      role="region"
      aria-labelledby={headerId}
      className={cn("grid transition-[grid-template-rows] duration-200 ease-out", aberto ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
    >
      <div className="min-h-0 overflow-hidden">
        <div className={cn("pb-4 pt-0 text-sm text-muted-foreground", className)}>{children}</div>
      </div>
    </div>
  );
}
