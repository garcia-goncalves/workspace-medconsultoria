import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pastaTemp, caminhoTemp } from "../../http/email-anexo.js";

/**
 * Ciclo de vida do anexo temporário num envio. O defeito que isto trava: os temporários eram
 * apagados num `finally`, ou seja, TAMBÉM quando o SMTP recusava. A sequência era um beco sem
 * saída — 3 anexos → Enviar → SMTP recusa (greylisting, timeout, 535) → toast de erro → a pessoa
 * clica Enviar de novo → "Um dos anexos não está mais disponível", com os arquivos já mortos e
 * os ids mortos ainda na lista da tela, de modo que anexar de novo não resolvia.
 *
 * SMTP e IMAP dublados: o que se afirma aqui é o que sobra NO DISCO, não a rede.
 */
const { comSmtp, comCaixa, caixaFindFirst, pastaFindFirst, mensagemFindFirst, anexoFindMany } = vi.hoisted(
  () => ({
    comSmtp: vi.fn(),
    comCaixa: vi.fn(),
    caixaFindFirst: vi.fn(),
    pastaFindFirst: vi.fn(),
    mensagemFindFirst: vi.fn(),
    anexoFindMany: vi.fn(),
  }),
);

vi.mock("@app/db", () => ({
  prisma: {
    caixaEmail: { findFirst: caixaFindFirst },
    caixaPasta: { findFirst: pastaFindFirst },
    emailMensagem: { findFirst: mensagemFindFirst, update: vi.fn() },
    emailAnexo: { findMany: anexoFindMany },
  },
}));
vi.mock("./smtp.js", () => ({ comSmtp }));
vi.mock("./imap.js", () => ({ comCaixa }));

const { enviarMensagem } = await import("./envio.service.js");

const userId = `teste-envio-anexos-${randomUUID()}`;

async function criarTemp(): Promise<{ id: string; nome: string }> {
  const id = randomUUID();
  await mkdir(pastaTemp(userId), { recursive: true });
  await writeFile(caminhoTemp(userId, id), Buffer.from("conteudo do anexo"));
  return { id, nome: "contrato.pdf" };
}

function entrada(anexos: { id: string; nome: string }[]) {
  return {
    caixaId: "caixa-1",
    // Endereço de teste do dono — o SMTP aqui é dublado, nada sai de verdade.
    para: ["tibamooca@gmail.com"],
    cc: [],
    cco: [],
    assunto: "Segue o contrato",
    corpoHtml: "",
    anexos,
    anexosOriginais: [],
  };
}

beforeEach(() => {
  comSmtp.mockReset();
  comCaixa.mockReset();
  caixaFindFirst.mockReset();
  pastaFindFirst.mockReset();
  mensagemFindFirst.mockReset();
  anexoFindMany.mockReset();
  caixaFindFirst.mockResolvedValue({
    id: "caixa-1",
    email: "contato@medconsultoria.com.br",
    nomeExibicao: "Med Consultoria",
    assinatura: null,
  });
  // Sem pasta de Enviados: o PASSO 2 sai do caminho e o teste não precisa de IMAP.
  pastaFindFirst.mockResolvedValue(null);
});

afterAll(async () => {
  await rm(pastaTemp(userId), { recursive: true, force: true });
});

describe("anexos temporários x falha do SMTP", () => {
  it("SMTP recusa: o erro sobe e os anexos CONTINUAM no disco para o reenvio", async () => {
    const a = await criarTemp();
    const b = await criarTemp();
    comSmtp.mockRejectedValue(Object.assign(new Error("450 4.2.0 greylisted"), { responseCode: 450 }));

    await expect(enviarMensagem(userId, entrada([a, b]))).rejects.toThrow(/greylisted/);

    expect(existsSync(caminhoTemp(userId, a.id)), "o anexo não pode morrer num envio que falhou").toBe(true);
    expect(existsSync(caminhoTemp(userId, b.id)), "o anexo não pode morrer num envio que falhou").toBe(true);
  });

  it("reenviar depois da falha funciona — os mesmos ids ainda valem", async () => {
    const a = await criarTemp();
    comSmtp.mockRejectedValueOnce(new Error("535 5.7.8 authentication failed"));
    await expect(enviarMensagem(userId, entrada([a]))).rejects.toThrow(/535/);

    comSmtp.mockResolvedValueOnce(undefined);
    await expect(enviarMensagem(userId, entrada([a]))).resolves.toEqual({
      enviado: true,
      copiaEmEnviados: false,
    });
  });

  it("envio aceito: aí sim os temporários são apagados (são de uso único)", async () => {
    const a = await criarTemp();
    comSmtp.mockResolvedValue(undefined);

    await expect(enviarMensagem(userId, entrada([a]))).resolves.toMatchObject({ enviado: true });
    expect(existsSync(caminhoTemp(userId, a.id)), "temporário de envio bem-sucedido tem de sumir").toBe(false);
  });
});

