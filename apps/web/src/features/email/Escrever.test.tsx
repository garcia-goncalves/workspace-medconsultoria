import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import { trpc } from "../../lib/trpc";
import { Escrever } from "./Escrever";

// Sem Testing Library neste repo (ver `useRascunhoAutomatico.test.tsx`): montamos o componente com
// `react-dom/client` + `act` puros. Para `Escrever.tsx`, que fala com o servidor via tRPC, também
// precisamos de um CLIENTE tRPC de mentira — um `link` mínimo que responde de um mapa de handlers
// por `op.path` (ex.: "email.prepararResposta"), em vez de bater rede de verdade.
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

function montar(handlers: Record<string, Handler>, props: Parameters<typeof Escrever>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({ links: [linkMock(handlers) as never] });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <Escrever {...props} />
        </QueryClientProvider>
      </trpc.Provider>,
    );
  });
  return { root, container, queryClient };
}

function desmontar(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

/** Espera uma volta de microtasks + timers — o suficiente para o mock resolver e o React rerenderizar. */
async function aguardar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function definirValor(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) throw new Error("setter de value não encontrado");
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoComTexto(container: HTMLElement, texto: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
  if (!btn) throw new Error(`botão "${texto}" não encontrado`);
  return btn;
}

describe("Escrever — Achado 2: preparo falhou não pode travar a tela para sempre", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) desmontar(raiz.root, raiz.container);
    raiz = null;
  });

  it("mostra erro persistente + botão Tentar de novo quando prepararResposta falha (não depende do toast, que some sozinho)", async () => {
    const handlers: Record<string, Handler> = {
      "email.prepararResposta": () => {
        throw new Error("Falha simulada de rede");
      },
    };
    raiz = montar(handlers, { modo: "responder", caixaId: "caixa-1", mensagemId: "msg-1", onFechar: vi.fn() });
    await aguardar();
    await aguardar();

    expect(raiz.container.textContent).toMatch(/não deu para carregar/i);
    // Tem que existir um jeito de tentar de novo — não só o toast, que some sozinho.
    expect(() => botaoComTexto(raiz!.container, "Tentar de novo")).not.toThrow();

    // O botão Enviar continua desabilitado (não há o que enviar sem a mensagem original).
    const enviarBtn = botaoComTexto(raiz.container, "Enviar");
    expect(enviarBtn.disabled).toBe(true);
  });

  it("Tentar de novo refaz a busca — se ela funcionar da 2ª vez, a tela sai do estado de erro e pré-preenche", async () => {
    let chamadas = 0;
    const handlers: Record<string, Handler> = {
      "email.prepararResposta": () => {
        chamadas += 1;
        if (chamadas === 1) throw new Error("Falha simulada de rede");
        return {
          para: ["cliente@exemplo.com"],
          cc: [],
          assunto: "Re: Proposta",
          citacaoPreview: "<p>citação</p>",
          citacaoEnvio: "<p>citação</p>",
        };
      },
    };
    raiz = montar(handlers, { modo: "responder", caixaId: "caixa-1", mensagemId: "msg-1", onFechar: vi.fn() });
    await aguardar();
    await aguardar();
    expect(raiz.container.textContent).toMatch(/não deu para carregar/i);

    act(() => {
      botaoComTexto(raiz!.container, "Tentar de novo").click();
    });
    await aguardar();
    await aguardar();

    expect(chamadas).toBe(2);
    expect(raiz.container.textContent).not.toMatch(/não deu para carregar/i);
    const assunto = raiz.container.querySelector<HTMLInputElement>("#esc-assunto");
    expect(assunto?.value).toBe("Re: Proposta");
    const enviarBtn = botaoComTexto(raiz.container, "Enviar");
    expect(enviarBtn.disabled).toBe(false);
  });

  it("o mesmo vale para prepararEncaminhamento", async () => {
    const handlers: Record<string, Handler> = {
      "email.prepararEncaminhamento": () => {
        throw new Error("Falha simulada de rede");
      },
    };
    raiz = montar(handlers, { modo: "encaminhar", caixaId: "caixa-1", mensagemId: "msg-1", onFechar: vi.fn() });
    await aguardar();
    await aguardar();

    expect(raiz.container.textContent).toMatch(/não deu para carregar/i);
    expect(() => botaoComTexto(raiz!.container, "Tentar de novo")).not.toThrow();
  });
});

