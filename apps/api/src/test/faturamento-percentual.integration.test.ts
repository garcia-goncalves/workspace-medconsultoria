import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { TITULO_PASSO_FATURAMENTO, TITULO_PASSO_VALOR } from "@app/shared";
import { hashPassword } from "../lib/password.js";
import { createLead, updateLead, listLeads, getLeadDetalhe, reconciliarPassosAuto } from "../modules/leads/leads.service.js";
import { criarServico, listServicosAtivos } from "../modules/servicos/servicos.service.js";

/**
 * ADR-125 — o serviço percentual para de pedir um valor fixo que não existe.
 *
 * Este teste roda contra o MySQL de VERDADE, e não contra tipos, por uma razão específica: os
 * campos novos deste projeto já sumiram em silêncio duas vezes no mesmo lugar. Na ADR-118 o
 * `Decimal` atravessou o tRPC e a tela mostrou "R$ NaN" com o typecheck verde; na ADR-119 o
 * `cnpj` era descartado por `createLead`/`updateLead`, que montam os campos um a um — o
 * compilador não reclama de um campo que ninguém copiou.
 *
 * Então o que se prova aqui é o caminho inteiro, com asserção em runtime:
 *  1. o `faturamentoMensalEstimado` sobrevive ao criar e ao editar;
 *  2. ele chega à tela como NÚMERO (nunca `Decimal`);
 *  3. o passo obrigatório da Qualificação troca de PERGUNTA quando o negócio é percentual;
 *  4. o `valorEstimado` passa a ser CALCULADO (faturamento × percentual);
 *  5. e volta atrás sozinho quando entra um serviço de preço fixo.
 */

const PFX = `fpc-${randomBytes(4).toString("hex")}`;
let atorId: string;
let servicoPercentualId: string;
let servicoFixoId: string;
let stageId: string;
const leadsCriados: string[] = [];

/** Prova em runtime, não na tipagem: dinheiro que sai do serviço é número ou nulo. */
function ehDinheiroDaTela(v: unknown) {
  return v === null || typeof v === "number";
}

/** O passo automático do valor/faturamento da etapa atual do lead. */
async function passoDaEstimativa(leadId: string) {
  return prisma.leadPasso.findFirst({ where: { leadId, autoRegra: "valor" } });
}

beforeAll(async () => {
  expect(process.env["DATABASE_URL"]).toContain("_test");
  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  atorId = u.id;

  // Um serviço 100% percentual (o formato do Faturamento de contas médicas) e um de preço fixo.
  const percentual = await criarServico({ nome: `${PFX}-percentual`, valor: null, percentual: 5, categoria: "Faturamento" });
  servicoPercentualId = percentual.id;
  const fixo = await criarServico({ nome: `${PFX}-fixo`, valor: 3500, valorRecorrencia: "MENSAL", categoria: "Gestão" });
  servicoFixoId = fixo.id;

  // A Qualificação é onde vive o passo obrigatório do valor.
  const stage =
    (await prisma.pipelineStage.findFirst({ where: { chaveAuto: "qualificacao" } })) ??
    (await prisma.pipelineStage.create({ data: { nome: `${PFX}-qualificacao`, ordem: 998, chaveAuto: "qualificacao" } }));
  stageId = stage.id;
});

afterAll(async () => {
  await prisma.leadPasso.deleteMany({ where: { leadId: { in: leadsCriados } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadsCriados } } });
  await prisma.servico.deleteMany({ where: { id: { in: [servicoPercentualId, servicoFixoId] } } });
  await prisma.user.deleteMany({ where: { id: atorId } });
});

