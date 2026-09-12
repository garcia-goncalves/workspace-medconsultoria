import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import { trpc } from "../../lib/trpc";
import { DialogsProvider } from "../../components/ui/confirm-dialog";

// O `Link` do TanStack exige o contexto de um router montado, e aqui a página é renderizada
// solta. Estes testes existem para checar O QUE a tela oferece (e a quem), não para onde ela
// navega — o dublê troca o `Link` por um `<a>` e mantém o teste sobre a decisão, não sobre a rota.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...resto }: { children: React.ReactNode; [k: string]: unknown }) => (
    <a {...(resto as Record<string, string>)}>{children}</a>
  ),
}));

const { EmailPage } = await import("./EmailPage");

// Mesmo arranjo de `Escrever.test.tsx`: sem Testing Library, com um link tRPC de mentira que
// responde de um mapa por `op.path`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// O painel mobile de caixas/pastas usa `Sheet`, que lê `window.matchMedia` — o jsdom não
// implementa. Mesmo stub do `sheet.test.tsx`; o valor não importa aqui (o painel nasce fechado).
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})) as unknown as typeof window.matchMedia;

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

const DATA = new Date("2026-08-05T12:00:00Z");

const HANDLERS: Record<string, Handler> = {
  "email.caixas": () => [
    { id: "caixa-1", email: "thais@medconsultoria.com.br", rotulo: "Thaís", estado: "OK", nomeExibicao: "Thaís" },
  ],
  "email.pastas": () => [{ id: "pasta-1", nome: "Caixa de entrada", papel: "INBOX", naoLidos: 0, caminho: "INBOX" }],
  "email.sincronizar": () => ({ ok: true }),
  "email.mensagens": () => [
    {
      id: "msg-1",
      deNome: "Cliente Exemplo",
      deEmail: "cliente@exemplo.com",
      assunto: "Proposta assinada",
      dataEm: DATA,
      lido: true,
      trecho: "segue em anexo",
      temAnexo: true,
    },
  ],
  "email.abrir": () => ({
    id: "msg-1",
    assunto: "Proposta assinada",
    deNome: "Cliente Exemplo",
    deEmail: "cliente@exemplo.com",
    dataEm: DATA,
    enderecos: [],
    anexos: [
      { id: "anx-1", nome: "contrato assinado.pdf", tipo: "application/pdf", tamanho: 12_345, arquivoId: null },
    ],
    corpoHtml: null,
    corpoTexto: "segue em anexo",
    imagensBloqueadas: 0,
    particular: false,
  }),
  // Fases 2D-2/2D-3: por padrão, remetente de fora que ainda não é ninguém no sistema.
  "email.contextoDaMensagem": () => ({ clientes: [], lead: null, remetenteDaCasa: false }),
};

