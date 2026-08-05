import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { Readable } from "node:stream";

/**
 * As duas ações que a equipe dispara A PARTIR de um e-mail (fases 2D-2 e 2D-3):
 * anexo vira documento do cliente, e remetente desconhecido vira lead.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *  1. **Posse.** As duas ações são de escrita e nascem de um id vindo da tela. A checagem de
 *     que a mensagem é da caixa de quem clicou tem de estar no `where` da consulta — não numa
 *     comparação depois. Um teste por ação cobre isso com a caixa de outra pessoa.
 *  2. **Não duplicar.** Clicar duas vezes (ou dois colegas clicando) não pode gerar dois
 *     documentos do mesmo anexo nem dois leads do mesmo remetente.
 *  3. **A trava da casa (ADR-97).** E-mail de colega nunca vira lead. Sem isso, a primeira
 *     conversa interna encheria o funil de leads falsos com o nome da própria equipe.
 */

const mocks = vi.hoisted(() => ({
  anexoFindFirst: vi.fn(),
  anexoUpdateMany: vi.fn(),
  arquivoDelete: vi.fn(),
  mensagemFindFirst: vi.fn(),
  clienteFindMany: vi.fn(),
  clienteFindFirst: vi.fn(),
  leadFindFirst: vi.fn(),
  arquivoFindFirst: vi.fn(),
  activityLogCreate: vi.fn(),
  userFindMany: vi.fn(),
  caixaFindMany: vi.fn(),
  comCaixa: vi.fn(),
  salvarArquivo: vi.fn(),
  removerArquivoDisco: vi.fn(),
  registrarUpload: vi.fn(),
  createLead: vi.fn(),
}));

vi.mock("@app/db", () => ({
  prisma: {
    emailAnexo: { findFirst: mocks.anexoFindFirst, updateMany: mocks.anexoUpdateMany },
    emailMensagem: { findFirst: mocks.mensagemFindFirst },
    cliente: { findMany: mocks.clienteFindMany, findFirst: mocks.clienteFindFirst },
    lead: { findFirst: mocks.leadFindFirst },
    arquivo: { findFirst: mocks.arquivoFindFirst, delete: mocks.arquivoDelete },
    activityLog: { create: mocks.activityLogCreate },
    user: { findMany: mocks.userFindMany },
    caixaEmail: { findMany: mocks.caixaFindMany },
  },
}));

vi.mock("./imap.js", () => ({ comCaixa: mocks.comCaixa }));
vi.mock("../../lib/storage.js", async () => {
  const real = await vi.importActual<typeof import("../../lib/storage.js")>("../../lib/storage.js");
  return {
    ...real,
    salvarArquivo: mocks.salvarArquivo,
    removerArquivo: mocks.removerArquivoDisco,
  };
});
vi.mock("../arquivos/arquivos.service.js", () => ({ registrarUpload: mocks.registrarUpload }));
vi.mock("../leads/leads.service.js", () => ({ createLead: mocks.createLead }));

const { arquivarAnexoComoDocumento, criarLeadDoRemetente, contextoDaMensagem, nomeDoRemetente, tipoBase } =
  await import("./acoes.service.js");

/** Anexo achado pela consulta com posse — o formato que o serviço consome. */
function anexoPadrao(over: Record<string, unknown> = {}) {
  return {
    id: "anx1",
    nome: "contrato.pdf",
    tipo: "application/pdf",
    tamanho: 1024,
    parte: "2",
    arquivoId: null,
    mensagem: {
      id: "m1",
      uid: BigInt(7),
      assunto: "Contrato assinado",
      deEmail: "cliente@empresa.com",
      particular: false,
      pasta: { caminho: "INBOX", caixaId: "cx1", papel: "INBOX" },
      enderecos: [{ endereco: "cliente@empresa.com" }],
    },
    ...over,
  };
}

function mensagemPadrao(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    deNome: "Maria Souza",
    deEmail: "maria@empresa.com",
    assunto: "Orçamento",
    dataEm: new Date("2026-08-05T12:00:00Z"),
    particular: false,
    pasta: { caixa: { id: "cx1", email: "thiago.garcia@medconsultoria.com.br" } },
    ...over,
  };
}

