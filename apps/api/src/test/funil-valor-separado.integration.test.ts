import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { listLeads } from "../modules/leads/leads.service.js";

/**
 * F8 — a régua já é pura e testada (`valor-do-funil.test.ts`); o que se prova AQUI é a ligação:
 * o board recebe os dois números separados, e recebe como **número**.
 *
 * ⚠️ O segundo ponto não é detalhe. `Servico.valor` e `Servico.percentual` são `Decimal`, e um
 * `Decimal` atravessando o tRPC vira objeto no JSON: a tela mostra "R$ NaN" sem um único erro de
 * console (ADR-118). Como a divisão passou a depender do preço de cada serviço do lead, um
 * caminho novo de dinheiro nasceu — e ele é conferido com `typeof`, em runtime, não pela tipagem,
 * que já foi enganada uma vez.
 */

const PFX = `fnl-${randomBytes(4).toString("hex")}`;
let stageId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  stageId = (await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } })).id;

  const mensal = await prisma.servico.create({
    data: { nome: `${PFX}-gestao`, valor: 3500, valorRecorrencia: "MENSAL" as never },
  });
  const avulso = await prisma.servico.create({
    data: { nome: `${PFX}-site`, valor: 1500, valorRecorrencia: "AVULSO" as never },
  });

  await prisma.lead.create({
    data: {
      nome: `${PFX}-misto`,
      pipelineStageId: stageId,
      valorEstimado: 5000,
      servicos: { connect: [{ id: mensal.id }, { id: avulso.id }] },
    },
  });
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.servico.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("F8 — o board recebe o valor do funil já separado", () => {
  it("mensal e avulso chegam separados, e chegam como número", async () => {
    const leads = await listLeads();
    const lead = leads.find((l) => l.nome === `${PFX}-misto`);
    expect(lead, "o lead do teste tem de estar no board").toBeTruthy();

    expect(lead!.estimativa.mensal).toBe(3500);
    expect(lead!.estimativa.avulso).toBe(1500);
    expect(typeof lead!.estimativa.mensal, "dinheiro chega à tela como number (ADR-118)").toBe("number");
    expect(typeof lead!.estimativa.avulso).toBe("number");
  });

  it("o board continua recebendo os serviços só com id e nome (preço não é assunto dele)", async () => {
    const leads = await listLeads();
    const lead = leads.find((l) => l.nome === `${PFX}-misto`)!;
    expect(lead.servicos).toHaveLength(2);
    for (const s of lead.servicos) {
      expect(Object.keys(s).sort(), "preço em Decimal não pode vazar por aqui").toEqual(["id", "nome"]);
    }
  });
});
