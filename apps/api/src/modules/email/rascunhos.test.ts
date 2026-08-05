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
 * falso, e a dublagem repete o que o `comCaixa` de verdade faz — gravar `estado: "ERRO"` na caixa
 * quando algo falha, a MENOS que quem chamou tenha passado `marcarErro: false`. É isso que deixa o
 * achado 1-B da Tarefa 5 testável: falha em operação ACESSÓRIA não pode marcar a caixa como
 * quebrada.
 *
 * A dublagem também sabe falhar ANTES de rodar o callback (`falhaAoConectar`), que é o que o
 * `comCaixa` real faz quando `c.connect()` estoura. Esse é o modo de falha mais provável destas
 * duas operações — as duas abrem conexão IMAP nova, o descarte logo depois de um envio ter gastado
 * as suas — e nenhum `try` de dentro do callback o alcança.
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

/**
 * Repete o contrato do `comCaixa` real, inclusive o efeito colateral de marcar a caixa — e a
 * cláusula de escape `marcarErro: false`, que é o que de fato impede a marcação (o `catch` do
 * `comCaixa` real grava `estado: "ERRO"` ANTES de relançar, então um `try` do lado de fora, sozinho,
 * não desfaz nada).
 *
 * `falhaAoConectar` dubla o `c.connect()` que estoura: o callback NEM CHEGA a rodar.
 */
function ligarComCaixa(cliente: ClienteFalso, opcoes?: { falhaAoConectar?: Error }) {
  mocks.comCaixa.mockImplementation(
    async (_caixaId: string, fn: (c: ImapFlow) => Promise<unknown>, cfg?: { marcarErro?: boolean }) => {
      try {
        if (opcoes?.falhaAoConectar) throw opcoes.falhaAoConectar;
        return await fn(cliente as unknown as ImapFlow);
      } catch (e) {
        if (cfg?.marcarErro !== false) mocks.marcouCaixaComoErro(e);
        throw e;
      }
    },
  );
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

    expect(r).toEqual({ uid: 99, gravacaoDesligada: false });
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
    // E desliga a gravação: sem isto o front reagenda a cada 5 s e abre uma conexão IMAP nova toda
    // vez só para redescobrir o mesmo "este servidor não tem UIDPLUS".
    expect(r).toEqual({ uid: null, gravacaoDesligada: true });
  });

  it("UIDPLUS anunciado mas SEM APPENDUID: grava, desliga a gravação e avisa — insistir acrescentaria uma cópia a cada 5 s, sem teto", async () => {
    const c = clienteFalso({ uidplus: true, uidDoAppend: null });
    ligarComCaixa(c);

    const r = await salvarRascunho("user-1", { ...ENTRADA, uidAnterior: 7 });

    expect(c.append).toHaveBeenCalledTimes(1); // a mensagem FOI gravada — só não veio o UID de volta
    // Sem UID de volta, a gravação seguinte iria com `uidAnterior` indefinido e não removeria nada:
    // cada ciclo de 5 s acrescentaria uma cópia. É o MESMO dano que fez desligar o ramo sem UIDPLUS,
    // então a resposta tem de ser a mesma. `uid: null` sozinho não bastava: o front reagendaria.
    expect(r).toEqual({ uid: null, gravacaoDesligada: true });
    // Ainda assim remove a versão anterior: a cópia nova já está na pasta de qualquer jeito.
    expect(c.messageDelete).toHaveBeenCalledWith("7", { uid: true });
    expect(console.warn).toHaveBeenCalled();
    expect(mocks.marcouCaixaComoErro).not.toHaveBeenCalled();
  });

  it("messageDelete devolve false SEM lançar (pasta sem \\Deleted permanente): registra em vez de sumir em silêncio", async () => {
    // `messageDelete` do imapflow não lança quando o expurgo falha — o catch de `expunge.js` engole
    // o erro e escreve só no logger interno, que está desligado (`logger: false`). Ignorar o retorno
    // deixava TODA gravação acumular lixo em Rascunhos sem uma linha de log.
    const c = clienteFalso({ uidplus: true });
    c.messageDelete.mockResolvedValue(false);
    ligarComCaixa(c);

    const r = await salvarRascunho("user-1", { ...ENTRADA, uidAnterior: 7 });

    expect(r.uid).toBe(42);
    expect(console.warn).toHaveBeenCalled();
  });

  it("falha ao CONECTAR não marca a caixa como ERRO nem estoura — e não desliga a gravação (é transitória)", async () => {
    // O buraco real: o try/catch antigo estava DENTRO do callback, e a conexão é aberta ANTES dele.
    // Gravação de rascunho é automática e invisível (a cada 5 s de pausa na digitação); um soluço de
    // rede não pode fazer a caixa da pessoa aparecer quebrada no meio de uma frase.
    const c = clienteFalso({ uidplus: true });
    ligarComCaixa(c, { falhaAoConectar: new Error("ETIMEDOUT ao conectar no IMAP") });

    const r = await salvarRascunho("user-1", ENTRADA);

    expect(r).toEqual({ uid: null, gravacaoDesligada: false });
    expect(mocks.marcouCaixaComoErro).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("pede ao comCaixa para NÃO marcar a caixa (a outra metade: o comCaixa marca antes de relançar)", async () => {
    const c = clienteFalso({ uidplus: true });
    ligarComCaixa(c);

    await salvarRascunho("user-1", ENTRADA);

    expect(mocks.comCaixa).toHaveBeenCalledWith("caixa-1", expect.any(Function), { marcarErro: false });
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

    // Não desliga a gravação: este ramo não gasta conexão IMAP nenhuma (é só uma consulta ao banco)
    // e a pasta pode aparecer na próxima sincronização de pastas.
    await expect(salvarRascunho("user-1", ENTRADA)).resolves.toEqual({ uid: null, gravacaoDesligada: false });
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

  it("falha ao CONECTAR (o caso mais provável, logo depois de um envio) também não marca a caixa", async () => {
    // A conexão é aberta ANTES do callback, então o try/catch antigo — que ficava DENTRO dele —
    // nunca cobriu este caso. O descarte roda logo depois de o envio ter gastado duas conexões
    // (SMTP + cópia em Enviados): recusa por limite de conexões simultâneas é o modo de falha
    // esperado, e ele fazia o e-mail sair com sucesso e a caixa aparecer "com erro" na tela.
    const c = clienteFalso({ uidplus: true });
    ligarComCaixa(c, { falhaAoConectar: new Error("Too many simultaneous connections") });

    await expect(descartarRascunho("user-1", { caixaId: "caixa-1", uid: 5 })).resolves.toBeUndefined();
    expect(mocks.marcouCaixaComoErro).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("pede ao comCaixa para NÃO marcar a caixa — sem isso ele grava ERRO antes de relançar", async () => {
    const c = clienteFalso({ uidplus: true });
    ligarComCaixa(c);

    await descartarRascunho("user-1", { caixaId: "caixa-1", uid: 5 });

    expect(mocks.comCaixa).toHaveBeenCalledWith("caixa-1", expect.any(Function), { marcarErro: false });
  });

  it("messageDelete devolve false SEM lançar: o rascunho órfão do e-mail que saiu deixa rastro no log", async () => {
    const c = clienteFalso({ uidplus: true });
    c.messageDelete.mockResolvedValue(false);
    ligarComCaixa(c);

    await descartarRascunho("user-1", { caixaId: "caixa-1", uid: 5 });

    expect(console.warn).toHaveBeenCalled();
    expect(c.liberouLock()).toBe(true);
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
