import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { painelCredenciamentos } from "../modules/servicos/credenciamento-painel.service.js";

/**
 * "EM CURSO" E "APROVADO" SÃO DOIS CARTÕES LADO A LADO — E CONTAVAM O MESMO DINHEIRO DUAS VEZES.
 *
 * A página Credenciamentos mostra os dois juntos: *"Em curso — honorário ainda não aprovado"* e
 * *"Aprovado — já virou conta a receber"*. O rótulo do primeiro declara que ele exclui o
 * segundo. O cálculo não excluía: o filtro tirava só NEGADO e ENCERRADO, então o valor dos
 * aprovados entrava nos dois lugares.
 *
 * Achado na tela, com o banco de desenvolvimento: R$ 2.020 de fato em andamento apareciam como
 * R$ 2.770 — exatamente 2.020 mais os R$ 750 que o cartão vizinho já anunciava. Quem soma os
 * dois para saber quanto o credenciamento vale no total erra para mais, e erra em silêncio.
 *
 * ⚠️ Este teste trava a relação, não os números: os dois conjuntos têm de ser DISJUNTOS. É o
 * que impede alguém de "consertar" o cartão devolvendo o total do processo para dentro dele.
 */

const PFX = `resumo-${randomBytes(4).toString("hex")}`;
let clienteId: string;
let profissionalId: string;
const operadoras: string[] = [];

beforeAll(async () => {
  const url = process.env["DATABASE_URL"] ?? "";
  expect(url).toContain("_test");
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } })).id;
  profissionalId = (
    await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-medico`, conselho: "CRM", especialidade: "radiologista" },
    })
  ).id;

  // Um cruzamento por situação, cada um com um valor distinto para o erro aparecer na soma.
  const cenario = [
    { status: "A_PROTOCOLAR", valor: 100 },
    { status: "PROTOCOLADO", valor: 200 },
    { status: "EM_ANALISE", valor: 400 },
    { status: "APROVADO", valor: 800 },
    { status: "NEGADO", valor: 1600 },
    { status: "ENCERRADO", valor: 3200 },
  ] as const;

  for (const [i, c] of cenario.entries()) {
    const op = await prisma.operadora.create({ data: { nome: `${PFX}-op${i}`, ordem: 900 + i } });
    operadoras.push(op.id);
    await prisma.credenciamento.create({
      data: {
        clienteId,
        profissionalId,
        operadoraId: op.id,
        valor: c.valor,
        status: c.status,
        motivoNegativa: c.status === "NEGADO" ? "motivo de teste" : null,
      },
    });
  }
});

afterAll(async () => {
  await prisma.credenciamento.deleteMany({ where: { clienteId } });
  await prisma.profissional.deleteMany({ where: { clienteId } });
  await prisma.operadora.deleteMany({ where: { id: { in: operadoras } } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.$disconnect();
});

describe("resumo do painel de credenciamentos", () => {
  it('"Em curso" conta só o que AINDA NÃO foi aprovado', async () => {
    const { resumo } = await painelCredenciamentos({ clienteId });
    // 100 + 200 + 400. Os 800 do aprovado ficam de fora — eles já são o cartão do lado.
    expect(resumo.valorEmCurso).toBe(700);
  });

  it('"Aprovado" conta só o aprovado', async () => {
    const { resumo } = await painelCredenciamentos({ clienteId });
    expect(resumo.valorAprovado).toBe(800);
  });

  it("os dois cartões são disjuntos: somá-los não conta ninguém duas vezes", async () => {
    const { resumo, linhas } = await painelCredenciamentos({ clienteId });

    const soma = (filtro: (s: string) => boolean) =>
      linhas.filter((l) => filtro(l.status)).reduce((s, l) => s + l.valor, 0);

    // A soma dos dois cartões tem de dar exatamente o que não terminou mal — nem mais (que é
    // contar aprovado duas vezes), nem menos (que é esconder trabalho em andamento).
    expect(resumo.valorEmCurso + resumo.valorAprovado).toBe(soma((s) => s !== "NEGADO" && s !== "ENCERRADO"));

    // E nenhum aprovado pode estar dentro do "em curso".
    expect(resumo.valorEmCurso).toBe(soma((s) => s !== "APROVADO" && s !== "NEGADO" && s !== "ENCERRADO"));
  });
});
