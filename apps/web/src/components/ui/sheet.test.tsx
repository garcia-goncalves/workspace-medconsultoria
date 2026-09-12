import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Sheet } from "./sheet";

// Sem Testing Library neste repo (ver `modal.test.tsx`): montamos com `react-dom/client` + `act`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom não implementa `matchMedia` — precisa de um stub, como o `offsetParent` do modal.test.tsx. */
function stubMatchMedia(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

// Mesmo stub do modal.test.tsx: sem layout no jsdom, `offsetParent` é sempre null.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
  stubMatchMedia(false);
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

describe("Sheet", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) desmontar(raiz.root, raiz.container);
    // O Sheet renderiza em portal direto no document.body — limpa o que sobrar entre os testes.
    document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
    raiz = null;
  });

  it("fechado, não renderiza nada (nem no portal)", () => {
    raiz = montar(
      <Sheet open={false} onClose={vi.fn()} title="Painel">
        conteúdo
      </Sheet>,
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("aberto, desenha role=dialog com aria-modal e o título", async () => {
    raiz = montar(
      <Sheet open onClose={vi.fn()} title="Convidar pessoa">
        conteúdo
      </Sheet>,
    );
    await aguardarFocoInicial();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
    expect(dialog!.textContent).toContain("Convidar pessoa");
  });

  it("Esc chama onClose", async () => {
    const onClose = vi.fn();
    raiz = montar(
      <Sheet open onClose={onClose} title="Painel">
        conteúdo
      </Sheet>,
    );
    await aguardarFocoInicial();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clique no fundo (fora do painel) chama onClose; clique DENTRO do painel não chama", async () => {
    const onClose = vi.fn();
    raiz = montar(
      <Sheet open onClose={onClose} title="Painel">
        <button type="button">Ação</button>
      </Sheet>,
    );
    await aguardarFocoInicial();

    const fundo = document.querySelector('[role="dialog"]')!.parentElement!;
    act(() => {
      // Dispatch DIRETO no fundo: o `target` nativo é o próprio fundo, satisfazendo
      // `e.target === e.currentTarget` — o mesmo teste que o Modal já faz.
      fundo.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    const botao = document.querySelector("button[type=button]")!;
    act(() => {
      botao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("botão 'Fechar' chama onClose", async () => {
    const onClose = vi.fn();
    raiz = montar(
      <Sheet open onClose={onClose} title="Painel">
        conteúdo
      </Sheet>,
    );
    await aguardarFocoInicial();
    const fechar = document.querySelector('[aria-label="Fechar"]') as HTMLButtonElement;
    act(() => {
      fechar.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("no desktop (matchMedia não-mobile) o padrão de `lado` é 'direita'", async () => {
    stubMatchMedia(false);
    raiz = montar(
      <Sheet open onClose={vi.fn()} title="Painel">
        conteúdo
      </Sheet>,
    );
    await aguardarFocoInicial();
    const painel = document.querySelector('[role="dialog"]')!;
    expect(painel.className).toContain("right-0");
  });

  it("no celular (matchMedia mobile) o padrão de `lado` vira 'baixo'", async () => {
    stubMatchMedia(true);
    raiz = montar(
      <Sheet open onClose={vi.fn()} title="Painel">
        conteúdo
      </Sheet>,
    );
    await aguardarFocoInicial();
    const painel = document.querySelector('[role="dialog"]')!;
    expect(painel.className).toContain("bottom-0");
    stubMatchMedia(false);
  });

  it("`lado` explícito vence o padrão do celular", async () => {
    stubMatchMedia(true);
    raiz = montar(
      <Sheet open onClose={vi.fn()} title="Painel" lado="esquerda">
        conteúdo
      </Sheet>,
    );
    await aguardarFocoInicial();
    const painel = document.querySelector('[role="dialog"]')!;
    expect(painel.className).toContain("left-0");
    stubMatchMedia(false);
  });

  it("fechar devolve o foco a quem abriu o Sheet", async () => {
    function Tela() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button id="abrir" onClick={() => setOpen(true)}>
            Abrir
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Painel">
            conteúdo
          </Sheet>
        </div>
      );
    }

    raiz = montar(<Tela />);
    const abrir = raiz.container.querySelector<HTMLButtonElement>("#abrir")!;
    act(() => {
      abrir.focus();
    });
    act(() => {
      abrir.click();
    });
    await aguardarFocoInicial();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(abrir);
  });
});
