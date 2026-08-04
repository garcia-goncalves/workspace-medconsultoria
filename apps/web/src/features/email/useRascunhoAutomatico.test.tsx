import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRascunhoAutomatico, type RascunhoComposicao } from "./useRascunhoAutomatico";

// Sem Testing Library neste repo: montamos o hook num componente mínimo com `react-dom/client` +
// `act` puros. `act` só reconhece o ambiente como "de teste" com este flag global — sem ele, os
// avisos "not configured to support act(...)" aparecem mesmo com tudo envolto em `act(...)`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useRascunhoAutomatico>;
type Opts = Parameters<typeof useRascunhoAutomatico>[0];

const COMPOSICAO: RascunhoComposicao = {
  caixaId: "caixa-1",
  para: ["cliente@exemplo.com"],
  cc: [],
  cco: [],
  assunto: "Assunto de teste",
  corpoHtml: "<p>corpo</p>",
};

/**
 * Reproduz, num componente mínimo, exatamente como `Escrever.tsx` liga o hook: um `useEffect`
 * (dependência = `versao`, o equivalente aos campos do e-mail) chama `agendar()` e o cleanup
 * chama `cancelarPendente()`. `apiRef` expõe as funções do hook para o teste chamar diretamente
 * (`aoFechar`, `aoComecarEnvio`, `descartarAposEnvio`), simulando os pontos onde a tela real
 * chama cada uma.
 */
function Harness({ apiRef, versao, opts }: { apiRef: { current: Api | null }; versao: number; opts: Opts }) {
  const api = useRascunhoAutomatico(opts);
  apiRef.current = api;
  useEffect(() => {
    api.agendar();
    return api.cancelarPendente;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versao]);
  return null;
}

function montar(apiRef: { current: Api | null }, opts: Opts, versao = 1): { root: Root; container: HTMLDivElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Harness apiRef={apiRef} versao={versao} opts={opts} />);
  });
  return { root, container };
}

function desmontar(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

describe("useRascunhoAutomatico", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("não grava antes dos 5s, grava exatamente aos 5s (debounce)", async () => {
    const apiRef: { current: Api | null } = { current: null };
    const salvar = vi.fn().mockResolvedValue({ uid: 1 });
    const descartar = vi.fn().mockResolvedValue(undefined);
    const { root, container } = montar(apiRef, { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(salvar).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(salvar).toHaveBeenCalledWith({ ...COMPOSICAO, uidAnterior: undefined });

    desmontar(root, container);
  });

  it("não grava rascunho em branco — temConteudo() false nunca chama salvar", async () => {
    const apiRef: { current: Api | null } = { current: null };
    const salvar = vi.fn();
    const { root, container } = montar(apiRef, { temConteudo: () => false, compor: () => COMPOSICAO, salvar, descartar: vi.fn() });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(salvar).not.toHaveBeenCalled();

    desmontar(root, container);
  });

  it("achado 1 — aoComecarEnvio cancela o timer pendente: envio não deixa gravação disparar durante ele", async () => {
    const apiRef: { current: Api | null } = { current: null };
    const salvar = vi.fn().mockResolvedValue({ uid: 1 });
    const { root, container } = montar(apiRef, { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar: vi.fn() });

    // Última tecla em t=0, clique em Enviar em t=2s — ainda faltam 3s pro timer original disparar.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    act(() => {
      apiRef.current!.aoComecarEnvio();
    });

    // Passa bem além dos 5s originais: se o timer não tivesse sido cancelado, teria disparado aqui.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(salvar, "nenhuma gravação pode nascer depois do clique em Enviar").not.toHaveBeenCalled();

    desmontar(root, container);
  });

  it("achado 3 — nunca duas gravações em voo ao mesmo tempo (aoFechar durante um save pendente)", async () => {
    let resolverPrimeira: ((r: { uid: number | null }) => void) | undefined;
    const salvar = vi.fn().mockImplementation(
      () =>
        new Promise<{ uid: number | null }>((resolve) => {
          resolverPrimeira = resolve;
        }),
    );
    const descartar = vi.fn().mockResolvedValue(undefined);
    const apiRef: { current: Api | null } = { current: null };
    const { root, container } = montar(apiRef, { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar });

    // Dispara a 1ª gravação (o debounce de 5s) — fica pendurada (nunca resolvida ainda).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(salvar).toHaveBeenCalledTimes(1);

    // Fecha a tela ENQUANTO a 1ª gravação ainda está em voo (o cenário real: 6-7s de IMAP,
    // pessoa fecha em ~6s). Não pode iniciar uma 2ª gravação por cima.
    act(() => {
      apiRef.current!.aoFechar();
    });
    expect(salvar, "nunca duas gravações em voo ao mesmo tempo").toHaveBeenCalledTimes(1);

    // A 1ª gravação termina — só agora uma gravação nova pode começar, com o UID certo.
    await act(async () => {
      resolverPrimeira!({ uid: 42 });
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      apiRef.current!.aoFechar();
    });
    expect(salvar).toHaveBeenCalledTimes(2);
    expect(salvar).toHaveBeenLastCalledWith({ ...COMPOSICAO, uidAnterior: 42 });

    desmontar(root, container);
  });

  it("achado 2 — descartarAposEnvio apaga o rascunho salvo e zera o UID rastreado", async () => {
    const salvar = vi.fn().mockResolvedValue({ uid: 77 });
    const descartar = vi.fn().mockResolvedValue(undefined);
    const apiRef: { current: Api | null } = { current: null };
    const { root, container } = montar(apiRef, { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(salvar).toHaveBeenCalledTimes(1);

    act(() => {
      apiRef.current!.descartarAposEnvio();
    });
    expect(descartar, "apaga no servidor o rascunho salvo da composição que acabou de sair").toHaveBeenCalledWith(77);

    // Uma gravação seguinte (novo e-mail na mesma tela) NÃO pode tentar regravar por cima do
    // UID que acabou de ser apagado — senão o servidor recusaria (mensagem não existe mais).
    act(() => {
      apiRef.current!.aoFechar();
    });
    expect(salvar).toHaveBeenCalledTimes(2);
    expect(salvar).toHaveBeenLastCalledWith({ ...COMPOSICAO, uidAnterior: undefined });

    desmontar(root, container);
  });
});
