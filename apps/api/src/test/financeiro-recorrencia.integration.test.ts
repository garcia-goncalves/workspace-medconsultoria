import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { marcarPaga } from "../modules/financeiro/contas.service";
import { hashPassword } from "../lib/password";

/**
 * Ciclo marcar → desmarcar → marcar de uma conta recorrente.
 *
 * Desmarcar faz SOFT-DELETE da sucessora (a linha continua na tabela). Se a geração
 * ignorasse as apagadas, remarcar criaria uma SEGUNDA linha para a mesma data: a apagada
 * viraria órfã e um índice único em (recorrenteId, vencimento) recusaria o insert.
 * A geração ressuscita a linha existente.
 */
const PFX = `rec-${randomBytes(4).toString("hex")}`;
let categoriaId: string;
let ctx: { userId: string; role: string };

const utc = (ano: number, mes: number, dia: number) => new Date(Date.UTC(ano, mes - 1, dia));
const iso = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  ctx = { userId: u.id, role: "ADMIN" };
  const c = await prisma.categoria.create({ data: { nome: `${PFX}-cat`, tipo: "DESPESA" } });
  categoriaId = c.id;
});

afterAll(async () => {
  await prisma.conta.deleteMany({ where: { descricao: { startsWith: PFX } } });
  await prisma.categoria.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

/** Todas as ocorrências da série, inclusive as apagadas. */
async function daSerie(origemId: string) {
  return prisma.conta.findMany({
    where: { OR: [{ id: origemId }, { recorrenteId: origemId }] },
    orderBy: { vencimento: "asc" },
    select: { id: true, vencimento: true, deletedAt: true, pago: true },
  });
}

describe("recorrência — marcar, desmarcar e marcar de novo", () => {
  it("não duplica a data: ressuscita a ocorrência que a reversão apagou", async () => {
    const origem = await prisma.conta.create({
      data: {
        tipo: "PAGAR",
        escopo: "EMPRESA",
        descricao: `${PFX}-aluguel`,
        valor: 1000 as never,
        vencimento: utc(2026, 1, 31),
        categoriaId,
        recorrencia: "MENSAL",
      },
    });

    // 1) Marcar paga → nasce a sucessora (31/01 clampado para 28/02).
    await marcarPaga(origem.id, true, ctx);
    let serie = await daSerie(origem.id);
    expect(serie).toHaveLength(2);
    expect(iso(serie[1]!.vencimento)).toBe("2026-02-28");
    const sucessoraId = serie[1]!.id;

    // 2) Desmarcar → a sucessora é apagada (soft-delete), mas a LINHA continua.
    await marcarPaga(origem.id, false, ctx);
    serie = await daSerie(origem.id);
    expect(serie, "a linha continua na tabela").toHaveLength(2);
    expect(serie[1]!.deletedAt, "apagada por soft-delete").not.toBeNull();

    // 3) Marcar de novo → ressuscita a MESMA linha; não cria uma segunda para a data.
    await marcarPaga(origem.id, true, ctx);
    serie = await daSerie(origem.id);
    expect(serie, "sem linha nova para a mesma data").toHaveLength(2);
    expect(serie[1]!.id, "é a mesma linha de antes").toBe(sucessoraId);
    expect(serie[1]!.deletedAt, "de volta à vida").toBeNull();
    expect(serie[1]!.pago, "ressuscita como pendente").toBe(false);
  });

  it("nenhuma série fica com duas ocorrências na mesma data (o que o índice único exigiria)", async () => {
    const grupos = await prisma.conta.groupBy({
      by: ["recorrenteId", "vencimento"],
      where: { recorrenteId: { not: null }, descricao: { startsWith: PFX } },
      _count: { _all: true },
    });
    const duplicados = grupos.filter((g) => g._count._all > 1);
    expect(duplicados, "inclui as apagadas — é o escopo do índice único").toEqual([]);
  });
});
