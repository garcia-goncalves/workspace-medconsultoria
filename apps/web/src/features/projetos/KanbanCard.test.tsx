import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { KanbanCard, type CardItem } from "./KanbanCard";

// Mesmo arranjo dos outros testes de componente do repositório (sem Testing Library):
// `createRoot` + `act`, lendo o DOM real por `querySelector`/`textContent`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE: CardItem = {
  id: "card-1",
  projetoId: "proj-1",
  titulo: "Cartão de teste",
  descricao: null,
  status: "A_FAZER",
  prioridade: "MEDIA",
  prazo: null,
  ordem: 0,
  responsavel: null,
  servico: null,
  checklist: [],
  tempoTotalSeg: 0,
  timerInicio: null,
};

function montar(card: CardItem) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<KanbanCard card={card} draggable={false} />);
  });
  return { root, container };
}

describe("KanbanCard — indicador do responsável", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  it("mostra as iniciais do responsável quando o cartão tem um", () => {
    raiz = montar({ ...BASE, responsavel: { nome: "Thaís Garcia" } });

    // O achado da auditoria: o dado já vem do servidor (CardItem.responsavel), e agora o
    // cartão o exibe — como iniciais no avatar, com o nome completo no title (tooltip) E
    // no aria-label (leitor de tela não anuncia `title` de forma confiável).
    const marcador = raiz.container.querySelector('[title="Responsável: Thaís Garcia"]');
    expect(marcador).not.toBeNull();
    expect(marcador?.getAttribute("aria-label")).toBe("Responsável: Thaís Garcia");
    expect(marcador?.textContent).toBe("T");
  });

  it("não mostra marcador nenhum quando o cartão está sem responsável", () => {
    raiz = montar({ ...BASE, responsavel: null });

    expect(raiz.container.querySelector('[title^="Responsável:"]')).toBeNull();
  });
});

describe("KanbanCard — título comprido não estoura o card", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  // Achado da auditoria: sem `min-w-0` no item flex que encolhe, um título sem espaços
  // (nome comprido de tarefa/serviço) força a largura do card fixo (`w-72`) a estourar —
  // `truncate` sozinho não basta dentro de um item flex, que por padrão não encolhe.
  it("o título tem min-w-0 e truncate para encolher dentro do card", () => {
    raiz = montar({ ...BASE, titulo: "TítuloBemCompridoSemEspaçosQueEstouraOCardDeLarguraFixa" });

    const titulo = raiz.container.querySelector(".font-medium");
    expect(titulo?.textContent).toBe("TítuloBemCompridoSemEspaçosQueEstouraOCardDeLarguraFixa");
    expect(titulo?.className).toContain("min-w-0");
    expect(titulo?.className).toContain("truncate");
  });
});
