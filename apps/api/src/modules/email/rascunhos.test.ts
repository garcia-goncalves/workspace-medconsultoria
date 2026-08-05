import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ImapFlow } from "imapflow";

/**
 * Os dois defeitos que estes testes travam vivem no MESMO pressuposto: "este servidor tem
 * UIDPLUS". O `imapflow` (`lib/commands/expunge.js`) faz `options.uid && hasCapability(conn,
 * 'UIDPLUS')` — sem a extensão, o `messageDelete(uid:true)` degrada para um `EXPUNGE` CEGO, que
 * apaga TODAS as mensagens \Deleted da pasta Drafts, não só a apontada. E o `append` só devolve
 * `uid` com UIDPLUS: sem ele, cada gravação automática (uma a cada 5 s de pausa na digitação)
 * viraria um rascunho novo sem remover o anterior. Como `descobrirServidor` (`imap.ts`) deriva
 * `mail.<domínio>` de qualquer endereço digitado, a garantia é do servidor de hoje — não é
 * estrutural. Por isso se CONFERE em vez de supor.
 *
 * Tudo aqui é dublado (nada de IMAP nem de banco): `comCaixa` roda o callback contra um cliente
 * falso, e a dublagem repete o que o `comCaixa` de verdade faz com uma exceção que sobe do
 * callback — gravar `estado: "ERRO"` na caixa (`imap.ts:120-125`). É isso que deixa o achado
 * 1-B da Tarefa 5 testável: falha em operação ACESSÓRIA não pode marcar a caixa como quebrada.
 */

const mocks = vi.hoisted(() => ({
  findFirstPasta: vi.fn(),
  comCaixa: vi.fn(),
  caixaDoUsuario: vi.fn(),
  /** Espião do efeito colateral do `comCaixa` real: marcar a caixa como ERRO. */
  marcouCaixaComoErro: vi.fn(),
}));

vi.mock("@app/db", () => ({ prisma: { caixaPasta: { findFirst: mocks.findFirstPasta } } }));
vi.mock("./imap.js", () => ({ comCaixa: mocks.comCaixa }));
vi.mock("./envio.service.js", () => ({ caixaDoUsuario: mocks.caixaDoUsuario }));

const { salvarRascunho, descartarRascunho } = await import("./rascunhos.service.js");

type ClienteFalso = {
  capabilities: Map<string, boolean | number>;
  append: ReturnType<typeof vi.fn>;
  messageDelete: ReturnType<typeof vi.fn>;
  getMailboxLock: ReturnType<typeof vi.fn>;
  liberouLock: () => boolean;
};

function clienteFalso(opcoes: { uidplus: boolean; uidDoAppend?: number | null }): ClienteFalso {
  let liberou = false;
  const uid = opcoes.uidDoAppend === undefined ? 42 : opcoes.uidDoAppend;
  return {
    capabilities: new Map<string, boolean | number>(opcoes.uidplus ? [["UIDPLUS", true]] : []),
    append: vi.fn().mockResolvedValue(uid === null ? { destination: "Drafts" } : { destination: "Drafts", uid }),
    messageDelete: vi.fn().mockResolvedValue(true),
    getMailboxLock: vi.fn().mockResolvedValue({
      release: () => {
        liberou = true;
      },
    }),
    liberouLock: () => liberou,
  };
}

/** Repete o contrato do `comCaixa` real, inclusive o efeito colateral de marcar a caixa. */
function ligarComCaixa(cliente: ClienteFalso) {
  mocks.comCaixa.mockImplementation(async (_caixaId: string, fn: (c: ImapFlow) => Promise<unknown>) => {
    try {
      return await fn(cliente as unknown as ImapFlow);
    } catch (e) {
      mocks.marcouCaixaComoErro(e);
      throw e;
    }
  });
}

