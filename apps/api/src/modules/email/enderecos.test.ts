import { describe, it, expect } from "vitest";
import { normalizarEndereco, extrairEnderecos, derivarThreadKey } from "./enderecos.js";

describe("normalizarEndereco", () => {
  it("baixa a caixa e tira espaços", () => {
    expect(normalizarEndereco("  Thais.Garcia@MedConsultoria.com.BR ")).toBe("thais.garcia@medconsultoria.com.br");
  });
  it("tira os sinais de menor/maior que alguns servidores mandam", () => {
    expect(normalizarEndereco("<contato@medconsultoria.com.br>")).toBe("contato@medconsultoria.com.br");
  });
});

describe("extrairEnderecos", () => {
  it("classifica de/para/cc e ignora entrada sem endereço", () => {
    const r = extrairEnderecos({
      from: [{ name: "José", address: "Jose@Cliente.com" }],
      to: [{ name: null, address: "teste@medconsultoria.com.br" }],
      cc: [{ name: "Sem endereço", address: null }],
    });
    expect(r).toEqual([
      { papel: "DE", nome: "José", endereco: "jose@cliente.com" },
      { papel: "PARA", nome: null, endereco: "teste@medconsultoria.com.br" },
    ]);
  });
});

describe("derivarThreadKey", () => {
  it("usa a PRIMEIRA referência, que é a raiz da conversa", () => {
    expect(
      derivarThreadKey({ messageId: "<c@x>", inReplyTo: "<b@x>", referencias: "<a@x> <b@x>" }),
    ).toBe("<a@x>");
  });
  it("sem referências, cai no inReplyTo", () => {
    expect(derivarThreadKey({ messageId: "<b@x>", inReplyTo: "<a@x>", referencias: null })).toBe("<a@x>");
  });
  it("mensagem que inicia a conversa é a própria raiz", () => {
    expect(derivarThreadKey({ messageId: "<a@x>", inReplyTo: null, referencias: null })).toBe("<a@x>");
  });
  it("sem nada devolve nulo, e não uma string vazia", () => {
    expect(derivarThreadKey({ messageId: null, inReplyTo: null, referencias: null })).toBeNull();
  });
});
