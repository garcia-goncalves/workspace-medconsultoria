import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import { trpc } from "../../../lib/trpc";
import { DialogsProvider } from "../../../components/ui/confirm-dialog";
import { ServicosPage } from "./ServicosPage";

/**
 * Achado da auditoria de 04/09/2026: o formulário "Novo serviço" não expunha a caixa
 * "Este é o serviço de credenciamento" — só a edição tinha. Este teste cobre a CRIAÇÃO pela
 * tela, ponta a ponta: marcar a caixa no "Novo serviço" chega ao `servicos.criar` com
 * `ehCredenciamento: true`, e a mensagem de recusa (mesma trava da edição) aparece na tela
 * quando o servidor recusa por já haver outro marcado.
 *
 * Mesmo arranjo de `AssinarPage.test.tsx`/`EmailPage.test.tsx`: sem Testing Library, com um
 * link tRPC de mentira que responde de um mapa por `op.path`.
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
          <DialogsProvider>
            <ServicosPage />
          </DialogsProvider>
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

function digitar(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Novo serviço — a caixa de credenciamento aparece já na CRIAÇÃO", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  it("marcar a caixa no formulário de criação envia ehCredenciamento: true", async () => {
    let ultimoInput: Record<string, unknown> | null = null;
    raiz = montar({
      "servicos.list": () => [],
      "servicos.criar": (input) => {
        ultimoInput = input as Record<string, unknown>;
        return { id: "s-novo", ehCredenciamento: true };
      },
    });
    await aguardar();

    const botaoNovo = Array.from(raiz.container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Novo serviço"),
    )!;
    act(() => botaoNovo.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await aguardar();

    const nomeInput = raiz.container.querySelector<HTMLInputElement>("#s-nome")!;
    expect(nomeInput).not.toBeNull();
    act(() => digitar(nomeInput, "Credenciamento médico e odontológico"));

    // A caixa "Este é o serviço de credenciamento" — achado: faltava aqui, no diálogo de criação.
    const rotuloCredenciamento = Array.from(raiz.container.querySelectorAll("span")).find((s) =>
      s.textContent === "Este é o serviço de credenciamento",
    )!;
    expect(rotuloCredenciamento).not.toBeUndefined();
    const checkbox = rotuloCredenciamento.closest("label")!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    act(() => checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await aguardar();
    expect(checkbox.checked).toBe(true);

    const form = raiz.container.querySelector<HTMLFormElement>("#novo-servico-form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(ultimoInput).not.toBeNull();
    expect(ultimoInput!.ehCredenciamento).toBe(true);
  });

  it("recusa da criação (segundo serviço já marcado) aparece na tela com mensagem clara", async () => {
    raiz = montar({
      "servicos.list": () => [],
      "servicos.criar": () => {
        throw new Error(
          'O serviço "Faturamento" já está marcado como o credenciamento, e só pode haver um. Desmarque-o antes.',
        );
      },
    });
    await aguardar();

    const botaoNovo = Array.from(raiz.container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Novo serviço"),
    )!;
    act(() => botaoNovo.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await aguardar();

    const nomeInput = raiz.container.querySelector<HTMLInputElement>("#s-nome")!;
    act(() => digitar(nomeInput, "Outro serviço"));

    const rotuloCredenciamento = Array.from(raiz.container.querySelectorAll("span")).find((s) =>
      s.textContent === "Este é o serviço de credenciamento",
    )!;
    const checkbox = rotuloCredenciamento.closest("label")!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const form = raiz.container.querySelector<HTMLFormElement>("#novo-servico-form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(raiz.container.textContent).toContain("já está marcado como o credenciamento");
  });
});
