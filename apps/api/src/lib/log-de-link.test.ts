import { describe, expect, it } from "vitest";
import { linhaDeLinkNaoEnviado } from "./log-de-link.js";

// O link de redefinição carrega um token que troca a senha de qualquer conta. Em produção o
// log mora no `docker logs` de uma VPS compartilhada — o token não pode chegar lá.
const URL = "https://workspace.exemplo/redefinir-senha?token=abc123segredo";

describe("linhaDeLinkNaoEnviado", () => {
  it("em produção NÃO escreve o link nem o token", () => {
    const linha = linhaDeLinkNaoEnviado("reset", "pessoa@x.com", URL, "production");
    expect(linha).not.toContain("abc123segredo");
    expect(linha).not.toContain("token=");
    expect(linha).not.toContain("http");
  });

  it("em produção a linha continua existindo, dizendo que o e-mail não saiu", () => {
    const linha = linhaDeLinkNaoEnviado("reset", "pessoa@x.com", URL, "production");
    expect(linha).toContain("pessoa@x.com");
    expect(linha).toContain("NÃO saiu");
  });

  it("em desenvolvimento e teste mantém o link — é assim que se testa sem SMTP", () => {
    expect(linhaDeLinkNaoEnviado("reset", "p@x.com", URL, "development")).toContain(URL);
    expect(linhaDeLinkNaoEnviado("reset", "p@x.com", URL, "test")).toContain(URL);
  });
});
