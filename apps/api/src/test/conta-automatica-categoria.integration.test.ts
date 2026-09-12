import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { hashPassword } from "../lib/password.js";
import { ativarServicoCliente } from "../modules/servicos/servicos-cliente.service.js";
import { mudarStatusCredenciamento } from "../modules/servicos/credenciamento-grade.service.js";

/**
 * B2 — CONTA CRIADA POR AUTOMAÇÃO NASCIA SEM CATEGORIA.
 *
 * Contratar serviço na ficha e a operadora aprovar um credenciamento criavam conta a receber
 * sem `categoriaId`, e o relatório por categoria do Financeiro sub-contava exatamente essas
 * contas. A correção reusa "Honorários" — a categoria-semente de RECEITA que já existe para
 * este mesmo dinheiro (`categorias.service.ts`, `DEFAULTS_EMPRESA`) — garantindo-a na hora,
 * porque num banco novo ninguém pode ter aberto a tela de Categorias ainda.
 *
 * A conversão do lead (a 3ª porta que cria conta automática) fica de fora: `leads.service.ts`
 * não está no escopo autorizado desta correção.
 */

const PFX = `catconta-${randomBytes(4).toString("hex")}`;
let ator: { id: string };
let clienteId1: string;
let clienteId2: string;
let servicoId: string;
let profissionalId: string;
let operadoraId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  ator = { id: u.id };

  clienteId1 = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica-1` } })).id;
  clienteId2 = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica-2` } })).id;

  servicoId = (
    await prisma.servico.create({ data: { nome: `${PFX}-servico`, valor: 1000, valorRecorrencia: "AVULSO" } })
  ).id;

  profissionalId = (
    await prisma.profissional.create({
      data: { clienteId: clienteId2, nome: `${PFX}-medico`, conselho: "CRM", anoFormatura: 2010 },
    })
  ).id;
  operadoraId = (await prisma.operadora.create({ data: { nome: `${PFX}-operadora`, ordem: 997 } })).id;
});

afterAll(async () => {
  await prisma.credenciamento.deleteMany({ where: { clienteId: clienteId2 } });
  await prisma.conta.deleteMany({ where: { clienteId: { in: [clienteId1, clienteId2] } } });
  await prisma.clienteServico.deleteMany({ where: { clienteId: { in: [clienteId1, clienteId2] } } });
  await prisma.profissional.deleteMany({ where: { clienteId: clienteId2 } });
  await prisma.operadora.deleteMany({ where: { id: operadoraId } });
  await prisma.servico.deleteMany({ where: { id: servicoId } });
  await prisma.cliente.deleteMany({ where: { id: { in: [clienteId1, clienteId2] } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

async function categoriaHonorarios() {
  return prisma.categoria.findFirst({ where: { nome: "Honorários", tipo: "RECEITA", escopo: "EMPRESA" } });
}

describe("B2 — conta automática nasce com categoria", () => {
  it("contratar serviço pela ficha cria a conta já categorizada", async () => {
    await ativarServicoCliente(clienteId1, servicoId, {}, ator);
    const conta = await prisma.conta.findFirstOrThrow({ where: { clienteId: clienteId1 } });
    const categoria = await categoriaHonorarios();
    expect(conta.categoriaId, "a conta nasceu sem categoria").not.toBeNull();
    expect(conta.categoriaId).toBe(categoria?.id);
  });

  it("a operadora aprovando o credenciamento cria a conta do honorário já categorizada", async () => {
    const celula = await prisma.credenciamento.create({
      data: { clienteId: clienteId2, profissionalId, operadoraId, valor: 2500, tentativa: 1 },
    });
    await mudarStatusCredenciamento({ id: celula.id, status: "PROTOCOLADO" }, ator);
    await mudarStatusCredenciamento({ id: celula.id, status: "APROVADO" }, ator);

    const conta = await prisma.conta.findFirstOrThrow({ where: { clienteId: clienteId2 } });
    const categoria = await categoriaHonorarios();
    expect(conta.categoriaId, "a conta do honorário nasceu sem categoria").not.toBeNull();
    expect(conta.categoriaId).toBe(categoria?.id);
  });
});
