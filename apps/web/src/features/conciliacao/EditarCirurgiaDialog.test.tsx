import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import { trpc } from "../../lib/trpc";
import { EditarCirurgiaDialog, type CirurgiaConciliada } from "./EditarCirurgiaDialog";

/**
 * Item #13 da rodada de set/2026: com a competência fechada, este diálogo abria editável e só
 * reclamava no Salvar (o servidor recusa, `assertCompetenciaAberta`) — a pessoa preenchia tudo de
 * novo para descobrir no fim que o mês está fechado. Agora ele busca sozinho se o mês da cirurgia
 * está fechado e abre SÓ LEITURA quando estiver.
 *
 * Mesmo arranjo de `EmailsDoClienteCard.test.tsx`/`ProcedimentosDialog.test.tsx`: sem Testing
 * Library, link tRPC de mentira respondendo por `op.path`.
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

const CIRURGIA: CirurgiaConciliada = {
  id: "cir-1",
  numeroCirurgia: "12345",
  atendimento: "98765",
  dataCirurgia: "2026-05-10",
  competencia: "2026-05",
  pacienteNome: "Paciente Exemplo",
  procedimento: "Artroplastia de quadril",
  convenioBruto: "Unimed",
  statusBruto: "Executada",
  autorizacaoBruto: "Autorizada",
  codigo: "300100",
  cobrado: 250,
  cobradoOrigem: "DE_PARA",
  recebido: null,
  recebidoOrigem: null,
  repasseCompartilhado: false,
  dataPagamento: null,
  glosa: null,
  statusConciliacao: "A_RECEBER",
  recurso: null,
  naoCobrar: false,
  observacao: null,
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
          <EditarCirurgiaDialog clienteId="cli-1" cirurgia={CIRURGIA} onClose={() => {}} onSalvo={() => {}} />
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

describe("EditarCirurgiaDialog — só leitura quando o mês está fechado", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  it("mês aberto: os campos continuam editáveis e o Salvar fica habilitado", async () => {
    raiz = montar({ "conciliacao.competenciasFechadas": () => [] });
    await aguardar();
    await aguardar();

    expect(raiz.container.textContent).not.toContain("está fechado");
    expect(raiz.container.querySelector<HTMLInputElement>("#ec-codigo")!.disabled).toBe(false);
    expect(raiz.container.querySelector<HTMLInputElement>("#ec-cobrado")!.disabled).toBe(false);
    const salvarBtn = [...raiz.container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Salvar"))!;
    expect(salvarBtn.disabled).toBe(false);
  });

  it("mês fechado: abre em modo leitura, com a explicação e todos os campos desabilitados", async () => {
    raiz = montar({
      "conciliacao.competenciasFechadas": () => [
        {
          competencia: "2026-05",
          fechadoEm: "2026-06-01T12:00:00.000Z",
          fechadoPor: "Thaís",
          observacao: null,
          retrato: { cobrado: 0, recebido: 0, glosa: 0, aReceber: 0, cirurgias: 0 },
          agora: { cobrado: 0, recebido: 0, glosa: 0, aReceber: 0, cirurgias: 0 },
          divergiu: false,
        },
      ],
    });
    await aguardar();
    await aguardar();

    const texto = raiz.container.textContent ?? "";
    expect(texto).toContain("2026-05 está fechado");
    expect(texto).toContain("conferido por Thaís");
    expect(texto).toContain("Só um administrador pode reabrir o mês");

    expect(raiz.container.querySelector<HTMLInputElement>("#ec-codigo")!.disabled).toBe(true);
    expect(raiz.container.querySelector<HTMLInputElement>("#ec-cobrado")!.disabled).toBe(true);
    expect(raiz.container.querySelector<HTMLInputElement>("#ec-recebido")!.disabled).toBe(true);
    expect(raiz.container.querySelector<HTMLInputElement>("#ec-data")!.disabled).toBe(true);
    expect(raiz.container.querySelector<HTMLInputElement>("#ec-obs")).toHaveProperty("disabled", true);
    expect(raiz.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);

    const salvarBtn = [...raiz.container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Salvar"))!;
    expect(salvarBtn.disabled).toBe(true);
  });

  it("competência de OUTRO mês fechada não trava esta cirurgia", async () => {
    raiz = montar({
      "conciliacao.competenciasFechadas": () => [
        {
          competencia: "2026-04",
          fechadoEm: "2026-05-01T12:00:00.000Z",
          fechadoPor: null,
          observacao: null,
          retrato: { cobrado: 0, recebido: 0, glosa: 0, aReceber: 0, cirurgias: 0 },
          agora: { cobrado: 0, recebido: 0, glosa: 0, aReceber: 0, cirurgias: 0 },
          divergiu: false,
        },
      ],
    });
    await aguardar();
    await aguardar();

    expect(raiz.container.textContent).not.toContain("está fechado");
    expect(raiz.container.querySelector<HTMLInputElement>("#ec-codigo")!.disabled).toBe(false);
  });
});
