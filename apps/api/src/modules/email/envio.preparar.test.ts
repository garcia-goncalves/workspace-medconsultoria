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

const { prepararResposta, prepararEncaminhamento, montarMime } = await import("./envio.service.js");

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
    // `corpoEm` é quem responde "o corpo já foi buscado?" — ver o describe do fim do arquivo.
    corpoEm: new Date("2026-08-01T12:05:00Z"),
    tamanho: 12_345,
    enderecos: [
      { papel: "PARA", endereco: "eu@medconsultoria.com.br" },
      { papel: "CC", endereco: "socio@exemplo.com" },
    ],
    pasta: { caixa: { email: "eu@medconsultoria.com.br" } },
    anexos: [{ id: "anx-1", nome: "proposta.pdf", tamanho: 12345, cid: null }],
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

  // `sync.service.ts` grava como `EmailAnexo` também a parte EMBUTIDA (`disposition: inline` com
  // `cid`) — a logo da assinatura de quem escreveu, tipicamente `image001.png`. Devolvê-la aqui
  // fazia a tela listar imagem-lixo como anexo e o e-mail encaminhado sair com ela pendurada.
  it("imagem EMBUTIDA na assinatura do remetente NÃO é oferecida como anexo do encaminhamento", async () => {
    findFirst.mockResolvedValue(
      mensagem({
        anexos: [
          { id: "anx-1", nome: "proposta.pdf", tamanho: 12345, cid: null },
          { id: "anx-2", nome: "image001.png", tamanho: 4096, cid: "logo@empresa.com" },
        ],
      }),
    );
    const r = await prepararEncaminhamento("user-1", "msg-1");
    expect(r.anexos).toEqual([{ id: "anx-1", nome: "proposta.pdf", tamanho: 12345 }]);
  });

  it("original SÓ com imagem embutida não oferece anexo nenhum", async () => {
    findFirst.mockResolvedValue(
      mensagem({ anexos: [{ id: "anx-2", nome: "image001.png", tamanho: 4096, cid: "logo@empresa.com" }] }),
    );
    const r = await prepararEncaminhamento("user-1", "msg-1");
    expect(r.anexos).toEqual([]);
  });
});

/**
 * O discriminador é `corpoEm`, NÃO os corpos. `abrirMensagem` (`leitura.service.ts`) grava
 * `corpoEm` assim que baixa e higieniza a mensagem, mesmo que `corpoHtml` e `corpoTexto` saiam
 * os dois nulos — que é o caso do e-mail cujo conteúdo inteiro É o anexo (cliente que manda
 * `contrato.pdf` sem escrever nada, robô de nota fiscal, scanner). Olhar para os corpos proibia
 * justamente encaminhar esse e-mail, com uma tarja que ainda mentia dizendo "grande demais".
 */
