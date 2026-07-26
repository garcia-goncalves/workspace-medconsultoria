import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

/**
 * "?" de AJUDA ao lado de um rótulo de campo. O usuário passa o mouse (PC), toca (celular) ou
 * foca pelo teclado e lê uma explicação curta. Para quem é leigo entender cada campo sem poluir
 * o formulário com textos fixos.
 *
 * O balão é renderizado em PORTAL (no <body>) e posicionado em coordenadas fixas — assim NÃO é
 * cortado por modais/cards com `overflow`, nem empurra o layout. Fecha ao rolar, redimensionar,
 * tocar fora ou apertar Esc.
 */
export function HintIcon({ text, label = "Ajuda" }: { text: ReactNode; label?: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const id = useId();

  const posicionar = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const largura = Math.min(280, window.innerWidth - 16);
    const margem = 8;
    let left = r.left + r.width / 2 - largura / 2;
    left = Math.max(margem, Math.min(left, window.innerWidth - largura - margem));
    const cabeAbaixo = window.innerHeight - r.bottom > 140;
    setStyle({
      position: "fixed",
      left: Math.round(left),
      width: largura,
      visibility: "visible",
      ...(cabeAbaixo ? { top: Math.round(r.bottom + 6) } : { bottom: Math.round(window.innerHeight - r.top + 6) }),
    });
  };

  const abrir = () => {
    posicionar();
    setOpen(true);
  };
  const fechar = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onScrollResize = () => fechar();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    // scroll em qualquer container (capture) fecha; evita balão "solto" ao rolar.
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 outline-none transition-colors hover:text-primary focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
        // PC = hover (mouseenter/leave); celular/teclado = foco (o toque foca o botão → abre; tocar
        // fora tira o foco → fecha). Sem onClick para não conflitar (o clique dispara mouseenter+focus).
        onMouseEnter={abrir}
        onMouseLeave={fechar}
        onFocus={abrir}
        onBlur={fechar}
        onClick={(e) => e.preventDefault()}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={style}
            className="z-[80] animate-fade-in rounded-lg border bg-popover px-3 py-2 text-xs font-normal leading-relaxed text-popover-foreground shadow-lg"
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
