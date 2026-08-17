import { describe, it, expect } from "vitest";
import { simpleParser } from "mailparser";

/**
 * Guarda de dependência do módulo de e-mail.
 *
 * `mailparser` → `html-to-text` → **`deepmerge-ts`**, que mescla as opções a cada mensagem
 * lida. Em 17/08/2026 o portão de auditoria da CI (ADR-107) reprovou o build por uma falha
 * ALTA nova no `deepmerge-ts` <8 (GHSA-ggr8-5vv4-36mx, exaustão de pilha ao mesclar grafos
 * recursivos), e a correção foi um `pnpm.overrides` que **pula uma versão maior**:
 * 7.1.5 → 8.0.1.
 *
 * Bump de versão maior por baixo do e-mail não se verifica com `typecheck`: o defeito
 * apareceria como caixa de entrada em branco, em produção. O teste entra pelo `mailparser`,
 * que é a dependência que a API realmente declara — e é ele quem aciona a cadeia inteira.
 */

describe("leitura de e-mail (mailparser)", () => {
  it("lê assunto, remetente e tira o texto de uma mensagem só-HTML", async () => {
    const bruto = [
      "From: Fulano <teste@exemplo.com>",
      "To: destino@exemplo.com",
      "Subject: Assunto de prova",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Mensagem <b>com HTML</b>.</p>",
    ].join("\r\n");

    const msg = await simpleParser(bruto);
    expect(msg.subject).toBe("Assunto de prova");
    expect(msg.from?.text).toContain("teste@exemplo.com");
    // É daqui que sai o TRECHO mostrado na ficha do cliente (a equipe vê trecho, nunca o
    // corpo — ADR-95). Vazio aqui = card de e-mail em branco na tela.
    expect((msg.text ?? "").trim()).toContain("Mensagem com HTML.");
    expect(msg.text).not.toContain("<b>");
  });

  it("HTML aninhado com link vira texto legível, sem sobrar marcação", async () => {
    // Estrutura recursiva de verdade — é o formato que o CVE do deepmerge-ts atacava.
    const bruto = [
      "From: Clínica <contato@exemplo.com>",
      "Subject: Documentos do credenciamento",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<div><table><tr><td><ul><li>Diploma</li><li>CRM</li></ul></td></tr></table>",
      '<p>Detalhes em <a href="https://exemplo.com.br/doc">nosso site</a>.</p></div>',
    ].join("\r\n");

    const msg = await simpleParser(bruto);
    const texto = (msg.text ?? "").trim();
    expect(texto).toContain("Diploma");
    expect(texto).toContain("CRM");
    expect(texto).toContain("nosso site");
    expect(texto).not.toMatch(/<\/?(div|table|ul|li|a)\b/i);
  });

  it("anexo continua sendo reconhecido, com nome e tipo", async () => {
    // O anexo vira documento do cliente com um clique (ADR-99). Se o parser parar de
    // enxergá-lo, o botão some sem erro nenhum na tela.
    const bruto = [
      "From: Fulano <teste@exemplo.com>",
      "Subject: Segue o documento",
      'Content-Type: multipart/mixed; boundary="LIMITE"',
      "",
      "--LIMITE",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Segue anexo.",
      "--LIMITE",
      'Content-Type: text/plain; name="crm.txt"',
      "Content-Disposition: attachment; filename=\"crm.txt\"",
      "",
      "CRM 123456",
      "--LIMITE--",
    ].join("\r\n");

    const msg = await simpleParser(bruto);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0]?.filename).toBe("crm.txt");
  });
});
