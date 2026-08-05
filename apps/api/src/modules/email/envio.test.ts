import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { conferirDestinoPermitido, conferirAnexos, montarMime } from "./envio.service.js";
import { pastaTemp, caminhoTemp } from "../../http/email-anexo.js";

describe("conferirDestinoPermitido (fora de produção)", () => {
  it("deixa passar os dois endereços de teste", () => {
    expect(() => conferirDestinoPermitido(["tibamooca@gmail.com"])).not.toThrow();
    expect(() => conferirDestinoPermitido(["contato@medconsultoria.com.br"])).not.toThrow();
  });

  it("barra qualquer outro destino — o SMTP aqui é real e o cliente também seria", () => {
    expect(() => conferirDestinoPermitido(["cliente.de.verdade@exemplo.com"])).toThrow(/desenvolvimento/i);
  });

  it("barra se UM dos destinos não estiver liberado", () => {
    expect(() => conferirDestinoPermitido(["tibamooca@gmail.com", "outro@exemplo.com"])).toThrow();
  });

  it("não se deixa enganar por maiúsculas ou espaço", () => {
    expect(() => conferirDestinoPermitido([" TibaMooca@Gmail.com "])).not.toThrow();
  });
});

// Regra pura, sem rede (sem IMAP/SMTP) — só arquivo local, igual ao que `caminhoTemp` já usa.
describe("conferirAnexos (teto agregado + existência, antes de compor)", () => {
  const userId = `teste-conferir-anexos-${randomUUID()}`;

  afterAll(async () => {
    await rm(pastaTemp(userId), { recursive: true, force: true });
  });

  async function criarTemp(tamanhoBytes: number): Promise<{ id: string; nome: string }> {
    const id = randomUUID();
    await mkdir(pastaTemp(userId), { recursive: true });
    await writeFile(caminhoTemp(userId, id), Buffer.alloc(tamanhoBytes));
    return { id, nome: `arquivo-${tamanhoBytes}.bin` };
  }

  it("não lança para lista vazia (nenhum anexo)", async () => {
    await expect(conferirAnexos(userId, [])).resolves.toBeUndefined();
  });

  it("aceita anexos cuja soma fica dentro do teto de 25 MB", async () => {
    const a = await criarTemp(1024);
    const b = await criarTemp(2048);
    await expect(conferirAnexos(userId, [a, b])).resolves.toBeUndefined();
  });

  it("recusa quando a soma passa do teto de 25 MB, com o tamanho total e o limite na mensagem", async () => {
    const grande = await criarTemp(20 * 1024 * 1024);
    const outroGrande = await criarTemp(10 * 1024 * 1024);
    await expect(conferirAnexos(userId, [grande, outroGrande])).rejects.toThrow(
      /anexos somam 30\.0 MB.*limite total é 25 MB/i,
    );
  });

  it("conta os anexos rebaixados do original no MESMO teto — encaminhar um e-mail pesado com mais um arquivo estoura", async () => {
    const anexado = await criarTemp(5 * 1024 * 1024);
    // 24 MB de anexos do e-mail original (vêm do IMAP, não do nosso disco) + 5 MB anexados aqui.
    await expect(conferirAnexos(userId, [anexado], 24 * 1024 * 1024)).rejects.toThrow(
      /anexos somam 29\.0 MB.*limite total é 25 MB/i,
    );
  });

  it("recusa com mensagem amigável (sem caminho de disco) quando um anexo temporário não existe mais — é o caso do compose deixado aberto além das 24h da varredura", async () => {
    const idInexistente = randomUUID();
    await expect(
      conferirAnexos(userId, [{ id: idInexistente, nome: "sumiu.pdf" }]),
    ).rejects.toThrow(/não está mais disponível/i);
  });
});

/**
 * O MIME construído é inspecionado DE VERDADE (o buffer, não o código): o defeito que estes
 * testes travam é do `MailComposer`, não nosso — `html: ""` é falsy para ele e a mensagem
 * COLAPSA no anexo. Ler o código não pega isso; só o Content-Type do buffer pega.
 */