describe("Escrever — Onda C: anexos do e-mail encaminhado", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) desmontar(raiz.root, raiz.container);
    raiz = null;
  });

  const PREPARO = {
    assunto: "Enc: Proposta",
    citacaoPreview: "<p>citação</p>",
    citacaoEnvio: "<p>citação</p>",
    anexos: [
      { id: "anx-1", nome: "contrato.pdf", tamanho: 1_000 },
      { id: "anx-2", nome: "planilha.xlsx", tamanho: 2_000 },
    ],
  };

  /** Monta em modo encaminhar, já preenchido, e devolve o que o `email.enviar` recebeu. */
  function montarEncaminhar() {
    const recebido: { input: Record<string, unknown> | null } = { input: null };
    const handlers: Record<string, Handler> = {
      "email.prepararEncaminhamento": () => PREPARO,
      "email.enviar": (input) => {
        recebido.input = input as Record<string, unknown>;
        return { enviado: true, copiaEmEnviados: true };
      },
    };
    raiz = montar(handlers, { modo: "encaminhar", caixaId: "caixa-1", mensagemId: "msg-1", onFechar: vi.fn() });
    return recebido;
  }

  async function submeter() {
    const paraInput = raiz!.container.querySelector<HTMLInputElement>("#esc-para")!;
    act(() => {
      definirValor(paraInput, "cliente@exemplo.com");
    });
    const form = raiz!.container.querySelector<HTMLFormElement>("#escrever-form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("lista os anexos que vieram do e-mail original — encaminhar um e-mail cujo ponto É o PDF tem de mostrar o PDF", async () => {
    montarEncaminhar();
    await aguardar();
    await aguardar();

    expect(raiz!.container.textContent).toContain("contrato.pdf");
    expect(raiz!.container.textContent).toContain("planilha.xlsx");
    // O teto real do servidor são 25 MB SOMADOS (novos + originais) — a tela tem de dizer isso.
    expect(raiz!.container.textContent, "o total tem de estar visível, contra o teto de verdade").toMatch(/de 25 MB/);
  });

  it("manda os ids em anexosOriginais — sem isso o encaminhamento sai sem o anexo", async () => {
    const recebido = montarEncaminhar();
    await aguardar();
    await aguardar();
    await submeter();

    expect(recebido.input?.anexosOriginais).toEqual(["anx-1", "anx-2"]);
    // O conteúdo NUNCA passa pelo navegador: só os ids. O nome sai do banco, no servidor.
    expect(recebido.input?.anexos, "anexo novo é outra lista — o do original não entra nela").toEqual([]);
  });

  it("remover um anexo do original tira só ele do envio (não apaga arquivo nenhum)", async () => {
    const recebido = montarEncaminhar();
    await aguardar();
    await aguardar();

    const remover = raiz!.container.querySelector<HTMLButtonElement>(
      '[aria-label="Remover contrato.pdf, anexo do e-mail original"]',
    );
    expect(remover, "cada anexo do original precisa de um jeito de tirar").not.toBeNull();
    act(() => {
      remover!.click();
    });
    expect(raiz!.container.textContent).not.toContain("contrato.pdf");

    await submeter();
    expect(recebido.input?.anexosOriginais).toEqual(["anx-2"]);
  });

  it("mais de 20 anexos do original BARRA o envio — o servidor recusaria com um erro ilegível", async () => {
    const recebido: { input: Record<string, unknown> | null } = { input: null };
    const muitos = Array.from({ length: 21 }, (_, i) => ({ id: `a${i}`, nome: `arquivo-${i}.pdf`, tamanho: 100 }));
    raiz = montar(
      {
        "email.prepararEncaminhamento": () => ({ ...PREPARO, anexos: muitos }),
        "email.enviar": (input) => {
          recebido.input = input as Record<string, unknown>;
          return { enviado: true, copiaEmEnviados: true };
        },
      },
      { modo: "encaminhar", caixaId: "caixa-1", mensagemId: "msg-1", onFechar: vi.fn() },
    );
    await aguardar();
    await aguardar();
    await submeter();

    expect(recebido.input, "a mutação não pode sair para o servidor recusar").toBeNull();
    expect(raiz!.container.textContent).toMatch(/no máximo 20 anexos do e-mail original/i);
  });

  it("passar de 25 MB só com os anexos do original BARRA o envio", async () => {
    const recebido: { input: Record<string, unknown> | null } = { input: null };
    const pesados = [
      { id: "p1", nome: "video-1.mp4", tamanho: 15 * 1024 * 1024 },
      { id: "p2", nome: "video-2.mp4", tamanho: 15 * 1024 * 1024 },
    ];
    raiz = montar(
      {
        "email.prepararEncaminhamento": () => ({ ...PREPARO, anexos: pesados }),
        "email.enviar": (input) => {
          recebido.input = input as Record<string, unknown>;
          return { enviado: true, copiaEmEnviados: true };
        },
      },
      { modo: "encaminhar", caixaId: "caixa-1", mensagemId: "msg-1", onFechar: vi.fn() },
    );
    await aguardar();
    await aguardar();
    expect(raiz!.container.textContent).toContain("30,0 MB de 25 MB");
    await submeter();

    expect(recebido.input, "acima do teto o envio não pode nem sair daqui").toBeNull();
  });

  it("arquivo acima de 20 MB nem começa a subir — o servidor só devolveria 413 depois da viagem inteira", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      raiz = montar({}, { modo: "novo", caixaId: "caixa-1", onFechar: vi.fn() });
      await aguardar();

      const input = raiz.container.querySelector<HTMLInputElement>('input[type="file"]')!;
      // `File` de mentira: só o que `anexar()` lê (nome e tamanho). Alocar 21 MB de verdade num
      // teste seria desperdício puro.
      const gordo = { name: "video.mp4", size: 21 * 1024 * 1024 } as File;
      Object.defineProperty(input, "files", { configurable: true, value: [gordo] });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(fetchSpy, "acima do teto por arquivo, nada pode ir para a rede").not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("modo novo não manda anexo original nenhum", async () => {
    const recebido: { input: Record<string, unknown> | null } = { input: null };
    raiz = montar(
      {
        "email.enviar": (input) => {
          recebido.input = input as Record<string, unknown>;
          return { enviado: true, copiaEmEnviados: true };
        },
      },
      { modo: "novo", caixaId: "caixa-1", onFechar: vi.fn() },
    );
    await aguardar();
    await submeter();

    expect(recebido.input?.anexosOriginais).toEqual([]);
  });
});

