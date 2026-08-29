import { useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@app/ui";
import { HintIcon } from "./tooltip";
import { useFocoPreso } from "./dialog-stack";

/** Larguras padronizadas dos modais. `md` é o padrão (mais confortável que o antigo). */
const SIZES = {
  sm: "max-w-md", // ~448px — confirmações/prompts curtos
  md: "max-w-xl", // ~576px — padrão (formulários simples)
  lg: "max-w-2xl", // ~672px — formulários maiores
  xl: "max-w-4xl", // ~896px — construtores/tabelas
  "2xl": "max-w-6xl", // ~1152px — construtor + preview lado a lado
} as const;

/**
 * Modal (overlay + card). Fecha no Esc e no clique fora.
 * Estrutura: cabeçalho FIXO · corpo que ROLA POR DENTRO · rodapé FIXO (opcional).
 * Assim as ações (Salvar/Cancelar) ficam SEMPRE visíveis — só os campos rolam.
 */
export function Modal({
  open,
  onClose,
  title,
  hint,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "?" de ajuda ao lado do título — mesmo padrão do `hint` de `<Label>`. */
  hint?: ReactNode;
  children: ReactNode;
  /** Rodapé fixo (ex.: botões de ação). Fica sempre visível; só o corpo rola. */
  footer?: ReactNode;
  size?: keyof typeof SIZES;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const tituloId = useId();

  // Foco preso + Esc (pilha global) + devolução de foco ao fechar — ver `dialog-stack.ts`.
  useFocoPreso(open, cardRef, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className={cn("flex max-h-[95vh] w-full animate-scale-in flex-col rounded-xl border bg-card shadow-lg outline-none", SIZES[size])}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-4">
          <h2 id={tituloId} className="inline-flex items-center gap-1.5 text-lg font-semibold text-primary">
            {title}
            {hint && <HintIcon text={hint} />}
          </h2>
          <button
            onClick={onClose}
            className="-mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-card px-6 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}
