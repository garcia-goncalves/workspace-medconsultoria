import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { servicosDoClientePortal } from "../modules/servicos/servicos-cliente.service.js";

/**
 * F20 — O PORTAL NUNCA MOSTRAVA AO CLIENTE QUANTO ESTAVA SENDO COBRADO.
 *
 * `servicosDoClientePortal` devolvia `servico`, `requisitos` e `convenios`, mas omitia a
 * contratação — onde moram `valor`, `valorRecorrencia`, `percentual` e
 * `percentualRecorrencia`. O cliente que paga 5% do faturamento não conferia isso em lugar
 * nenhum do Portal. `s.contratacao` já vinha convertido por `emReais` desde `servicosDoCliente`
 * (ADR-118) — a correção é só devolvê-lo, sem `Decimal` cru atravessando o tRPC.
 */

const PFX = `preco-${randomBytes(4).toString("hex")}`;
let clienteId: string;
let servicoId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } })).id;
  servicoId = (
    await prisma.servico.create({
      data: {
        nome: `${PFX}-faturamento`,
        categoria: "Faturamento",
        percentual: 5,
        percentualRecorrencia: "MENSAL",
        ehCredenciamento: false,
      },
    })
  ).id;
  await prisma.clienteServico.create({
    data: { clienteId, servicoId, status: "ATIVO", percentual: 5, percentualRecorrencia: "MENSAL" },
  });
});

afterAll(async () => {
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.servico.deleteMany({ where: { id: servicoId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("F20 — o preço contratado chega ao Portal", () => {
  it("devolve o percentual combinado, já em número (nunca Decimal cru)", async () => {
    const servicos = await servicosDoClientePortal(clienteId);
    const item = servicos.find((s) => s.servico.id === servicoId);
    expect(item, "o serviço contratado precisa aparecer no Portal").toBeTruthy();
    expect(item!.preco, "F20: o preço contratado precisa vir junto").toBeTruthy();
    expect(item!.preco!.percentual).toBe(5);
    expect(item!.preco!.percentualRecorrencia).toBe("MENSAL");
    expect(typeof item!.preco!.percentual).toBe("number");
  });
});
