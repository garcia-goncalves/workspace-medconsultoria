import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { historicoNotificacoes, listNotificacoes } from "../modules/notificacoes/notificacoes.service.js";

/** Histórico do sininho (Onda 4B): "ver mais antigos" por chave (createdAt, id) e filtro "não lidas". */
describe("historicoNotificacoes", () => {
  const PFX = `nhist-${randomBytes(4).toString("hex")}`;
  let euId: string;
  let outroId: string;

  beforeAll(async () => {
    exigirBancoDeTeste();
    const [eu, outro] = await Promise.all([
      prisma.user.create({ data: { nome: `${PFX}-eu`, email: `${PFX}-eu@example.test`, role: "FUNCIONARIO" } }),
      prisma.user.create({ data: { nome: `${PFX}-outro`, email: `${PFX}-o@example.test`, role: "FUNCIONARIO" } }),
    ]);
    euId = eu.id;
    outroId = outro.id;
    const base = Date.UTC(2026, 8, 1, 12, 0, 0);
    // 7 avisos meus, um por minuto; os dois últimos no MESMO milissegundo (o id desempata).
    const quando = [0, 1, 2, 3, 4, 5, 5].map((m) => new Date(base + m * 60_000));
    for (let i = 0; i < quando.length; i++) {
      await prisma.notificacao.create({
        data: { userId: euId, tipo: "lembrete", titulo: `${PFX} n${i}`, lida: i % 2 === 0, createdAt: quando[i]! },
      });
    }
    await prisma.notificacao.create({ data: { userId: outroId, tipo: "lembrete", titulo: `${PFX} alheia`, createdAt: quando[3]! } });
  });

  afterAll(async () => {
    await prisma.notificacao.deleteMany({ where: { userId: { in: [euId, outroId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [euId, outroId] } } });
  });

  it("percorre tudo, página a página, sem repetir nem pular — nem no empate de milissegundo", async () => {
    const vistos: string[] = [];
    let antesDe: { createdAt: Date; id: string } | undefined;
    for (let guarda = 0; guarda < 10; guarda++) {
      const pagina = await historicoNotificacoes(euId, { antesDe, limite: 2 });
      if (pagina.length === 0) break;
      vistos.push(...pagina.map((n) => n.id));
      const ultima = pagina[pagina.length - 1]!;
      antesDe = { createdAt: ultima.createdAt, id: ultima.id };
    }
    expect(vistos).toHaveLength(7);
    expect(new Set(vistos).size).toBe(7);
    // Mais novo primeiro.
    const todas = await prisma.notificacao.findMany({ where: { userId: euId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect(vistos).toEqual(todas.map((n) => n.id));
  });

  it("filtro 'não lidas' só traz as não lidas", async () => {
    const naoLidas = await historicoNotificacoes(euId, { apenasNaoLidas: true });
    expect(naoLidas).toHaveLength(3);
    expect(naoLidas.every((n) => !n.lida)).toBe(true);
  });

  it("nunca traz aviso de outra pessoa", async () => {
    const minhas = await historicoNotificacoes(euId, {});
    expect(minhas.some((n) => n.userId !== euId)).toBe(false);
  });

  it("o que o sino mostra por padrão não mudou (as 30 últimas, lidas e não lidas)", async () => {
    const padrao = await listNotificacoes(euId);
    expect(padrao).toHaveLength(7);
    expect(padrao.some((n) => n.lida)).toBe(true);
  });
});