function montar(handlers: Record<string, Handler>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({ links: [linkMock(handlers) as never] });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      // `DialogsProvider` porque desplugar uma caixa é ação destrutiva e passa pelo `useConfirm`
      // (que estoura sem o provider na árvore).
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <DialogsProvider>
            <EmailPage />
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

describe("EmailPage — anexo recebido tem de dar para BAIXAR", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  /**
   * A rota `GET /email-anexo/:mensagemId/:anexoId` existe desde o Bloco 2 e ficou MORTA na app
   * inteira (produção inclusive): a tela desenhava o nome do anexo num `<span>` puro e ninguém
   * conseguia abrir o arquivo. É o defeito que este teste existe para travar — "enviar e baixar"
   * foi entregue pela metade uma vez e ninguém percebeu.
   */
  it("cada anexo da mensagem aberta é um LINK para a rota de download", async () => {
    raiz = montar(HANDLERS);
    // Cadeia de consultas: caixas → pastas → mensagens. Cada uma só começa quando a anterior
    // responde, então uma volta de microtasks por elo.
    for (let i = 0; i < 6; i += 1) await aguardar();

    const item = [...raiz.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Proposta assinada"),
    );
    expect(item, "a mensagem tem de aparecer na lista").toBeTruthy();
    act(() => {
      item!.click();
    });
    await aguardar();
    await aguardar();

    const link = raiz.container.querySelector<HTMLAnchorElement>('a[href="/email-anexo/msg-1/anx-1"]');
    expect(link, "o anexo tem de ser um <a> apontando para a rota de download").not.toBeNull();
    expect(link!.textContent).toContain("contrato assinado.pdf");
    // Mesmo domínio: o cookie httpOnly da sessão vai junto no clique — nada de `fetch` aqui.
    // NADA de `download`: com ele o navegador salva o corpo da resposta seja qual for o status, e
    // um 401/404 viraria um "contrato assinado.pdf" com JSON de erro dentro — arquivo corrompido
    // na mão da pessoa e a mensagem do servidor perdida. Em aba nova, o sucesso baixa igual (quem
    // manda é o `Content-Disposition: attachment` da rota) e o erro aparece legível.
    expect(link!.hasAttribute("download"), "`download` transforma erro do servidor em arquivo corrompido").toBe(false);
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toBe("noopener");
    // O rótulo diz o que o link FAZ; o nome truncado guarda o `title` no texto, não no link (senão
    // o leitor de tela anuncia o nome duas vezes).
    expect(link!.getAttribute("aria-label")).toBe("Baixar anexo contrato assinado.pdf");
    expect(link!.hasAttribute("title")).toBe(false);
    expect(link!.querySelector("span")?.getAttribute("title")).toBe("contrato assinado.pdf");
  });
});

describe("EmailPage — a válvula do ADR-97 tem de ter volta", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  async function abrirMensagem(particular: boolean) {
    raiz = montar({
      ...HANDLERS,
      "email.abrir": () => ({ ...(HANDLERS["email.abrir"]!({}) as object), particular }),
    });
    for (let i = 0; i < 6; i += 1) await aguardar();
    const item = [...raiz.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Proposta assinada"),
    );
    act(() => {
      item!.click();
    });
    await aguardar();
    await aguardar();
    return [...raiz.container.querySelectorAll("button")];
  }

  /**
   * A ficha do cliente só TIRA um e-mail de lá. Sem este botão, marcar como particular seria de
   * mão única na app inteira — desfazer exigiria mexer no banco.
   */
  it("mensagem visível na ficha oferece tirar; mensagem já tirada oferece devolver", async () => {
    let botoes = await abrirMensagem(false);
    expect(botoes.some((b) => b.textContent?.includes("Tirar da ficha"))).toBe(true);
    expect(botoes.some((b) => b.textContent?.includes("Devolver à ficha"))).toBe(false);

    act(() => raiz!.root.unmount());
    raiz!.container.remove();
    raiz = null;

    botoes = await abrirMensagem(true);
    expect(botoes.some((b) => b.textContent?.includes("Devolver à ficha"))).toBe(true);
    expect(botoes.some((b) => b.textContent?.includes("Tirar da ficha"))).toBe(false);
  });
});

