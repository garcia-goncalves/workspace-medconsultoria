import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { gerarParaLead } from "../modules/documentos/documentos.service.js";
import { listStages } from "../modules/pipeline/pipeline.service.js";

/**
 * Achado da auditoria de 04/09/2026: `gerarParaLead` era a SEGUNDA porta de geração de
 * documento e não consultava `MODELO_ACEITA_LEAD` — o botão "Elaborar e enviar o contrato" do
 * passo "Negociação" do funil (leads.service.ts, PLAYBOOK.negociacao) conseguia gerar Contrato
 * para um lead que nunca teve proposta aceita, contrariando a regra "contrato nasce do aceite"
 * (ADR-132/133). A régua certa não é "bloquear sempre" — o mesmo caminho é o FALLBACK legítimo
 * de `gerarContratoAutoParaCliente`, disparado no aceite da proposta (propostas.service.ts)
 * quando o cliente ainda não tem serviço estruturado. A distinção é: existe proposta ACEITA?
 */

const PFX = `contrato-aceite-${randomBytes(4).toString("hex")}`;
let atorId: string;
let clienteId: string;
let leadId: string;
let servicoId: string;

beforeAll(async () => {
  exigirBancoDeTeste();
  atorId = (
    await prisma.user.create({ data: { nome: `${PFX}-ator`, email: `${PFX}@teste.local`, role: "ADMIN" } })
  ).id;
  servicoId = (
    await prisma.servico.create({ data: { nome: `${PFX}-gestao`, categoria: "Gestão", ordem: 995, valor: 3500 } })
  ).id;
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica`, situacaoComercial: "PROSPECT" } })).id;
  const etapas = await listStages(); // semeia/backfilla as etapas padrão do funil
  const primeiraEtapa = etapas[0];
  if (!primeiraEtapa) throw new Error("banco de teste sem nenhuma etapa do funil");
  leadId = (
    await prisma.lead.create({
      data: {
        nome: `${PFX}-contato`,
        empresa: `${PFX}-clinica`,
        email: `${PFX}-lead@teste.local`,
        clienteId,
        pipelineStageId: primeiraEtapa.id,
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

describe("Contrato só nasce depois de uma proposta ACEITA", () => {
  it("gerar contrato para lead SEM proposta aceita nenhuma é recusado", async () => {
    await expect(gerarParaLead(leadId, "contrato", { id: atorId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const total = await prisma.documento.count({ where: { clienteId, modelo: { tipo: "CONTRATO" } } });
    expect(total, "o contrato não pode ter sido criado depois da recusa").toBe(0);
  });

  it("depois do aceite da proposta, gerar contrato pelo mesmo caminho funciona", async () => {
    // Marca a proposta como ACEITA diretamente (em vez de passar por `responder()`, cujo
    // efeito colateral — a AUTOMAÇÃO de contrato em propostas.service.ts — é fire-and-forget
    // e correria contra esta asserção). O que se testa aqui é a régua NOVA de `gerarParaLead`,
    // não a automação do aceite, já coberta por `funil-fecha-com-o-aceite.integration.test.ts`.
    await gerarParaLead(leadId, "proposta", { id: atorId });
    const proposta = await prisma.documento.findFirstOrThrow({
      where: { clienteId, deletedAt: null, modelo: { tipo: "PROPOSTA" } },
      select: { id: true },
    });
    await prisma.documento.update({ where: { id: proposta.id }, data: { propostaStatus: "ACEITA" } });

    const { documentoId } = await gerarParaLead(leadId, "contrato", { id: atorId });
    expect(documentoId).toBeTruthy();
    const total = await prisma.documento.count({ where: { clienteId, deletedAt: null, modelo: { tipo: "CONTRATO" } } });
    expect(total).toBe(1);
  });
});
