import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@app/ui";
import { useFocoPreso } from "./dialog-stack";

/** Abaixo deste ponto (o `sm` do Tailwind) o padrão de `lado` vira `"baixo"` — o gesto natural
 * de painel no celular é subir da borda inferior, não deslizar de uma lateral estreita. */
const LIMITE_MOBILE = "(max-width: 639px)";

function useEhMobile(): boolean {
  const [ehMobile, setEhMobile] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(LIMITE_MOBILE).matches));
  useEffect(() => {
    const mq = window.matchMedia(LIMITE_MOBILE);
    const onChange = () => setEhMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return ehMobile;
}

const LADO_CLASSES: Record<"direita" | "esquerda" | "baixo", string> = {
  direita: "inset-y-0 right-0 h-full w-full max-w-md animate-slide-in-panel",
  esquerda: "inset-y-0 left-0 h-full w-full max-w-md animate-slide-in-right",
  baixo: "inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-xl animate-slide-in-bottom",
};

/**
 * Painel que desliza da borda (`role="dialog"`, `aria-modal`). Mesma técnica de foco preso do
 * `Modal` (`useFocoPreso`): Esc fecha, clique no fundo fecha, foco preso dentro enquanto aberto,
 * devolve o foco a quem abriu ao fechar.
 *
 * `lado` escolhe de onde desliza; no celular (`< sm`) o padrão vira `"baixo"` automaticamente —
 * passe `lado` explicitamente só quando o caso de uso pedir um lado fixo em toda tela.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  lado,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Rodapé fixo (ações). Fica sempre visível; só o corpo rola. */
  footer?: ReactNode;
  /** Padrão: `"baixo"` no celular (`< sm`), `"direita"` no resto. */
  lado?: "direita" | "esquerda" | "baixo";
}) {
  const ehMobile = useEhMobile();
  const ladoEfetivo = lado ?? (ehMobile ? "baixo" : "direita");
  const painelRef = useRef<HTMLDivElement>(null);
  const tituloId = useId();

  useFocoPreso(open, painelRef, onClose);

  if (!open) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex animate-fade-in bg-foreground/30 backdrop-blur-sm",
        ladoEfetivo === "direita" && "justify-end",
        ladoEfetivo === "baixo" && "items-end",
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className={cn("relative flex flex-col bg-card shadow-lg outline-none", LADO_CLASSES[ladoEfetivo])}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-4">
          <h2 id={tituloId} className="text-lg font-semibold text-primary">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="-mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-card px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