const ENTRADA = {
  caixaId: "caixa-1",
  para: ["tibamooca@gmail.com"],
  cc: [],
  cco: [],
  assunto: "Assunto",
  corpoHtml: "<p>oi</p>",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.caixaDoUsuario.mockResolvedValue({ id: "caixa-1", email: "eu@medconsultoria.com.br", nomeExibicao: "Eu" });
  mocks.findFirstPasta.mockResolvedValue({ caminho: "Drafts" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("salvarRascunho — o expurgo por UID depende de UIDPLUS", () => {
  it("com UIDPLUS: grava a nova e só depois remove a anterior, por UID", async () => {
    const c = clienteFalso({ uidplus: true, uidDoAppend: 99 });
    ligarComCaixa(c);

    const r = await salvarRascunho("user-1", { ...ENTRADA, uidAnterior: 7 });

    expect(r).toEqual({ uid: 99 });
    expect(c.append).toHaveBeenCalledTimes(1);
    expect(c.messageDelete).toHaveBeenCalledWith("7", { uid: true });
    expect(c.append.mock.invocationCallOrder[0]!).toBeLessThan(c.messageDelete.mock.invocationCallOrder[0]!);
    expect(c.liberouLock()).toBe(true);
  });

  it("SEM UIDPLUS: não apaga nada — o EXPUNGE cego levaria junto todo rascunho \\Deleted da pasta", async () => {
    const c = clienteFalso({ uidplus: false });
    ligarComCaixa(c);

    await salvarRascunho("user-1", { ...ENTRADA, uidAnterior: 7 });

    expect(c.messageDelete).not.toHaveBeenCalled();
  });

  it("SEM UIDPLUS: também não grava — sem UID de volta, cada gravação viraria uma cópia nova sem remover a anterior", async () => {
    const c = clienteFalso({ uidplus: false });
    ligarComCaixa(c);

    const r = await salvarRascunho("user-1", ENTRADA);

    expect(c.append).not.toHaveBeenCalled();
    expect(r).toEqual({ uid: null });
  });

  it("grava o rascunho com \\Seen além de \\Draft — senão o contador de não-lidos infla a cada gravação automática", async () => {
    const c = clienteFalso({ uidplus: true });
    ligarComCaixa(c);

    await salvarRascunho("user-1", ENTRADA);

    const flags = c.append.mock.calls[0]![2] as string[];
    expect(flags).toContain("\\Draft");
    expect(flags).toContain("\\Seen");
  });

  it("falha ao remover a versão anterior deixa rastro no log em vez de sumir num catch mudo", async () => {
    const c = clienteFalso({ uidplus: true });
    c.messageDelete.mockRejectedValue(new Error("socket caiu"));
    ligarComCaixa(c);

    const r = await salvarRascunho("user-1", { ...ENTRADA, uidAnterior: 7 });

    expect(r.uid).toBe(42); // a gravação nova já aconteceu: ninguém fica sem rascunho
    expect(console.warn).toHaveBeenCalled();
    expect(mocks.marcouCaixaComoErro).not.toHaveBeenCalled();
  });

  it("sem pasta Drafts não tenta nada e devolve uid nulo", async () => {
    mocks.findFirstPasta.mockResolvedValue(null);
    const c = clienteFalso({ uidplus: true });
    ligarComCaixa(c);

    await expect(salvarRascunho("user-1", ENTRADA)).resolves.toEqual({ uid: null });
    expect(mocks.comCaixa).not.toHaveBeenCalled();
  });
});

describe("descartarRascunho — descarte cosmético não pode quebrar a caixa nem a pasta", () => {
  it("com UIDPLUS: apaga só o UID pedido, na pasta Drafts resolvida no servidor", async () => {
    const c = clienteFalso({ uidplus: true });
    ligarComCaixa(c);

    await descartarRascunho("user-1", { caixaId: "caixa-1", uid: 5 });

    expect(c.getMailboxLock).toHaveBeenCalledWith("Drafts");
    expect(c.messageDelete).toHaveBeenCalledWith("5", { uid: true });
  });

  it("SEM UIDPLUS: não chama messageDelete — apagar às cegas levaria rascunhos de outras composições", async () => {
    const c = clienteFalso({ uidplus: false });
    ligarComCaixa(c);

    await descartarRascunho("user-1", { caixaId: "caixa-1", uid: 5 });

    expect(c.messageDelete).not.toHaveBeenCalled();
  });

  it("falha ao descartar NÃO marca a caixa inteira como ERRO (achado 1-B da Tarefa 5)", async () => {
    const c = clienteFalso({ uidplus: true });
    c.messageDelete.mockRejectedValue(new Error("conexão caiu no meio"));
    ligarComCaixa(c);

    await expect(descartarRascunho("user-1", { caixaId: "caixa-1", uid: 5 })).resolves.toBeUndefined();
    expect(mocks.marcouCaixaComoErro).not.toHaveBeenCalled();
    expect(c.liberouLock()).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });

  it("a posse é conferida antes de qualquer coisa e o caminho da pasta NUNCA vem do cliente", async () => {
    const c = clienteFalso({ uidplus: true });
    ligarComCaixa(c);

    await descartarRascunho("user-1", { caixaId: "caixa-1", uid: 5 });

    expect(mocks.caixaDoUsuario).toHaveBeenCalledWith("user-1", "caixa-1");
    // A pasta sai de uma consulta por `papel: "DRAFTS"` na caixa JÁ conferida — o input não tem
    // (nem pode ganhar) um campo de pasta: o alcance máximo é a pasta Drafts da própria pessoa.
    expect(mocks.findFirstPasta).toHaveBeenCalledWith(
      expect.objectContaining({ where: { caixaId: "caixa-1", papel: "DRAFTS" } }),
    );
  });
});
