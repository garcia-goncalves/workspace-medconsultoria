import { describe, it, expect } from "vitest";
import { decidirPastas, type PastaDoServidor } from "./pastas.service.js";

/**
 * O que este Dovecot devolve de verdade (sondado ao vivo em 04/08/2026, caixa de teste e
 * caixa real). Repare no par que causou o bug das DUAS pastas de spam na coluna: o servidor
 * tem `Junk` com o selo `\Junk` e `INBOX.spam` sem selo nenhum — e a inscrita, a que o webmail
 * mostra e onde o filtro entrega, é justamente a que NÃO tem o selo.
 */
const SERVIDOR_REAL: PastaDoServidor[] = [
  { caminho: "INBOX", specialUse: "\\Inbox", inscrita: true },
  { caminho: "Sent", specialUse: "\\Sent", inscrita: true },
  { caminho: "Drafts", specialUse: "\\Drafts", inscrita: true },
  { caminho: "Junk", specialUse: "\\Junk", inscrita: false },
  { caminho: "Trash", specialUse: "\\Trash", inscrita: true },
  { caminho: "INBOX.spam", specialUse: null, inscrita: true },
];

describe("decidirPastas — o caso real do servidor", () => {
  const r = decidirPastas(SERVIDOR_REAL);

  it("mostra UMA pasta de spam, não duas", () => {
    expect(r.filter((p) => p.nome === "Spam")).toHaveLength(1);
    expect(r.map((p) => p.caminho)).not.toContain("Junk");
  });

  it("a que fica é a inscrita, que é onde o spam realmente cai", () => {
    const spam = r.find((p) => p.papel === "JUNK");
    expect(spam?.caminho).toBe("INBOX.spam");
  });

  it("dá papel de spam a quem não tem SPECIAL-USE, pelo nome", () => {
    const spam = r.find((p) => p.caminho === "INBOX.spam")!;
    expect(spam.papel).toBe("JUNK");
    expect(spam.nome).toBe("Spam");
    expect(spam.ordem).toBe(8);
  });

  it("não mexe nas pastas que já vinham certas", () => {
    expect(r.find((p) => p.caminho === "INBOX")).toMatchObject({ papel: "INBOX", nome: "Caixa de entrada", ordem: 0 });
    expect(r.find((p) => p.caminho === "Sent")).toMatchObject({ papel: "SENT", nome: "Enviados" });
  });
});

describe("decidirPastas — inscrição", () => {
  it("esconde pasta não inscrita: o webmail também não mostra", () => {
    const r = decidirPastas([
      { caminho: "INBOX", specialUse: "\\Inbox", inscrita: true },
      { caminho: "INBOX.velharia", specialUse: null, inscrita: false },
    ]);
    expect(r.map((p) => p.caminho)).toEqual(["INBOX"]);
  });

  it("a INBOX entra mesmo sem inscrição — sem ela não há caixa de e-mail", () => {
    const r = decidirPastas([
      { caminho: "INBOX", specialUse: "\\Inbox", inscrita: false },
      { caminho: "Sent", specialUse: "\\Sent", inscrita: true },
    ]);
    expect(r.map((p) => p.caminho)).toContain("INBOX");
  });

  it("servidor que não informa inscrição nenhuma mostra TUDO, em vez de esvaziar a coluna", () => {
    const r = decidirPastas([
      { caminho: "INBOX", specialUse: "\\Inbox", inscrita: false },
      { caminho: "Sent", specialUse: "\\Sent", inscrita: false },
      { caminho: "INBOX.clientes", specialUse: null, inscrita: false },
    ]);
    expect(r).toHaveLength(3);
  });
});

describe("decidirPastas — papel inferido pelo nome", () => {
  it.each([
    ["INBOX.Lixeira", "TRASH", "Lixeira"],
    ["INBOX.Enviados", "SENT", "Enviados"],
    ["INBOX.Rascunhos", "DRAFTS", "Rascunhos"],
    ["INBOX.Arquivo", "ARCHIVE", "Arquivados"],
    ["INBOX.junk", "JUNK", "Spam"],
  ])("%s vira %s", (caminho, papel, nome) => {
    const r = decidirPastas([
      { caminho: "INBOX", specialUse: "\\Inbox", inscrita: true },
      { caminho, specialUse: null, inscrita: true },
    ]);
    expect(r.find((p) => p.caminho === caminho)).toMatchObject({ papel, nome });
  });

  it("pasta comum continua com o último segmento do caminho", () => {
    const r = decidirPastas([
      { caminho: "INBOX", specialUse: "\\Inbox", inscrita: true },
      { caminho: "INBOX.clientes", specialUse: null, inscrita: true },
    ]);
    expect(r.find((p) => p.caminho === "INBOX.clientes")!.nome).toBe("clientes");
    expect(r.find((p) => p.caminho === "INBOX.clientes")!.papel).toBeNull();
  });

  it("SPECIAL-USE ganha do nome: o selo do servidor é a verdade", () => {
    const r = decidirPastas([
      { caminho: "INBOX", specialUse: "\\Inbox", inscrita: true },
      { caminho: "INBOX.spam", specialUse: "\\Archive", inscrita: true },
    ]);
    expect(r.find((p) => p.caminho === "INBOX.spam")!.papel).toBe("ARCHIVE");
  });
});

describe("decidirPastas — empate de nome", () => {
  it("mostra o caminho para desempatar, em vez de esconder pasta que pode ter mensagem", () => {
    const r = decidirPastas([
      { caminho: "INBOX", specialUse: "\\Inbox", inscrita: true },
      { caminho: "INBOX.clientes", specialUse: null, inscrita: true },
      { caminho: "INBOX.antigos.clientes", specialUse: null, inscrita: true },
    ]);
    const nomes = r.filter((p) => p.caminho.endsWith("clientes")).map((p) => p.nome);
    expect(nomes).toHaveLength(2);
    expect(new Set(nomes).size, "os dois rótulos são distintos").toBe(2);
    expect(nomes.some((n) => n.includes("antigos"))).toBe(true);
  });
});
