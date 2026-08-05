import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Modal } from "./modal";

// Sem Testing Library neste repo (ver `features/email/useRascunhoAutomatico.test.tsx`): montamos
// com `react-dom/client` + `act` puros.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * O jsdom não tem layout, então `offsetParent` é SEMPRE null nele — e `listarFocaveis` usa
 * `offsetParent !== null` para descartar o que está escondido. Sem este stub, a lista de focáveis
 * viria vazia em QUALQUER teste e o focus trap nunca rodaria (o `onKeyDown` sai cedo em
 * `if (!foc.length) return`), fazendo o teste passar por engano. O stub reproduz o que o
 * navegador devolve para um elemento visível: um ancestral posicionado (aqui, o pai).
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});

function montar(children: ReactNode, footer?: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <Modal open onClose={vi.fn()} title="Teste" footer={footer}>
        {children}
      </Modal>,
    );
  });
  return { root, container };
}

function desmontar(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

/** Espera o `setTimeout(…, 0)` do foco inicial do Modal. */
async function aguardarFocoInicial() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Dispara um Tab (real, com bolha) a partir do elemento em foco e devolve o evento. */
function apertarTab(shift = false): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(ev);
  });
  return ev;
}

function botao(container: HTMLElement, texto: string): HTMLButtonElement {
  const b = [...container.querySelectorAll("button")].find((x) => x.textContent?.trim() === texto);
  if (!b) throw new Error(`botão "${texto}" não encontrado`);
  return b;
}

describe("Modal — focus trap", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) desmontar(raiz.root, raiz.container);
    raiz = null;
  });

  it("campo desabilitado pelo <fieldset disabled> do PAI não conta como focável — o Tab não escapa do modal", async () => {
    // É exatamente a tela "Escrever" durante o "Enviando…": todos os campos ficam desabilitados
    // por herança de um `<fieldset disabled>`, sem atributo `disabled` próprio nenhum.
    raiz = montar(
      <fieldset disabled>
        <input id="dentro-do-fieldset" />
        <textarea id="area-do-fieldset" />
      </fieldset>,
    );
    await aguardarFocoInicial();

    // Único focável de verdade: o "X" do cabeçalho. Sendo o primeiro E o último, o Tab a partir
    // dele tem de ser interceptado (volta para ele mesmo) — é isso que prende o foco no modal.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Fechar");
    const ev = apertarTab();
    expect(
      ev.defaultPrevented,
      "Tab escapou do modal: os campos do <fieldset disabled> ainda estão sendo contados como focáveis",
    ).toBe(true);
  });

  it("REGRESSÃO dos outros modais: botão com `disabled` próprio no FIM do ciclo continua fora da conta", async () => {
    // O desabilitado precisa ser o ÚLTIMO do DOM. Com ele no meio, tirar o filtro de
    // desabilitados por completo não mudaria as pontas do ciclo e o teste passaria com o defeito
    // de volta — foi o falso-positivo que a revisão mediu na primeira versão deste arquivo.
    raiz = montar(<input id="campo-ok" />, [
      <button key="s" type="button">
        Salvar
      </button>,
      <button key="d" type="button" disabled>
        Desabilitado
      </button>,
    ]);
    await aguardarFocoInicial();

    // Primeiro focável = "X" do cabeçalho; último = "Salvar" (o desabilitado não conta).
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Fechar");
    const ev = apertarTab(true); // shift+Tab no primeiro → vai para o último
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement, "shift+Tab no primeiro tem de cair no último focável REAL").toBe(
      botao(raiz.container, "Salvar"),
    );

    // Tab no último volta ao primeiro — o ciclo dos modais comuns continua idêntico.
    const ev2 = apertarTab();
    expect(ev2.defaultPrevented).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Fechar");
  });

  it("foco perdido no <body> (o botão focado virou `disabled`) volta para dentro do modal no Tab", async () => {
    // Caminho REAL do "Enviando…": clicar em Enviar desabilita o botão, o navegador joga o foco
    // no `body`, e daí em diante o Tab não borbulha por card nenhum. Com o listener preso ao
    // card, o modal nem via essa tecla — o Tab passeava pela página atrás do modal.
    raiz = montar(
      <fieldset disabled>
        <input id="dentro-do-fieldset" />
      </fieldset>,
      <button type="button">Salvar</button>,
    );
    await aguardarFocoInicial();

    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    expect(document.activeElement).toBe(document.body);

    const ev = apertarTab();
    expect(ev.defaultPrevented, "Tab a partir do body tem de ser interceptado pelo modal do topo").toBe(true);
    expect(
      raiz.container.querySelector('[role="dialog"]')!.contains(document.activeElement),
      "o foco tem de voltar para dentro do modal",
    ).toBe(true);
  });

  it("REGRESSÃO: foco num elemento FORA do modal que não é o body (dropdown em portal) não é sequestrado", async () => {
    // Este repo renderiza dropdown ancorado em portal, fora da árvore do modal. Antes de o
    // listener virar global, um Tab ali nunca chegava ao modal — tem de continuar assim.
    const fora = document.createElement("button");
    fora.textContent = "Item do dropdown";
    document.body.appendChild(fora);
    try {
      raiz = montar(<input id="campo-ok" />, <button type="button">Salvar</button>);
      await aguardarFocoInicial();

      act(() => {
        fora.focus();
      });
      const ev = apertarTab();
      expect(ev.defaultPrevented, "o modal não pode roubar o Tab de um portal seu").toBe(false);
      expect(document.activeElement).toBe(fora);
    } finally {
      fora.remove();
    }
  });

  it("REGRESSÃO dos outros modais: elemento no MEIO do ciclo não é interceptado (o Tab do navegador segue normal)", async () => {
    raiz = montar(<input id="campo-meio" />, <button type="button">Salvar</button>);
    await aguardarFocoInicial();

    act(() => {
      raiz!.container.querySelector<HTMLInputElement>("#campo-meio")!.focus();
    });
    const ev = apertarTab();
    expect(ev.defaultPrevented, "no meio do ciclo o modal não pode interferir no Tab").toBe(false);
  });
});
