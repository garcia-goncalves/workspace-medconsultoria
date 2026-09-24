import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { scanProativo } from "../realtime/reminders.js";

/**
 * TAREFA (a página "Tarefas", NÃO o Card do Kanban) COM PRAZO VENCIDO PASSA A GERAR AVISO
 * SOZINHA — o `scanProativo` só varria `Card`; uma tarefa delegada que passasse do prazo só
 * aparecia para quem abrisse a página e olhasse a coluna "Prazo".
 *
 * ⚠️ Dados 100% SINTÉTICOS, com prefixo sorteado, criados e apagados por este arquivo.
 */

const PFX = `tvenc-${randomBytes(4).toString("hex")}`;
let criadorId: string;
let responsavelId: string;
let outroResponsavelId: string;

beforeAll(async () => {
  exigirBancoDeTeste();
  criadorId = (await prisma.user.create({ data: { nome: `${PFX}-criador`, email: `${PFX}-criador@teste.local`, role: "ADMIN" } })).id;
  responsavelId = (
    await prisma.user.create({ data: { nome: `${PFX}-resp`, email: `${PFX}-resp@teste.local`, role: "FUNCIONARIO" } })
  ).id;
  outroResponsavelId = (
    await prisma.user.create({ data: { nome: `${PFX}-resp2`, email: `${PFX}-resp2@teste.local`, role: "FUNCIONARIO" } })
  ).id;
});

afterAll(async () => {
  await prisma.notificacao.deleteMany({ where: { userId: { in: [criadorId, responsavelId, outroResponsavelId] } } });
  await prisma.tarefa.deleteMany({ where: { criadoPorId: criadorId } });
  await prisma.user.deleteMany({ where: { id: { in: [criadorId, responsavelId, outroResponsavelId] } } });
});

const ontem = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

describe("scanProativo avisa de tarefa individual vencida", () => {
  it("notifica o(s) responsável(is) e quem delegou, uma vez cada — e não repete na rodada seguinte", async () => {
    const tarefa = await prisma.tarefa.create({
      data: {
        titulo: `${PFX}-tarefa vencida`,
        criadoPorId: criadorId,
        prazo: ontem(),
        responsaveis: { create: [{ userId: responsavelId }, { userId: outroResponsavelId }] },
      },
    });

    await scanProativo();

    const notifs = await prisma.notificacao.findMany({
      where: { tipo: "tarefa_vencida", entidadeId: tarefa.id },
      orderBy: { userId: "asc" },
    });
    expect(notifs.map((n) => n.userId).sort()).toEqual([criadorId, responsavelId, outroResponsavelId].sort());
    for (const n of notifs) {
      expect(n.entidadeTipo).toBe("tarefa");
      expect(n.titulo).toContain(`${PFX}-tarefa vencida`);
    }

    // Rodar de novo não duplica (dedupe por `unico: true`, igual ao scan de cards).
    await scanProativo();
    const depois = await prisma.notificacao.findMany({ where: { tipo: "tarefa_vencida", entidadeId: tarefa.id } });
    expect(depois).toHaveLength(3);
  });

  it("tarefa concluída, mesmo com prazo no passado, não gera aviso", async () => {
    const tarefa = await prisma.tarefa.create({
      data: {
        titulo: `${PFX}-tarefa concluida`,
        criadoPorId: criadorId,
        prazo: ontem(),
        status: "CONCLUIDA",
        concluidaEm: new Date(),
        responsaveis: { create: [{ userId: responsavelId }] },
      },
    });

    await scanProativo();

    const notifs = await prisma.notificacao.findMany({ where: { tipo: "tarefa_vencida", entidadeId: tarefa.id } });
    expect(notifs).toHaveLength(0);
  });

  it("tarefa sem prazo, ou com prazo futuro, não gera aviso", async () => {
    const semPrazo = await prisma.tarefa.create({
      data: { titulo: `${PFX}-sem prazo`, criadoPorId: criadorId, responsaveis: { create: [{ userId: responsavelId }] } },
    });
    const futura = await prisma.tarefa.create({
      data: {
        titulo: `${PFX}-prazo futuro`,
        criadoPorId: criadorId,
        prazo: new Date(Date.now() + 24 * 60 * 60 * 1000),
        responsaveis: { create: [{ userId: responsavelId }] },
      },
    });

    await scanProativo();

    const notifs = await prisma.notificacao.findMany({
      where: { tipo: "tarefa_vencida", entidadeId: { in: [semPrazo.id, futura.id] } },
    });
    expect(notifs).toHaveLength(0);
  });

  it("tarefa vencida há 30 dias NÃO gera aviso — a 1ª varredura não despeja o passado inteiro", async () => {
    const antiga = await prisma.tarefa.create({
      data: {
        titulo: `${PFX}-vencida ha 30 dias`,
        criadoPorId: criadorId,
        prazo: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        responsaveis: { create: [{ userId: responsavelId }] },
      },
    });

    await scanProativo();

    const notifs = await prisma.notificacao.findMany({ where: { tipo: "tarefa_vencida", entidadeId: antiga.id } });
    expect(notifs).toHaveLength(0);
  });
});
