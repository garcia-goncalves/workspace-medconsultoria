import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { createTarefa, updateTarefa, setStatus, proximoPrazoDaSerie, type Ctx } from "../modules/tarefas/tarefas.service.js";

/**
 * Tarefa que se repete (Onda 4B): ao CONCLUIR, nasce a próxima ocorrência da série.
 * Contra o MySQL de verdade — a idempotência é do índice único `(recorrenteId, prazo)`, e isso
 * não se prova lendo código.
 */
const utc = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe("proximoPrazoDaSerie (pura)", () => {
  it("mensal no dia 31 vira o último dia de fevereiro e volta ao 31 em março pela âncora", () => {
    expect(iso(proximoPrazoDaSerie(utc(2026, 1, 31), "MENSAL", 31))).toBe("2026-02-28");
    expect(iso(proximoPrazoDaSerie(utc(2026, 2, 28), "MENSAL", 31))).toBe("2026-03-31");
    expect(iso(proximoPrazoDaSerie(utc(2028, 1, 31), "MENSAL", 31))).toBe("2028-02-29");
  });
  it("mantém a hora do prazo original (a API do agente pode mandar prazo com hora)", () => {
    const comHora = new Date("2026-01-31T15:30:00.000Z");
    expect(proximoPrazoDaSerie(comHora, "MENSAL", 31).toISOString()).toBe("2026-02-28T15:30:00.000Z");
    expect(proximoPrazoDaSerie(comHora, "SEMANAL", 31).toISOString()).toBe("2026-02-07T15:30:00.000Z");
  });
});

