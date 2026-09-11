import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import { trpc } from "../../lib/trpc";
import { AssinarPage } from "./AssinarPage";

// Mesmo arranjo de `EmailsDoClienteCard.test.tsx`: sem Testing Library, com um link tRPC de
// mentira que responde de um mapa por `op.path`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom não implementa ResizeObserver — o DocumentoBranded usa um para o "zoom" que encolhe a
// folha A4 no container. Sem ele o efeito de layout do componente lança em runtime.
class ResizeObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverFalso;

type Handler = (input: unknown) => unknown | Promise<unknown>;

function linkMock(handlers: Record<string, Handler>): TRPCLink<AnyTRPCRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const handler = handlers[op.path];
        if (!handler) {
          observer.error(TRPCClientError.from(new Error(`sem handler mockado para "${op.path}"`)));
          return;
        }
        Promise.resolve()
          .then(() => handler(op.input))
          .then((data) => {
            observer.next({ result: { type: "data", data } });
            observer.complete();
          })
          .catch((erro) => {
            observer.error(TRPCClientError.from(erro instanceof Error ? erro : new Error(String(erro))));
          });
        return () => {};
      });
}

const RESPOSTA_POR_TOKEN = {
  status: "PENDENTE",
  conteudoAlterado: false,
  signatario: { nome: "Dra. Helena" },
  documento: {
    titulo: "Contrato de prestação de serviços",
    // Negrito, título e item de lista — os três precisam virar HTML, não texto cru.
    conteudo: "# Cláusula 1\n\n**Objeto:** prestação de serviços.\n\n- Item um\n- Item dois",
  },
  todas: [{ nome: "Dra. Helena", papel: "CLIENTE", status: "PENDENTE", assinadoEm: null }],
};

function montar(handlers: Record<string, Handler>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({ links: [linkMock(handlers) as never] });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <AssinarPage token="tok-123" />
        </QueryClientProvider>
      </trpc.Provider>,
    );
  });
  return { root, container };
}

async function aguardar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  // A paginação do DocumentoBranded roda num useLayoutEffect que mede o DOM — mais uma volta
  // do loop garante que o HTML paginado (não só o fallback) já foi montado.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("AssinarPage — o documento aparece renderizado, não como Markdown cru", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  it("negrito, título e lista viram HTML (DocumentoBranded), nunca os caracteres de Markdown", async () => {
    raiz = montar({ "assinaturas.porToken": () => RESPOSTA_POR_TOKEN });
    await aguardar();

    // Achado da auditoria: a página mostrava o Markdown CRU (com ** e # literais).
    const textoCompleto = raiz.container.textContent ?? "";
    expect(textoCompleto).not.toContain("**Objeto:**");
    expect(textoCompleto).not.toContain("# Cláusula 1");

    // Em vez disso, o corpo renderizado (dentro do `.doc-body` do DocumentoBranded) tem as
    // tags reais — é o MESMO renderizador central, não um segundo motor.
    const corpo = raiz.container.querySelector(".doc-body");
    expect(corpo).not.toBeNull();
    expect(corpo!.querySelector("strong")?.textContent).toContain("Objeto:");
    expect(corpo!.querySelector("h1")?.textContent).toContain("Cláusula 1");
    expect(corpo!.querySelectorAll("li").length).toBeGreaterThanOrEqual(2);
  });
});
