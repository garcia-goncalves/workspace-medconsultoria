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

const COMPOSICAO_2: RascunhoComposicao = {
  ...COMPOSICAO,
  corpoHtml: "<p>corpo, editado enquanto a gravação anterior ainda estava em voo</p>",
};

/**
 * Reproduz, num componente mínimo, exatamente como `Escrever.tsx` liga o hook: um `useEffect`
 * (dependência = `versao`, o equivalente aos campos do e-mail) chama `agendar()` e o cleanup
 * chama `cancelarPendente()`. `apiRef` expõe as funções do hook para o teste chamar diretamente
 * (`aoFechar`, `aoComecarEnvio`, `aoEnvioFalhou`, `descartarAposEnvio`), simulando os pontos onde
 * a tela real chama cada uma.
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

/** Promessa controlável de fora — simula uma gravação IMAP que demora (6-7s medidos contra o servidor real). */
function salvarControlavel() {
  let resolver: ((r: { uid: number | null }) => void) | undefined;
  const salvar = vi.fn().mockImplementation(
    () =>
      new Promise<{ uid: number | null }>((resolve) => {
        resolver = resolve;
      }),
  );
  return { salvar, resolver: () => resolver! };
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

  it("rodada 1 — aoComecarEnvio cancela o timer AGENDADO: envio não deixa uma gravação nova disparar", async () => {
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

  it("rodada 2, item 2 — digitar durante uma gravação em voo e fechar NÃO perde as últimas edições", async () => {
    // Composição "viva": o teste troca o valor devolvido por `compor()` para simular a pessoa
    // digitando MAIS enquanto a 1ª gravação (que já saiu com a versão antiga) ainda está em voo.
    let composicaoAtual: RascunhoComposicao = COMPOSICAO;
    const { salvar, resolver } = salvarControlavel();
    const descartar = vi.fn().mockResolvedValue(undefined);
    const apiRef: { current: Api | null } = { current: null };
    const { root, container } = montar(apiRef, {
      temConteudo: () => true,
      compor: () => composicaoAtual,
      salvar,
      descartar,
    });

    // Dispara a 1ª gravação (a versão ANTIGA) — fica pendurada, nunca resolvida ainda.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(salvar).toHaveBeenCalledWith({ ...COMPOSICAO, uidAnterior: undefined });

    // A pessoa digita mais (a tela mudaria `compor()`) e fecha ENQUANTO a 1ª ainda está em voo.
    composicaoAtual = COMPOSICAO_2;
    act(() => {
      apiRef.current!.aoFechar();
    });
    // Não pode duplicar: nenhuma 2ª gravação começa AGORA, enquanto a 1ª ainda está em voo.
    expect(salvar, "nunca duas gravações em voo ao mesmo tempo").toHaveBeenCalledTimes(1);

    // A 1ª gravação termina — a versão MAIS RECENTE (que ficou pendente) tem de ser refeita
    // sozinha, sem precisar de outro `aoFechar()` — é o que garante que o texto não se perde.
    await act(async () => {
      resolver()({ uid: 10 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(salvar, "a versão mais recente tem de chegar ao servidor sozinha, sem novo aoFechar()").toHaveBeenCalledTimes(2);
    expect(salvar).toHaveBeenLastCalledWith({ ...COMPOSICAO_2, uidAnterior: 10 });

    desmontar(root, container);
  });

  it("rodada 2, item 1 — gravação já em voo quando o envio começa: o UID é DESCARTADO, não guardado", async () => {
    const { salvar, resolver } = salvarControlavel();
    const descartar = vi.fn().mockResolvedValue(undefined);
    const apiRef: { current: Api | null } = { current: null };
    const { root, container } = montar(apiRef, { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar });

    // t=5s: o debounce dispara e a gravação começa — leva ~6-7s contra IMAP real, então ainda
    // está em voo quando a pessoa relê o e-mail por alguns segundos e clica em Enviar.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(salvar).toHaveBeenCalledTimes(1);

    // t≈7s: clique em Enviar — a gravação de t=5s ainda não voltou do servidor.
    act(() => {
      apiRef.current!.aoComecarEnvio();
    });

    // t≈11s: a gravação que já estava em voo finalmente resolve — não pode ser guardada como o
    // rascunho "vigente": o e-mail já está saindo (ou já saiu), guardar geraria uma cópia quase
    // idêntica ao que foi enviado, reabrível e reenviável.
    await act(async () => {
      resolver()({ uid: 99 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(descartar, "o UID que chegou depois do clique em Enviar tem de ser descartado na hora").toHaveBeenCalledWith(99);

    // E se a pessoa ainda mexer na tela antes do envio terminar de verdade (onSuccess/onError),
    // nenhuma gravação nova pode nascer nesse meio-tempo — ver o teste do item 3, a seguir.
    desmontar(root, container);
  });

  it("rodada 2, item 3 — digitar durante o envio (enviando=true) não inicia gravação nenhuma", async () => {
    const salvar = vi.fn().mockResolvedValue({ uid: 1 });
    const apiRef: { current: Api | null } = { current: null };
    const { root, container } = montar(apiRef, { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar: vi.fn() });

    // Consome o timer inicial sem deixar nada em voo, para isolar o que o teste quer provar.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    salvar.mockClear();

    act(() => {
      apiRef.current!.aoComecarEnvio(); // clique em Enviar — envio começou
    });

    // Os campos do formulário NÃO ficam desabilitados durante o envio (só o botão Enviar), então
    // uma tecla digitada aqui re-agenda o debounce normalmente (`agendar()`, como o `useEffect`
    // de `Escrever.tsx` faria a cada mudança de campo).
    act(() => {
      apiRef.current!.agendar();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(salvar, "nenhuma gravação nova nasce enquanto o envio está em andamento").not.toHaveBeenCalled();

    desmontar(root, container);
  });

  it("aoEnvioFalhou desliga `enviando` — depois de um envio que falha, o rascunho volta a gravar normalmente", async () => {
    const salvar = vi.fn().mockResolvedValue({ uid: 5 });
    const apiRef: { current: Api | null } = { current: null };
    const { root, container } = montar(apiRef, { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar: vi.fn() });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    salvar.mockClear();

    act(() => {
      apiRef.current!.aoComecarEnvio(); // clique em Enviar
      apiRef.current!.aoEnvioFalhou(); // ... e o envio falhou (SMTP fora, por exemplo)
      apiRef.current!.agendar(); // a pessoa continua editando
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(salvar, "depois de uma falha, os rascunhos precisam voltar a gravar normalmente").toHaveBeenCalledTimes(1);

    desmontar(root, container);
  });

  it("rodada 1, achado 2 — descartarAposEnvio apaga o rascunho salvo e zera o UID rastreado", async () => {
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
