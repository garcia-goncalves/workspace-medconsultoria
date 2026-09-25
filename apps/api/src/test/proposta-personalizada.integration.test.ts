import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { MARCADOR_PERSONALIZADO } from "@app/shared";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { listModelos } from "../modules/documentos/modelos.service.js";
import { criarPropostaPersonalizada } from "../modules/documentos/proposta-personalizada.service.js";
import { habilitarAceite, responder } from "../modules/propostas/propostas.service.js";
import { listStages } from "../modules/pipeline/pipeline.service.js";

/**
 * A proposta PERSONALIZADA contra o MySQL de verdade (ADR-156).
 *
 * O que só o banco prova, e por isso não fica no teste de unidade:
 *  1. o modelo-semente existe depois de `listModelos()` e é tipo PROPOSTA — é isso que faz o
 *     aceite, o funil e a ficha tratarem o documento como proposta;
 *  2. a numeração é a MESMA sequência das outras propostas;
 *  3. no ACEITE, só a linha do catálogo vira `ClienteServico` — a linha avulsa, que não tem
 *     cadastro, vira conta a receber (Onda 4A, provado em `propostas-onda-4a.integration.test.ts`);
 *  4. para um LEAD, o documento cai no `Cliente` PROSPECT por trás dele, sem converter ninguém.
 */

const PFX = `pers-${randomBytes(4).toString("hex")}`;
let atorId: string;
let clienteId: string;
let servicoId: string;
let leadId: string;
let clienteDoLeadId: string | null = null;

beforeAll(async () => {
  exigirBancoDeTeste();
  atorId = (await prisma.user.create({ data: { nome: `${PFX}-ator`, email: `${PFX}@teste.local`, role: "ADMIN" } })).id;
  servicoId = (
    await prisma.servico.create({ data: { nome: `${PFX}-gestao`, categoria: "Gestão", ordem: 995, valor: 3500, valorRecorrencia: "MENSAL" } })
  ).id;
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } })).id;
  await listStages(); // semeia as etapas padrão do funil no banco de teste
  await listStages(); // num banco novo (CI, job build-test) não há etapa: semeia as padrão.
  const etapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });
  leadId = (
    await prisma.lead.create({
      data: { nome: `${PFX}-contato`, empresa: `${PFX}-lead-clinica`, email: `${PFX}-lead@teste.local`, pipelineStageId: etapa.id, ordem: 0 },
    })
  ).id;
  await listModelos();
});

afterAll(async () => {
  const clientes = [clienteId, clienteDoLeadId].filter((id): id is string => !!id);
  await prisma.documentoVersao.deleteMany({ where: { documento: { clienteId: { in: clientes } } } });
  await prisma.documento.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.activityLog.deleteMany({ where: { userId: atorId } });
  await prisma.conta.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.clienteServico.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.leadPasso.deleteMany({ where: { leadId } });
  await prisma.lead.deleteMany({ where: { id: leadId } });
  await prisma.user.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.cliente.deleteMany({ where: { id: { in: clientes } } });
  await prisma.servico.deleteMany({ where: { id: servicoId } });
  await prisma.user.deleteMany({ where: { id: atorId } });
});

describe("o modelo-semente", () => {
  it("existe, é tipo PROPOSTA e declara o marcador do Personalizado", async () => {
    const m = await prisma.modeloDocumento.findFirst({ where: { nome: "Proposta personalizada" } });
    expect(m?.tipo).toBe("PROPOSTA");
    expect(m?.corpo).toContain(MARCADOR_PERSONALIZADO);
  });
});

