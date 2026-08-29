import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Popover } from "./popover";

// Sem Testing Library neste repo (ver `modal.test.tsx`): montamos com `react-dom/client` + `act`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});

function montar(children: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(children);
  });
  return { root, container };
}

function desmontar(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

async function aguardarFocoInicial() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function PopoverDeTeste() {
  return (
    <Popover
      trigger={(p) => (
        <button id="gatilho" type="button" {...p}>
          Filtros
        </button>
      )}
      ariaLabel="Filtros"
    >
      <button id="dentro" type="button">
        Aplicar
      </button>
    </Popover>
  );
}

describe("Popover", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) desmontar(raiz.root, raiz.container);
    document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
    raiz = null;
  });

  it("fechado por padrão: gatilho com aria-expanded=false e nenhum balão no DOM", () => {
    raiz = montar(<PopoverDeTeste />);
    const gatilho = raiz.container.querySelector("#gatilho")!;
    expect(gatilho.getAttribute("aria-expanded")).toBe("false");
    expect(gatilho.getAttribute("aria-haspopup")).toBe("dialog");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("clicar no gatilho abre o balão, aria-expanda=true e o foco entra nele", async () => {
    raiz = montar(<PopoverDeTeste />);
    const gatilho = raiz.container.querySelector<HTMLButtonElement>("#gatilho")!;
    act(() => {
      gatilho.click();
    });
    await aguardarFocoInicial();

    expect(gatilho.getAttribute("aria-expanded")).toBe("true");
    const balao = document.querySelector('[role="dialog"]');
    expect(balao).not.toBeNull();
    expect(balao!.getAttribute("aria-label")).toBe("Filtros");
    // Foco inicial vai para o 1º focável do balão (o botão "Aplicar").
    expect(document.activeElement?.id).toBe("dentro");
  });

  it("clicar de novo no gatilho fecha o balão", async () => {
    raiz = montar(<PopoverDeTeste />);
    const gatilho = raiz.container.querySelector<HTMLButtonElement>("#gatilho")!;
    act(() => {
      gatilho.click();
    });
    await aguardarFocoInicial();
    act(() => {
      gatilho.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("Esc fecha o balão e devolve o foco ao gatilho", async () => {
    raiz = montar(<PopoverDeTeste />);
    const gatilho = raiz.container.querySelector<HTMLButtonElement>("#gatilho")!;
    act(() => {
      gatilho.focus();
      gatilho.click();
    });
    await aguardarFocoInicial();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(gatilho);
  });

  it("clique FORA (nem gatilho nem balão) fecha; clique DENTRO do balão não fecha", async () => {
    raiz = montar(<PopoverDeTeste />);
    const gatilho = raiz.container.querySelector<HTMLButtonElement>("#gatilho")!;
    act(() => {
      gatilho.click();
    });
    await aguardarFocoInicial();

    const dentro = document.querySelector<HTMLButtonElement>("#dentro")!;
    act(() => {
      dentro.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    const foraDoTudo = document.createElement("div");
    document.body.appendChild(foraDoTudo);
    act(() => {
      foraDoTudo.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    foraDoTudo.remove();
  });

  it("modo controlado (`open`/`onOpenChange`): o Popover não decide sozinho", async () => {
    const onOpenChange = vi.fn();

    function Controlado() {
      return (
        <Popover open onOpenChange={onOpenChange} trigger={(p) => <button {...p}>Filtros</button>}>
          conteúdo
        </Popover>
      );
    }
    raiz = montar(<Controlado />);
    await aguardarFocoInicial();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Controlado: continua aberto até o pai atualizar `open` (que não mudou aqui).
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