describe("Escrever — Achado 3: trava os campos durante o envio (e as 3 portas de saída se comportam igual)", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    if (raiz) desmontar(raiz.root, raiz.container);
    raiz = null;
  });

  it("antes de enviar, o fieldset dos campos está habilitado e o botão diz Cancelar", async () => {
    raiz = montar({}, { modo: "novo", caixaId: "caixa-1", onFechar: vi.fn() });
    await aguardar();

    const fieldset = raiz.container.querySelector("fieldset");
    expect(fieldset?.disabled).toBe(false);
    expect(botaoComTexto(raiz.container, "Cancelar").disabled).toBe(false);
  });

  it("durante o envio: campos desabilitados, e o botão vira Fechar CLICÁVEL — as 3 portas (botão, X, Esc) fecham igual", async () => {
    // Decisão da onda C: Cancelar desabilitado enquanto X/Esc/clique-fora continuavam fechando era
    // incoerente; e prender a pessoa no modal seria pior — o SMTP tem socketTimeout de 45s
    // (`smtp.ts`), então um servidor lento trancaria a tela por quase um minuto sem saída. Todas
    // as portas fecham; o rótulo vira "Fechar" para não prometer que interrompe o envio (o e-mail
    // termina de sair em segundo plano e o toast avisa o resultado).
    let resolverEnvio: ((v: unknown) => void) | null = null;
    const handlers: Record<string, Handler> = {
      "email.enviar": () =>
        new Promise((resolve) => {
          resolverEnvio = resolve;
        }),
    };
    const onFechar = vi.fn();
    raiz = montar(handlers, { modo: "novo", caixaId: "caixa-1", onFechar });
    await aguardar();

    const paraInput = raiz.container.querySelector<HTMLInputElement>("#esc-para")!;
    act(() => {
      definirValor(paraInput, "cliente@exemplo.com");
    });

    const form = raiz.container.querySelector<HTMLFormElement>("#escrever-form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const fieldset = raiz.container.querySelector("fieldset");
    expect(fieldset?.disabled).toBe(true);

    const fechar = botaoComTexto(raiz.container, "Fechar");
    expect(fechar.disabled, "a porta do rodapé tem de funcionar como o X e o Esc").toBe(false);
    act(() => {
      fechar.click();
    });
    expect(onFechar).toHaveBeenCalled();

    // limpa a mutação em voo para não vazar entre testes
    await act(async () => {
      resolverEnvio?.({ enviado: true, copiaEmEnviados: true });
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("envio que conclui DEPOIS de a tela fechar não chama onFechar de novo (senão fecha a composição SEGUINTE)", async () => {
    // `onSuccess`/`onError` do `useMutation` são chamados pela mutação do query-core, não pelo
    // observer: rodam com o componente já desmontado. Sem guarda, o envio lento que terminava 20s
    // depois fechava o e-mail que a pessoa já tinha começado a escrever — levando junto o texto
    // dos últimos 5s (o cleanup do timer cancela a gravação pendente).
    let resolverEnvio: ((v: unknown) => void) | null = null;
    const onFechar = vi.fn();
    raiz = montar(
      {
        "email.enviar": () =>
          new Promise((resolve) => {
            resolverEnvio = resolve;
          }),
      },
      { modo: "novo", caixaId: "caixa-1", onFechar },
    );
    await aguardar();

    act(() => {
      definirValor(raiz!.container.querySelector<HTMLInputElement>("#esc-para")!, "cliente@exemplo.com");
    });
    const form = raiz.container.querySelector<HTMLFormElement>("#escrever-form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    // A pessoa fecha a tela com o envio em voo (as 3 portas fecham) — e a `EmailPage` desmonta o
    // componente, que é o que o `onFechar` real faz (`setEscrevendo(null)`).
    act(() => {
      botaoComTexto(raiz!.container, "Fechar").click();
    });
    expect(onFechar).toHaveBeenCalledTimes(1);
    const { root, container } = raiz;
    raiz = null;
    desmontar(root, container);

    // Só AGORA o envio termina.
    await act(async () => {
      resolverEnvio?.({ enviado: true, copiaEmEnviados: true });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onFechar, "a tela já fechou: fechar de novo mataria a composição seguinte").toHaveBeenCalledTimes(1);
  });
});
