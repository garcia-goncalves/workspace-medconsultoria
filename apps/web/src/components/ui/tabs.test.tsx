import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

// Sem Testing Library neste repo (ver `modal.test.tsx`): montamos com `react-dom/client` + `act`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function apertarTecla(alvo: Element, key: string): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => {
    alvo.dispatchEvent(ev);
  });
  return ev;
}

function TrêsAbas({ onValueChange, value }: { onValueChange?: (v: string) => void; value?: string }) {
  return (
    <Tabs value={value} defaultValue={value === undefined ? "a" : undefined} onValueChange={onValueChange}>
      <TabsList aria-label="Seções">
        <TabsTrigger value="a">Documentos</TabsTrigger>
        <TabsTrigger value="b" contador={12}>
          Convênios
        </TabsTrigger>
        <TabsTrigger value="c">Suporte</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Conteúdo A</TabsContent>
      <TabsContent value="b">Conteúdo B</TabsContent>
      <TabsContent value="c">Conteúdo C</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) desmontar(raiz.root, raiz.container);
    raiz = null;
  });

  it("não-controlado: abre no `defaultValue` e o painel correspondente é o único no DOM", () => {
    raiz = montar(<TrêsAbas />);
    expect(raiz.container.textContent).toContain("Conteúdo A");
    expect(raiz.container.textContent).not.toContain("Conteúdo B");

    const tabs = [...raiz.container.querySelectorAll('[role="tab"]')];
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("false");
  });

  it("clicar numa aba troca o painel ativo e o `aria-selected`", () => {
    raiz = montar(<TrêsAbas />);
    const tabB = [...raiz.container.querySelectorAll('[role="tab"]')][1] as HTMLButtonElement;
    act(() => {
      tabB.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(raiz.container.textContent).toContain("Conteúdo B");
    expect(raiz.container.textContent).not.toContain("Conteúdo A");
    expect(tabB.getAttribute("aria-selected")).toBe("true");
  });

  it("contador aparece ao lado do rótulo da aba", () => {
    raiz = montar(<TrêsAbas />);
    const tabB = [...raiz.container.querySelectorAll('[role="tab"]')][1]!;
    expect(tabB.textContent).toContain("Convênios");
    expect(tabB.textContent).toContain("12");
  });

  it("ArrowRight move o FOCO para a próxima aba sem selecioná-la (ativação manual)", () => {
    raiz = montar(<TrêsAbas />);
    const [tabA, tabB] = [...raiz.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    act(() => {
      tabA!.focus();
    });
    const ev = apertarTecla(tabA!, "ArrowRight");
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tabB);
    // O foco moveu, mas a SELEÇÃO (e o painel visível) continuam na aba A — mover com a seta
    // não ativa; quem ativa é Enter/Espaço/clique (o <button> nativo já cuida disso).
    expect(raiz.container.textContent).toContain("Conteúdo A");
    expect(tabA!.getAttribute("aria-selected")).toBe("true");
  });

  it("ArrowLeft na primeira aba RODA para a última (wrap-around)", () => {
    raiz = montar(<TrêsAbas />);
    const abas = [...raiz.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    act(() => {
      abas[0]!.focus();
    });
    apertarTecla(abas[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(abas[abas.length - 1]);
  });

  it("Home e End vão para a 1ª e a última aba", () => {
    raiz = montar(<TrêsAbas />);
    const abas = [...raiz.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    act(() => {
      abas[1]!.focus();
    });
    apertarTecla(abas[1]!, "End");
    expect(document.activeElement).toBe(abas[abas.length - 1]);
    apertarTecla(abas[abas.length - 1]!, "Home");
    expect(document.activeElement).toBe(abas[0]);
  });

  it("controlado: o valor só muda quando o pai atualiza `value` a partir de `onValueChange`", () => {
    const onValueChange = vi.fn();

    function Pai() {
      const [valor, setValor] = useState("a");
      return (
        <TrêsAbas
          value={valor}
          onValueChange={(v) => {
            onValueChange(v);
            setValor(v);
          }}
        />
      );
    }
    raiz = montar(<Pai />);
    const tabC = [...raiz.container.querySelectorAll('[role="tab"]')][2] as HTMLButtonElement;
    act(() => {
      tabC.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onValueChange).toHaveBeenCalledWith("c");
    expect(raiz.container.textContent).toContain("Conteúdo C");
  });
});
