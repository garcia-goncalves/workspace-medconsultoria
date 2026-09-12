import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { mudarStatusCredenciamento } from "../modules/servicos/credenciamento-grade.service.js";
import { hashPassword } from "../lib/password.js";

/**
 * APROVAR DUAS VEZES AO MESMO TEMPO COBRAVA O CLIENTE DUAS VEZES.
 *
 * `mudarStatusCredenciamento` lia o cruzamento UMA vez, no começo, e decidia criar a conta a
 * receber com base nesse retrato (`!atual.contaId`). Entre a leitura e a criação não havia
 * trava nenhuma: `Credenciamento.contaId` não é único e `criarContaDoHonorario` não reconferia.
 *
 * ⚠️ **Duas chamadas quase simultâneas não são hipótese de laboratório aqui.** O botão
 * "Atualizar" existe na página Credenciamentos E na grade da ficha, um clique duplo basta, e
 * a ADR-128 permite de propósito que a mesma clínica esteja aberta em duas sessões (a normal e
 * a de suporte da Med). As duas leituras viam `contaId` nulo, as duas passavam pela guarda, e
 * nasciam DUAS contas a receber do mesmo honorário — com a segunda gravação sobrescrevendo
 * `contaId`, de modo que uma das contas ficava órfã, sem nada na ficha que a explicasse.
 *
 * A cura é a reserva ATÔMICA: a conta é criada e só então amarrada por um `UPDATE ... WHERE
 * contaId IS NULL`, que o MySQL resolve numa linha travada — só um dos dois pedidos vê
 * `count === 1`. Quem perde a corrida apaga a conta que criou, e ela nunca chega a ser vista.
 */

const PFX = `race-${randomBytes(4).toString("hex")}`;
let ator: { id: string };
let clienteId: string;
let profissionalId: string;
let operadoraId: string;

beforeAll(async () => {
  const url = process.env["DATABASE_URL"] ?? "";
  expect(url).toContain("_test");
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
  operadoraId = (await prisma.operadora.create({ data: { nome: `${PFX}-operadora`, ordem: 997 } })).id;
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

describe("aprovar o mesmo credenciamento duas vezes ao mesmo tempo", () => {
  it("cria UMA conta a receber, nunca duas", async () => {
    const celula = await prisma.credenciamento.create({
      // Já EM ANÁLISE: é de lá que a operadora responde, e é esse o estado da linha quando
      // alguém clica em "Aprovar" (a transição direta de "A protocolar" é recusada por regra).
      data: { clienteId, profissionalId, operadoraId, valor: 2500, tentativa: 1, status: "EM_ANALISE" },
    });

    // As duas chamadas partem juntas, sem esperar uma pela outra — é o clique duplo.
    const resultados = await Promise.allSettled([
      mudarStatusCredenciamento({ id: celula.id, status: "APROVADO" }, ator),
      mudarStatusCredenciamento({ id: celula.id, status: "APROVADO" }, ator),
    ]);

    // Pelo menos uma tem de ter dado certo: a aprovação é um fato, não pode se perder.
    expect(resultados.some((r) => r.status === "fulfilled")).toBe(true);

    const contas = await prisma.conta.findMany({
      where: { clienteId, deletedAt: null, descricao: { contains: "Credenciamento aprovado" } },
    });
    expect(contas.length, "duas contas = cliente cobrado em dobro pelo mesmo honorário").toBe(1);

    // E a conta que sobrou tem de estar amarrada ao cruzamento — conta órfã é dinheiro que
    // ninguém acha pela ficha.
    const depois = await prisma.credenciamento.findUnique({ where: { id: celula.id } });
    expect(depois?.status).toBe("APROVADO");
    expect(depois?.contaId).toBe(contas[0]!.id);
  });
});
