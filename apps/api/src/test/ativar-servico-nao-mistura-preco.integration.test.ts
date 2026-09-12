import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { ativarServicoCliente } from "../modules/servicos/servicos-cliente.service.js";

/**
 * Achado da auditoria de 04/09/2026: das QUATRO portas de preço (catálogo, edição de
 * contratação, aceite de proposta e `ativarServicoCliente`), só esta última não conferia
 * valor+percentual juntos — as outras três já recusam a combinação (ADR-138). Hoje nenhuma tela
 * chama `ativarServicoCliente` passando `valor`, então não mordia ninguém ainda; mas a função é
 * pública e qualquer chamada direta (script, próxima tela) podia gravar um `ClienteServico`
 * inválido.
 */

const PFX = `ativar-preco-${randomBytes(4).toString("hex")}`;
let atorId: string;
let clienteId: string;
let servicoPercentualId: string;

beforeAll(async () => {
  exigirBancoDeTeste();
  atorId = (
    await prisma.user.create({ data: { nome: `${PFX}-ator`, email: `${PFX}@teste.local`, role: "ADMIN" } })
  ).id;
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica`, situacaoComercial: "ATIVO" } })).id;
  // Um serviço só-percentual, como o Faturamento — nunca tem `valor` de catálogo.
  servicoPercentualId = (
    await prisma.servico.create({
      data: { nome: `${PFX}-faturamento`, categoria: "Faturamento", ordem: 994, percentual: 5, percentualRecorrencia: "MENSAL" },
    })
  ).id;
});

afterAll(async () => {
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.card.deleteMany({ where: { projeto: { clienteId } } });
  await prisma.projeto.deleteMany({ where: { clienteId } });
  await prisma.activityLog.deleteMany({ where: { userId: atorId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.servico.deleteMany({ where: { id: servicoPercentualId } });
  await prisma.user.deleteMany({ where: { id: atorId } });
});

describe("ativarServicoCliente recusa valor fixo num serviço só-percentual", () => {
  it("passar opts.valor para um serviço com percentual de catálogo é recusado", async () => {
    await expect(
      ativarServicoCliente(clienteId, servicoPercentualId, { valor: 1000 }, { id: atorId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const cs = await prisma.clienteServico.findUnique({
      where: { clienteId_servicoId: { clienteId, servicoId: servicoPercentualId } },
    });
    expect(cs, "nada pode ter sido gravado depois da recusa").toBeNull();
  });

  it("sem opts.valor, contratar o mesmo serviço continua funcionando normalmente", async () => {
    const cs = await ativarServicoCliente(clienteId, servicoPercentualId, {}, { id: atorId });
    expect(cs.status).toBe("ATIVO");
  });
});
