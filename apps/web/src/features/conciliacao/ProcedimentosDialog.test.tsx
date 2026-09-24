import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import { trpc } from "../../lib/trpc";
import { DialogsProvider } from "../../components/ui/confirm-dialog";
import { ProcedimentosDialog } from "./ProcedimentosDialog";

/**
 * Item #2 da rodada de set/2026: apagar ou mudar o valor de um procedimento já usado por
 * cirurgias mudava o "cobrado" delas na hora, sem ninguém confirmar nada. Criar um valor novo
 * onde não havia nenhum continua sem confirmar — é a exceção deliberada.
 *
 * Mesmo arranjo de `ServicosPage.test.tsx`/`EmailsDoClienteCard.test.tsx`: sem Testing Library,
 * link tRPC de mentira respondendo por `op.path`, `DialogsProvider` de verdade (é ele quem
 * desenha o modal de confirmação).
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
            <ProcedimentosDialog clienteId="cli-1" onClose={() => {}} onSalvo={() => {}} />
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

function clicar(el: Element) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("ProcedimentosDialog — confirmação ao apagar/mudar valor já usado por cirurgias", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  it("apagar o valor pede confirmação dizendo QUANTAS cirurgias ficam sem valor, e só grava se confirmar", async () => {
    let ultimoInput: Record<string, unknown> | null = null;
    raiz = montar({
      "documentos.operadoras.list": () => [],
      "conciliacao.procedimentos": () => [
        { procedimento: "Artroplastia de quadril", cirurgias: 8, padrao: { codigo: "300100", valor: 250 }, porOperadora: [] },
      ],
      "conciliacao.salvarProcedimento": (input) => {
        ultimoInput = input as Record<string, unknown>;
        return { ok: true, removido: true };
      },
    });
    await aguardar();
    await aguardar();

    const valorInput = raiz.container.querySelector<HTMLInputElement>('[aria-label="Valor — Padrão"]')!;
    expect(valorInput.value).toContain("250,00");
    act(() => digitar(valorInput, ""));

    const salvarBtn = [...raiz.container.querySelectorAll("button")].find((b) => b.textContent === "Salvar")!;
    expect(salvarBtn.disabled).toBe(false);
    act(() => clicar(salvarBtn));

    // O diálogo de confirmação abriu, com a contagem certa — nada foi gravado ainda.
    const texto = raiz.container.textContent ?? "";
    expect(texto).toContain('Remover o valor padrão de "');
    expect(texto).toContain("8 cirurgias vão ficar sem valor de referência");
    expect(ultimoInput).toBeNull();

    const removerBtn = [...raiz.container.querySelectorAll("button")].find((b) => b.textContent === "Remover")!;
    act(() => clicar(removerBtn));
    await aguardar();

    expect(ultimoInput).not.toBeNull();
    expect(ultimoInput!.valor).toBeNull();
  });

  it("cancelar a confirmação NÃO grava nada", async () => {
    let chamado = false;
    raiz = montar({
      "documentos.operadoras.list": () => [],
      "conciliacao.procedimentos": () => [
        { procedimento: "Artroplastia de quadril", cirurgias: 3, padrao: { codigo: null, valor: 250 }, porOperadora: [] },
      ],
      "conciliacao.salvarProcedimento": () => {
        chamado = true;
        return { ok: true, removido: false };
      },
    });
    await aguardar();
    await aguardar();

    const valorInput = raiz.container.querySelector<HTMLInputElement>('[aria-label="Valor — Padrão"]')!;
    act(() => digitar(valorInput, "30000"));

    const salvarBtn = [...raiz.container.querySelectorAll("button")].find((b) => b.textContent === "Salvar")!;
    act(() => clicar(salvarBtn));

    expect(raiz.container.textContent).toContain('Mudar o valor padrão de "');
    const cancelarBtn = [...raiz.container.querySelectorAll("button")].find((b) => b.textContent === "Cancelar")!;
    act(() => clicar(cancelarBtn));
    await aguardar();

    expect(chamado).toBe(false);
  });

  it("criar um valor onde não havia nenhum NÃO pede confirmação", async () => {
    let ultimoInput: Record<string, unknown> | null = null;
    raiz = montar({
      "documentos.operadoras.list": () => [],
      "conciliacao.procedimentos": () => [
        { procedimento: "Artroscopia de joelho", cirurgias: 5, padrao: null, porOperadora: [] },
      ],
      "conciliacao.salvarProcedimento": (input) => {
        ultimoInput = input as Record<string, unknown>;
        return { ok: true, removido: false };
      },
    });
    await aguardar();
    await aguardar();

    const valorInput = raiz.container.querySelector<HTMLInputElement>('[aria-label="Valor — Padrão"]')!;
    act(() => digitar(valorInput, "10000"));

    const salvarBtn = [...raiz.container.querySelectorAll("button")].find((b) => b.textContent === "Salvar")!;
    act(() => clicar(salvarBtn));
    await aguardar();

    // Sem confirmação nenhuma no meio do caminho — grava direto.
    expect(raiz.container.textContent).not.toContain("Mudar o valor");
    expect(raiz.container.textContent).not.toContain("Remover o valor");
    expect(ultimoInput).not.toBeNull();
    expect(ultimoInput!.valor).toBe(100);
  });

  it("a contagem da confirmação do valor PADRÃO desconta as cirurgias que já têm valor por convênio", async () => {
    raiz = montar({
      "documentos.operadoras.list": () => [{ id: "op-1", nome: "Unimed" }],
      "conciliacao.procedimentos": () => [
        {
          procedimento: "Colecistectomia",
          cirurgias: 10,
          padrao: { codigo: "400200", valor: 300 },
          porOperadora: [{ operadoraId: "op-1", operadora: "Unimed", codigo: "400200", valor: 500, cirurgias: 4 }],
        },
      ],
      "conciliacao.salvarProcedimento": () => ({ ok: true, removido: true }),
    });
    await aguardar();
    await aguardar();

    const valorInput = raiz.container.querySelector<HTMLInputElement>('[aria-label="Valor — Padrão"]')!;
    act(() => digitar(valorInput, ""));
    const salvarBtn = [...raiz.container.querySelectorAll("button")].find((b) => b.textContent === "Salvar")!;
    act(() => clicar(salvarBtn));

    // 10 no total, 4 já cobertas pela Unimed — sobram 6 usando o padrão.
    expect(raiz.container.textContent).toContain("6 cirurgias vão ficar sem valor de referência");
  });
});