describe("proposta personalizada para um CLIENTE, até o aceite", () => {
  let documentoId: string;

  it("gera o documento numerado, sem marcador cru, com as duas linhas no papel", async () => {
    const antes = (await prisma.documento.aggregate({ _max: { numero: true } }))._max.numero ?? 0;
    const doc = await criarPropostaPersonalizada(
      {
        clienteId,
        titulo: "Proposta sob medida",
        itens: [
          { servicoId, valor: 3000, quantidade: 1, recorrencia: "MENSAL" },
          { descricao: `${PFX} Treinamento da recepção`, valor: 400, quantidade: 3, recorrencia: "AVULSO" },
        ],
        secoes: [{ titulo: "Apresentação", corpo: "Cuidamos da rotina da sua clínica." }],
        clausulas: ["Os valores são reajustados a cada 12 meses."],
        validadeDias: 20,
        formaPagamento: "PIX",
      },
      atorId,
    );
    documentoId = doc.id;

    expect(doc.numero).toBeGreaterThan(antes);
    expect(doc.titulo).toContain("Proposta sob medida");
    expect(doc.conteudo).not.toMatch(/\{\{|\}\}/);
    expect(doc.conteudo).not.toMatch(/a preencher/i);
    expect(doc.conteudo).toContain(`${PFX}-gestao`);
    expect(doc.conteudo).toContain(`${PFX} Treinamento da recepção`);
    expect(doc.conteudo).toContain("válida por 20 dias");

    const gravado = await prisma.documento.findUniqueOrThrow({ where: { id: doc.id }, include: { modelo: true } });
    expect(gravado.modelo?.tipo).toBe("PROPOSTA");
    // Em `itens` SÓ a linha do catálogo — é o que o aceite copia e o contrato relê.
    expect(gravado.itens).toEqual([{ servicoId, valor: 3000, quantidade: 1, recorrencia: "MENSAL", percentual: null }]);
  });

  it("aceita, e SÓ o serviço do catálogo vira serviço contratado", async () => {
    await habilitarAceite(documentoId, { id: atorId, nome: `${PFX}-ator` }, false);
    const { propostaToken } = await prisma.documento.findUniqueOrThrow({ where: { id: documentoId }, select: { propostaToken: true } });
    await responder({ token: propostaToken!, decisao: "ACEITA" }, "127.0.0.1", null);

    // A automação pós-aceite roda em segundo plano: espera o serviço E o contrato, para a limpeza
    // não correr contra ela.
    await vi.waitFor(
      async () => {
        const contratados = await prisma.clienteServico.findMany({ where: { clienteId }, select: { servicoId: true } });
        expect(contratados).toEqual([{ servicoId }]);
        const contratos = await prisma.documento.count({ where: { clienteId, modelo: { tipo: "CONTRATO" } } });
        expect(contratos).toBeGreaterThan(0);
      },
      { timeout: 15_000, interval: 250 },
    );
    const cs = await prisma.clienteServico.findFirstOrThrow({ where: { clienteId, servicoId } });
    expect(Number(cs.valor)).toBe(3000);
  });
});

describe("proposta personalizada para um LEAD", () => {
  it("cai no cliente PROSPECT por trás do lead e não converte ninguém", async () => {
    const doc = await criarPropostaPersonalizada(
      { leadId, itens: [], secoes: [{ titulo: "Proposta", corpo: "Texto livre." }], clausulas: [], validadeDias: 15, formaPagamento: "PIX" },
      atorId,
    );
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { clienteId: true, convertidoEmClienteId: true } });
    clienteDoLeadId = lead.clienteId;
    expect(doc.clienteId).toBe(lead.clienteId);
    expect(lead.convertidoEmClienteId).toBeNull();
    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: lead.clienteId! } });
    expect(cliente.situacaoComercial).toBe("PROSPECT");
    expect(doc.itens).toBeNull();
  });

  it("serviço do catálogo que não existe é recusado em português", async () => {
    await expect(
      criarPropostaPersonalizada(
        { clienteId, itens: [{ servicoId: "nao-existe", valor: 10, quantidade: 1, recorrencia: "AVULSO" }], secoes: [], clausulas: [], validadeDias: 15, formaPagamento: "PIX" },
        atorId,
      ),
    ).rejects.toThrow(/não existe mais no catálogo/);
  });

  it("percentual em serviço que não é o faturamento é recusado já na emissão", async () => {
    await expect(
      criarPropostaPersonalizada(
        { clienteId, itens: [{ servicoId, valor: 0, percentual: 5, quantidade: 1, recorrencia: "MENSAL" }], secoes: [], clausulas: [], validadeDias: 15, formaPagamento: "PIX" },
        atorId,
      ),
    ).rejects.toThrow(/faturamento médico/);
  });
});
