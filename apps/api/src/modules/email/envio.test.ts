import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { conferirDestinoPermitido, conferirAnexos } from "./envio.service.js";
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

  it("recusa com mensagem amigável (sem caminho de disco) quando um anexo temporário não existe mais — cobre o reenvio depois de falha do SMTP", async () => {
    const idInexistente = randomUUID();
    await expect(
      conferirAnexos(userId, [{ id: idInexistente, nome: "sumiu.pdf" }]),
    ).rejects.toThrow(/não está mais disponível/i);
  });
});
