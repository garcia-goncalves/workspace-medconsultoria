import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { mudarStatusCredenciamento, salvarGrade } from "../modules/servicos/credenciamento-grade.service.js";
import { hashPassword } from "../lib/password.js";

/**
 * M15 — CREDENCIAMENTO "A COMBINAR" APROVADO NUNCA MAIS COBRAVA.
 *
 * `Credenciamento.valor` tem padrão 0: o cruzamento médico × operadora pode nascer sem preço,
 * porque nem sempre ele está acertado na hora de montar a grade. Quando a operadora aprovava
 * esse cruzamento, a aprovação criava uma conta a receber de **R$ 0,00** e prendia as duas
 * (`contaId`). Daí em diante a guarda `!atual.contaId` fazia o resto do estrago: a conta existia,
 * então nada mais tentava cobrar. Um credenciamento aprovado, trabalho entregue, e uma linha de
 * R$ 0,00 no Financeiro que ninguém lê como pendência.
 *
 * A correção não pode ser recusar a aprovação — a operadora aprovou, e isso é um fato que o
 * sistema precisa registrar. Ela é: **aprova, NÃO inventa uma cobrança de zero, e deixa o sinal
 * à vista** nas observações do cruzamento, que é o que a página Credenciamentos desenha embaixo
 * de cada linha. Acertado o valor pela grade da ficha, a cobrança que faltava nasce ali — o
 * `contaId` continuou nulo, então a porta nunca chegou a fechar.
 */

const PFX = `zero-${randomBytes(4).toString("hex")}`;
let ator: { id: string };
let clienteId: string;
let profissionalId: string;
let operadoraId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  ator = { id: u.id };
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } })).id;
  profissionalId = (
    await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-medico`, conselho: "CRM", especialidade: "ortopedista", anoFormatura: 2012 },
    })
  ).id;
  operadoraId = (await prisma.operadora.create({ data: { nome: `${PFX}-operadora`, ordem: 998 } })).id;
});

afterAll(async () => {
  await prisma.credenciamento.deleteMany({ where: { clienteId } });
  await prisma.conta.deleteMany({ where: { clienteId } });
  await prisma.profissional.deleteMany({ where: { clienteId } });
  await prisma.operadora.deleteMany({ where: { id: operadoraId } });
  await prisma.activityLog.deleteMany({ where: { entidadeId: clienteId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

const contasDoCliente = () => prisma.conta.findMany({ where: { clienteId, deletedAt: null } });

async function novaCelula(tentativa: number, valor: number) {
  return prisma.credenciamento.create({ data: { clienteId, profissionalId, operadoraId, valor, tentativa } });
}

describe("M15 — honorário 'a combinar' não vira conta de R$ 0,00", () => {
  it("aprovar com valor zerado não cria conta nenhuma e não prende um contaId", async () => {
    const celula = await novaCelula(1, 0);
    await mudarStatusCredenciamento({ id: celula.id, status: "PROTOCOLADO" }, ator);
    const aprovada = await mudarStatusCredenciamento({ id: celula.id, status: "APROVADO" }, ator);

    expect(aprovada.status, "a aprovação acontece — o fato é da operadora").toBe("APROVADO");
    expect(await contasDoCliente(), "conta de R$ 0,00 é dinheiro que ninguém volta a cobrar").toHaveLength(0);
    expect(aprovada.contaId, "sem contaId, a cobrança continua possível").toBeNull();
  });

  it("o sinal de que falta definir o valor fica à vista na linha da grade", async () => {
    const celula = await prisma.credenciamento.findFirstOrThrow({ where: { clienteId, tentativa: 1 } });
    expect(celula.observacoes ?? "", "a página Credenciamentos desenha as observações da linha").toMatch(
      /valor.*a combinar|a combinar.*valor/i,
    );
  });

  it("acertado o valor na grade da ficha, a cobrança que faltava é criada", async () => {
    // A grade da ficha é o lugar onde o valor do cruzamento se digita — e é por ela que o
    // honorário "a combinar" vira número. Um APROVADO que já cobrou continua congelado; este
    // não cobrou nada, e é justamente a peça que falta.
    await salvarGrade({ clienteId, celulas: [{ profissionalId, operadoraId, valor: 2500 }] }, ator);

    const celula = await prisma.credenciamento.findFirstOrThrow({ where: { clienteId, tentativa: 1 } });
    expect(Number(celula.valor), "o valor combinado depois é aceito").toBe(2500);

    const contas = await contasDoCliente();
    expect(contas, "o honorário acertado depois vira cobrança").toHaveLength(1);
    expect(Number(contas[0]!.valor)).toBe(2500);
    expect(celula.contaId).toBe(contas[0]!.id);
    expect(celula.observacoes ?? "", "com a cobrança criada, a pendência sai da linha").not.toMatch(/a combinar/i);
  });

  it("APROVADO que JÁ cobrou continua com o valor congelado", async () => {
    const celula = await prisma.credenciamento.findFirstOrThrow({ where: { clienteId, tentativa: 1 } });
    await salvarGrade({ clienteId, celulas: [{ profissionalId, operadoraId, valor: 9999 }] }, ator);

    const depois = await prisma.credenciamento.findUniqueOrThrow({ where: { id: celula.id } });
    expect(Number(depois.valor), "o que já virou conta não se reescreve pela grade").toBe(2500);
    expect(await contasDoCliente(), "e não nasce uma segunda cobrança").toHaveLength(1);
  });

  it("aprovar com valor acertado desde o começo continua criando a conta de uma vez", async () => {
    const celula = await novaCelula(2, 1800);
    await mudarStatusCredenciamento({ id: celula.id, status: "PROTOCOLADO" }, ator);
    const aprovada = await mudarStatusCredenciamento({ id: celula.id, status: "APROVADO" }, ator);

    const conta = await prisma.conta.findUniqueOrThrow({ where: { id: aprovada.contaId! } });
    expect(Number(conta.valor)).toBe(1800);
    expect(
      (await prisma.credenciamento.findUniqueOrThrow({ where: { id: celula.id } })).observacoes ?? "",
      "sem pendência de valor, nada é escrito nas observações",
    ).not.toMatch(/a combinar/i);
  });
});
