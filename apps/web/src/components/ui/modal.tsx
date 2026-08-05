import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@app/ui";

/**
 * Seletor dos elementos focáveis dentro do modal (para foco inicial e focus trap).
 *
 * O descarte do que está desabilitado NÃO fica aqui como `:not([disabled])`: aquilo é seletor de
 * ATRIBUTO e só enxerga o `disabled` escrito no próprio elemento — um campo dentro de um
 * `<fieldset disabled>` (o "Enviando…" da tela de e-mail) continuava contando como focável e o Tab
 * escapava do modal. A pseudoclasse `:disabled` do filtro abaixo é a que a especificação define
 * como "de fato desabilitado", herança do fieldset inclusive; para quem tem o atributo próprio o
 * resultado é exatamente o mesmo de antes.
 */
const FOCAVEIS = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
const listarFocaveis = (root: HTMLElement | null): HTMLElement[] =>
  root
    ? [...root.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(
        (el) => !el.matches(":disabled") && (el.offsetParent !== null || el === document.activeElement),
      )
    : [];

/** Larguras padronizadas dos modais. `md` é o padrão (mais confortável que o antigo). */
const SIZES = {
  sm: "max-w-md", // ~448px — confirmações/prompts curtos
  md: "max-w-xl", // ~576px — padrão (formulários simples)
  lg: "max-w-2xl", // ~672px — formulários maiores
  xl: "max-w-4xl", // ~896px — construtores/tabelas
  "2xl": "max-w-6xl", // ~1152px — construtor + preview lado a lado
} as const;

// Pilha de onClose dos modais abertos + UM listener global de Esc que fecha SEMPRE o do topo
// (o último registrado). Assim um modal-sobre-modal (ex.: "Gerenciar operadoras" dentro do
// "Novo documento") fecha só o de cima no Esc — sem perder o de baixo.
const escStack: Array<() => void> = [];
let escListening = false;
function ensureEscListener() {
  if (escListening) return;
  escListening = true;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && escStack.length) escStack[escStack.length - 1]!();
  });
}

/** Mesma ideia da pilha do Esc, para os cards abertos: só o do topo recupera um foco perdido. */
const trapStack: HTMLElement[] = [];


/**
 * Modal (overlay + card). Fecha no Esc e no clique fora.
 * Estrutura: cabeçalho FIXO · corpo que ROLA POR DENTRO · rodapé FIXO (opcional).
 * Assim as ações (Salvar/Cancelar) ficam SEMPRE visíveis — só os campos rolam.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Rodapé fixo (ex.: botões de ação). Fica sempre visível; só o corpo rola. */
  footer?: ReactNode;
  size?: keyof typeof SIZES;
}) {
  // onClose via ref (evita re-registrar a cada render). Registra na pilha global de Esc ao abrir.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const cardRef = useRef<HTMLDivElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);
  const tituloId = useId();

  useEffect(() => {
    if (!open) return;
    ensureEscListener();
    const fn = () => onCloseRef.current();
    escStack.push(fn);

    // Acessibilidade: guarda o foco atual, foca o 1º elemento do modal e prende o Tab dentro dele.
    focoAnterior.current = (document.activeElement as HTMLElement) ?? null;
    const card = cardRef.current;
    const t = window.setTimeout(() => {
      const foc = listarFocaveis(card);
      (foc[0] ?? card)?.focus();
    }, 0);
    if (card) trapStack.push(card);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !card) return;
      const ativo = document.activeElement as HTMLElement | null;

      // O foco pode ter caído FORA de qualquer elemento: é o que o navegador faz quando o
      // elemento focado é desabilitado no meio do caminho (clicar em "Enviar" e o botão virar
      // `disabled`) — o foco vai para o `body`. Como o `body` não é filho do card, este listener
      // precisa estar no DOCUMENTO para enxergar o Tab a partir dali; ficando no card, o evento
      // nunca chegava e o Tab escapava do modal. Só o modal do TOPO recupera, senão dois modais
      // empilhados disputariam o foco.
      if (!ativo || ativo === document.body) {
        if (trapStack[trapStack.length - 1] !== card) return;
        const foc = listarFocaveis(card);
        if (!foc.length) {
          // Nem um focável sobrou (formulário inteiro desabilitado): o próprio card recebe o
          // foco — ele tem `tabIndex={-1}` justamente para isto.
          e.preventDefault();
          card.focus();
          return;
        }
        e.preventDefault();
        (e.shiftKey ? foc[foc.length - 1]! : foc[0]!).focus();
        return;
      }

      // Foco num elemento de verdade que não está no card (ex.: um dropdown ancorado, que este
      // repo renderiza em portal, fora da árvore do modal): não é nosso, e antes deste listener
      // virar global esse Tab nunca chegava aqui. Sair mantém o comportamento idêntico.
      if (!card.contains(ativo)) return;

      const foc = listarFocaveis(card);
      if (!foc.length) return;
      const primeiro = foc[0]!;
      const ultimo = foc[foc.length - 1]!;
      if (e.shiftKey && ativo === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && ativo === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(t);
      const i = escStack.lastIndexOf(fn);
      if (i >= 0) escStack.splice(i, 1);
      if (card) {
        const j = trapStack.lastIndexOf(card);
        if (j >= 0) trapStack.splice(j, 1);
      }
      document.removeEventListener("keydown", onKeyDown);
      // Restaura o foco para quem abriu o modal (se ainda estiver no documento).
      focoAnterior.current?.focus?.();
    };
  }, [open]);

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
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-card px-6 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}
