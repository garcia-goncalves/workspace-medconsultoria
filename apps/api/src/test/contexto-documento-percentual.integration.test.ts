import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { contextoClienteDoc } from "../modules/documentos/documentos.service.js";

/**
 * F9 — O CONTEXTO DO DOCUMENTO DEVOLVIA R$ 0,00 DE INVESTIMENTO.
 *
 * `contextoClienteDoc` é o que faz o "Novo documento" nascer preenchido: ele soma os serviços do
 * cliente e devolve `investimento` (avulso + mensal) e `sugestoes.valor`. A soma olhava só o
 * **valor fixo** — e o cliente de Faturamento não tem valor fixo nenhum, ele paga um percentual
 * do que fatura (ADR-125/127).
 *
 * Resultado: para o cliente que é justamente o carro-chefe da Med, o dialog abria dizendo
 * **R$ 0,00** de investimento e pré-preenchia o recibo com zero. O corpo do documento estava
 * certo o tempo todo (`montarServicos` já escreve a linha do percentual) — quem mentia era o
 * resumo que a Thaís lê ANTES de gerar, e o campo que ela aceitaria sem reparar.
 *
 * ⚠️ O percentual **não vira um valor em reais aqui**: ele depende do faturamento do mês, que o
 * documento não conhece. O que o contexto passa a devolver é o percentual em separado, para
 * quem desenha dizer "5% do faturamento/mês" em vez de "R$ 0,00".
 */

const PFX = `f9-${randomBytes(4).toString("hex")}`;
let clienteId: string;
let clienteMistoId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica-pct` } })).id;
  clienteMistoId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica-mista` } })).id;

  const faturamento = await prisma.servico.create({
    data: { nome: `${PFX}-faturamento`, valor: null, percentual: 5, percentualRecorrencia: "MENSAL" as never },
  });
  const gestao = await prisma.servico.create({
    data: { nome: `${PFX}-gestao`, valor: 3500, valorRecorrencia: "MENSAL" as never },
  });

  await prisma.clienteServico.create({
    data: { clienteId, servicoId: faturamento.id, status: "ATIVO", percentual: 5, percentualRecorrencia: "MENSAL" as never },
  });
  await prisma.clienteServico.createMany({
    data: [
      { clienteId: clienteMistoId, servicoId: faturamento.id, status: "ATIVO", percentual: 4 },
      { clienteId: clienteMistoId, servicoId: gestao.id, status: "ATIVO", valor: 3500, valorRecorrencia: "MENSAL" as never },
    ] as never,
  });
});

afterAll(async () => {
  const ids = [clienteId, clienteMistoId];
  await prisma.clienteServico.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.cliente.deleteMany({ where: { id: { in: ids } } });
  await prisma.servico.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("F9 — o investimento do contexto não é R$ 0,00 para quem paga percentual", () => {
  it("cliente só de percentual: o contexto devolve o percentual, não um zero", async () => {
    const ctx = await contextoClienteDoc({ clienteId, tipo: "PROPOSTA" });

    expect(ctx.investimento.avulso).toBe(0);
    expect(ctx.investimento.mensal).toBe(0);
    expect(ctx.investimento.percentualMensal, "5% do faturamento, por mês").toBe(5);
    expect(typeof ctx.investimento.percentualMensal, "dinheiro/percentual chega à tela como número").toBe("number");
  });

  it("o valor sugerido não é preenchido com zero quando não há valor fixo", async () => {
    const ctx = await contextoClienteDoc({ clienteId, tipo: "RECIBO" });
    // Sugerir 0 faz a pessoa aceitar um recibo de R$ 0,00 sem reparar. Melhor não sugerir nada.
    expect(ctx.sugestoes.valor).toBe(0);
    expect(ctx.sugestoes.investimento, "o resumo em texto diz o que o número não consegue").toMatch(
      /5\s*%.*faturamento/i,
    );
  });

  it("cliente misto: o valor fixo continua igual e o percentual passa a aparecer junto", async () => {
    const ctx = await contextoClienteDoc({ clienteId: clienteMistoId, tipo: "PROPOSTA" });

    expect(ctx.investimento.mensal).toBe(3500);
    expect(ctx.investimento.avulso).toBe(0);
    expect(ctx.investimento.percentualMensal).toBe(4);
    expect(ctx.sugestoes.valor, "o campo de valor continua sendo o fixo mensal").toBe(3500);
  });
});