describe("guarda de corpo: recusa o que NUNCA foi buscado, não o que é vazio", () => {
  const VAZIOS = { corpoHtml: null, corpoTexto: null };
  const SO_ANEXO = { ...VAZIOS, corpoEm: new Date("2026-08-01T12:05:00Z"), tamanho: 90_000 };
  const NUNCA_ABERTA = { ...VAZIOS, corpoEm: null, tamanho: 90_000 };
  const GRANDE_DEMAIS = { ...VAZIOS, corpoEm: null, tamanho: 30 * 1024 * 1024 };

  it("acima do teto de corpo, `abrirMensagem` nunca vai baixar: manda para o webmail", async () => {
    findFirst.mockResolvedValue(mensagem(GRANDE_DEMAIS));
    await expect(prepararEncaminhamento("user-1", "msg-1")).rejects.toThrow(/webmail/i);
    findFirst.mockResolvedValue(mensagem(GRANDE_DEMAIS));
    await expect(prepararResposta("user-1", "msg-1", false)).rejects.toThrow(/webmail/i);
  });

  it("mensagem ainda não aberta aqui: manda ABRIR — e não fala em webmail nem em tamanho", async () => {
    findFirst.mockResolvedValue(mensagem(NUNCA_ABERTA));
    await expect(prepararEncaminhamento("user-1", "msg-1")).rejects.toThrow(/abra esta mensagem/i);
    findFirst.mockResolvedValue(mensagem(NUNCA_ABERTA));
    await expect(prepararResposta("user-1", "msg-1", false)).rejects.toThrow(/abra esta mensagem/i);
    findFirst.mockResolvedValue(mensagem(NUNCA_ABERTA));
    const erro: unknown = await prepararEncaminhamento("user-1", "msg-1").catch((e: unknown) => e);
    expect((erro as Error).message).not.toMatch(/webmail|grande demais/i);
  });

  it("e-mail que é SÓ ANEXO (corpos vazios, mas já buscados) pode ser encaminhado, com o anexo", async () => {
    findFirst.mockResolvedValue(mensagem(SO_ANEXO));
    const r = await prepararEncaminhamento("user-1", "msg-1");
    expect(r.assunto).toBe("Enc: Proposta");
    expect(r.anexos).toEqual([{ id: "anx-1", nome: "proposta.pdf", tamanho: 12345 }]);
  });

  it("e-mail que é só anexo também pode ser RESPONDIDO", async () => {
    findFirst.mockResolvedValue(mensagem(SO_ANEXO));
    const r = await prepararResposta("user-1", "msg-1", false);
    expect(r.para).toEqual(["cliente@exemplo.com"]);
    expect(r.assunto).toBe("Re: Proposta");
  });

  /**
   * A prova de ponta a ponta do e-mail só-anexo, e o que ela trava MUDOU com a decisão de mandar
   * o cabeçalho de procedência mesmo sem corpo (`citacao.ts`):
   *
   *  - ANTES o corpo que chegava ao `montarMime` era `""`, e quem segurava o MIME era o
   *    `CORPO_MINIMO`. Esse caso continua travado, onde ele de fato mora: `envio.test.ts`
   *    ("com CORPO VAZIO e um anexo…"), que chama `montarMime` com `corpoHtml: ""` direto.
   *  - AGORA o que este teste trava é a PROCEDÊNCIA: encaminhar o contrato do cliente tem de
   *    dizer de quem ele veio. Sem isso, quem recebe vê "Enc: Proposta" e um PDF, e não sabe de
   *    quem é — que é justamente a primeira pergunta que ele faz. O anexo continua sendo anexo.
   */
  it("encaminhar o e-mail só-anexo leva a PROCEDÊNCIA do original, e o anexo continua sendo anexo", async () => {
    findFirst.mockResolvedValue(mensagem(SO_ANEXO));
    const r = await prepararEncaminhamento("user-1", "msg-1");

    expect(r.citacaoEnvio).toContain("Cliente Fulano");
    expect(r.citacaoEnvio).toContain("&lt;cliente@exemplo.com&gt;");
    expect(r.citacaoEnvio).toContain("01/08/2026");
    // Procedência sim, corpo inventado não.
    const dentroDaCitacao = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/.exec(r.citacaoEnvio)?.[1] ?? "";
    expect(dentroDaCitacao.trim()).toBe("");

    const mime = await montarMime({
      de: { nome: "Med Consultoria", email: "contato@medconsultoria.com.br" },
      para: ["tibamooca@gmail.com"],
      cc: [],
      cco: [],
      assunto: r.assunto,
      corpoHtml: r.citacaoEnvio,
      anexos: [{ filename: "proposta.pdf", content: Buffer.from("%PDF-1.4") }],
    });
    const texto = mime.toString("utf8");
    expect(texto.split(/\r?\n\r?\n/)[0]).toMatch(/Content-Type: multipart\/mixed/i);
    expect(texto).toMatch(/Content-Disposition: attachment; filename=.*proposta\.pdf/i);
    // A parte de CORPO existe e é ela que carrega a procedência até quem recebe.
    expect(texto).toMatch(/Content-Type: text\/html[\s\S]*?Cliente Fulano/i);
  });

  it("mensagem só com corpo em TEXTO continua passando", async () => {
    findFirst.mockResolvedValue(mensagem({ corpoHtml: null, corpoTexto: "só texto" }));
    const r = await prepararEncaminhamento("user-1", "msg-1");
    expect(r.citacaoEnvio).toContain("só texto");
  });
});