describe("ADR-125 — o campo novo sobrevive ao caminho inteiro", () => {
  it("createLead grava o faturamento mensal (a armadilha da ADR-119: campo descartado em silêncio)", async () => {
    const lead = await createLead(
      { nome: `${PFX}-cria`, faturamentoMensalEstimado: 200000, servicoIds: [servicoPercentualId], pipelineStageId: stageId } as never,
      atorId,
    );
    leadsCriados.push(lead.id);

    const noBanco = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(noBanco.faturamentoMensalEstimado?.toFixed(2)).toBe("200000.00");
  });

  it("updateLead grava o faturamento mensal", async () => {
    const lead = await createLead({ nome: `${PFX}-edita`, pipelineStageId: stageId } as never, atorId);
    leadsCriados.push(lead.id);

    await updateLead({ id: lead.id, faturamentoMensalEstimado: 150000 } as never, atorId);
    const noBanco = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(noBanco.faturamentoMensalEstimado?.toFixed(2)).toBe("150000.00");
  });

  it("o faturamento chega à tela como NÚMERO, nunca como Decimal (armadilha da ADR-118)", async () => {
    const lead = await createLead(
      { nome: `${PFX}-tipo`, faturamentoMensalEstimado: 12345.67, pipelineStageId: stageId } as never,
      atorId,
    );
    leadsCriados.push(lead.id);

    expect(ehDinheiroDaTela(lead.faturamentoMensalEstimado)).toBe(true);
    expect(lead.faturamentoMensalEstimado).toBe(12345.67);

    const detalhe = await getLeadDetalhe(lead.id);
    expect(ehDinheiroDaTela(detalhe.faturamentoMensalEstimado)).toBe(true);

    const naLista = (await listLeads()).find((l) => l.id === lead.id);
    expect(naLista && ehDinheiroDaTela(naLista.faturamentoMensalEstimado)).toBe(true);
  });
});

describe("ADR-125 — o passo da Qualificação troca de pergunta", () => {
  it("negócio 100% percentual: pergunta o FATURAMENTO e calcula o valor do negócio", async () => {
    const lead = await createLead(
      { nome: `${PFX}-passo`, servicoIds: [servicoPercentualId], pipelineStageId: stageId } as never,
      atorId,
    );
    leadsCriados.push(lead.id);
    await getLeadDetalhe(lead.id); // abrir o painel semeia o checklist da etapa
    await reconciliarPassosAuto(lead.id);

    const passo = await passoDaEstimativa(lead.id);
    expect(passo?.titulo).toBe(TITULO_PASSO_FATURAMENTO);
    expect(passo?.concluido).toBe(false);

    // Preencher a BASE conclui o passo e calcula o valor: 200.000 × 5% = 10.000.
    await updateLead({ id: lead.id, faturamentoMensalEstimado: 200000 } as never, atorId);
    const depois = await passoDaEstimativa(lead.id);
    expect(depois?.concluido).toBe(true);

    const noBanco = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(noBanco.valorEstimado?.toFixed(2)).toBe("10000.00");
  });

  it("entrar um serviço de preço fixo devolve a pergunta antiga — a regra tem volta", async () => {
    const lead = await createLead(
      { nome: `${PFX}-volta`, servicoIds: [servicoPercentualId], faturamentoMensalEstimado: 100000, pipelineStageId: stageId } as never,
      atorId,
    );
    leadsCriados.push(lead.id);
    await getLeadDetalhe(lead.id);
    await reconciliarPassosAuto(lead.id);
    expect((await passoDaEstimativa(lead.id))?.titulo).toBe(TITULO_PASSO_FATURAMENTO);

    await updateLead({ id: lead.id, servicoIds: [servicoPercentualId, servicoFixoId] } as never, atorId);
    expect((await passoDaEstimativa(lead.id))?.titulo).toBe(TITULO_PASSO_VALOR);
  });
});

describe("ADR-125 — a condição de pagamento viaja com o serviço", () => {
  it("a lista de serviços ativos entrega a condição para a proposta pré-preencher", async () => {
    await prisma.servico.update({
      where: { id: servicoPercentualId },
      data: { condicaoPagamento: "O recebimento do Repasse será sempre feito após o crédito na conta da Clínica." },
    });

    const ativos = await listServicosAtivos();
    const meu = ativos.find((s) => s.id === servicoPercentualId);
    expect(meu?.condicaoPagamento).toContain("após o crédito na conta da Clínica");
  });
});