/**
 * Encaminhar o e-mail cujo ponto inteiro É o PDF anexo é o caso normal — o anexo do original
 * precisa sair no MIME. IMAP dublado: o que se afirma é que o conteúdo INTEIRO baixado vira uma
 * parte do e-mail que sai, e que o lock da caixa é sempre devolvido.
 */
describe("anexos do e-mail original num encaminhamento", () => {
  const PEDACOS = ["%PDF-1.4 comeco", " meio do arquivo", " fim do arquivo"];
  const CONTEUDO = PEDACOS.join("");
  let solturasDeLock = 0;

  /** Original citado, com posse já conferida por `originalDoUsuario` (filtra pela caixa da pessoa). */
  function original() {
    return {
      id: "msg-1",
      uid: 42n,
      messageId: "<original@exemplo.com>",
      referencias: "",
      assunto: "Proposta",
      pastaId: "pasta-1",
      pasta: { caminho: "INBOX", caixaId: "caixa-1" },
    };
  }

  /** IMAP de mentira: entrega o conteúdo em VÁRIOS pedaços, como o socket de verdade entrega. */
  function imapQueEntrega() {
    return async (_caixaId: string, fn: (c: unknown) => Promise<unknown>) =>
      fn({
        getMailboxLock: async () => ({
          release: () => {
            solturasDeLock += 1;
          },
        }),
        download: async () => ({ content: Readable.from(PEDACOS.map((p) => Buffer.from(p))) }),
      });
  }

  function encaminhamento(anexosOriginais: string[]) {
    return { ...entrada([]), assunto: "Enc: Proposta", encaminhando: "msg-1", anexosOriginais };
  }

  beforeEach(() => {
    solturasDeLock = 0;
    mensagemFindFirst.mockResolvedValue(original());
    anexoFindMany.mockResolvedValue([
      { id: "anx-1", nome: "proposta.pdf", tamanho: CONTEUDO.length, parte: "2" },
    ]);
  });

  it("o anexo do original entra INTEIRO no MIME que sai, como parte separada", async () => {
    comCaixa.mockImplementation(imapQueEntrega());
    let mimeEnviado = "";
    comSmtp.mockImplementation(async (_id: string, fn: (t: unknown) => Promise<unknown>) =>
      fn({
        sendMail: async (m: { raw: Buffer }) => {
          mimeEnviado = m.raw.toString("utf8");
        },
      }),
    );

    await expect(enviarMensagem(userId, encaminhamento(["anx-1"]))).resolves.toMatchObject({ enviado: true });

    expect(mimeEnviado.split(/\r?\n\r?\n/)[0]).toMatch(/Content-Type: multipart\/mixed/i);
    expect(mimeEnviado).toMatch(/filename=.*proposta\.pdf/i);
    // Conteúdo COMPLETO, não só o primeiro pedaço: é o defeito do stream devolvido para fora do
    // `comCaixa`, que cortava o anexo em silêncio acima de ~64 KB.
    expect(mimeEnviado).toContain(Buffer.from(CONTEUDO).toString("base64"));
    expect(solturasDeLock, "o lock da caixa tem de ser devolvido").toBe(1);
  });

  it("id de anexo que não é daquela mensagem é recusado antes de tocar no IMAP", async () => {
    anexoFindMany.mockResolvedValue([]);
    comCaixa.mockImplementation(imapQueEntrega());

    await expect(enviarMensagem(userId, encaminhamento(["anx-de-outra-pessoa"]))).rejects.toThrow(
      /não está mais disponível/i,
    );
    expect(comCaixa).not.toHaveBeenCalled();
    expect(comSmtp).not.toHaveBeenCalled();
  });

  it("os anexos rebaixados contam no teto de 25 MB junto com os anexados aqui", async () => {
    const anexado = await criarTemp();
    anexoFindMany.mockResolvedValue([
      { id: "anx-1", nome: "gigante.pdf", tamanho: 25 * 1024 * 1024, parte: "2" },
    ]);

    await expect(enviarMensagem(userId, { ...encaminhamento(["anx-1"]), anexos: [anexado] })).rejects.toThrow(
      /limite total é 25 MB/i,
    );
    expect(comSmtp).not.toHaveBeenCalled();
  });

  it("servidor de e-mail que não devolve a parte falha ANTES de enviar — nada de encaminhamento sem o anexo", async () => {
    comCaixa.mockImplementation(
      async (_caixaId: string, fn: (c: unknown) => Promise<unknown>) =>
        fn({
          getMailboxLock: async () => ({
            release: () => {
              solturasDeLock += 1;
            },
          }),
          download: async () => null,
        }),
    );

    await expect(enviarMensagem(userId, encaminhamento(["anx-1"]))).rejects.toThrow(/não devolveu o anexo/i);
    expect(comSmtp).not.toHaveBeenCalled();
    expect(solturasDeLock, "o lock tem de ser devolvido mesmo quando o download falha").toBe(1);
  });
});
