import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@app/ui";
import { useFocoPreso } from "./dialog-stack";

/** Props que o `trigger` recebe para ligar o botão real do gatilho ao balão. */
export interface PopoverTriggerProps {
  ref: (el: HTMLElement | null) => void;
  onClick: () => void;
  "aria-expanded": boolean;
  "aria-haspopup": "dialog";
  "aria-controls": string;
}

/**
 * Posiciona o balão SEM deixá-lo sair da tela: mede o próprio gatilho e o próprio balão (que já
 * está montado, só invisível) e escolhe abrir para cima quando faltar espaço embaixo, além de
 * deslizar horizontalmente para caber (nunca "vazando" pela lateral). Mesma ideia de
 * `use-anchored-style.ts` (usado pelo Combobox), mas medindo o balão de verdade em vez de assumir
 * a largura do gatilho — aqui o conteúdo é livre (formulário, lista, o que for).
 */
function usePosicaoNaTela(open: boolean, gatilhoRef: RefObject<HTMLElement | null>, painelRef: RefObject<HTMLElement | null>): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) return;

    const atualizar = () => {
      const gatilho = gatilhoRef.current;
      const painel = painelRef.current;
      if (!gatilho || !painel) return;
      const g = gatilho.getBoundingClientRect();
      const p = painel.getBoundingClientRect();
      const margem = 8;

      let left = g.left + g.width / 2 - p.width / 2;
      left = Math.max(margem, Math.min(left, window.innerWidth - p.width - margem));

      const espacoAbaixo = window.innerHeight - g.bottom - margem;
      const espacoAcima = g.top - margem;
      const paraCima = espacoAbaixo < p.height && espacoAcima > espacoAbaixo;

      setStyle({
        position: "fixed",
        left: Math.round(left),
        visibility: "visible",
        ...(paraCima ? { bottom: Math.round(window.innerHeight - g.top + 6) } : { top: Math.round(g.bottom + 6) }),
      });
    };

    atualizar();
    window.addEventListener("scroll", atualizar, true);
    window.addEventListener("resize", atualizar);
    return () => {
      window.removeEventListener("scroll", atualizar, true);
      window.removeEventListener("resize", atualizar);
    };
  }, [open, gatilhoRef, painelRef]);

  return style;
}

/**
 * Balão ancorado a um gatilho, para conteúdo INTERATIVO (formulário curto, lista de ações — o
 * `HintIcon`/`Tooltip` continua sendo o certo para texto simples). Renderizado em portal, como os
 * dropdowns deste repo já fazem (ver `combobox.tsx`).
 *
 * Reaproveita a MESMA técnica de foco preso do `Modal` (`useFocoPreso`): Esc fecha, foco entra no
 * balão ao abrir e volta ao gatilho ao fechar. Clique fora fecha por conta própria (gatilho e
 * painel contam como "dentro").
 *
 * `trigger` é uma função porque o gatilho pode ser qualquer botão do design system (`Button`,
 * ícone, etc.) — o Popover não escolhe por você, só entrega as props de acessibilidade para você
 * espalhar nele.
 */
export function Popover({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  trigger,
  children,
  ariaLabel,
  className,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode;
  /** Nome acessível do balão, para quem lê por leitor de tela (ex.: "Filtros"). */
  ariaLabel?: string;
  className?: string;
}) {
  const [interno, setInterno] = useState(defaultOpen);
  const controlado = openProp !== undefined;
  const open = controlado ? openProp : interno;
  const setOpen = (v: boolean) => {
    if (!controlado) setInterno(v);
    onOpenChange?.(v);
  };

  const gatilhoRef = useRef<HTMLElement | null>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const idPainel = useId();
  const style = usePosicaoNaTela(open, gatilhoRef, painelRef);

  useFocoPreso(open, painelRef, () => setOpen(false));

  // Clique fora fecha (gatilho e painel contam como "dentro" — clicar no próprio gatilho para
  // fechar já é tratado pelo onClick dele, então não fecha-e-reabre no mesmo clique).
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (gatilhoRef.current?.contains(alvo) || painelRef.current?.contains(alvo)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {trigger({
        ref: (el) => {
          gatilhoRef.current = el;
        },
        onClick: () => setOpen(!open),
        "aria-expanded": open,
        "aria-haspopup": "dialog",
        "aria-controls": idPainel,
      })}
      {open &&
        createPortal(
          <div
            ref={painelRef}
            id={idPainel}
            role="dialog"
            aria-label={ariaLabel}
            tabIndex={-1}
            style={style}
            className={cn(
              "z-[70] w-max max-w-sm animate-scale-in rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg outline-none",
              className,
            )}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