describe("tarefa recorrente — conclusão gera a próxima", () => {
  const PFX = `trec-${randomBytes(4).toString("hex")}`;
  let criadorId: string;
  let respId: string;
  let ctx: Ctx;

  const nova = (titulo: string, extra: Partial<Parameters<typeof createTarefa>[0]> = {}) =>
    createTarefa(
      {
        titulo: `${PFX} ${titulo}`,
        descricao: "detalhe",
        responsavelIds: [respId],
        prioridade: "ALTA",
        clienteId: "",
        projetoId: "",
        ...extra,
      },
      ctx,
    );
  const daSerie = (serie: string) =>
    prisma.tarefa.findMany({
      where: { OR: [{ id: serie }, { recorrenteId: serie }] },
      include: { responsaveis: true },
      orderBy: { prazo: "asc" },
    });

  beforeAll(async () => {
    exigirBancoDeTeste();
    const [c, r] = await Promise.all([
      prisma.user.create({ data: { nome: `${PFX}-criador`, email: `${PFX}-c@example.test`, role: "FUNCIONARIO" } }),
      prisma.user.create({ data: { nome: `${PFX}-resp`, email: `${PFX}-r@example.test`, role: "FUNCIONARIO" } }),
    ]);
    criadorId = c.id;
    respId = r.id;
    ctx = { userId: criadorId, role: "FUNCIONARIO" };
  });

  afterAll(async () => {
    await prisma.notificacao.deleteMany({ where: { userId: { in: [criadorId, respId] } } });
    await prisma.tarefa.deleteMany({ where: { criadoPorId: criadorId } });
    await prisma.user.deleteMany({ where: { id: { in: [criadorId, respId] } } });
  });

  it("concluir cria a próxima com o mesmo título, descrição, prioridade e responsáveis, ligada à série", async () => {
    const t = await nova("semanal", { prazo: utc(2026, 10, 5), recorrencia: "SEMANAL" });
    expect(t.recorrencia).toBe("SEMANAL");

    await setStatus(t.id, "CONCLUIDA", { userId: respId, role: "FUNCIONARIO" });
    const serie = await daSerie(t.id);
    expect(serie).toHaveLength(2);
    const prox = serie[1]!;
    expect(iso(prox.prazo)).toBe("2026-10-12");
    expect(prox.recorrenteId).toBe(t.id);
    expect(prox.status).toBe("PENDENTE");
    expect(prox.concluidaEm).toBeNull();
    expect(prox.titulo).toBe(t.titulo);
    expect(prox.descricao).toBe("detalhe");
    expect(prox.prioridade).toBe("ALTA");
    expect(prox.criadoPorId).toBe(criadorId);
    expect(prox.responsaveis.map((r) => r.userId)).toEqual([respId]);

    // A terceira continua apontando para a ORIGEM da série, não para a anterior.
    await updateTarefa({ id: prox.id, status: "CONCLUIDA" }, ctx);
    const depois = await daSerie(t.id);
    expect(depois).toHaveLength(3);
    expect(iso(depois[2]!.prazo)).toBe("2026-10-19");
    expect(depois[2]!.recorrenteId).toBe(t.id);
  });

  it("concluir duas vezes ao mesmo tempo cria UMA só próxima (índice único)", async () => {
    const t = await nova("concorrente", { prazo: utc(2026, 11, 2), recorrencia: "DIARIA" });
    await Promise.all([
      setStatus(t.id, "CONCLUIDA", ctx),
      setStatus(t.id, "CONCLUIDA", ctx),
      updateTarefa({ id: t.id, status: "CONCLUIDA" }, ctx),
    ]);
    const serie = await daSerie(t.id);
    expect(serie).toHaveLength(2);
    expect(iso(serie[1]!.prazo)).toBe("2026-11-03");
  });

  it("reabrir e concluir de novo não empilha outra ocorrência", async () => {
    const t = await nova("reabre", { prazo: utc(2026, 11, 10), recorrencia: "SEMANAL" });
    await setStatus(t.id, "CONCLUIDA", ctx);
    await setStatus(t.id, "PENDENTE", ctx);
    // Mesmo mudando o prazo antes de concluir de novo: a série já andou.
    await updateTarefa({ id: t.id, prazo: utc(2026, 11, 11) }, ctx);
    await setStatus(t.id, "CONCLUIDA", ctx);
    expect(await daSerie(t.id)).toHaveLength(2);
  });

  it("respeita o fim da série (recorrenciaAte)", async () => {
    const t = await nova("fim", { prazo: utc(2026, 12, 1), recorrencia: "SEMANAL", recorrenciaAte: utc(2026, 12, 8) });
    await setStatus(t.id, "CONCLUIDA", ctx);
    const serie = await daSerie(t.id);
    expect(serie).toHaveLength(2); // 08/12 ainda está dentro (limite inclusivo)
    await setStatus(serie[1]!.id, "CONCLUIDA", ctx);
    expect(await daSerie(t.id)).toHaveLength(2); // 15/12 passaria do fim: nada novo
  });

  it("mensal no dia 31: 31/01 → 28/02 → 31/03", async () => {
    const t = await nova("mensal31", { prazo: utc(2027, 1, 31), recorrencia: "MENSAL" });
    await setStatus(t.id, "CONCLUIDA", ctx);
    let serie = await daSerie(t.id);
    expect(iso(serie[1]!.prazo)).toBe("2027-02-28");
    await setStatus(serie[1]!.id, "CONCLUIDA", ctx);
    serie = await daSerie(t.id);
    expect(iso(serie[2]!.prazo)).toBe("2027-03-31");
  });

  it("tarefa avulsa concluída não gera nada", async () => {
    const t = await nova("avulsa", { prazo: utc(2026, 10, 1) });
    await setStatus(t.id, "CONCLUIDA", ctx);
    expect(await prisma.tarefa.count({ where: { recorrenteId: t.id } })).toBe(0);
  });

  it("recorrência exige prazo — na criação e ao tirar o prazo de uma que já se repete", async () => {
    await expect(nova("sem prazo", { recorrencia: "DIARIA" })).rejects.toThrow(/prazo/);
    const t = await nova("tira prazo", { prazo: utc(2026, 10, 20), recorrencia: "MENSAL" });
    await expect(updateTarefa({ id: t.id, prazo: undefined, recorrencia: "MENSAL" }, ctx)).resolves.toBeTruthy();
    await expect(updateTarefa({ id: t.id, prazo: null as unknown as undefined }, ctx)).rejects.toThrow(/prazo/);
    // Desligar a repetição apaga a data de fim junto.
    const semRepetir = await updateTarefa({ id: t.id, recorrencia: "NENHUMA" }, ctx);
    expect(semRepetir.recorrencia).toBe("NENHUMA");
    expect(semRepetir.recorrenciaAte).toBeNull();
  });
});
