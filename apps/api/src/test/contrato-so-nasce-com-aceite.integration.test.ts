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
let etapaId: string;

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
  etapaId = primeiraEtapa.id;
  leadId = (
    await prisma.lead.create({
      data: {
        nome: `${PFX}-contato`,
        empresa: `${PFX}-clinica`,
        email: `${PFX}-lead@teste.local`,
        clienteId,
        pipelineStageId: etapaId,
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

    // Achado: este caminho manual (painel do lead) reescrevia `{{valor}}` à mão como uma frase
    // FIXA — "Conforme os valores da proposta comercial aprovada pela CONTRATANTE." — em vez de
    // trazer a tabela de preço REAL, como o caminho automático (`criarContrato`) já faz. O
    // contrato precisa sair com o preço de verdade do serviço aceito (R$ 3.500,00), não com a
    // frase genérica.
    // ⚠️ `toLocaleString("pt-BR", { style: "currency", ... })` usa espaço NÃO separável
    // (U+00A0) entre "R$" e o número — daí o `\s` na regex em vez de comparar string literal.
    const contrato = await prisma.documento.findUniqueOrThrow({ where: { id: documentoId }, select: { conteudo: true } });
    expect(contrato.conteudo).toMatch(/R\$\s*3\.500,00/);
    expect(contrato.conteudo).not.toContain("Conforme os valores da proposta comercial aprovada pela CONTRATANTE.");
  });

  it("proposta aceita SEM itens estruturados (ex.: credenciamento) não gera contrato com objeto em branco", async () => {
    // Achado da revisão especialista: uma proposta de credenciamento (grade médico × operadora,
    // ou o formato antigo por operadora) nunca guarda `Documento.itens` — ver `criarProposta`,
    // `itens: ehCredenciamento ? undefined : itensParaGravar`. Delegar direto para `criarContrato`
    // com um array vazio produzia um contrato com `{{objeto}}`/`{{clausulas_servicos}}` em BRANCO,
    // sem erro nem aviso — pior que o fallback textual que o código antigo tinha para esse caso.
    const clienteCredId = (
      await prisma.cliente.create({ data: { nome: `${PFX}-clinica-cred`, situacaoComercial: "PROSPECT" } })
    ).id;
    const leadCredId = (
      await prisma.lead.create({
        data: {
          nome: `${PFX}-cred-contato`,
          empresa: `${PFX}-clinica-cred`,
          email: `${PFX}-cred-lead@teste.local`,
          clienteId: clienteCredId,
          pipelineStageId: etapaId,
          ordem: 0,
          // Sem `servicos` conectados — nem `ClienteServico`, nem serviço de catálogo no lead: a
          // única fonte possível de itens estruturados é a proposta aceita, e ela não tem nenhum.
        },
      })
    ).id;
    try {
      const modeloProposta = await prisma.modeloDocumento.findFirstOrThrow({ where: { tipo: "PROPOSTA", ativo: true } });
      const propostaCred = await prisma.documento.create({
        data: {
          modeloId: modeloProposta.id,
          clienteId: clienteCredId,
          titulo: `${PFX}-proposta-credenciamento`,
          conteudo: "proposta de credenciamento (sem itens estruturados)",
          status: "ENVIADO",
          criadoPorId: atorId,
          propostaStatus: "ACEITA",
          // `itens` fica de fora de propósito — é exatamente o que `criarProposta` grava para
          // uma proposta de credenciamento.
        },
      });

      await expect(gerarParaLead(leadCredId, "contrato", { id: atorId })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      const total = await prisma.documento.count({ where: { clienteId: clienteCredId, modelo: { tipo: "CONTRATO" } } });
      expect(total, "nenhum contrato — muito menos um com objeto em branco — pode ter sido criado").toBe(0);
      void propostaCred;
    } finally {
      await prisma.leadPasso.deleteMany({ where: { leadId: leadCredId } });
      await prisma.documentoVersao.deleteMany({ where: { documento: { clienteId: clienteCredId } } });
      await prisma.documento.deleteMany({ where: { clienteId: clienteCredId } });
      await prisma.lead.deleteMany({ where: { id: leadCredId } });
      await prisma.cliente.deleteMany({ where: { id: clienteCredId } });
    }
  });
});
