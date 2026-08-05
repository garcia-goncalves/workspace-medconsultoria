import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Testa as DUAS procedures de preparo com o Prisma dublado — de propósito, e não uma guarda
 * estática nos moldes de `Escrever.wiring.test.ts`:
 *
 *  - a decisão que precisa de rede (achado 1 da revisão de segurança da fase 2A) é de
 *    COMPORTAMENTO, não de texto: resposta pode restaurar a imagem remota da citação,
 *    encaminhamento NUNCA pode. Uma guarda estática travaria a linha `restaurarImagensNoEnvio:
 *    false`, mas continuaria verde se a decisão vazasse por outro caminho (um replace de
 *    `data-src-bloqueada` copiado para dentro do fluxo, por exemplo — exatamente o "não faça
 *    isso" registrado em `citacao.ts`). Aqui o que se afirma é o HTML que sai.
 *  - `citacao.test.ts` já trava a função pura `montarCitacao`; o buraco era a FIAÇÃO: trocar
 *    `false` por `true` em `prepararEncaminhamento` reabria o vazamento com a bateria inteira
 *    verde. Estes testes falham nessa troca.
 *
 * Prisma dublado porque nenhuma das duas procedures toca IMAP/SMTP: elas só leem a mensagem e
 * montam texto. Dobrar a leitura deixa o teste rodar sem banco e sem rede.
 */
const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@app/db", () => ({
  prisma: {
    emailMensagem: { findFirst },
    emailAnexo: { findMany: vi.fn() },
  },
}));

const { prepararResposta, prepararEncaminhamento } = await import("./envio.service.js");

/** Pixel de rastreio do e-mail original — o dado que não pode ser repassado ao cliente. */
const PIXEL = "https://rastreio.exemplo.com/pixel.png";

function mensagem(sobrescreve: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    deNome: "Cliente Fulano",
    deEmail: "cliente@exemplo.com",
    dataEm: new Date("2026-08-01T12:00:00Z"),
    assunto: "Proposta",
    corpoHtml: `<p>segue a proposta</p><img src="${PIXEL}">`,
    corpoTexto: null,
    enderecos: [
      { papel: "PARA", endereco: "eu@medconsultoria.com.br" },
      { papel: "CC", endereco: "socio@exemplo.com" },
    ],
    pasta: { caixa: { email: "eu@medconsultoria.com.br" } },
    anexos: [{ id: "anx-1", nome: "proposta.pdf", tamanho: 12345 }],
    ...sobrescreve,
  };
}

beforeEach(() => {
  findFirst.mockReset();
});

describe("imagem remota na citação: resposta restaura, encaminhamento NUNCA", () => {
  it("prepararResposta manda a citação de ENVIO com a imagem remota restaurada", async () => {
    findFirst.mockResolvedValue(mensagem());
    const r = await prepararResposta("user-1", "msg-1", false);
    expect(r.citacaoEnvio).toContain(`src="${PIXEL}"`);
    // O preview (tela de quem escreve) continua bloqueado nos dois modos.
    expect(r.citacaoPreview).not.toContain(`src="${PIXEL}"`);
  });

  it("prepararEncaminhamento NÃO repassa a imagem remota ao terceiro — nem na citação de envio", async () => {
    findFirst.mockResolvedValue(mensagem());
    const r = await prepararEncaminhamento("user-1", "msg-1");
    expect(r.citacaoEnvio).not.toContain(`src="${PIXEL}"`);
    expect(r.citacaoPreview).not.toContain(`src="${PIXEL}"`);
  });
});

describe("anexos do original vão no contrato do encaminhamento", () => {
  it("prepararEncaminhamento devolve os anexos do e-mail original (id, nome, tamanho)", async () => {
    findFirst.mockResolvedValue(mensagem());
    const r = await prepararEncaminhamento("user-1", "msg-1");
    expect(r.anexos).toEqual([{ id: "anx-1", nome: "proposta.pdf", tamanho: 12345 }]);
  });

  it("devolve lista vazia quando o original não tem anexo", async () => {
    findFirst.mockResolvedValue(mensagem({ anexos: [] }));
    const r = await prepararEncaminhamento("user-1", "msg-1");
    expect(r.anexos).toEqual([]);
  });
});

describe("mensagem sem corpo guardado (acima do teto de `abrirMensagem`) falha alto", () => {
  it("prepararResposta recusa em vez de devolver citação vazia", async () => {
    findFirst.mockResolvedValue(mensagem({ corpoHtml: null, corpoTexto: null }));
    await expect(prepararResposta("user-1", "msg-1", false)).rejects.toThrow(/webmail/i);
  });

  it("prepararEncaminhamento recusa em vez de mandar um 'Enc:' de corpo vazio", async () => {
    findFirst.mockResolvedValue(mensagem({ corpoHtml: null, corpoTexto: null }));
    await expect(prepararEncaminhamento("user-1", "msg-1")).rejects.toThrow(/webmail/i);
  });

  it("mensagem só com corpo em TEXTO continua passando", async () => {
    findFirst.mockResolvedValue(mensagem({ corpoHtml: null, corpoTexto: "só texto" }));
    const r = await prepararEncaminhamento("user-1", "msg-1");
    expect(r.citacaoEnvio).toContain("só texto");
  });
});