/** O `comCaixa` de verdade executa o callback com um cliente IMAP; o dublê imita isso. */
function imapQueEntrega(bytes = "conteudo-do-anexo") {
  return async (_caixaId: string, cb: (c: unknown) => Promise<unknown>) =>
    cb({
      getMailboxLock: async () => ({ release: () => {} }),
      download: async () => ({ content: Readable.from([Buffer.from(bytes)]) }),
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Por padrão a casa é o domínio medconsultoria.com.br (um usuário interno + a caixa plugada).
  mocks.userFindMany.mockResolvedValue([{ email: "thiago.garcia@medconsultoria.com.br" }]);
  mocks.caixaFindMany.mockResolvedValue([
    { email: "thiago.garcia@medconsultoria.com.br", usuario: "thiago.garcia@medconsultoria.com.br" },
  ]);
  mocks.activityLogCreate.mockResolvedValue({});
  mocks.clienteFindMany.mockResolvedValue([]);
  mocks.clienteFindFirst.mockResolvedValue(null);
  mocks.leadFindFirst.mockResolvedValue(null);
  mocks.arquivoFindFirst.mockResolvedValue(null);
  mocks.salvarArquivo.mockResolvedValue({ caminho: "clientes/c1/uuid.pdf", tamanho: 1024 });
  mocks.registrarUpload.mockResolvedValue({ id: "arq1", nome: "contrato.pdf" });
  mocks.anexoUpdateMany.mockResolvedValue({ count: 1 });
  mocks.arquivoDelete.mockResolvedValue({});
  mocks.comCaixa.mockImplementation(imapQueEntrega());
});

describe("2D-2 · anexo vira documento do cliente", () => {
  it("recusa anexo de mensagem que não é da caixa de quem clicou", async () => {
    // A consulta com posse não acha nada — é assim que a posse é aplicada (no `where`).
    mocks.anexoFindFirst.mockResolvedValue(null);

    await expect(
      arquivarAnexoComoDocumento("outra-pessoa", { mensagemId: "m1", anexoId: "anx1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(mocks.comCaixa).not.toHaveBeenCalled();
    expect(mocks.registrarUpload).not.toHaveBeenCalled();
  });

  it("exige que a posse esteja no `where` da consulta (e não numa conferência posterior)", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);

    await arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" });

    const where = mocks.anexoFindFirst.mock.calls[0]![0].where;
    expect(where.id).toBe("anx1");
    expect(where.mensagemId).toBe("m1");
    expect(where.mensagem.pasta.caixa).toMatchObject({ userId: "u1", deletedAt: null });
  });

  it("grava o documento no cliente vinculado e marca o anexo como arquivado", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);

    const r = await arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" });

    expect(r).toMatchObject({ arquivoId: "arq1", clienteId: "c1", jaExistia: false });
    expect(mocks.salvarArquivo).toHaveBeenCalledWith("c1", "contrato.pdf", expect.anything());
    expect(mocks.registrarUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteId: "c1",
        nome: "contrato.pdf",
        mimetype: "application/pdf",
        enviadoPorTipo: "EQUIPE",
        enviadoPorId: "u1",
        caminho: "clientes/c1/uuid.pdf",
      }),
    );
    // O elo que a fase existe para fechar: `EmailAnexo.arquivoId` deixa de ser um campo morto.
    // `arquivoId: null` no `where` é o que faz o segundo clique simultâneo perder a corrida em vez
    // de sobrescrever o elo do primeiro — tirar essa condição tem de ficar vermelho.
    expect(mocks.anexoUpdateMany).toHaveBeenCalledWith({
      where: { id: "anx1", arquivoId: null },
      data: { arquivoId: "arq1" },
    });
  });

  it("não arquiva duas vezes: anexo já arquivado devolve o documento existente sem tocar no IMAP", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao({ arquivoId: "arq-antigo" }));
    mocks.arquivoFindFirst.mockResolvedValue({ id: "arq-antigo", nome: "contrato.pdf", clienteId: "c1" });

    const r = await arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" });

    expect(r).toMatchObject({ arquivoId: "arq-antigo", jaExistia: true });
    expect(mocks.comCaixa).not.toHaveBeenCalled();
    expect(mocks.registrarUpload).not.toHaveBeenCalled();
  });

  it("arquiva de novo quando o documento anterior foi removido da ficha", async () => {
    // `arquivoId` aponta para um `Arquivo` que sofreu soft-delete: o elo está velho, não vale.
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao({ arquivoId: "arq-apagado" }));
    mocks.arquivoFindFirst.mockResolvedValue(null);
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);

    const r = await arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" });

    expect(r.jaExistia).toBe(false);
    expect(mocks.registrarUpload).toHaveBeenCalled();
  });

  it("recusa tipo que o acervo de documentos não aceita, sem baixar nada", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao({ nome: "fotos.zip", tipo: "application/zip" }));
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);

    await expect(
      arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" }),
    ).rejects.toBeInstanceOf(TRPCError);

    expect(mocks.comCaixa).not.toHaveBeenCalled();
    expect(mocks.salvarArquivo).not.toHaveBeenCalled();
  });

  it("aceita tipo com parâmetro no cabeçalho (`application/pdf; name=...`)", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao({ tipo: 'application/pdf; name="contrato.pdf"' }));
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);

    const r = await arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" });

    expect(r.arquivoId).toBe("arq1");
    expect(mocks.registrarUpload).toHaveBeenCalledWith(expect.objectContaining({ mimetype: "application/pdf" }));
  });

  /**
   * O furo que a revisão de segurança desta fase achou: `EmailEndereco` guarda CC, CCO e
   * RESPONDER_A, escritos por QUEM MANDA e invisíveis na tela. Enquanto eles eram chave, um
   * estranho sem conta nenhuma escolhia em qual cliente o arquivo dele ia parar — bastava um
   * `Reply-To:`. O documento entrava na ficha marcado como enviado pela EQUIPE, ou seja, com a
   * procedência da empresa, num canal que o cliente confia.
   */
  it("estranho NÃO escolhe o cliente-destino pondo o endereço dele em cópia/responder-a", async () => {
    mocks.anexoFindFirst.mockResolvedValue(
      anexoPadrao({
        mensagem: {
          id: "m1",
          uid: BigInt(7),
          assunto: "Fatura em anexo",
          deEmail: "estranho@golpe.com",
          particular: false,
          pasta: { caminho: "INBOX", caixaId: "cx1", papel: "INBOX" },
          // O atacante pôs o endereço do cliente-alvo aqui.
          enderecos: [{ endereco: "estranho@golpe.com" }, { endereco: "financeiro@clientealvo.com" }],
        },
      }),
    );
    // Só o remetente pode virar chave: quem responder por `financeiro@clientealvo.com` não conta.
    mocks.clienteFindMany.mockImplementation(async ({ where }: { where: { OR: Array<{ email?: { in: string[] } }> } }) => {
      const alvo = where.OR[0]?.email?.in ?? [];
      return alvo.includes("financeiro@clientealvo.com") ? [{ id: "c-alvo", nome: "Cliente Alvo" }] : [];
    });

    await expect(
      arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(mocks.registrarUpload).not.toHaveBeenCalled();
  });

  it("na pasta Enviados valem os destinatários — ali quem escreveu os cabeçalhos fomos nós", async () => {
    mocks.anexoFindFirst.mockResolvedValue(
      anexoPadrao({
        mensagem: {
          id: "m1",
          uid: BigInt(7),
          assunto: "Segue o contrato",
          deEmail: "thiago.garcia@medconsultoria.com.br",
          particular: false,
          pasta: { caminho: "INBOX.Sent", caixaId: "cx1", papel: "SENT" },
          enderecos: [{ endereco: "maria@empresa.com" }],
        },
      }),
    );
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);

    const r = await arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" });

    expect(r).toMatchObject({ clienteId: "c1", jaExistia: false });
    // O endereço da casa não entra como chave nem aqui (o filtro do `casa.ts` continua valendo).
    const chaves = mocks.clienteFindMany.mock.calls[0]![0].where.OR[0].email.in;
    expect(chaves).toContain("maria@empresa.com");
    expect(chaves).not.toContain("thiago.garcia@medconsultoria.com.br");
  });

  it("recusa pelo tamanho do índice sem nem abrir conexão", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao({ tamanho: 21 * 1024 * 1024 }));
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);

    await expect(
      arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });

    expect(mocks.comCaixa).not.toHaveBeenCalled();
  });

  it("pede o cliente quando a mensagem não está vinculada a nenhum", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindMany.mockResolvedValue([]);

    await expect(
      arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(mocks.comCaixa).not.toHaveBeenCalled();
  });

  it("pede escolha quando a mensagem casa com mais de um cliente", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindMany.mockResolvedValue([
      { id: "c1", nome: "Empresa X" },
      { id: "c2", nome: "Empresa Y" },
    ]);

    await expect(
      arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("usa o cliente informado pela tela mesmo sem vínculo automático", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindMany.mockResolvedValue([]);
    mocks.clienteFindFirst.mockResolvedValue({ id: "c9", nome: "Escolhido na tela" });

    const r = await arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1", clienteId: "c9" });

    expect(r.clienteId).toBe("c9");
    expect(mocks.clienteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c9", deletedAt: null } }),
    );
  });

  it("recusa cliente informado que não existe (ou foi removido)", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindFirst.mockResolvedValue(null);

    await expect(
      arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1", clienteId: "sumiu" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("quando o servidor não devolve o anexo, não deixa registro pela metade", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);
    mocks.comCaixa.mockImplementation(async (_id: string, cb: (c: unknown) => Promise<unknown>) =>
      cb({ getMailboxLock: async () => ({ release: () => {} }), download: async () => null }),
    );

    await expect(
      arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" }),
    ).rejects.toBeInstanceOf(TRPCError);

    expect(mocks.registrarUpload).not.toHaveBeenCalled();
    expect(mocks.anexoUpdateMany).not.toHaveBeenCalled();
  });

  it("apaga o que gravou quando o anexo passa do teto de tamanho no disco", async () => {
    // O tamanho do índice é METADADO do servidor de e-mail: pode mentir. Quem decide é o disco.
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao({ tamanho: 10 }));
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);
    mocks.salvarArquivo.mockResolvedValue({ caminho: "clientes/c1/gigante.pdf", tamanho: 21 * 1024 * 1024 });

    await expect(
      arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });

    expect(mocks.removerArquivoDisco).toHaveBeenCalledWith("clientes/c1/gigante.pdf");
    expect(mocks.registrarUpload).not.toHaveBeenCalled();
  });

  it("perde a corrida com elegância: dois cliques simultâneos deixam UM documento só", async () => {
    // Os dois passaram pela conferência de "já arquivado" antes de qualquer um gravar o elo —
    // é a janela real, e quem decide o vencedor é o `updateMany` condicionado a `arquivoId: null`.
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);
    mocks.anexoUpdateMany.mockResolvedValue({ count: 0 }); // o outro clique chegou primeiro
    mocks.anexoFindFirst.mockResolvedValueOnce(anexoPadrao()).mockResolvedValue({ arquivoId: "arq-vencedor" });
    mocks.arquivoFindFirst.mockResolvedValue({ id: "arq-vencedor", nome: "contrato.pdf", clienteId: "c1" });

    const r = await arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" });

    expect(r).toMatchObject({ arquivoId: "arq-vencedor", jaExistia: true });
    // O perdedor desfaz o próprio documento — registro E arquivo em disco.
    expect(mocks.arquivoDelete).toHaveBeenCalledWith({ where: { id: "arq1" } });
    expect(mocks.removerArquivoDisco).toHaveBeenCalledWith("clientes/c1/uuid.pdf");
  });

  it("não deixa arquivo órfão no disco quando o banco recusa o registro", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);
    mocks.registrarUpload.mockRejectedValue(new Error("banco fora do ar"));

    await expect(arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" })).rejects.toThrow();

    expect(mocks.removerArquivoDisco).toHaveBeenCalledWith("clientes/c1/uuid.pdf");
  });

  it("solta o cadeado da pasta IMAP mesmo quando o download falha", async () => {
    // Cadeado preso segura a caixa até o processo reiniciar — e um processo Node serve a app toda.
    const release = vi.fn();
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);
    mocks.comCaixa.mockImplementation(async (_id: string, cb: (c: unknown) => Promise<unknown>) =>
      cb({
        getMailboxLock: async () => ({ release }),
        download: async () => {
          throw new Error("conexão caiu no meio");
        },
      }),
    );

    await expect(arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" })).rejects.toThrow();

    expect(release).toHaveBeenCalled();
  });

  it("grava com a conexão IMAP ainda aberta (senão o arquivo chega cortado)", async () => {
    // `download()` resolve no PRIMEIRO pedaço; o resto ainda vem pelo socket. Se a gravação sair
    // de dentro do callback, a conexão fecha no meio da leitura — foi a lição da rota de download.
    let conexaoAberta = false;
    let gravouComConexaoAberta = false;
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);
    mocks.salvarArquivo.mockImplementation(async () => {
      gravouComConexaoAberta = conexaoAberta;
      return { caminho: "clientes/c1/uuid.pdf", tamanho: 1024 };
    });
    mocks.comCaixa.mockImplementation(async (_id: string, cb: (c: unknown) => Promise<unknown>) => {
      conexaoAberta = true;
      try {
        return await cb({
          getMailboxLock: async () => ({ release: () => {} }),
          download: async () => ({ content: Readable.from([Buffer.from("x")]) }),
        });
      } finally {
        conexaoAberta = false; // o `comCaixa` de verdade fecha o socket aqui
      }
    });

    await arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" });

    expect(gravouComConexaoAberta).toBe(true);
  });

  it("registra quem arquivou (auditoria), sem assunto nem conteúdo", async () => {
    mocks.anexoFindFirst.mockResolvedValue(anexoPadrao());
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);

    await arquivarAnexoComoDocumento("u1", { mensagemId: "m1", anexoId: "anx1" });

    const log = mocks.activityLogCreate.mock.calls[0]![0].data;
    expect(log).toMatchObject({ userId: "u1", acao: "email_anexo_arquivado" });
    expect(JSON.stringify(log)).not.toContain("Contrato assinado");
  });
});

