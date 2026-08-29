import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import {
  ativarServicoCliente,
  cancelarServicoCliente,
  previaDoCancelamento,
} from "../modules/servicos/servicos-cliente.service.js";
import { hojeBRT, somarDiasUTC } from "../lib/datas.js";

/**
 * CANCELAR O SERVIÇO ENCERRA A MENSALIDADE (decisão do dono, 28/08/2026).
 *
 * Até aqui cancelar um serviço na ficha parava o trabalho (o projeto ia a PAUSADO) e não
 * mexia no dinheiro: a série recorrente seguia materializando parcela todo mês, e a Med
 * continuava emitindo cobrança de um serviço que já não presta até alguém notar e apagar à
 * mão. Ninguém era avisado — trabalho invisível com nota fiscal.
 *
 * ⚠️ ENCERRAR É FECHAR A SÉRIE (`recorrenciaAte`), não apagar linhas do passado: o que já
 * venceu foi prestado e é devido.
 */

const PFX = `cancel-${randomBytes(4).toString("hex")}`;
let atorId: string;
let clienteId: string;
let servicoId: string;

beforeAll(async () => {
  exigirBancoDeTeste();
  atorId = (
    await prisma.user.create({ data: { nome: `${PFX}-ator`, email: `${PFX}@teste.local`, role: "ADMIN" } })
  ).id;
  servicoId = (
    await prisma.servico.create({
      data: { nome: `${PFX}-gestao`, categoria: "Gestão", ordem: 995, valor: 3500, valorRecorrencia: "MENSAL" },
    })
  ).id;
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } })).id;
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { userId: atorId } });
  await prisma.conta.deleteMany({ where: { clienteId } });
  await prisma.card.deleteMany({ where: { projeto: { clienteId } } });
  await prisma.projeto.deleteMany({ where: { clienteId } });
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.servico.deleteMany({ where: { id: servicoId } });
  await prisma.user.deleteMany({ where: { id: atorId } });
});

describe("cancelar o serviço para a mensalidade e mantém o que já venceu", () => {
  it("as futuras param, as vencidas ficam, e a série não gera mais nada", async () => {
    await ativarServicoCliente(clienteId, servicoId, {}, { id: atorId });

    const futura = await prisma.conta.findFirstOrThrow({
      where: { clienteId, tipo: "RECEBER", deletedAt: null },
    });
    expect(futura.recorrencia).toBe("MENSAL");

    // Uma parcela do mês passado, ainda em aberto: é dinheiro devido por serviço prestado.
    const vencida = await prisma.conta.create({
      data: {
        tipo: "RECEBER",
        descricao: futura.descricao,
        valor: futura.valor,
        vencimento: somarDiasUTC(hojeBRT(), -20),
        clienteId,
        recorrencia: "MENSAL",
        recorrenteId: futura.id,
      },
    });

    // A tela precisa dizer isto ANTES do clique.
    const previa = await previaDoCancelamento(clienteId, servicoId);
    expect(previa.parcelasFuturas).toBe(1);
    expect(previa.valorFuturo).toBe(3500);
    expect(previa.parcelasVencidas).toBe(1);

    await cancelarServicoCliente(clienteId, servicoId, "EQUIPE", undefined, atorId);

    const depoisFutura = await prisma.conta.findUniqueOrThrow({ where: { id: futura.id } });
    const depoisVencida = await prisma.conta.findUniqueOrThrow({ where: { id: vencida.id } });

    expect(depoisFutura.deletedAt, "a parcela futura continuou cobrando").not.toBeNull();
    expect(depoisVencida.deletedAt, "a parcela já vencida foi apagada — é dinheiro devido").toBeNull();
    expect(depoisVencida.recorrenciaAte, "a série não foi fechada: o mês que vem nasce de novo").not.toBeNull();
  });

  it("a cobrança AVULSA de outro serviço não é tocada", async () => {
    const avulsa = await prisma.conta.create({
      data: {
        tipo: "RECEBER",
        descricao: `Serviço: outro-servico — ${PFX}-clinica`,
        valor: 900,
        vencimento: somarDiasUTC(hojeBRT(), 15),
        clienteId,
        recorrencia: "NENHUMA",
      },
    });
    const depois = await prisma.conta.findUniqueOrThrow({ where: { id: avulsa.id } });
    expect(depois.deletedAt).toBeNull();
    expect(depois.recorrenciaAte).toBeNull();
  });
});
