import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BotaoIA, IA_DESLIGADA } from "./BotaoIA";

// Sem Testing Library neste repo (ver `components/ui/modal.test.tsx`): montamos com
// `react-dom/client` + `act` puros.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: { root: Root; container: HTMLDivElement } | null = null;

function montar(iaDisponivel: boolean | undefined, extra?: Partial<Parameters<typeof BotaoIA>[0]>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onClick = extra?.onClick ?? vi.fn();
  act(() => {
    root.render(
      <BotaoIA iaDisponivel={iaDisponivel} pendente={false} onClick={onClick} {...extra}>
        Fazer com IA
      </BotaoIA>,
    );
  });
  raiz = { root, container };
  return { container, onClick };
}

afterEach(() => {
  if (raiz) {
    act(() => raiz!.root.unmount());
    raiz.container.remove();
  }
  raiz = null;
});

function botao(container: HTMLElement): HTMLButtonElement {
  const b = container.querySelector("button");
  if (!b) throw new Error("botão não encontrado");
  return b;
}

describe("BotaoIA — nunca some, mesmo com a IA fora do ar (ADR-156)", () => {
  it("com a IA disponível: botão habilitado, sem explicação visível", () => {
    const { container } = montar(true);
    const b = botao(container);
    expect(b.disabled).toBe(false);
    expect(container.textContent).not.toContain(IA_DESLIGADA);
  });

  it("com a IA indisponível: o botão CONTINUA no DOM, desabilitado, com a explicação em TEXTO VISÍVEL — não só no title", () => {
    const { container } = montar(false);
    const b = botao(container);
    expect(b).toBeTruthy();
    expect(b.disabled).toBe(true);
    // A explicação precisa estar no texto renderizado (leitor de tela lê), não só no `title`
    // (que muitos leitores de tela ignoram).
    expect(container.textContent).toContain(IA_DESLIGADA);
    expect(b.title).toBe(IA_DESLIGADA);
  });

  it("enquanto ainda não se sabe se a IA está ligada (`undefined`): desabilitado, com aviso de verificação — não a frase de desligado", () => {
    const { container } = montar(undefined);
    const b = botao(container);
    expect(b.disabled).toBe(true);
    expect(container.textContent).not.toContain(IA_DESLIGADA);
    expect(container.textContent).toContain("Verificando se a IA está ligada");
  });

  it("clicar dispara o `onClick` quando a IA está disponível", () => {
    const onClick = vi.fn();
    const { container } = montar(true, { onClick });
    act(() => botao(container).click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("`pendente` mostra o estado de carregamento e desabilita, mesmo com a IA disponível", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <BotaoIA iaDisponivel={true} pendente={true} onClick={vi.fn()}>
          Fazer com IA
        </BotaoIA>,
      );
    });
    raiz = { root, container };
    expect(botao(container).disabled).toBe(true);
  });

  it("`ocupado` (outra chamada de IA em andamento) desabilita mesmo com a IA disponível e sem estar pendente", () => {
    const { container } = montar(true, { ocupado: true });
    expect(botao(container).disabled).toBe(true);
  });
});
