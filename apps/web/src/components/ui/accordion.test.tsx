import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion";

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

function DuasSeções({ modo = "unica" as "unica" | "multipla" }) {
  return (
    <Accordion modo={modo} defaultValue={["um"]}>
      <AccordionItem value="um">
        <AccordionTrigger>Dados jurídicos</AccordionTrigger>
        <AccordionContent>
          Conteúdo 1<button type="button">Editar</button>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="dois">
        <AccordionTrigger>Dados bancários</AccordionTrigger>
        <AccordionContent>Conteúdo 2</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

describe("Accordion", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) desmontar(raiz.root, raiz.container);
    raiz = null;
  });

  it("cabeçalho: aria-expanded reflete o estado e aria-controls aponta para o painel certo", () => {
    raiz = montar(<DuasSeções />);
    const cabecalhos = [...raiz.container.querySelectorAll('button[aria-expanded]')];
    expect(cabecalhos[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(cabecalhos[1]!.getAttribute("aria-expanded")).toBe("false");

    const painelId = cabecalhos[0]!.getAttribute("aria-controls")!;
    // `useId()` gera ids com `:` (ex.: `:r0:-painel`), inválido em seletor CSS — usa getElementById.
    const painel = document.getElementById(painelId)!;
    expect(painel.getAttribute("role")).toBe("region");
    expect(painel.getAttribute("aria-labelledby")).toBe(cabecalhos[0]!.id);
  });

  it("modo 'unica': abrir a 2ª seção fecha a 1ª automaticamente", () => {
    raiz = montar(<DuasSeções modo="unica" />);
    const cabecalhos = [...raiz.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
    act(() => {
      cabecalhos[1]!.click();
    });
    expect(cabecalhos[0]!.getAttribute("aria-expanded")).toBe("false");
    expect(cabecalhos[1]!.getAttribute("aria-expanded")).toBe("true");
  });

  it("modo 'multipla': abrir a 2ª seção MANTÉM a 1ª aberta", () => {
    raiz = montar(<DuasSeções modo="multipla" />);
    const cabecalhos = [...raiz.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
    act(() => {
      cabecalhos[1]!.click();
    });
    expect(cabecalhos[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(cabecalhos[1]!.getAttribute("aria-expanded")).toBe("true");
  });

  it("clicar num cabeçalho aberto FECHA a própria seção (alterna)", () => {
    raiz = montar(<DuasSeções />);
    const primeiroCabecalho = raiz.container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(primeiroCabecalho.getAttribute("aria-expanded")).toBe("true");
    act(() => {
      primeiroCabecalho.click();
    });
    expect(primeiroCabecalho.getAttribute("aria-expanded")).toBe("false");
  });

  it("seção fechada fica com `inert` (fora do Tab e da leitura de tela); aberta, não", () => {
    raiz = montar(<DuasSeções />);
    const cabecalhos = [...raiz.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
    const painelAberto = document.getElementById(cabecalhos[0]!.getAttribute("aria-controls")!)!;
    const painelFechado = document.getElementById(cabecalhos[1]!.getAttribute("aria-controls")!)!;

    expect(painelAberto.hasAttribute("inert")).toBe(false);
    expect(painelFechado.hasAttribute("inert")).toBe(true);

    act(() => {
      cabecalhos[1]!.click();
    });
    expect(painelFechado.hasAttribute("inert")).toBe(false);
  });

  it("o chevron gira (rotate-180) quando a seção está aberta", () => {
    raiz = montar(<DuasSeções />);
    const cabecalhos = [...raiz.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
    const chevronAberto = cabecalhos[0]!.querySelector("svg")!;
    const chevronFechado = cabecalhos[1]!.querySelector("svg")!;
    expect(chevronAberto.getAttribute("class")).toContain("rotate-180");
    expect(chevronFechado.getAttribute("class")).not.toContain("rotate-180");
  });

  it("controlado: onValueChange é chamado com a lista nova; o estado só muda se o pai atualizar `value`", () => {
    const onValueChange = vi.fn();
    raiz = montar(
      <Accordion modo="unica" value={["um"]} onValueChange={onValueChange}>
        <AccordionItem value="um">
          <AccordionTrigger>A</AccordionTrigger>
          <AccordionContent>Conteúdo A</AccordionContent>
        </AccordionItem>
        <AccordionItem value="dois">
          <AccordionTrigger>B</AccordionTrigger>
          <AccordionContent>Conteúdo B</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    const cabecalhos = [...raiz.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
    act(() => {
      cabecalhos[1]!.click();
    });
    expect(onValueChange).toHaveBeenCalledWith(["dois"]);
    // Sem o pai atualizar `value`, o estado externo (aria-expanded) não muda sozinho.
    expect(cabecalhos[0]!.getAttribute("aria-expanded")).toBe("true");
  });
});
