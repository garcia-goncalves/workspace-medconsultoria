import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { sincronizarServicosContratados } from "../modules/servicos/servicos-cliente.service.js";

/**
 * VENDIDO E NÃO COBRADO — o buraco do upsell.
 *
 * Aceitar uma proposta sincroniza os serviços e gera o contrato, mas quem cobrava era sempre
 * OUTRO caminho: a conversão do lead. Para o cliente JÁ convertido — exatamente o caso do
 * upsell, que é o que a Med mais quer vender — não há conversão nenhuma depois do aceite, e a
 * conta a receber simplesmente nunca nascia.
 *
 * O segundo caso é a trava contra o oposto: havendo lead ativo, quem cobra é a conversão, e
 * lançar aqui também cobraria o cliente duas vezes.
 */

const PFX = `upsell-${randomBytes(4).toString("hex")}`;
let atorId: string;
let servicoId: string;
let clienteConvertido: string;
let clienteComLead: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const ator = await prisma.user.create({
    data: { nome: `${PFX}-ator`, email: `${PFX}@teste.local`, role: "ADMIN" },
  });
  atorId = ator.id;
  const servico = await prisma.servico.create({
    data: { nome: `${PFX}-gestao`, categoria: "Gestão", ordem: 997, valor: 3500 },
  });
  servicoId = servico.id;
  clienteConvertido = (await prisma.cliente.create({ data: { nome: `${PFX}-ja-cliente` } })).id;
  clienteComLead = (await prisma.cliente.create({ data: { nome: `${PFX}-ainda-lead` } })).id;

  const etapa = await prisma.pipelineStage.findFirst({ orderBy: { ordem: "asc" }, select: { id: true } });
  if (!etapa) throw new Error("O banco de teste precisa das etapas do funil semeadas.");
  await prisma.lead.create({
    data: { nome: `${PFX}-lead`, clienteId: clienteComLead, pipelineStageId: etapa.id, ordem: 0 },
  });
});

afterAll(async () => {
  const clientes = [clienteConvertido, clienteComLead];
  await prisma.activityLog.deleteMany({ where: { userId: atorId } });
  await prisma.conta.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.clienteServico.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.lead.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.cliente.deleteMany({ where: { id: { in: clientes } } });
  await prisma.servico.delete({ where: { id: servicoId } });
  await prisma.user.delete({ where: { id: atorId } });
});

describe("proposta aceita por cliente JÁ convertido", () => {
  it("gera a conta a receber pelo valor ACEITO", async () => {
    await sincronizarServicosContratados(
      clienteConvertido,
      [{ servicoId, valor: 2800, recorrencia: "MENSAL" }],
      { id: atorId },
    );

    const contas = await prisma.conta.findMany({ where: { clienteId: clienteConvertido, tipo: "RECEBER" } });
    expect(contas).toHaveLength(1);
    const conta = contas[0]!;
    // O valor é o da proposta aceita (2800), não o do catálogo (3500) — ADR-137.
    expect(Number(conta.valor)).toBe(2800);
    expect(conta.recorrencia).toBe("MENSAL");
  });

  it("aceitar de novo o mesmo serviço NÃO lança a cobrança duas vezes", async () => {
    await sincronizarServicosContratados(
      clienteConvertido,
      [{ servicoId, valor: 2800, recorrencia: "MENSAL" }],
      { id: atorId },
    );
    expect(await prisma.conta.count({ where: { clienteId: clienteConvertido, tipo: "RECEBER" } })).toBe(1);
  });
});

describe("proposta aceita por quem AINDA é lead", () => {
  it("não lança nada — quem cobra é a conversão", async () => {
    await sincronizarServicosContratados(
      clienteComLead,
      [{ servicoId, valor: 2800, recorrencia: "MENSAL" }],
      { id: atorId },
    );
    expect(await prisma.conta.count({ where: { clienteId: clienteComLead, tipo: "RECEBER" } })).toBe(0);
  });
});
