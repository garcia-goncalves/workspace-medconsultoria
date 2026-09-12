import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { marcarPaga, removeConta, garantirProximasRecorrencias } from "../modules/financeiro/contas.service";
import { hashPassword } from "../lib/password";

/**
 * C10 — EXCLUIR UMA PARCELA DE UMA SÉRIE E A VARREDURA A RESSUSCITAVA.
 *
 * A exclusão de conta é lógica (`deletedAt`), e a materialização da recorrência tinha uma regra
 * que dizia: "achou uma ocorrência apagada nesta data? traga de volta". A regra nasceu para o
 * ciclo marcar → desmarcar → marcar (a reversão apagava a sucessora e remarcar precisava da
 * MESMA linha, por causa do índice único `(recorrenteId, vencimento)`).
 *
 * ⚠️ **O problema é que `deletedAt` tinha DOIS significados** — "o sistema desfez" e "a pessoa
 * excluiu" — e a ressurreição não sabia distinguir. Excluir a parcela de maio fazia a varredura
 * recriá-la na madrugada seguinte, sem aviso nenhum.
 *
 * A correção dá **um significado só** a `deletedAt` numa série: exclusão feita por gente. A
 * reversão do pagamento passou a apagar a sucessora de verdade (é uma linha que o sistema tinha
 * acabado de criar, nunca paga e que ninguém referencia — desfazer é apagar). E a geração passou
 * a **respeitar a exceção**: não ressuscita a data excluída e segue para a ocorrência seguinte —
 * excluir uma parcela pula aquele mês, não mata a série.
 */

const PFX = `exc-${randomBytes(4).toString("hex")}`;
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
  categoriaId = (await prisma.categoria.create({ data: { nome: `${PFX}-cat`, tipo: "DESPESA" } })).id;
});

afterAll(async () => {
  await prisma.conta.deleteMany({ where: { descricao: { startsWith: PFX } } });
  await prisma.categoria.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

/** Todas as ocorrências da série, inclusive as apagadas. */
const daSerie = (origemId: string) =>
  prisma.conta.findMany({
    where: { OR: [{ id: origemId }, { recorrenteId: origemId }] },
    orderBy: { vencimento: "asc" },
    select: { id: true, vencimento: true, deletedAt: true, pago: true },
  });

async function novaSerie(sufixo: string, vencimento: Date) {
  const conta = await prisma.conta.create({
    data: {
      tipo: "PAGAR",
      escopo: "EMPRESA",
      descricao: `${PFX}-${sufixo}`,
      valor: 900 as never,
      vencimento,
      categoriaId,
      recorrencia: "MENSAL",
    },
  });
  await prisma.conta.update({ where: { id: conta.id }, data: { recorrenteId: conta.id } });
  return conta;
}

describe("C10 — parcela excluída à mão é uma exceção da série", () => {
  it("a varredura NÃO ressuscita a parcela que a pessoa excluiu", async () => {
    const origem = await novaSerie("aluguel", utc(2026, 3, 10));

    // Março quitado → nasce a parcela de abril.
    await marcarPaga(origem.id, true, ctx);
    let serie = await daSerie(origem.id);
    expect(serie).toHaveLength(2);
    const abril = serie[1]!;
    expect(iso(abril.vencimento)).toBe("2026-04-10");

    // A pessoa exclui abril na tela do Financeiro (não vai haver cobrança neste mês).
    await removeConta(abril.id, ctx);

    // A rede de segurança do scan roda (é ela que rodava de madrugada e desfazia a exclusão).
    await garantirProximasRecorrencias();

    serie = await daSerie(origem.id);
    const abrilDepois = serie.find((c) => c.id === abril.id)!;
    expect(abrilDepois.deletedAt, "abril foi excluído à mão e tem de continuar excluído").not.toBeNull();

    // E a série não morre: a ocorrência seguinte (maio) é a que passa a existir.
    const vivas = serie.filter((c) => c.deletedAt === null).map((c) => iso(c.vencimento));
    expect(vivas, "excluir uma parcela pula aquele mês, não mata a série").toEqual(["2026-03-10", "2026-05-10"]);
  });

  it("marcar de novo depois de excluir a parcela também não a traz de volta", async () => {
    const origem = await novaSerie("internet", utc(2026, 7, 5));

    await marcarPaga(origem.id, true, ctx); // gera 05/08
    let serie = await daSerie(origem.id);
    const agosto = serie.find((c) => c.id !== origem.id)!;
    expect(iso(agosto.vencimento)).toBe("2026-08-05");

    await removeConta(agosto.id, ctx); // a pessoa exclui agosto
    await marcarPaga(origem.id, false, ctx); // e depois desmarca julho
    await marcarPaga(origem.id, true, ctx); // e remarca

    serie = await daSerie(origem.id);
    expect(serie.find((c) => c.id === agosto.id)!.deletedAt, "a exclusão da pessoa é definitiva").not.toBeNull();
    const vivas = serie.filter((c) => c.deletedAt === null).map((c) => iso(c.vencimento));
    expect(vivas).toEqual(["2026-07-05", "2026-09-05"]);
  });

  it("o ciclo marcar → desmarcar → marcar continua sem duplicar a data", async () => {
    const origem = await novaSerie("energia", utc(2026, 1, 31));

    await marcarPaga(origem.id, true, ctx);
    let serie = await daSerie(origem.id);
    expect(serie.filter((c) => c.deletedAt === null)).toHaveLength(2);
    expect(iso(serie[1]!.vencimento), "31/01 clampado para 28/02").toBe("2026-02-28");

    await marcarPaga(origem.id, false, ctx);
    serie = await daSerie(origem.id);
    expect(serie.filter((c) => c.deletedAt === null), "desmarcar desfaz a sucessora").toHaveLength(1);

    await marcarPaga(origem.id, true, ctx);
    serie = await daSerie(origem.id);
    const vivas = serie.filter((c) => c.deletedAt === null);
    expect(vivas, "uma linha por data, nunca duas").toHaveLength(2);
    expect(iso(vivas[1]!.vencimento)).toBe("2026-02-28");
    expect(vivas[1]!.pago, "a sucessora volta pendente").toBe(false);
  });

  it("a série para quando todas as datas até o limite foram excluídas", async () => {
    const origem = await novaSerie("consultoria", utc(2026, 2, 15));
    await prisma.conta.update({ where: { id: origem.id }, data: { recorrenciaAte: utc(2026, 3, 20) } });

    const atualizada = await prisma.conta.findUniqueOrThrow({ where: { id: origem.id } });
    await marcarPaga(atualizada.id, true, ctx); // gera 15/03, dentro do limite
    let serie = await daSerie(origem.id);
    const marco = serie.find((c) => c.id !== origem.id)!;

    await removeConta(marco.id, ctx); // excluída: a próxima (15/04) já passa do limite
    await garantirProximasRecorrencias();

    serie = await daSerie(origem.id);
    expect(serie.filter((c) => c.deletedAt === null).map((c) => iso(c.vencimento))).toEqual(["2026-02-15"]);
  });
});
