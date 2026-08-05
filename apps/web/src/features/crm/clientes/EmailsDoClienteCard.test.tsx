import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import type { SessionUser } from "@app/shared";
import { trpc } from "../../../lib/trpc";
import { AuthProvider } from "../../../lib/auth-context";
import { DialogsProvider } from "../../../components/ui/confirm-dialog";
import { EmailsDoClienteCard } from "./EmailsDoClienteCard";

// Mesmo arranjo de `EmailPage.test.tsx`: sem Testing Library, com um link tRPC de mentira que
// responde de um mapa por `op.path`.
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

const DATA = new Date("2026-08-05T12:00:00Z");
const DONO: SessionUser = {
  id: "user-thais",
  nome: "Thaís",
  email: "thais@medconsultoria.com.br",
  role: "ADMIN",
  avatarUrl: null,
  clienteId: null,
  senhaTrocadaEm: DATA,
};
const OUTRA_PESSOA: SessionUser = { ...DONO, id: "user-andre", nome: "André", email: "andre@medconsultoria.com.br" };

const CONVERSA = {
  caixaIndisponivel: false,
  itens: [
    {
      origem: "caixa",
      id: "msg-1",
      dataEm: DATA,
      assunto: "Contrato assinado",
      trecho: "segue o contrato assinado em anexo",
      deNome: "Cliente Exemplo",
      deEmail: "cliente@exemplo.com",
      para: ["thais@medconsultoria.com.br"],
      temAnexo: true,
      particular: false,
      caixa: { id: "caixa-1", email: "thais@medconsultoria.com.br", donoId: DONO.id, donoNome: "Thaís" },
    },
    {
      origem: "automatico",
      id: "env-1",
      dataEm: new Date("2026-08-04T12:00:00Z"),
      assunto: "Bem-vindo à MedConsultoria",
      trecho: null,
      para: "cliente@exemplo.com",
      status: "ENVIADO",
      erro: null,
      templateLabel: "Boas-vindas",
    },
  ],
};

function montar(handlers: Record<string, Handler>, user: SessionUser = DONO) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({ links: [linkMock(handlers) as never] });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider value={{ user, logout: () => {}, loggingOut: false }}>
            <DialogsProvider>
              <EmailsDoClienteCard clienteId="cli-1" />
            </DialogsProvider>
          </AuthProvider>
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

describe("EmailsDoClienteCard — a conversa com o cliente na ficha", () => {
  let raiz: { root: Root; container: HTMLDivElement } | null = null;

  afterEach(() => {
    if (raiz) {
      act(() => raiz!.root.unmount());
      raiz.container.remove();
    }
    raiz = null;
  });

  it("distingue por selo o que o sistema mandou do que saiu da caixa de alguém", async () => {
    raiz = montar({ "email.conversaDoCliente": () => CONVERSA });
    await aguardar();
    await aguardar();

    const texto = raiz.container.textContent ?? "";
    expect(texto).toContain("Contrato assinado");
    expect(texto).toContain("Bem-vindo à MedConsultoria");
    // O selo é o que impede confundir e-mail automático com correspondência de gente.
    expect(texto).toContain("Caixa de Thaís");
    expect(texto).toContain("Enviado pelo sistema");
    // Metadado + trecho, nunca corpo (a decisão de privacidade do ADR-97).
    expect(texto).toContain("segue o contrato assinado em anexo");
  });

  it("só o dono da caixa vê tirar-da-ficha e o link para a própria caixa", async () => {
    raiz = montar({ "email.conversaDoCliente": () => CONVERSA }, DONO);
    await aguardar();
    await aguardar();

    const botoes = [...raiz.container.querySelectorAll("button")];
    expect(botoes.some((b) => b.textContent?.includes("Tirar da ficha"))).toBe(true);
    expect(raiz.container.querySelector('a[href="/email?mensagem=msg-1"]')).not.toBeNull();

    act(() => raiz!.root.unmount());
    raiz.container.remove();

    raiz = montar({ "email.conversaDoCliente": () => CONVERSA }, OUTRA_PESSOA);
    await aguardar();
    await aguardar();

    const outros = [...raiz.container.querySelectorAll("button")];
    expect(outros.some((b) => b.textContent?.includes("Tirar da ficha"))).toBe(false);
    expect(raiz.container.querySelector('a[href="/email?mensagem=msg-1"]')).toBeNull();
    // Quem não é dono continua vendo a mensagem — o que muda é o que pode FAZER com ela.
    expect(raiz.container.textContent).toContain("Contrato assinado");
  });

  it("falha na consulta vira erro visível com 'tentar de novo', não um card vazio", async () => {
    raiz = montar({
      "email.conversaDoCliente": () => {
        throw new Error("banco fora");
      },
    });
    await aguardar();
    await aguardar();

    const texto = raiz.container.textContent ?? "";
    expect(texto).toContain("Não foi possível carregar");
    expect(texto).not.toContain("Nenhum e-mail");
    expect([...raiz.container.querySelectorAll("button")].some((b) => b.textContent?.includes("Tentar de novo"))).toBe(
      true,
    );
  });

  it("caixa indisponível avisa que a lista está incompleta, sem derrubar o card", async () => {
    raiz = montar({
      "email.conversaDoCliente": () => ({
        caixaIndisponivel: true,
        itens: CONVERSA.itens.filter((i) => i.origem === "automatico"),
      }),
    });
    await aguardar();
    await aguardar();

    const texto = raiz.container.textContent ?? "";
    expect(texto).toContain("Bem-vindo à MedConsultoria");
    expect(texto.toLowerCase()).toContain("não deu para ler as caixas");
  });
});