describe("EmailPage — falha de consulta tem de aparecer, nunca virar tela vazia", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  const explode = () => {
    throw new Error("falha de rede");
  };

  /**
   * O defeito mais caro dos três: sem tratar `isError`, `caixas.data` fica `undefined` e a página
   * caía no caminho de "nenhuma caixa plugada" — a tela de boas-vindas para quem JÁ tem caixa.
   * A pessoa concluía que a caixa sumiu e ia redigitar a senha.
   */
  it("caixas que falham mostram erro com 'tentar de novo', NUNCA o convite de plugar a primeira", async () => {
    raiz = montar({ ...HANDLERS, "email.caixas": explode });
    for (let i = 0; i < 4; i += 1) await aguardar();

    expect(raiz.container.textContent).not.toContain("Conecte a sua caixa");
    expect(raiz.container.textContent).not.toContain("Seu e-mail, aqui dentro");
    expect([...raiz.container.querySelectorAll("button")].some((b) => b.textContent?.includes("Adicionar caixa"))).toBe(
      false,
    );
    expect([...raiz.container.querySelectorAll("button")].some((b) => b.textContent?.includes("Tentar de novo"))).toBe(
      true,
    );
  });

  /** "Nenhum e-mail nesta pasta" depende de `length === 0` — com `data` indefinido a lista ficava muda. */
  it("lista que falha mostra erro, e não deixa a pasta cheia parecendo vazia", async () => {
    raiz = montar({ ...HANDLERS, "email.mensagens": explode });
    for (let i = 0; i < 6; i += 1) await aguardar();

    expect(raiz.container.textContent).not.toContain("Nenhum e-mail nesta pasta");
    expect(raiz.container.textContent).toContain("Não foi possível carregar os e-mails desta pasta");
  });

  /**
   * Caminho NORMAL, não exceção: "Abrir na minha caixa" na ficha do cliente manda `?mensagem=<id>`
   * de um e-mail que pode ser da caixa de outra pessoa (ADR-95). O painel ficava em branco.
   */
  it("mensagem que não abre explica o motivo provável em vez de deixar o painel em branco", async () => {
    raiz = montar({ ...HANDLERS, "email.abrir": explode });
    for (let i = 0; i < 6; i += 1) await aguardar();

    const item = [...raiz.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Proposta assinada"),
    );
    act(() => {
      item!.click();
    });
    await aguardar();
    await aguardar();

    expect(raiz.container.textContent).toContain("Este e-mail não está na sua caixa");
    expect([...raiz.container.querySelectorAll("button")].some((b) => b.textContent?.includes("Tentar de novo"))).toBe(
      true,
    );
  });
});

describe("EmailPage — dá para desplugar uma caixa", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  /**
   * `email.removerCaixa` existia no servidor, com serviço e teste, e NENHUMA tela chamava: caixa
   * plugada por engano ficava para sempre, com a senha cifrada guardada junto.
   */
  it("cada caixa oferece desconectar, e a ação passa por confirmação antes de remover", async () => {
    const removidas: unknown[] = [];
    raiz = montar({
      ...HANDLERS,
      "email.removerCaixa": (input) => {
        removidas.push(input);
        return undefined;
      },
    });
    for (let i = 0; i < 6; i += 1) await aguardar();

    const botao = raiz.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Desconectar a caixa thais@medconsultoria.com.br"]',
    );
    expect(botao, "a caixa da barra lateral tem de oferecer desplugar").not.toBeNull();

    act(() => {
      botao!.click();
    });
    await aguardar();

    // Ação destrutiva NUNCA remove no clique: confirma antes, dizendo o que acontece.
    expect(removidas).toHaveLength(0);
    // O diálogo vive num portal, fora do container da página.
    expect(document.body.textContent).toContain("Desconectar esta caixa?");
    expect(document.body.textContent).toContain("Os e-mails continuam no servidor");

    const confirmar = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Desconectar");
    act(() => {
      confirmar!.click();
    });
    await aguardar();

    expect(removidas).toEqual([{ caixaId: "caixa-1" }]);
  });

  /**
   * `estado`/`ultimaSyncEm` vinham do servidor e NENHUM arquivo do front os lia: com o IMAP fora
   * do ar a caixa continuava com cara de saudável e a pessoa lia cache velho sem saber.
   */
  it("caixa em ERRO avisa que a lista parou, e desde quando", async () => {
    raiz = montar({
      ...HANDLERS,
      "email.caixas": () => [
        {
          id: "caixa-1",
          email: "thais@medconsultoria.com.br",
          rotulo: "Thaís",
          estado: "ERRO",
          nomeExibicao: "Thaís",
          ultimaSyncEm: DATA,
          ultimoErro: "ECONNREFUSED",
        },
      ],
    });
    for (let i = 0; i < 6; i += 1) await aguardar();

    expect(raiz.container.textContent).toContain("Não deu para falar com o servidor de e-mail");
    // A data do último acesso bem-sucedido, no formato pt-BR da app (nunca um formatador local).
    expect(raiz.container.textContent).toContain("05/08/2026");
    // Detalhe técnico do servidor não vai para a tela de quem não é técnico.
    expect(raiz.container.textContent).not.toContain("ECONNREFUSED");
  });
});