describe("montarMime (o anexo tem de sair como ANEXO)", () => {
  const de = { nome: "Med Consultoria", email: "contato@medconsultoria.com.br" };
  const base = {
    de,
    para: ["tibamooca@gmail.com"],
    cc: [] as string[],
    cco: [] as string[],
    assunto: "Segue o contrato",
  };
  const anexo = { filename: "contrato.html", content: Buffer.from("<h1>anexo de terceiro</h1>") };

  /** Só o bloco de cabeçalhos da mensagem — é ali que o Content-Type da RAIZ aparece. */
  function cabecalhos(mime: Buffer): string {
    return mime.toString("utf8").split(/\r?\n\r?\n/)[0] ?? "";
  }

  /**
   * Cabeçalhos de CADA parte do multipart. Existe por causa do SEGUNDO rosto do mesmo defeito:
   * com dois ou mais anexos, `html: ""` deixa a raiz `multipart/mixed` e os nomes de arquivo
   * todos no lugar — só que SEM parte de corpo nenhuma. Olhar só a raiz e os `filename=` passa
   * verde com o defeito de volta; quem discrimina é contar as partes e achar a que não é anexo.
   */
  function partesDo(mime: Buffer): string[] {
    const texto = mime.toString("utf8");
    const fronteira = /boundary="([^"]+)"/.exec(cabecalhos(mime))?.[1];
    if (!fronteira) return [];
    return (
      texto
        .split(`--${fronteira}`)
        // fora o preâmbulo (antes da 1ª fronteira) e o epílogo (depois da fronteira final).
        .slice(1, -1)
        .map((p) => (p.split(/\r?\n\r?\n/)[0] ?? "").trim())
    );
  }

  const ehAnexo = (cabecalhosDaParte: string) => /Content-Disposition:\s*attachment/i.test(cabecalhosDaParte);

  it("com CORPO VAZIO e um anexo, ainda monta multipart/mixed — o anexo não vira o corpo", async () => {
    const mime = await montarMime({ ...base, corpoHtml: "", anexos: [anexo] });
    expect(cabecalhos(mime)).toMatch(/Content-Type: multipart\/mixed/i);
    // O nome do arquivo tem de aparecer como PARTE, nunca no Content-Type da mensagem inteira.
    expect(cabecalhos(mime)).not.toMatch(/contrato\.html/);
    expect(mime.toString("utf8")).toMatch(/Content-Disposition: attachment; filename=.*contrato\.html/i);
  });

  it("com corpo preenchido e um anexo, segue multipart/mixed (o caso que já funcionava)", async () => {
    const mime = await montarMime({ ...base, corpoHtml: "<p>segue</p>", anexos: [anexo] });
    expect(cabecalhos(mime)).toMatch(/Content-Type: multipart\/mixed/i);
  });

  it("com corpo vazio e DOIS anexos, os dois saem como anexo E a mensagem ainda tem um corpo", async () => {
    const mime = await montarMime({
      ...base,
      corpoHtml: "",
      anexos: [anexo, { filename: "recibo.pdf", content: Buffer.from("%PDF-1.4") }],
    });
    const texto = mime.toString("utf8");
    expect(cabecalhos(mime)).toMatch(/Content-Type: multipart\/mixed/i);
    expect(texto).toMatch(/filename=.*contrato\.html/i);
    expect(texto).toMatch(/filename=.*recibo\.pdf/i);

    // A asserção que DISCRIMINA: sem `CORPO_MINIMO` o `MailComposer` monta as duas partes de
    // anexo e mais nada — mensagem sem corpo nenhum, que sai como "e-mail vazio com 2 anexos"
    // e nem sempre é exibida. Tem de haver 3 partes: o corpo e os dois anexos.
    const partes = partesDo(mime);
    expect(partes, "corpo + 2 anexos = 3 partes").toHaveLength(3);
    const corpo = partes.filter((p) => !ehAnexo(p));
    expect(corpo, "faltou a parte de CORPO — o e-mail sairia só com anexos").toHaveLength(1);
    expect(corpo[0]).toMatch(/Content-Type: text\/html/i);
    expect(partes.filter(ehAnexo)).toHaveLength(2);
  });

  it("sem anexo nenhum e com corpo, sai text/html simples", async () => {
    const mime = await montarMime({ ...base, corpoHtml: "<p>oi</p>", anexos: [] });
    expect(cabecalhos(mime)).toMatch(/Content-Type: text\/html/i);
  });
});
