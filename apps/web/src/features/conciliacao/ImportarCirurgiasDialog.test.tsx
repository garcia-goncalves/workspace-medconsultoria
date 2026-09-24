import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import { trpc } from "../../lib/trpc";
import { ImportarCirurgiasDialog } from "./ImportarCirurgiasDialog";

/**
 * Item #14 da rodada de set/2026: mandar o arquivo errado (ex.: consultas, no importador de
 * cirurgias) mostrava um toast que some sozinho em ~5s e deixava o modal vazio, sem a dica de
 * para onde levar o arquivo que o servidor já manda (`dicaDeRota`). Agora a mensagem fica FIXA
 * dentro do modal.
 *
 * Mesmo arranjo de `ProcedimentosDialog.test.tsx`: sem Testing Library, link tRPC de mentira. O
 * upload em si passa por `/upload` via XMLHttpRequest (não tRPC) — aqui ele é substituído por um
 * XHR de mentira que "sobe" o arquivo na hora, para exercer o caminho real (escolher arquivo →
 * `previsualizarCirurgias` recusa → a tela mostra o motivo).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** XHR de mentira: "sobe" qualquer arquivo e responde com um `ArquivoEnviado` fixo. */
class FakeXHR {
  status = 200;
  responseText = JSON.stringify({ id: "arq-1", nome: "producao-consultas.csv", tamanho: 100 });
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  withCredentials = false;
  open() {}
  send() {
    queueMicrotask(() => this.onload?.());
  }
}

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
          <ImportarCirurgiasDialog clienteId="cli-1" clienteNome="Clínica Exemplo" open onClose={() => {}} onImportado={() => {}} />
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
}

function enviarArquivo(container: HTMLElement, nome: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const arquivo = new File(["conteudo"], nome, { type: "text/csv" });
  Object.defineProperty(input, "files", { value: [arquivo], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("ImportarCirurgiasDialog — arquivo do relatório errado", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
    vi.unstubAllGlobals();
  });

  it("mostra a dica de rota FIXA dentro do modal, não um toast que some", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    raiz = montar({
      "conciliacao.previsualizarCirurgias": () => {
        throw new Error(
          "Não reconheci este arquivo como o mapa cirúrgico do TASY. Pelo cabeçalho, este arquivo é o relatório de produção de " +
            "consultas. Importe-o em: Consultas → Importar produção.",
        );
      },
    });
    await aguardar();

    act(() => enviarArquivo(raiz!.container, "producao-consultas.csv"));
    await aguardar();
    await aguardar();

    const texto = raiz.container.textContent ?? "";
    expect(texto).toContain("Pelo cabeçalho, este arquivo é o relatório de produção de consultas");
    expect(texto).toContain("Consultas → Importar produção");

    // O modal continua com o cabeçalho e o rodapé — não "esvaziou".
    expect(texto).toContain("Importar cirurgias (TASY)");
    expect(raiz.container.querySelector("input")).not.toBeNull();
  });
});
