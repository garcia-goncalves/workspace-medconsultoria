import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { appRouter } from "../trpc/router.js";
import { agregarEntregas, limitesDoPeriodo, relatorioEntregas } from "../modules/tarefas/relatorio-entregas.service.js";

/** Relatório de entregas da equipe (Onda 4B, ADMIN+). */
const utc = (a: number, m: number, d: number, h = 0, min = 0) => new Date(Date.UTC(a, m - 1, d, h, min));

describe("agregarEntregas (pura)", () => {
  const pessoas = [
    { id: "b", nome: "Bruno" },
    { id: "a", nome: "Ana" },
  ];

  it("conta no prazo × atrasada × sem prazo por DIA de Brasília, e a tarefa da equipe conta para cada responsável", () => {
    const prazo = utc(2026, 9, 10); // date-only: dia 10/09
    const linhas = agregarEntregas({
      pessoas,
      concluidas: [
        // 10/09 às 23:30 de Brasília (= 11/09 02:30 UTC): ainda é o dia do prazo → no prazo.
        { responsavelIds: ["a"], prazo, concluidaEm: utc(2026, 9, 11, 2, 30) },
        // 11/09 às 00:30 de Brasília → atrasada.
        { responsavelIds: ["a"], prazo, concluidaEm: utc(2026, 9, 11, 3, 30) },
        { responsavelIds: ["a", "b", "a"], prazo: null, concluidaEm: utc(2026, 9, 5) },
        { responsavelIds: ["fora-da-equipe"], prazo: null, concluidaEm: utc(2026, 9, 5) },
      ],
      abertasAtrasadas: [{ responsavelIds: ["b"] }, { responsavelIds: ["a", "b"] }],
      cartoes: [{ responsavelId: "b" }, { responsavelId: null }],
    });
    expect(linhas.map((l) => l.nome)).toEqual(["Ana", "Bruno"]);
    const [ana, bruno] = linhas;
    expect(ana).toMatchObject({ concluidas: 3, noPrazo: 1, atrasadas: 1, semPrazo: 1, abertasAtrasadasHoje: 1, cartoesConcluidos: 0 });
    expect(bruno).toMatchObject({ concluidas: 1, noPrazo: 0, atrasadas: 0, semPrazo: 1, abertasAtrasadasHoje: 2, cartoesConcluidos: 1 });
  });

  it("período em dias de Brasília: de 00:00 BRT a 00:00 BRT do dia seguinte ao fim", () => {
    const { inicio, fim } = limitesDoPeriodo({ de: utc(2026, 9, 1), ate: utc(2026, 9, 30) });
    expect(inicio.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});

describe("relatorioEntregas — contra o banco e pela porta", () => {
  const PFX = `rent-${randomBytes(4).toString("hex")}`;
  let funcId: string;
  let adminId: string;
  let projetoId: string;
  let clienteId: string;
  const periodo = { de: utc(2031, 3, 1), ate: utc(2031, 3, 31) };

  beforeAll(async () => {
    exigirBancoDeTeste();
    const [f, a] = await Promise.all([
      prisma.user.create({ data: { nome: `${PFX}-func`, email: `${PFX}-f@example.test`, role: "FUNCIONARIO", ativo: true } }),
      prisma.user.create({ data: { nome: `${PFX}-admin`, email: `${PFX}-a@example.test`, role: "ADMIN", ativo: true } }),
    ]);
    funcId = f.id;
    adminId = a.id;
    const resp = { responsaveis: { create: [{ userId: funcId }] } };
    // No período: uma no prazo, uma atrasada. Fora do período: uma. Apagada: não conta.
    await prisma.tarefa.create({
      data: {
        titulo: `${PFX} ok`,
        criadoPorId: adminId,
        status: "CONCLUIDA",
        prazo: utc(2031, 3, 10),
        concluidaEm: utc(2031, 3, 9, 15),
        ...resp,
      },
    });
    await prisma.tarefa.create({
      data: {
        titulo: `${PFX} late`,
        criadoPorId: adminId,
        status: "CONCLUIDA",
        prazo: utc(2031, 3, 10),
        concluidaEm: utc(2031, 3, 20, 15),
        ...resp,
      },
    });
    await prisma.tarefa.create({
      data: { titulo: `${PFX} fora`, criadoPorId: adminId, status: "CONCLUIDA", concluidaEm: utc(2031, 5, 2, 15), ...resp },
    });
    await prisma.tarefa.create({
      data: {
        titulo: `${PFX} apagada`,
        criadoPorId: adminId,
        status: "CONCLUIDA",
        concluidaEm: utc(2031, 3, 5, 15),
        deletedAt: new Date(),
        ...resp,
      },
    });
    // Aberta com prazo vencido (conta hoje, independente do período).
    await prisma.tarefa.create({ data: { titulo: `${PFX} aberta`, criadoPorId: adminId, prazo: utc(2020, 1, 1), ...resp } });

    clienteId = (await prisma.cliente.create({ data: { nome: `${PFX} clinica` } })).id;
    projetoId = (await prisma.projeto.create({ data: { nome: `${PFX} proj`, clienteId } })).id;
    // Cartão concluído com a última alteração no período (updatedAt é @updatedAt: forçado por SQL).
    const card = await prisma.card.create({ data: { projetoId, titulo: `${PFX} card`, status: "CONCLUIDO", responsavelId: funcId } });
    await prisma.$executeRaw`UPDATE Card SET updatedAt = ${utc(2031, 3, 15, 12)} WHERE id = ${card.id}`;
  });

  afterAll(async () => {
    await prisma.card.deleteMany({ where: { projetoId } });
    await prisma.projeto.deleteMany({ where: { id: projetoId } });
    await prisma.cliente.deleteMany({ where: { id: clienteId } });
    await prisma.tarefa.deleteMany({ where: { criadoPorId: adminId } });
    await prisma.user.deleteMany({ where: { id: { in: [funcId, adminId] } } });
  });

  it("agrega a pessoa certa no período", async () => {
    const linhas = await relatorioEntregas(periodo);
    const f = linhas.find((l) => l.userId === funcId);
    expect(f).toMatchObject({ concluidas: 2, noPrazo: 1, atrasadas: 1, semPrazo: 0, cartoesConcluidos: 1 });
    expect(f!.abertasAtrasadasHoje).toBeGreaterThanOrEqual(1);
    // Admin ativo sem entrega aparece com zeros (ver quem não entregou é o ponto do relatório).
    expect(linhas.find((l) => l.userId === adminId)).toMatchObject({ concluidas: 0, cartoesConcluidos: 0 });
  });

  it("é só para ADMIN+: funcionário é recusado na porta", async () => {
    const sessao = (id: string, role: string) => ({ id, nome: "x", email: `${id}@example.test`, role });
    const caller = (u: ReturnType<typeof sessao>) =>
      appRouter.createCaller({ user: u, req: { ip: "1.2.3.4", headers: {} }, res: {} } as never);
    await expect(caller(sessao(funcId, "FUNCIONARIO")).tarefas.relatorioEntregas(periodo)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(sessao(adminId, "ADMIN")).tarefas.relatorioEntregas(periodo)).resolves.toBeInstanceOf(Array);
  });

  it("recusa período invertido", async () => {
    const sessao = { id: adminId, nome: "x", email: "x@example.test", role: "ADMIN" };
    const caller = appRouter.createCaller({ user: sessao, req: { ip: "1.2.3.4", headers: {} }, res: {} } as never);
    await expect(caller.tarefas.relatorioEntregas({ de: utc(2031, 3, 31), ate: utc(2031, 3, 1) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
