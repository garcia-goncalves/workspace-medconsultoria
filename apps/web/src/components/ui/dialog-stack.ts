import { useEffect, useRef, type RefObject } from "react";

/**
 * Infra de acessibilidade COMPARTILHADA pelos overlays flutuantes (Modal, Sheet, Popover):
 * uma pilha ÚNICA de Esc e uma pilha ÚNICA de foco preso, para todo o app — extraída do
 * `Modal` original (`modal.tsx`), sem mudar o comportamento dele.
 *
 * ⚠️ Por que UMA pilha global, e não uma por componente: se cada tipo de overlay tivesse a
 * própria pilha, dois overlays abertos ao mesmo tempo (ex.: um Popover aberto de dentro de um
 * Sheet) teriam DOIS listeners de Esc independentes no `document` — os dois fechariam juntos no
 * mesmo aperto de tecla, em vez de só o do TOPO. Com a pilha compartilhada, só o overlay mais
 * recente (o do topo, seja ele Modal, Sheet ou Popover) responde ao Esc.
 */

/**
 * Seletor dos elementos focáveis dentro de um overlay (para foco inicial e para o "prender" o
 * Tab). O descarte do que está desabilitado NÃO fica aqui como `:not([disabled])`: aquilo é
 * seletor de ATRIBUTO e só enxerga o `disabled` escrito no próprio elemento — um campo dentro
 * de um `<fieldset disabled>` continuaria contando como focável. A pseudoclasse `:disabled`
 * abaixo é a que a especificação define como "de fato desabilitado", herança do fieldset
 * inclusive.
 */
const FOCAVEIS = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

export function listarFocaveis(root: HTMLElement | null): HTMLElement[] {
  return root
    ? [...root.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(
        (el) => !el.matches(":disabled") && (el.offsetParent !== null || el === document.activeElement),
      )
    : [];
}

const escStack: Array<() => void> = [];
let escListening = false;
function ensureEscListener() {
  if (escListening) return;
  escListening = true;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && escStack.length) escStack[escStack.length - 1]!();
  });
}

/** Mesma ideia da pilha do Esc: só o overlay do topo recupera um foco perdido no Tab. */
const trapStack: HTMLElement[] = [];

/**
 * Prende o foco dentro de `containerRef` enquanto `open`: foca o 1º elemento focável ao abrir,
 * mantém o Tab girando dentro do container, fecha no Esc (registrado na pilha global) e devolve
 * o foco a quem o tinha antes de abrir. É a MESMA técnica do `Modal` — quem chamar este hook não
 * reimplementa nada, só reaproveita.
 */
export function useFocoPreso(open: boolean, containerRef: RefObject<HTMLElement>, onClose: () => void) {
  // onClose via ref (evita re-registrar o efeito a cada render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const focoAnterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    ensureEscListener();
    const fn = () => onCloseRef.current();
    escStack.push(fn);

    focoAnterior.current = (document.activeElement as HTMLElement) ?? null;
    const container = containerRef.current;
    const t = window.setTimeout(() => {
      const foc = listarFocaveis(container);
      (foc[0] ?? container)?.focus();
    }, 0);
    if (container) trapStack.push(container);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !container) return;
      const ativo = document.activeElement as HTMLElement | null;

      // Foco fora de qualquer elemento (ex.: o elemento focado virou `disabled` no meio do
      // caminho) — o navegador joga o foco no `body`. Só o overlay do TOPO recupera.
      if (!ativo || ativo === document.body) {
        if (trapStack[trapStack.length - 1] !== container) return;
        const foc = listarFocaveis(container);
        if (!foc.length) {
          e.preventDefault();
          container.focus();
          return;
        }
        e.preventDefault();
        (e.shiftKey ? foc[foc.length - 1]! : foc[0]!).focus();
        return;
      }

      // Foco num elemento de verdade fora do container (ex.: um dropdown ancorado em portal,
      // fora da árvore do overlay): não é nosso, deixa o Tab seguir normal.
      if (!container.contains(ativo)) return;

      const foc = listarFocaveis(container);
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
      if (container) {
        const j = trapStack.lastIndexOf(container);
        if (j >= 0) trapStack.splice(j, 1);
      }
      document.removeEventListener("keydown", onKeyDown);
      // Restaura o foco para quem abriu o overlay (se ainda estiver no documento).
      focoAnterior.current?.focus?.();
    };
  }, [open, containerRef]);
}
