import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { buscaGlobal, abaDaTarefa, diaParaAbrirOEvento, type SearchHit } from "../modules/busca/busca.service.js";

/**
 * Busca global (Onda 4B) passou a achar tarefa, compromisso e conversa. A régua que importa:
 * ela NÃO pode mostrar o que a tela de cada um recusa — senão vira uma segunda porta para o
 * mesmo dado (ADR-140).
 */
describe("buscaGlobal — tarefa, compromisso e conversa respeitam quem busca", () => {
  const PFX = `bvis${randomBytes(4).toString("hex")}`;
  let aId: string; // funcionário que busca
  let bId: string; // outro funcionário
  let adminId: string;
  const ids: Record<string, string> = {};

  const buscar = (userId: string, role: string) => buscaGlobal(PFX, { userId, role });
  const doTipo = (hits: SearchHit[], tipo: SearchHit["tipo"]) => hits.filter((h) => h.tipo === tipo);
  const temId = (hits: SearchHit[], id: string) => hits.some((h) => h.id === id);

  beforeAll(async () => {
    exigirBancoDeTeste();
    const [a, b, adm] = await Promise.all([
      prisma.user.create({ data: { nome: `Ana ${PFX}`, email: `${PFX}-a@example.test`, role: "FUNCIONARIO" } }),
      prisma.user.create({ data: { nome: `Bruno ${PFX}`, email: `${PFX}-b@example.test`, role: "FUNCIONARIO" } }),
      prisma.user.create({ data: { nome: `Chefe ${PFX}`, email: `${PFX}-adm@example.test`, role: "ADMIN" } }),
    ]);
    aId = a.id;
    bId = b.id;
    adminId = adm.id;

    // Tarefas
    ids.tDoB = (
      await prisma.tarefa.create({
        data: { titulo: `${PFX} só do Bruno`, criadoPorId: bId, responsaveis: { create: [{ userId: bId }] } },
      })
    ).id;
    ids.tDelegada = (
      await prisma.tarefa.create({
        data: { titulo: `${PFX} Ana pediu ao Bruno`, criadoPorId: aId, responsaveis: { create: [{ userId: bId }] } },
      })
    ).id;
    ids.tApagada = (
      await prisma.tarefa.create({
        data: { titulo: `${PFX} apagada`, criadoPorId: aId, deletedAt: new Date(), responsaveis: { create: [{ userId: aId }] } },
      })
    ).id;

    // Compromissos
    const inicio = new Date("2026-10-10T13:00:00Z");
    ids.ePessoalB = (
      await prisma.evento.create({ data: { titulo: `${PFX} pessoal do Bruno`, escopo: "PESSOAL", inicio, donoId: bId } })
    ).id;
    ids.eEmpresa = (await prisma.evento.create({ data: { titulo: `${PFX} da empresa`, escopo: "EMPRESA", inicio, donoId: bId } })).id;
    ids.eConvidada = (
      await prisma.evento.create({
        data: { titulo: `${PFX} Ana convidada`, escopo: "PESSOAL", inicio, donoId: bId, participantes: { create: [{ userId: aId }] } },
      })
    ).id;

    // Conversas
    ids.cGrupoComA = (
      await prisma.conversa.create({
        data: { tipo: "GRUPO", nome: `Grupo ${PFX}`, participantes: { create: [{ userId: aId }, { userId: bId }] } },
      })
    ).id;
    ids.cGrupoSemA = (
      await prisma.conversa.create({
        data: { tipo: "GRUPO", nome: `Sigilo ${PFX}`, participantes: { create: [{ userId: bId }, { userId: adminId }] } },
      })
    ).id;
    // Direta entre Ana e Bruno: sem nome; acha-se pelo nome do Bruno (que contém o PFX).
    ids.cDireta = (
      await prisma.conversa.create({
        data: { tipo: "INDIVIDUAL", participantes: { create: [{ userId: aId }, { userId: bId }] } },
      })
    ).id;
    // Grupo com a Ana cujo NOME não casa — só o CONTEÚDO de uma mensagem casa. Não pode aparecer.
    ids.cSoConteudo = (
      await prisma.conversa.create({
        data: {
          tipo: "GRUPO",
          nome: "Assunto qualquer",
          participantes: { create: [{ userId: aId }, { userId: adminId }] },
          mensagens: { create: [{ autorId: adminId, conteudo: `texto com ${PFX} dentro` }] },
        },
      })
    ).id;
    // Grupo que a Ana apagou "só para mim".
    ids.cOculta = (
      await prisma.conversa.create({
        data: { tipo: "GRUPO", nome: `Oculta ${PFX}`, participantes: { create: [{ userId: aId, ocultoEm: new Date() }, { userId: bId }] } },
      })
    ).id;
  });

  afterAll(async () => {
    const users = [aId, bId, adminId];
    await prisma.conversa.deleteMany({
      where: { id: { in: [ids.cGrupoComA!, ids.cGrupoSemA!, ids.cDireta!, ids.cSoConteudo!, ids.cOculta!] } },
    });
    await prisma.evento.deleteMany({ where: { donoId: { in: users } } });
    await prisma.tarefa.deleteMany({ where: { criadoPorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  it("funcionário acha só as tarefas que pediu ou que são dele, com a aba certa", async () => {
    const tarefasA = doTipo(await buscar(aId, "FUNCIONARIO"), "tarefa");
    expect(temId(tarefasA, ids.tDoB!)).toBe(false);
    expect(temId(tarefasA, ids.tApagada!)).toBe(false);
    expect(tarefasA.find((h) => h.id === ids.tDelegada)?.aba).toBe("DELEGUEI");

    const tarefasB = doTipo(await buscar(bId, "FUNCIONARIO"), "tarefa");
    expect(tarefasB.find((h) => h.id === ids.tDelegada)?.aba).toBe("COMIGO");
    expect(tarefasB.find((h) => h.id === ids.tDoB)?.aba).toBe("COMIGO");
  });

  it("ADMIN acha todas as tarefas, e as dos outros caem na aba 'Da equipe'", async () => {
    const tarefas = doTipo(await buscar(adminId, "ADMIN"), "tarefa");
    expect(tarefas.find((h) => h.id === ids.tDoB)?.aba).toBe("EQUIPE");
    expect(temId(tarefas, ids.tDelegada!)).toBe(true);
  });

  it("compromisso: empresa + os de que a pessoa é dona ou convidada — nunca o pessoal de outro", async () => {
    const eventosA = doTipo(await buscar(aId, "FUNCIONARIO"), "evento");
    expect(temId(eventosA, ids.eEmpresa!)).toBe(true);
    expect(temId(eventosA, ids.eConvidada!)).toBe(true);
    expect(temId(eventosA, ids.ePessoalB!)).toBe(false);
    // Nem o ADMIN vê o pessoal de outro: a agenda não tem essa exceção, a busca também não.
    const eventosAdmin = doTipo(await buscar(adminId, "ADMIN"), "evento");
    expect(temId(eventosAdmin, ids.ePessoalB!)).toBe(false);
    expect(eventosA.find((h) => h.id === ids.eEmpresa)?.data).toBe("2026-10-10T13:00:00.000Z");
  });

  it("conversa: só as de que participa, pelo nome — nunca pelo conteúdo, nunca a que apagou para si", async () => {
    const conversasA = doTipo(await buscar(aId, "FUNCIONARIO"), "conversa");
    expect(temId(conversasA, ids.cGrupoComA!)).toBe(true);
    expect(temId(conversasA, ids.cGrupoSemA!)).toBe(false);
    expect(temId(conversasA, ids.cSoConteudo!)).toBe(false);
    expect(temId(conversasA, ids.cOculta!)).toBe(false);
    // A direta se chama pelo nome da OUTRA pessoa.
    expect(conversasA.find((h) => h.id === ids.cDireta)?.titulo).toBe(`Bruno ${PFX}`);
  });

  it("termo curto não consulta nada", async () => {
    expect(await buscaGlobal("a", { userId: aId, role: "FUNCIONARIO" })).toEqual([]);
  });
});

describe("regras puras da busca", () => {
  it("abaDaTarefa: responsável > quem pediu > equipe", () => {
    expect(abaDaTarefa({ criadoPorId: "x", responsaveis: [{ userId: "u" }] }, "u")).toBe("COMIGO");
    expect(abaDaTarefa({ criadoPorId: "u", responsaveis: [{ userId: "u" }] }, "u")).toBe("COMIGO");
    expect(abaDaTarefa({ criadoPorId: "u", responsaveis: [{ userId: "x" }] }, "u")).toBe("DELEGUEI");
    expect(abaDaTarefa({ criadoPorId: "x", responsaveis: [{ userId: "y" }] }, "u")).toBe("EQUIPE");
  });

  it("diaParaAbrirOEvento: avulso no dia dele; série viva abre hoje; série encerrada no início", () => {
    const agora = new Date("2026-09-25T12:00:00Z");
    const passado = new Date("2026-01-05T12:00:00Z");
    const futuro = new Date("2026-12-01T12:00:00Z");
    expect(diaParaAbrirOEvento({ inicio: passado, recorrencia: "NENHUMA", recorrenciaAte: null }, agora)).toBe(passado);
    expect(diaParaAbrirOEvento({ inicio: futuro, recorrencia: "SEMANAL", recorrenciaAte: null }, agora)).toBe(futuro);
    expect(diaParaAbrirOEvento({ inicio: passado, recorrencia: "SEMANAL", recorrenciaAte: null }, agora)).toBe(agora);
    expect(diaParaAbrirOEvento({ inicio: passado, recorrencia: "MENSAL", recorrenciaAte: new Date("2026-03-01") }, agora)).toBe(passado);
  });
});
