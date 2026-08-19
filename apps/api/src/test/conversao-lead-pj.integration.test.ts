import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { garantirClienteDoLead } from "../modules/leads/leads.service";

/**
 * ADR-119 — **todo cliente nasce pessoa jurídica**.
 *
 * Este teste existe porque o caminho por onde a pessoa física entrava no cadastro NÃO era a
 * tela: era a conversão do lead. Lead sem o campo "Empresa" preenchido virava um cliente PF
 * sem ninguém escolher nada, e o credenciamento desse cliente já nascia reprovado pela antiga
 * triagem R1. Fechar só a tela deixaria o portão dos fundos aberto.
 *
 * Roda contra MySQL de verdade de propósito: depois da migração a coluna `tipo` não existe
 * mais, e é o banco — não a tipagem — que garante que ninguém grave PF.
 */
const PFX = `conv-${randomBytes(4).toString("hex")}`;

async function criarLead(dados: { nome: string; empresa?: string | null; cnpj?: string | null }) {
  const stage = await prisma.pipelineStage.findFirst({ orderBy: { ordem: "asc" } });
  if (!stage) throw new Error("Pipeline não configurado no banco de teste.");
  return prisma.lead.create({
    data: {
      nome: dados.nome,
      empresa: dados.empresa ?? null,
      cnpj: dados.cnpj ?? null,
      email: `${dados.nome.replace(/\W/g, "")}@example.test`,
      telefone: "(11) 90000-0000",
      pipelineStageId: stage.id,
    },
  });
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
});

afterAll(async () => {
  const clientes = await prisma.cliente.findMany({ where: { nome: { contains: PFX } }, select: { id: true } });
  const ids = clientes.map((c) => c.id);
  await prisma.contato.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { nome: { contains: PFX } } });
  await prisma.cliente.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("conversão do lead — a conta nasce sempre pessoa jurídica (ADR-119)", () => {
  it("com razão social: a conta é a empresa e a pessoa vira contato principal", async () => {
    const lead = await criarLead({ nome: `Dra. Ana ${PFX}`, empresa: `Clínica Ana ${PFX}`, cnpj: "11.222.333/0001-81" });
    const clienteId = await garantirClienteDoLead(lead, null);

    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: clienteId } });
    expect(cliente.nome).toBe(`Clínica Ana ${PFX}`);
    expect(cliente.cnpj).toBe("11.222.333/0001-81");

    const contato = await prisma.contato.findFirstOrThrow({ where: { clienteId, principal: true } });
    expect(contato.nome).toBe(`Dra. Ana ${PFX}`);
  });

  it("SEM razão social: a conta nasce com o nome da pessoa — e mesmo assim é PJ, não PF", async () => {
    const lead = await criarLead({ nome: `Dr. Bruno ${PFX}`, empresa: null });
    const clienteId = await garantirClienteDoLead(lead, null);

    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: clienteId } });
    expect(cliente.nome).toBe(`Dr. Bruno ${PFX}`);
    // A prova de que não existe mais pessoa física é estrutural: a coluna não existe.
    expect(cliente).not.toHaveProperty("tipo");
  });

  it("SEM razão social o contato principal continua sendo criado — a conta é empresa, e empresa não atende telefone", async () => {
    const lead = await criarLead({ nome: `Dra. Carla ${PFX}`, empresa: null });
    const clienteId = await garantirClienteDoLead(lead, null);

    const contato = await prisma.contato.findFirst({ where: { clienteId, principal: true } });
    expect(contato).not.toBeNull();
    expect(contato!.nome).toBe(`Dra. Carla ${PFX}`);
    expect(contato!.telefone).toBe("(11) 90000-0000");
  });

  it("o CNPJ digitado no lead viaja para a ficha do cliente — ninguém redigita", async () => {
    const lead = await criarLead({ nome: `Dr. Davi ${PFX}`, empresa: `Consultório Davi ${PFX}`, cnpj: "22.333.444/0001-81" });
    const clienteId = await garantirClienteDoLead(lead, null);

    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: clienteId } });
    expect(cliente.cnpj).toBe("22.333.444/0001-81");
  });

  it("o banco RECUSA gravar tipo de pessoa — a regra não depende de ninguém lembrar dela", async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE Cliente SET tipo = 'PF' WHERE nome LIKE '%${PFX}%'`),
    ).rejects.toThrow();
  });
});