describe("EmailPage — o que dá para FAZER com este e-mail (fases 2D-2 e 2D-3)", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  /** Abre a mensagem com um contexto (quem é o remetente para a empresa) e devolve o container. */
  async function abrirCom(contexto: unknown, extras: Record<string, Handler> = {}) {
    raiz = montar({ ...HANDLERS, "email.contextoDaMensagem": () => contexto, ...extras });
    for (let i = 0; i < 6; i += 1) await aguardar();
    const item = [...raiz.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Proposta assinada"),
    );
    act(() => {
      item!.click();
    });
    await aguardar();
    await aguardar();
    return raiz.container;
  }

  it("desconhecido de fora ganha o botão de virar lead", async () => {
    const c = await abrirCom({ clientes: [], lead: null, remetenteDaCasa: false });
    const botoes = [...c.querySelectorAll("button")];
    expect(botoes.some((b) => b.textContent?.includes("Virar lead"))).toBe(true);
  });

  /** A trava do ADR-97 também do lado de cá: nem chega a existir o botão para um colega. */
  it("colega da casa NÃO ganha o botão de virar lead", async () => {
    const c = await abrirCom({ clientes: [], lead: null, remetenteDaCasa: true });
    const botoes = [...c.querySelectorAll("button")];
    expect(botoes.some((b) => b.textContent?.includes("Virar lead"))).toBe(false);
  });

  it("quem já é cliente aparece identificado, e não vira lead de novo", async () => {
    const c = await abrirCom({ clientes: [{ id: "c1", nome: "Clínica Exemplo" }], lead: null, remetenteDaCasa: false });
    expect(c.textContent).toContain("Clínica Exemplo");
    expect([...c.querySelectorAll("button")].some((b) => b.textContent?.includes("Virar lead"))).toBe(false);
  });

  it("quem já é lead aparece como do funil, sem oferecer criar outro", async () => {
    const c = await abrirCom({ clientes: [], lead: { id: "l1", nome: "Maria Souza" }, remetenteDaCasa: false });
    expect(c.textContent).toContain("Maria Souza");
    expect([...c.querySelectorAll("button")].some((b) => b.textContent?.includes("Virar lead"))).toBe(false);
  });

  it("anexo não guardado oferece guardar; anexo já guardado vira selo, não botão", async () => {
    let c = await abrirCom({ clientes: [{ id: "c1", nome: "Clínica Exemplo" }], lead: null, remetenteDaCasa: false });
    expect([...c.querySelectorAll("button")].some((b) => b.textContent?.includes("guardar"))).toBe(true);
    expect(c.textContent).not.toContain("na ficha");

    act(() => raiz!.root.unmount());
    raiz!.container.remove();
    raiz = null;

    c = await abrirCom(
      { clientes: [{ id: "c1", nome: "Clínica Exemplo" }], lead: null, remetenteDaCasa: false },
      {
        "email.abrir": () => ({
          ...(HANDLERS["email.abrir"]!({}) as object),
          anexos: [
            {
              id: "anx-1",
              nome: "contrato assinado.pdf",
              tipo: "application/pdf",
              tamanho: 12_345,
              arquivoId: "arq-1",
            },
          ],
        }),
      },
    );
    expect([...c.querySelectorAll("button")].some((b) => b.textContent?.includes("guardar"))).toBe(false);
    expect(c.textContent).toContain("na ficha");
  });
});
