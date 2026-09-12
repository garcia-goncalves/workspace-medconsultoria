import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { marcarPaga, updateConta } from "../modules/financeiro/contas.service";
import { hashPassword } from "../lib/password";

/**
 * Ciclo marcar → desmarcar → marcar de uma conta recorrente.
 *
 * Desmarcar DESFAZ a sucessora, apagando a linha que a materialização tinha acabado de criar.
 * Numa série, `deletedAt` passou a ter um significado só — "alguém excluiu esta parcela de
 * propósito" —, e a geração respeita isso em vez de ressuscitar (C10). O índice único
 * `(recorrenteId, vencimento)` continua garantindo uma linha por data.
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
  it("não duplica a data: a reversão desfaz a sucessora e remarcar a cria de novo", async () => {
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

    // 2) Desmarcar → a sucessora é desfeita. ⚠️ A linha é APAGADA de verdade (C10): a
    //    materialização a tinha criado segundos antes, ninguém a pagou, e desmarcar é desfazer
    //    essa criação. Deixá-la soft-deletada dava dois significados a `deletedAt` numa série, e
    //    era por isso que a varredura ressuscitava a parcela que alguém excluía à mão.
    await marcarPaga(origem.id, false, ctx);
    serie = await daSerie(origem.id);
    expect(serie, "a sucessora foi desfeita, não guardada").toHaveLength(1);

    // 3) Marcar de novo → a data volta a existir, uma única vez.
    await marcarPaga(origem.id, true, ctx);
    serie = await daSerie(origem.id);
    expect(serie, "uma linha por data, nunca duas").toHaveLength(2);
    expect(iso(serie[1]!.vencimento)).toBe("2026-02-28");
    expect(serie[1]!.deletedAt).toBeNull();
    expect(serie[1]!.pago, "nasce pendente").toBe(false);
  });

  it("editar o vencimento para colidir com uma irmã dá erro EXPLICÁVEL, não erro cru do banco", async () => {
    const origem = await prisma.conta.create({
      data: {
        tipo: "PAGAR",
        escopo: "EMPRESA",
        descricao: `${PFX}-colisao`,
        valor: 500 as never,
        vencimento: utc(2026, 6, 10),
        categoriaId,
        recorrencia: "MENSAL",
      },
    });
    await prisma.conta.update({ where: { id: origem.id }, data: { recorrenteId: origem.id } });
    await marcarPaga(origem.id, true, ctx); // gera a de 10/07

    const serie = await daSerie(origem.id);
    const sucessora = serie.find((c) => c.id !== origem.id)!;

    // Puxar a sucessora para o vencimento da origem colide dentro da série.
    await expect(
      updateConta({ id: sucessora.id, vencimento: utc(2026, 6, 10) }, ctx),
    ).rejects.toThrow(/já existe.*parcela.*vencimento/i);
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
