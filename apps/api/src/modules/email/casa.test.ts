import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A trava que decide QUEM pode escolher a chave das consultas da ficha (ADR-97).
 *
 * A revisão de segurança da fase derrubou a primeira versão, que comparava só endereços exatos:
 * `comercial@medconsultoria.com.br` não tem `User` nem caixa plugada, então passava — e um
 * funcionário que pusesse esse endereço num cliente descartável lia, pela ficha, o metadado e o
 * trecho de tudo o que a equipe trocou com aquela caixa institucional. Por isso a regra virou
 * **por domínio**, e é isso que estes testes travam.
 */

const mocks = vi.hoisted(() => ({ userFindMany: vi.fn(), caixaFindMany: vi.fn() }));

vi.mock("@app/db", () => ({
  prisma: {
    user: { findMany: mocks.userFindMany },
    caixaEmail: { findMany: mocks.caixaFindMany },
  },
}));

const { carregarCasa, ehDaCasa, soDeFora } = await import("./casa.js");

/** O dublê honra o `role: { not: CLIENTE }` — o cliente do Portal também é `User`. */
function casa(users: Array<string | { email: string; role: string }>, caixas: Array<{ email: string; usuario: string }> = []) {
  const linhas = users.map((u) => (typeof u === "string" ? { email: u, role: "FUNCIONARIO" } : u));
  mocks.userFindMany.mockImplementation(async (args: any) => {
    const fora: string | undefined = args?.where?.role?.not;
    return linhas.filter((l) => l.role !== fora).map((l) => ({ email: l.email }));
  });
  mocks.caixaFindMany.mockResolvedValue(caixas);
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.caixaFindMany.mockResolvedValue([]);
});

describe("casa — endereço que nunca pode virar chave de consulta", () => {
  it("recusa o endereço exato de uma conta interna", async () => {
    casa(["Thais.Garcia@MedConsultoria.com.BR"]);
    expect(await ehDaCasa("thais.garcia@medconsultoria.com.br")).toBe(true);
  });

  it("recusa a caixa institucional que NÃO tem conta nem caixa plugada (o furo da 1ª versão)", async () => {
    casa(["thais.garcia@medconsultoria.com.br"]);
    // `comercial@` não é `User` nem `CaixaEmail` — só o domínio o denuncia.
    expect(await ehDaCasa("comercial@medconsultoria.com.br")).toBe(true);
  });

  it("recusa apelido e plus-address do domínio da casa", async () => {
    casa(["thiago.garcia@medconsultoria.com.br"]);
    expect(await ehDaCasa("thiago@medconsultoria.com.br")).toBe(true);
    expect(await ehDaCasa("thiago.garcia+cliente@medconsultoria.com.br")).toBe(true);
  });

  it("recusa o domínio de uma caixa plugada, mesmo sem conta correspondente", async () => {
    casa([], [{ email: "financeiro@med.com.br", usuario: "financeiro" }]);
    expect(await ehDaCasa("outra.pessoa@med.com.br")).toBe(true);
  });

  it("NÃO transforma provedor público em domínio da casa", async () => {
    // Se um dia alguém plugar (ou logar com) um Gmail, todo cliente com Gmail sumiria da ficha.
    casa([{ email: "pessoa@gmail.com", role: "FUNCIONARIO" }], [{ email: "pessoa@gmail.com", usuario: "pessoa@gmail.com" }]);
    expect(await ehDaCasa("cliente.de.verdade@gmail.com")).toBe(false);
    // O endereço exato continua recusado — ele é de casa, o domínio não.
    expect(await ehDaCasa("pessoa@gmail.com")).toBe(true);
  });

  it("o cliente do Portal é User, mas o e-mail dele NÃO é da casa", async () => {
    casa([
      { email: "cliente@exemplo.com", role: "CLIENTE" },
      { email: "thais.garcia@medconsultoria.com.br", role: "ADMIN" },
    ]);
    expect(await ehDaCasa("cliente@exemplo.com")).toBe(false);
  });

  it("usuário de login sem domínio não vira domínio da casa", async () => {
    casa([], [{ email: "financeiro@med.com.br", usuario: "financeiro" }]);
    const c = await carregarCasa();
    expect(c.enderecos.has("financeiro")).toBe(true);
    expect([...c.dominios]).toEqual(["med.com.br"]);
  });
});

describe("soDeFora", () => {
  it("tira os da casa, mantém os de fora e respeita o teto", async () => {
    casa(["thais.garcia@medconsultoria.com.br"]);
    const r = await soDeFora(
      ["cliente@exemplo.com", "comercial@medconsultoria.com.br", "outro@exemplo.com"],
      2,
    );
    expect(r).toEqual(["cliente@exemplo.com", "outro@exemplo.com"]);
  });

  it("lista vazia não consulta o banco", async () => {
    casa(["thais.garcia@medconsultoria.com.br"]);
    expect(await soDeFora([], 50)).toEqual([]);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });
});
