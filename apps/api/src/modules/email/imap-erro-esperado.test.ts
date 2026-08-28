import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

/**
 * Prova o CAMINHO REAL, não só a fábrica de erro: `comCaixa` com uma caixa já marcada
 * `AUTENTICACAO_FALHOU` — exatamente o estado da caixa da Thaís no banco local, que produziu as
 * **66 ocorrências** no painel de Sistema.
 *
 * Sem este teste, o conserto ficaria provado só em `erros-de-caixa.test.ts`, que exercita a
 * função isolada; nada garantiria que o `comCaixa` a usa.
 */
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn() }));

vi.mock("@app/db", () => ({
  prisma: { caixaEmail: { findFirst: mocks.findFirst, update: mocks.update } },
}));

const { comCaixa } = await import("./imap.js");

describe("caixa quebrada não vira erro interno de servidor", () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.update.mockReset();
  });

  it("caixa em AUTENTICACAO_FALHOU: erro esperado, fora do painel de Sistema", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "cx1",
      imapHost: "mail.exemplo.test",
      imapPorta: 993,
      usuario: "alguem@exemplo.test",
      segredo: "v1:x:y:z",
      estado: "AUTENTICACAO_FALHOU",
    });

    const erro = await comCaixa("cx1", async () => "nunca chega aqui").catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(TRPCError);
    // A asserção que importa: é ESTE código que o `onError` do server.ts usa para decidir se
    // grava no ErrorLog e avisa o ROOT por e-mail.
    expect((erro as TRPCError).code).not.toBe("INTERNAL_SERVER_ERROR");
    expect((erro as TRPCError).message).toMatch(/reconectada/i);
  });

  it("caixa que não existe continua sendo NOT_FOUND-ish, não silêncio", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const erro = await comCaixa("sumida", async () => "x").catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(/não encontrada/i);
  });
});
