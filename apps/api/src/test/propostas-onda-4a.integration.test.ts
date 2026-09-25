import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { listModelos } from "../modules/documentos/modelos.service.js";
import { criarPropostaPersonalizada } from "../modules/documentos/proposta-personalizada.service.js";
import { duplicarProposta, getDocumento, updateConteudo } from "../modules/documentos/documentos.service.js";
import { habilitarAceite, responder } from "../modules/propostas/propostas.service.js";
import { exportarClientes } from "../modules/clientes/clientes.service.js";

/**
 * ONDA 4A contra o MySQL de verdade — o que só o banco prova:
 *  1. convênios no item de faturamento da Personalizada chegam ao papel e, no aceite, ao
 *     `ClienteServico.operadoras` (pela MESMA sincronização da proposta de faturamento);
 *  2. a linha avulsa com valor vira UMA conta a receber por linha — e aceitar DUAS vezes não cria
 *     a segunda (índice único `(origemDocumentoId, origemLinha)`);
 *  3. editar o texto e tirar um valor dos itens devolve o alerta (na edição e na leitura);
 *  4. duplicar cria rascunho com número novo, sem aceite, e recusa credenciamento para outra clínica;
 *  5. a exportação da lista de clientes respeita o filtro e não deixa célula virar fórmula.
 */

const PFX = `o4a-${randomBytes(4).toString("hex")}`;
let atorId: string;
let clienteId: string;
let outroClienteId: string;
let servicoFatId: string;
let servicoFixoId: string;
let opA: string;
let opB: string;

