import { describe, expect, it } from "vitest";
import { dividirEmails, emailValido, montarCorpoEnvio, temConteudoParaRascunho, textoParaHtml } from "./compor";

describe("dividirEmails", () => {
  it("separa por vírgula, ponto-e-vírgula e espaço", () => {
    expect(dividirEmails("a@x.com, b@x.com;c@x.com d@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com",
    ]);
  });

  it("apara espaços e descarta vazios", () => {
    expect(dividirEmails("  a@x.com ,, ,  b@x.com  ")).toEqual(["a@x.com", "b@x.com"]);
  });

  it("string vazia vira lista vazia", () => {
    expect(dividirEmails("")).toEqual([]);
    expect(dividirEmails("   ")).toEqual([]);
  });
});

describe("emailValido", () => {
  it("aceita e-mail bem formado", () => {
    expect(emailValido("thais@medconsultoria.com.br")).toBe(true);
  });

  it("recusa o que não é e-mail", () => {
    expect(emailValido("nao-e-email")).toBe(false);
    expect(emailValido("")).toBe(false);
    expect(emailValido("a@")).toBe(false);
  });
});

describe("textoParaHtml", () => {
  it("troca quebra de linha por <br>", () => {
    expect(textoParaHtml("linha 1\nlinha 2")).toBe("linha 1<br>linha 2");
  });

  it("trata \\r\\n e \\r isolado", () => {
    expect(textoParaHtml("a\r\nb\rc")).toBe("a<br>b<br>c");
  });

  it("escapa HTML hostil ANTES de converter — nunca produz tag viva", () => {
    const saida = textoParaHtml("<script>alert(1)</script>\n<img src=x onerror=alert(2)>");
    expect(saida).not.toContain("<script>");
    expect(saida).not.toContain("<img");
    expect(saida).toContain("&lt;script&gt;");
    // a quebra de linha ainda vira <br> depois do escape, sem ser destruída pelo escape do '<'
    expect(saida).toContain("<br>");
  });

  it("texto vazio vira string vazia", () => {
    expect(textoParaHtml("")).toBe("");
  });
});

describe("montarCorpoEnvio", () => {
  it("só o texto digitado, sem citação", () => {
    expect(montarCorpoEnvio("Olá", "")).toBe("Olá");
  });

  it("só a citação, sem texto digitado (ex.: encaminhar sem comentário)", () => {
    expect(montarCorpoEnvio("", "<blockquote>oi</blockquote>")).toBe("<blockquote>oi</blockquote>");
  });

  it("texto + citação, separados por uma linha em branco", () => {
    expect(montarCorpoEnvio("Segue abaixo", "<blockquote>oi</blockquote>")).toBe(
      "Segue abaixo<br><br><blockquote>oi</blockquote>",
    );
  });

  it("nada digitado e sem citação vira string vazia", () => {
    expect(montarCorpoEnvio("", "")).toBe("");
  });

  it("NUNCA reescapa a citação — ela já vem como HTML pronto do servidor", () => {
    const citacao = '<blockquote>&lt;já escapado&gt; e <a href="x">link</a></blockquote>';
    expect(montarCorpoEnvio("", citacao)).toBe(citacao);
  });
});

describe("temConteudoParaRascunho", () => {
  const VAZIO = { para: "", cc: "", cco: "", assunto: "", corpo: "", citacao: "" };

  it("tudo vazio não tem conteúdo — abrir e desistir não pode criar rascunho em branco", () => {
    expect(temConteudoParaRascunho(VAZIO)).toBe(false);
  });

  it("só espaços em branco também não conta como conteúdo", () => {
    expect(temConteudoParaRascunho({ ...VAZIO, corpo: "   ", assunto: "\n\t " })).toBe(false);
  });

  it("destinatário digitado já conta, mesmo sem assunto/corpo", () => {
    expect(temConteudoParaRascunho({ ...VAZIO, para: "alguem@exemplo.com" })).toBe(true);
  });

  it("cc digitado conta", () => {
    expect(temConteudoParaRascunho({ ...VAZIO, cc: "copia@exemplo.com" })).toBe(true);
  });

  it("cco digitado conta", () => {
    expect(temConteudoParaRascunho({ ...VAZIO, cco: "oculto@exemplo.com" })).toBe(true);
  });

  it("assunto digitado conta", () => {
    expect(temConteudoParaRascunho({ ...VAZIO, assunto: "Dúvida sobre contrato" })).toBe(true);
  });

  it("corpo digitado conta", () => {
    expect(temConteudoParaRascunho({ ...VAZIO, corpo: "Olá, tudo bem?" })).toBe(true);
  });

  it("só a citação (responder/encaminhar aberto e fechado sem comentar) também conta", () => {
    expect(temConteudoParaRascunho({ ...VAZIO, citacao: "<blockquote>oi</blockquote>" })).toBe(true);
  });
});
