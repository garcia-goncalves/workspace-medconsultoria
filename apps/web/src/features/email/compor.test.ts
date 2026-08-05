import { describe, expect, it } from "vitest";
import {
  dividirEmails,
  emailValido,
  formatarTamanho,
  montarCorpoEnvio,
  temConteudoParaRascunho,
  textoParaHtml,
} from "./compor";

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

  // Colar "Nome <email@x.com>" é o gesto mais natural de quem copia de outro cliente de e-mail
  // (Gmail, Outlook, webmail). Quebrar por espaço transformava isso em dois "endereços"
  // inválidos e o envio morria em "Endereço de e-mail inválido: Nome".
  it("aceita o formato com nome: descarta o nome e fica com o endereço", () => {
    expect(dividirEmails("Thaís Garcia <thais@medconsultoria.com.br>")).toEqual([
      "thais@medconsultoria.com.br",
    ]);
  });

  it("aceita nome ENTRE ASPAS com vírgula dentro (o jeito do Outlook)", () => {
    expect(dividirEmails('"Garcia, Thaís" <thais@medconsultoria.com.br>, b@x.com')).toEqual([
      "thais@medconsultoria.com.br",
      "b@x.com",
    ]);
  });

  it("vários com nome, separados por vírgula/ponto-e-vírgula", () => {
    expect(dividirEmails("Ana <ana@x.com>, Bruno <bruno@x.com>; Célia <celia@x.com>")).toEqual([
      "ana@x.com",
      "bruno@x.com",
      "celia@x.com",
    ]);
  });

  it("mistura de formato com nome e e-mail solto na mesma colagem", () => {
    expect(dividirEmails("Ana <ana@x.com>, solto@x.com")).toEqual(["ana@x.com", "solto@x.com"]);
  });

  it("dois com nome separados só por espaço (colagem sem vírgula)", () => {
    expect(dividirEmails("Ana <ana@x.com> Bruno <bruno@x.com>")).toEqual(["ana@x.com", "bruno@x.com"]);
  });

  // O caso que a primeira versão do formato-com-nome ENGOLIA em silêncio: quem digita um
  // endereço, dá espaço e cola um contato do Outlook mandava o e-mail só para o segundo. Endereço
  // que some sem aviso é pior que erro na cara — e-mail enviado não tem desfazer.
  it("endereço solto ANTES de um com nome, separados por espaço — nenhum dos dois pode sumir", () => {
    expect(dividirEmails("cliente@exemplo.com Thaís <thais@medconsultoria.com.br>")).toEqual([
      "cliente@exemplo.com",
      "thais@medconsultoria.com.br",
    ]);
  });

  it("endereço solto DEPOIS de um com nome, na mesma colagem, na ordem em que foram digitados", () => {
    expect(dividirEmails("Thaís <thais@medconsultoria.com.br> cliente@exemplo.com")).toEqual([
      "thais@medconsultoria.com.br",
      "cliente@exemplo.com",
    ]);
  });

  it("três misturados sem vírgula nenhuma", () => {
    expect(dividirEmails("a@x.com Ana <ana@x.com> b@x.com")).toEqual(["a@x.com", "ana@x.com", "b@x.com"]);
  });

  it("endereço entre < > sem nome nenhum", () => {
    expect(dividirEmails("<so-o-endereco@x.com>")).toEqual(["so-o-endereco@x.com"]);
  });
});

describe("formatarTamanho", () => {
  it("bytes, KB e MB — com vírgula decimal, como se lê em português", () => {
    expect(formatarTamanho(0)).toBe("0 B");
    expect(formatarTamanho(900)).toBe("900 B");
    expect(formatarTamanho(2048)).toBe("2 KB");
    expect(formatarTamanho(1024 * 1024)).toBe("1,0 MB");
    expect(formatarTamanho(25 * 1024 * 1024)).toBe("25,0 MB");
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
