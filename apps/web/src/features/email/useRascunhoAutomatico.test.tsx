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

/**
 * Promessa controlável de fora — simula uma gravação IMAP que demora (6-7s medidos contra o
 * servidor real). Guarda um resolvedor POR CHAMADA (índice 0, 1, 2…), porque vários testes desta
 * rodada precisam controlar a 1ª e a 2ª gravação separadamente (ex.: A ainda em voo quando B começa).
 */
function salvarControlavel() {
  const resolvers: Array<(r: { uid: number | null }) => void> = [];
  const salvar = vi.fn().mockImplementation(
    () =>
      new Promise<{ uid: number | null }>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return { salvar, resolver: (indice = resolvers.length - 1) => resolvers[indice]! };
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

  it("rodada 3, item 1 — aoEnvioFalhou REGRAVA sozinho, sem depender de nova tecla", async () => {
    // Reprodução exata do defeito que a rodada 3 fechou: gravação em voo no clique em Enviar →
    // resolve DURANTE o envio → é descartada (achado 1 da rodada 2) → o envio então FALHA. No
    // head anterior (5533c7b) o rascunho sobrevivia a um envio falho; a rodada 2 quebrou isso
    // sem perceber (a correção do achado 1 fechou um buraco e abriu este do lado).
    const { salvar, resolver } = salvarControlavel();
    const descartar = vi.fn().mockResolvedValue(undefined);
    const apiRef: { current: Api | null } = { current: null };
    const { root, container } = montar(apiRef, { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar });

    // t=5s: gravação A começa, ainda em voo quando a pessoa clica Enviar em t≈7s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    act(() => {
      apiRef.current!.aoComecarEnvio();
    });

    // t≈11s: A resolve DURANTE o envio — é descartada (comportamento correto e já coberto).
    await act(async () => {
      resolver(0)({ uid: 99 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(descartar).toHaveBeenCalledWith(99);

    // t≈13s: o envio FALHA (SMTP fora, por exemplo). SEM nenhuma tecla nova, o rascunho tem de
    // voltar a existir no servidor — a pessoa continua com o texto na tela e não pode ficar sem
    // rede de segurança nenhuma até digitar de novo ou fechar a janela.
    act(() => {
      apiRef.current!.aoEnvioFalhou();
    });
    expect(salvar, "aoEnvioFalhou tem de regravar na hora, sem depender de nova tecla").toHaveBeenCalledTimes(2);
    expect(salvar).toHaveBeenLastCalledWith({ ...COMPOSICAO, uidAnterior: undefined });

    desmontar(root, container);
  });

  it("rodada 3, item 1 (variante) — aoEnvioFalhou com gravação AINDA em voo só marca pendente, não duplica", async () => {
    // Caso mais raro do mesmo achado: o envio falha ANTES da gravação em voo (do clique) resolver.
    const { salvar, resolver } = salvarControlavel();
    const apiRef: { current: Api | null } = { current: null };
    const { root, container } = montar(apiRef, { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar: vi.fn().mockResolvedValue(undefined) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    act(() => {
      apiRef.current!.aoComecarEnvio();
    });

    // O envio falha ENQUANTO a gravação A ainda está em voo (não resolveu ainda).
    act(() => {
      apiRef.current!.aoEnvioFalhou();
    });
    expect(salvar, "não pode duplicar: A ainda está em voo").toHaveBeenCalledTimes(1);

    // A resolve — como `enviando` já está desligado, o resultado é GUARDADO normalmente (não
    // descartado), e a gravação marcada pendente por `aoEnvioFalhou` é refeita sozinha por cima.
    await act(async () => {
      resolver(0)({ uid: 55 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(salvar, "a gravação adiada por aoEnvioFalhou tem de acontecer sozinha, com o UID de A").toHaveBeenCalledTimes(2);
    expect(salvar).toHaveBeenLastCalledWith({ ...COMPOSICAO, uidAnterior: 55 });

    desmontar(root, container);
  });

  it("rodada 3, item 2 — a reentrada de salvarAgora não órfã um timer ARMADO (contagem real de timers)", async () => {
    // `vi.getTimerCount()` conta timers de verdade agendados no relógio falso — é a forma direta
    // de provar que `cancelarPendente()` (não um `timerRef.current = null` solto) rodou.
    const { salvar, resolver } = salvarControlavel();
    const descartar = vi.fn().mockResolvedValue(undefined);
    const apiRef: { current: Api | null } = { current: null };
    const { root, container } = montar(apiRef, { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar });

    // Dispara a gravação A (fica em voo). O timer que a disparou já consumiu a si mesmo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    // Fecha a tela enquanto A está em voo — marca `pendente`, não arma timer nenhum sozinho.
    act(() => {
      apiRef.current!.aoFechar();
    });

    // Mais uma tecla digitada ENQUANTO A ainda está em voo — arma um timer de VERDADE (T3), como
    // o `useEffect` de `Escrever.tsx` faria a cada mudança de campo.
    act(() => {
      apiRef.current!.agendar();
    });
    expect(vi.getTimerCount(), "T3 tem de estar armado, esperando 5s").toBe(1);

    // A resolve — dispara a reentrada de `salvarAgora` pelo `.finally` (achado 2 da rodada 2),
    // que começa a gravação B.
    await act(async () => {
      resolver(0)({ uid: 5 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(salvar).toHaveBeenCalledTimes(2);
    expect(salvar).toHaveBeenLastCalledWith({ ...COMPOSICAO, uidAnterior: 5 });

    // T3 tinha de ter sido CANCELADO por essa reentrada. Com o defeito da rodada 3
    // (`timerRef.current = null` direto, sem `clearTimeout`), T3 continuaria vivo aqui — órfão,
    // imune a qualquer `cancelarPendente()` futuro (nem o do `useEffect`, nem o de `aoComecarEnvio`).
    expect(vi.getTimerCount(), "nenhum timer pode sobrar órfão depois da reentrada").toBe(0);

    desmontar(root, container);
  });

  it("rodada 3, item 3 — descartarAposEnvio NÃO desliga `enviando`: gravação que resolve DEPOIS dele ainda é descartada", async () => {
    // Cobre a invariante que sustenta o achado 1 da rodada 2: se `descartarAposEnvio` desligasse
    // `enviando`, uma gravação que já estava em voo no clique (e ainda não voltou quando o envio
    // termina com sucesso) seria GUARDADA como se fosse o rascunho vigente — o mesmo defeito que
    // a rodada 2 fechou, mas por outra porta.
    const { salvar, resolver } = salvarControlavel();
    const descartar = vi.fn().mockResolvedValue(undefined);
    const apiRef: { current: Api | null } = { current: null };
    const { root, container } = montar(apiRef, { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    act(() => {
      apiRef.current!.aoComecarEnvio();
    });

    // O envio termina com SUCESSO antes da gravação A (que já estava em voo) resolver.
    act(() => {
      apiRef.current!.descartarAposEnvio();
    });
    expect(descartar, "nada para descartar ainda — a gravação A não voltou").not.toHaveBeenCalled();

    // SÓ AGORA a gravação A resolve.
    await act(async () => {
      resolver(0)({ uid: 99 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      descartar,
      "enviando tem de continuar true depois de descartarAposEnvio — senão este uid seria GUARDADO em vez de descartado",
    ).toHaveBeenCalledWith(99);

    desmontar(root, container);
  });

  it("rodada 3, item 3 (optsRef) — a gravação adiada usa o conteúdo do RENDER MAIS RECENTE, não o de quando a gravação original começou", async () => {
    // Discrimina de verdade `optsRef` de `opts`: usa dois objetos `opts` DIFERENTES (como a tela
    // real recria a cada render), não uma variável mutável fechada pelo mesmo `compor()` — o
    // truque da variável mutável (ver o teste "rodada 2, item 2") passaria mesmo se `optsRef`
    // fosse revertido para `opts` simples, porque só há UM render nesse outro teste.
    const { salvar, resolver } = salvarControlavel();
    const descartar = vi.fn().mockResolvedValue(undefined);
    const apiRef: { current: Api | null } = { current: null };
    const optsA: Opts = { temConteudo: () => true, compor: () => COMPOSICAO, salvar, descartar };
    const { root, container } = montar(apiRef, optsA, 1);

    // Dispara a gravação A com o `opts` do PRIMEIRO render.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(salvar).toHaveBeenLastCalledWith({ ...COMPOSICAO, uidAnterior: undefined });

    // Re-renderiza com um `opts` NOVO (objeto diferente — não é a mesma variável mutável).
    const optsB: Opts = { temConteudo: () => true, compor: () => COMPOSICAO_2, salvar, descartar };
    act(() => {
      root.render(<Harness apiRef={apiRef} versao={2} opts={optsB} />);
    });

    // Fecha ENQUANTO a gravação original ainda está em voo — adia (achado 2 da rodada 2).
    act(() => {
      apiRef.current!.aoFechar();
    });
    expect(salvar).toHaveBeenCalledTimes(1);

    // A gravação original resolve — a gravação adiada tem de usar o `opts` do render MAIS
    // RECENTE (`optsB`/`COMPOSICAO_2`), não o capturado quando a gravação original começou.
    await act(async () => {
      resolver(0)({ uid: 7 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(salvar).toHaveBeenCalledTimes(2);
    expect(salvar).toHaveBeenLastCalledWith({ ...COMPOSICAO_2, uidAnterior: 7 });

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