describe("2D-3 · e-mail de desconhecido vira lead", () => {
  it("recusa mensagem que não é da caixa de quem clicou", async () => {
    mocks.mensagemFindFirst.mockResolvedValue(null);

    await expect(criarLeadDoRemetente("outra-pessoa", { mensagemId: "m1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it("nunca transforma colega de trabalho em lead (trava da casa, ADR-97)", async () => {
    mocks.mensagemFindFirst.mockResolvedValue(
      mensagemPadrao({ deEmail: "andre.cintra@medconsultoria.com.br", deNome: "André" }),
    );

    await expect(criarLeadDoRemetente("u1", { mensagemId: "m1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it("recusa remetente que já é cliente, dizendo qual", async () => {
    mocks.mensagemFindFirst.mockResolvedValue(mensagemPadrao());
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);

    await expect(criarLeadDoRemetente("u1", { mensagemId: "m1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it("não duplica: remetente com lead ativo devolve o lead existente", async () => {
    mocks.mensagemFindFirst.mockResolvedValue(mensagemPadrao());
    mocks.leadFindFirst.mockResolvedValue({ id: "lead-antigo", nome: "Maria Souza" });

    const r = await criarLeadDoRemetente("u1", { mensagemId: "m1" });

    expect(r).toMatchObject({ leadId: "lead-antigo", jaExistia: true });
    expect(mocks.createLead).not.toHaveBeenCalled();
    // Dedup só vale para lead ATIVO — convertido ou apagado não bloqueia um lead novo.
    expect(mocks.leadFindFirst.mock.calls[0]![0].where).toMatchObject({
      email: "maria@empresa.com",
      deletedAt: null,
      convertidoEmClienteId: null,
    });
  });

  it("cria o lead com o nome do remetente, o e-mail e o rastro de onde veio", async () => {
    mocks.mensagemFindFirst.mockResolvedValue(mensagemPadrao());
    mocks.createLead.mockResolvedValue({ id: "lead1", nome: "Maria Souza" });

    const r = await criarLeadDoRemetente("u1", { mensagemId: "m1" });

    expect(r).toMatchObject({ leadId: "lead1", jaExistia: false });
    const [input, userId, rastreio] = mocks.createLead.mock.calls[0]!;
    expect(input).toMatchObject({ nome: "Maria Souza", email: "maria@empresa.com", origem: "E-mail" });
    expect(userId).toBe("u1");
    expect(rastreio).toContain("thiago.garcia@medconsultoria.com.br");
    expect(rastreio).toContain("Orçamento");
  });

  it("e-mail tirado da ficha (particular) não devolve o assunto pelo rastreio do lead", async () => {
    // A válvula do ADR-97 não pode ser esvaziada por uma porta lateral: o rastreio é lido pela
    // equipe inteira, e o assunto foi justamente o que o dono da caixa escondeu.
    mocks.mensagemFindFirst.mockResolvedValue(mensagemPadrao({ particular: true }));
    mocks.createLead.mockResolvedValue({ id: "lead1", nome: "Maria Souza" });

    await criarLeadDoRemetente("u1", { mensagemId: "m1" });

    const rastreio = mocks.createLead.mock.calls[0]![2] as string;
    expect(rastreio).toContain("thiago.garcia@medconsultoria.com.br");
    expect(rastreio).not.toContain("Orçamento");
  });

  it("usa a parte local do endereço quando o remetente não tem nome", async () => {
    mocks.mensagemFindFirst.mockResolvedValue(mensagemPadrao({ deNome: null }));
    mocks.createLead.mockResolvedValue({ id: "lead1", nome: "maria" });

    await criarLeadDoRemetente("u1", { mensagemId: "m1" });

    expect(mocks.createLead.mock.calls[0]![0]).toMatchObject({ nome: "maria" });
  });
});

describe("contexto da mensagem (o que a tela oferece)", () => {
  it("recusa mensagem de outra caixa", async () => {
    mocks.mensagemFindFirst.mockResolvedValue(null);
    await expect(contextoDaMensagem("outra-pessoa", "m1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("aponta o cliente quando a conversa é com um cadastro conhecido", async () => {
    mocks.mensagemFindFirst.mockResolvedValue({
      deEmail: "maria@empresa.com",
      pasta: { papel: "INBOX" },
      enderecos: [{ endereco: "maria@empresa.com" }],
    });
    mocks.clienteFindMany.mockResolvedValue([{ id: "c1", nome: "Empresa X" }]);

    const r = await contextoDaMensagem("u1", "m1");

    expect(r).toMatchObject({ clientes: [{ id: "c1", nome: "Empresa X" }], lead: null, remetenteDaCasa: false });
  });

  it("marca remetente da casa e não procura lead para colega", async () => {
    mocks.mensagemFindFirst.mockResolvedValue({
      deEmail: "andre.cintra@medconsultoria.com.br",
      pasta: { papel: "INBOX" },
      enderecos: [{ endereco: "andre.cintra@medconsultoria.com.br" }],
    });

    const r = await contextoDaMensagem("u1", "m1");

    expect(r.remetenteDaCasa).toBe(true);
    expect(r.lead).toBeNull();
    expect(mocks.leadFindFirst).not.toHaveBeenCalled();
  });

  it("devolve o lead do remetente quando já existe", async () => {
    mocks.mensagemFindFirst.mockResolvedValue({
      deEmail: "maria@empresa.com",
      pasta: { papel: "INBOX" },
      enderecos: [{ endereco: "maria@empresa.com" }],
    });
    mocks.leadFindFirst.mockResolvedValue({ id: "lead1", nome: "Maria Souza" });

    const r = await contextoDaMensagem("u1", "m1");

    expect(r.lead).toMatchObject({ id: "lead1", nome: "Maria Souza" });
  });
});

describe("funções puras", () => {
  it("nomeDoRemetente prefere o nome; cai para a parte local; nunca devolve vazio", () => {
    expect(nomeDoRemetente("Maria Souza", "maria@x.com")).toBe("Maria Souza");
    expect(nomeDoRemetente(null, "joao.silva@x.com")).toBe("joao.silva");
    expect(nomeDoRemetente("   ", "joao@x.com")).toBe("joao");
    // Um `From` mal-formado não pode gerar lead sem nome (o campo é obrigatório no banco).
    expect(nomeDoRemetente(null, "@x.com")).toBe("Contato por e-mail");
    expect(nomeDoRemetente(null, "")).toBe("Contato por e-mail");
  });

  it("tipoBase descarta parâmetros e normaliza caixa", () => {
    expect(tipoBase('application/PDF; name="a.pdf"')).toBe("application/pdf");
    expect(tipoBase("image/png")).toBe("image/png");
    expect(tipoBase("")).toBe("");
  });
});