beforeAll(async () => {
  expect(process.env["DATABASE_URL"]).toContain("_test");
  atorId = (await prisma.user.create({ data: { nome: `${PFX}-ator`, email: `${PFX}@teste.local`, role: "ADMIN" } })).id;
  // ⚠️ Marcado DIRETO no banco (o padrão das fixtures desta casa): o teste é sobre o caminho do
  // dado depois da trava da marca única, não sobre ela. Apagado no fim — a marca é estado global.
  servicoFatId = (
    await prisma.servico.create({
      data: { nome: `${PFX}-fat`, categoria: "Faturamento", ordem: 996, percentual: 5, percentualRecorrencia: "MENSAL", ehFaturamento: true },
    })
  ).id;
  servicoFixoId = (
    await prisma.servico.create({ data: { nome: `${PFX}-gestao`, categoria: "Gestão", ordem: 997, valor: 3500, valorRecorrencia: "MENSAL" } })
  ).id;
  opA = (await prisma.operadora.create({ data: { nome: `${PFX}-Unimed`, ordem: 900 } })).id;
  opB = (await prisma.operadora.create({ data: { nome: `${PFX}-Omint`, ordem: 901 } })).id;
  clienteId = (
    await prisma.cliente.create({
      data: { nome: `${PFX}-clinica`, email: `${PFX}-c@teste.local`, situacaoComercial: "ATIVO", responsavelId: atorId },
    })
  ).id;
  outroClienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-outra`, situacaoComercial: "INATIVO" } })).id;
  await listModelos();
});

afterAll(async () => {
  const clientes = [clienteId, outroClienteId];
  await prisma.documentoVersao.deleteMany({ where: { documento: { clienteId: { in: clientes } } } });
  await prisma.documento.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.conta.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.clienteServico.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.projeto.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.activityLog.deleteMany({ where: { userId: atorId } });
  await prisma.cliente.deleteMany({ where: { id: { in: clientes } } });
  await prisma.operadora.deleteMany({ where: { id: { in: [opA, opB] } } });
  await prisma.servico.deleteMany({ where: { id: { in: [servicoFatId, servicoFixoId] } } });
  await prisma.user.deleteMany({ where: { id: atorId } });
});

async function aceitar(documentoId: string) {
  await habilitarAceite(documentoId, { id: atorId, nome: "ator" }, false);
  const { propostaToken } = await prisma.documento.findUniqueOrThrow({ where: { id: documentoId }, select: { propostaToken: true } });
  await responder({ token: propostaToken!, decisao: "ACEITA" }, "127.0.0.1", null);
}

describe("Personalizada com faturamento, convênios e linhas avulsas, até o aceite", () => {
  let documentoId: string;

  it("o papel lista os convênios e o documento guarda ids e linhas avulsas", async () => {
    const doc = await criarPropostaPersonalizada(
      {
        clienteId,
        itens: [
          { servicoId: servicoFatId, valor: 0, quantidade: 1, recorrencia: "MENSAL", percentual: 4, conveniosIds: [opA, opB] },
          { descricao: `${PFX} Treinamento`, valor: 400, quantidade: 3, recorrencia: "AVULSO" },
          { descricao: `${PFX} Suporte extra`, valor: 250, quantidade: 1, recorrencia: "MENSAL" },
          { descricao: `${PFX} Brinde`, valor: 0, quantidade: 1, recorrencia: "AVULSO" },
        ],
        secoes: [{ titulo: "Apresentação", corpo: "Texto." }],
        clausulas: [],
        validadeDias: 15,
        formaPagamento: "PIX",
      },
      atorId,
    );
    documentoId = doc.id;
    expect(doc.conteudo).toContain("## Convênios atendidos");
    expect(doc.conteudo).toContain(`${PFX}-Unimed`);
    expect(doc.conteudo).toContain(`${PFX}-Omint`);
    const gravado = await prisma.documento.findUniqueOrThrow({ where: { id: doc.id } });
    expect(gravado.itens).toEqual([
      { servicoId: servicoFatId, valor: 0, quantidade: 1, recorrencia: "MENSAL", percentual: 4, conveniosIds: [opA, opB] },
    ]);
    expect(gravado.linhasAvulsas).toEqual([
      { linha: 0, descricao: `${PFX} Treinamento`, valor: 400, quantidade: 3, recorrencia: "AVULSO" },
      { linha: 1, descricao: `${PFX} Suporte extra`, valor: 250, quantidade: 1, recorrencia: "MENSAL" },
      { linha: 2, descricao: `${PFX} Brinde`, valor: 0, quantidade: 1, recorrencia: "AVULSO" },
    ]);
  });

  it("aceito: convênios na ficha, UMA conta por linha avulsa com valor, e a linha no contrato", async () => {
    await aceitar(documentoId);
    await vi.waitFor(
      async () => {
        const contratos = await prisma.documento.count({ where: { clienteId, modelo: { tipo: "CONTRATO" } } });
        expect(contratos).toBe(1);
        expect(await prisma.conta.count({ where: { origemDocumentoId: documentoId } })).toBe(2);
      },
      { timeout: 15_000, interval: 250 },
    );
    const cs = await prisma.clienteServico.findFirstOrThrow({
      where: { clienteId, servicoId: servicoFatId },
      include: { operadoras: { select: { id: true } } },
    });
    expect(cs.operadoras.map((o) => o.id).sort()).toEqual([opA, opB].sort());

    const contas = await prisma.conta.findMany({ where: { origemDocumentoId: documentoId }, orderBy: { origemLinha: "asc" } });
    expect(contas.map((c) => [c.origemLinha, Number(c.valor), c.recorrencia])).toEqual([
      [0, 1200, "NENHUMA"],
      [1, 250, "MENSAL"],
    ]);
    // A linha de valor zero ("Brinde") não vira cobrança.
    expect(contas.some((c) => c.descricao.includes("Brinde"))).toBe(false);

    const contrato = await prisma.documento.findFirstOrThrow({ where: { clienteId, modelo: { tipo: "CONTRATO" } } });
    expect(contrato.conteudo).toContain(`${PFX} Treinamento`);
  });

  it("aceitar a MESMA proposta de novo não cobra a linha avulsa duas vezes", async () => {
    await aceitar(documentoId);
    // Espera a automação do 2º aceite terminar: ela grava o `servico.sincronizado_aceite` de novo.
    await vi.waitFor(
      async () => {
        expect(
          await prisma.activityLog.count({ where: { userId: atorId, acao: "servico.sincronizado_aceite", entidadeId: clienteId } }),
        ).toBe(2);
      },
      { timeout: 15_000, interval: 250 },
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(await prisma.conta.count({ where: { origemDocumentoId: documentoId } })).toBe(2);
  });

  it("convênio em serviço que não é o faturamento é recusado já na emissão", async () => {
    await expect(
      criarPropostaPersonalizada(
        {
          clienteId,
          itens: [{ servicoId: servicoFixoId, valor: 3500, quantidade: 1, recorrencia: "MENSAL", conveniosIds: [opA] }],
          secoes: [],
          clausulas: [],
          validadeDias: 15,
          formaPagamento: "PIX",
        },
        atorId,
      ),
    ).rejects.toThrow(/Convênios só se informam/);
  });
});

describe("editar o texto e tirar um valor dos itens", () => {
  it("a edição devolve o alerta, e a leitura do documento também o traz", async () => {
    const doc = await criarPropostaPersonalizada(
      {
        clienteId,
        itens: [{ servicoId: servicoFixoId, valor: 3500, quantidade: 1, recorrencia: "MENSAL" }],
        secoes: [],
        clausulas: [],
        validadeDias: 15,
        formaPagamento: "PIX",
      },
      atorId,
    );
    expect((await getDocumento(doc.id)).alertaValores).toEqual([]);
    const nbsp = String.fromCharCode(160);
    const editado = doc.conteudo.split(`R$${nbsp}3.500,00`).join("R$ 3.000,00");
    const r = await updateConteudo(doc.id, editado, atorId);
    expect(r.alertaValores).toEqual(["R$ 3.500,00"]);
    expect((await getDocumento(doc.id)).alertaValores).toEqual(["R$ 3.500,00"]);
    // A edição NÃO é bloqueada: o texto novo foi gravado.
    expect((await prisma.documento.findUniqueOrThrow({ where: { id: doc.id } })).conteudo).toBe(editado);
  });
});

describe("duplicar proposta", () => {
  it("cria rascunho com número novo, mesmos itens e linhas, e sem aceite", async () => {
    const orig = await criarPropostaPersonalizada(
      {
        clienteId,
        itens: [
          { servicoId: servicoFixoId, valor: 3500, quantidade: 1, recorrencia: "MENSAL" },
          { descricao: `${PFX} Linha`, valor: 100, quantidade: 1, recorrencia: "AVULSO" },
        ],
        secoes: [],
        clausulas: [],
        validadeDias: 15,
        formaPagamento: "PIX",
      },
      atorId,
    );
    await habilitarAceite(orig.id, { id: atorId, nome: "ator" }, false);

    const copia = await duplicarProposta(orig.id, {}, atorId);
    expect(copia.id).not.toBe(orig.id);
    expect(copia.status).toBe("RASCUNHO");
    expect(copia.clienteId).toBe(clienteId);
    expect(copia.propostaToken).toBeNull();
    expect(copia.propostaStatus).toBeNull();
    expect(copia.numero).toBeGreaterThan(orig.numero!);
    expect(copia.itens).toEqual(orig.itens);
    const linhasOrig = (await prisma.documento.findUniqueOrThrow({ where: { id: orig.id } })).linhasAvulsas;
    expect(copia.linhasAvulsas).toEqual(linhasOrig);
    const pad = (n: number) => String(n).padStart(4, "0");
    expect(copia.conteudo).toContain(pad(copia.numero!));
    expect(copia.conteudo).not.toContain(pad(orig.numero!));
    expect(copia.titulo).toContain(pad(copia.numero!));
  });

  it("para outro cliente, troca o nome da clínica no papel", async () => {
    const orig = await criarPropostaPersonalizada(
      { clienteId, itens: [], secoes: [{ titulo: "A", corpo: "Texto." }], clausulas: [], validadeDias: 15, formaPagamento: "PIX" },
      atorId,
    );
    const copia = await duplicarProposta(orig.id, { clienteId: outroClienteId }, atorId);
    expect(copia.clienteId).toBe(outroClienteId);
    expect(copia.conteudo).toContain(`${PFX}-outra`);
    expect(copia.conteudo).not.toContain(`${PFX}-clinica`);
  });

  it("documento que não é proposta não é duplicado", async () => {
    const contrato = await prisma.documento.findFirstOrThrow({ where: { clienteId, modelo: { tipo: "CONTRATO" } } });
    await expect(duplicarProposta(contrato.id, {}, atorId)).rejects.toThrow(/Só propostas/);
  });

  it("proposta de credenciamento não vai para outra clínica", async () => {
    const modeloCred = await prisma.modeloDocumento.findFirstOrThrow({ where: { tipo: "PROPOSTA", corpo: { contains: "{{operadoras}}" } } });
    const cred = await prisma.documento.create({
      data: { modeloId: modeloCred.id, clienteId, titulo: `${PFX} cred`, conteudo: "x", criadoPorId: atorId },
    });
    await expect(duplicarProposta(cred.id, { clienteId: outroClienteId }, atorId)).rejects.toThrow(/credenciamento/);
    // Para o MESMO cliente, pode.
    const copia = await duplicarProposta(cred.id, {}, atorId);
    expect(copia.clienteId).toBe(clienteId);
  });
});

describe("exportar a lista de clientes", () => {
  it("respeita busca e situação, lista os serviços ativos e neutraliza fórmula", async () => {
    await prisma.cliente.update({ where: { id: outroClienteId }, data: { nome: `=HYPERLINK("x") ${PFX}-outra` } });
    const todos = await exportarClientes({ search: PFX }, atorId);
    expect(todos.linhas).toBe(2);
    expect(todos.csv.startsWith("\uFEFF")).toBe(true);
    expect(todos.csv).toContain(`"'=HYPERLINK(""x"") ${PFX}-outra"`);
    expect(todos.csv).toContain(`${PFX}-fat`); // serviço ativo do cliente (veio do aceite)

    const ativos = await exportarClientes({ search: PFX, situacao: "ATIVO" }, atorId);
    expect(ativos.linhas).toBe(1);
    expect(ativos.csv).toContain(`${PFX}-clinica`);
    expect(ativos.csv).not.toContain(`${PFX}-outra`);

    const doResponsavel = await exportarClientes({ search: PFX, responsavelId: atorId }, atorId);
    expect(doResponsavel.linhas).toBe(1);
  });

  it("deixa rastro de QUEM exportou, com o filtro e a contagem — e sem os dados (B4)", async () => {
    await prisma.activityLog.deleteMany({ where: { userId: atorId, acao: "clientes.exportados" } });
    await exportarClientes({ search: PFX, situacao: "ATIVO" }, atorId);
    const rastro = await prisma.activityLog.findMany({ where: { userId: atorId, acao: "clientes.exportados" } });
    expect(rastro).toHaveLength(1);
    expect(rastro[0]!.dados).toEqual({ filtro: { search: PFX, situacao: "ATIVO" }, linhas: 1 });
    // Nada da planilha no rastro: nem nome, nem e-mail da clínica.
    expect(JSON.stringify(rastro)).not.toContain(`${PFX}-c@teste.local`);
  });
});
