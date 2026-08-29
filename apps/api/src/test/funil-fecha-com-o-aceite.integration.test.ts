import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { moveLead } from "../modules/leads/leads.service.js";
import { gerarParaLead } from "../modules/documentos/documentos.service.js";
import { habilitarAceite, responder } from "../modules/propostas/propostas.service.js";
import { listStages } from "../modules/pipeline/pipeline.service.js";

/**
 * O FUNIL QUE NÃO ANDA E O NÚMERO DE PROPOSTA QUE SE QUEIMA.
 *
 * C1 — o cliente aceita a proposta e o passo "Confirmar o aceite do cliente" fica pendurado
 * para sempre, porque a régua de marcos só conhecia a ASSINATURA (`assinaturaSolicitadaEm` /
 * `assinadoEm`). O aceite online é outro caminho inteiro (`propostaSolicitadaEm` /
 * `propostaStatus`), e nenhum dos dois passos de proposta reagia a ele. Como o passo é
 * OBRIGATÓRIO, o lead não avança — e ninguém entende por quê, porque na tela do documento
 * está escrito "ACEITA".
 *
 * C2 — a mesma proposta emitida pelo painel do lead e depois a entrada na etapa "Proposta"
 * geravam DUAS. ⚠️ A numeração é a contagem manual da Thaís, que começou em 224: cada
 * documento a mais é um buraco na sequência dela.
 */

const PFX = `funil-${randomBytes(4).toString("hex")}`;
let atorId: string;
let clienteId: string;
let leadId: string;
let servicoId: string;
let etapaQualificacaoId: string;
let etapaPropostaId: string;

beforeAll(async () => {
  exigirBancoDeTeste();
  atorId = (
    await prisma.user.create({ data: { nome: `${PFX}-ator`, email: `${PFX}@teste.local`, role: "ADMIN" } })
  ).id;
  servicoId = (
    await prisma.servico.create({ data: { nome: `${PFX}-gestao`, categoria: "Gestão", ordem: 996, valor: 3500 } })
  ).id;
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica`, situacaoComercial: "PROSPECT" } })).id;

  await listStages(); // semeia/backfilla as etapas padrão do funil no banco de teste
  // O banco de teste é compartilhado e as etapas podem ter sido renomeadas por outra suíte:
  // garante as duas de que este arquivo depende, sem apagar as que já existem.
  const garantirEtapa = async (chaveAuto: string, nome: string, ordem: number) => {
    const existente = await prisma.pipelineStage.findFirst({ where: { chaveAuto } });
    if (existente) return existente.id;
    const criada = await prisma.pipelineStage.create({ data: { nome, ordem, cor: "#30AD73", chaveAuto } });
    return criada.id;
  };
  etapaQualificacaoId = await garantirEtapa("qualificacao", "Qualificação", 1);
  etapaPropostaId = await garantirEtapa("proposta", "Proposta", 2);

  leadId = (
    await prisma.lead.create({
      data: {
        nome: `${PFX}-contato`,
        empresa: `${PFX}-clinica`,
        email: `${PFX}-lead@teste.local`,
        clienteId,
        pipelineStageId: etapaQualificacaoId,
        ordem: 0,
        servicos: { connect: [{ id: servicoId }] },
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.leadPasso.deleteMany({ where: { leadId } });
  await prisma.documentoVersao.deleteMany({ where: { documento: { clienteId } } });
  await prisma.documento.deleteMany({ where: { clienteId } });
  await prisma.activityLog.deleteMany({ where: { userId: atorId } });
  await prisma.conta.deleteMany({ where: { clienteId } });
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.lead.deleteMany({ where: { clienteId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.servico.deleteMany({ where: { id: servicoId } });
  await prisma.user.deleteMany({ where: { id: atorId } });
});

describe("C2 — entrar na etapa Proposta não pode queimar um número", () => {
  it("a proposta já emitida pelo painel do lead é ADOTADA, não duplicada", async () => {
    // A equipe emite a proposta antes de arrastar o card (é o caminho do painel do lead).
    await gerarParaLead(leadId, "proposta", { id: atorId });
    const depoisDaPrimeira = await prisma.documento.count({
      where: { clienteId, deletedAt: null, modelo: { tipo: "PROPOSTA" } },
    });
    expect(depoisDaPrimeira).toBe(1);

    // Agora o card entra na etapa "Proposta" — a automação roda.
    await moveLead({ id: leadId, pipelineStageId: etapaPropostaId, ordem: 0 }, atorId);

    const total = await prisma.documento.count({
      where: { clienteId, deletedAt: null, modelo: { tipo: "PROPOSTA" } },
    });
    expect(total, "entrar na etapa gerou uma SEGUNDA proposta e queimou um número").toBe(1);
  });

  it("o passo do funil fica ligado ao documento que já existia", async () => {
    const passo = await prisma.leadPasso.findFirstOrThrow({
      where: { leadId, acaoDoc: "proposta" },
      select: { documentoId: true },
    });
    expect(passo.documentoId, "sem esta ligação o painel do lead não acha a proposta").not.toBeNull();
  });

  it("entrar na etapa DE NOVO continua não gerando nada", async () => {
    await moveLead({ id: leadId, pipelineStageId: etapaQualificacaoId, ordem: 0 }, atorId);
    await moveLead({ id: leadId, pipelineStageId: etapaPropostaId, ordem: 0 }, atorId);
    const total = await prisma.documento.count({
      where: { clienteId, deletedAt: null, modelo: { tipo: "PROPOSTA" } },
    });
    expect(total).toBe(1);
  });
});

describe("C1 — o aceite do cliente fecha o passo do funil", () => {
  it("enviar para aceite conclui 'Elaborar e enviar a proposta'", async () => {
    const doc = await prisma.documento.findFirstOrThrow({
      where: { clienteId, deletedAt: null, modelo: { tipo: "PROPOSTA" } },
      select: { id: true },
    });
    await habilitarAceite(doc.id, { id: atorId, nome: `${PFX}-ator` }, false);

    const { reconciliarPassosAuto } = await import("../modules/leads/leads.service.js");
    await reconciliarPassosAuto(leadId);

    const passo = await prisma.leadPasso.findFirstOrThrow({
      where: { leadId, autoRegra: "proposta_enviada" },
      select: { concluido: true },
    });
    expect(passo.concluido, "a proposta foi enviada ao cliente e o passo continua aberto").toBe(true);
  });

  it("o cliente aceitando conclui 'Confirmar o aceite do cliente'", async () => {
    const doc = await prisma.documento.findFirstOrThrow({
      where: { clienteId, deletedAt: null, modelo: { tipo: "PROPOSTA" }, propostaToken: { not: null } },
      select: { propostaToken: true },
    });
    await responder({ token: doc.propostaToken!, decisao: "ACEITA" }, "127.0.0.1", null);

    const { reconciliarPassosAuto } = await import("../modules/leads/leads.service.js");
    await reconciliarPassosAuto(leadId);

    const passo = await prisma.leadPasso.findFirstOrThrow({
      where: { leadId, autoRegra: "proposta_assinada" },
      select: { concluido: true },
    });
    expect(passo.concluido, "proposta ACEITA e o passo obrigatório continua travando a etapa").toBe(true);
  });
});
