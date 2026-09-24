import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "../../test/guarda-banco-de-teste.js";
import { createTarefa, updateTarefa, contarTarefas, type Ctx } from "./tarefas.service.js";

/**
 * Achado de auditoria: mudar o prazo de uma tarefa já delegada não avisava o responsável.
 * `updateTarefa` trocava `prazo` livremente e nenhuma notificação nascia — nem in-app, nem
 * e-mail. Estes testes provam o aviso `tarefa_prazo_alterado` (via `Notificacao`, que o
 * `notificar()` sempre grava, independente de preferência de e-mail).
 */
describe("updateTarefa — aviso de mudança de prazo", () => {
  const PFX = `tprazo-${randomBytes(4).toString("hex")}`;
  let criadorId: string;
  let responsavelId: string;
  let ctxCriador: Ctx;

  beforeAll(async () => {
    exigirBancoDeTeste();
    const [criador, responsavel] = await Promise.all([
      prisma.user.create({ data: { nome: `${PFX}-criador`, email: `${PFX}-criador@example.test`, role: "FUNCIONARIO" } }),
      prisma.user.create({ data: { nome: `${PFX}-resp`, email: `${PFX}-resp@example.test`, role: "FUNCIONARIO" } }),
    ]);
    criadorId = criador.id;
    responsavelId = responsavel.id;
    ctxCriador = { userId: criadorId, role: "FUNCIONARIO" };
  });

  afterAll(async () => {
    await prisma.notificacao.deleteMany({ where: { userId: { in: [criadorId, responsavelId] } } });
    await prisma.tarefaResponsavel.deleteMany({ where: { userId: { in: [criadorId, responsavelId] } } });
    await prisma.tarefa.deleteMany({ where: { criadoPorId: criadorId } });
    await prisma.user.deleteMany({ where: { id: { in: [criadorId, responsavelId] } } });
  });

  it("dispara a notificação certa quando o prazo muda", async () => {
    const prazoInicial = new Date("2026-10-01T12:00:00Z");
    const prazoNovo = new Date("2026-10-15T12:00:00Z");
    const tarefa = await createTarefa(
      {
        titulo: `${PFX} tarefa`,
        descricao: "",
        responsavelIds: [responsavelId],
        prazo: prazoInicial,
        prioridade: "NORMAL",
        clienteId: "",
        projetoId: "",
      },
      ctxCriador,
    );

    await updateTarefa({ id: tarefa.id, prazo: prazoNovo }, ctxCriador);

    const avisos = await prisma.notificacao.findMany({
      where: { userId: responsavelId, tipo: "tarefa_prazo_alterado", entidadeId: tarefa.id },
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.titulo).toContain(tarefa.titulo);
    expect(avisos[0]!.corpo).toContain("15/10/2026");
  });

  it("NÃO dispara quando outro campo muda (ex.: descrição), sem o prazo mudar", async () => {
    const prazo = new Date("2026-11-01T12:00:00Z");
    const tarefa = await createTarefa(
      {
        titulo: `${PFX} tarefa-desc`,
        descricao: "original",
        responsavelIds: [responsavelId],
        prazo,
        prioridade: "NORMAL",
        clienteId: "",
        projetoId: "",
      },
      ctxCriador,
    );

    await updateTarefa({ id: tarefa.id, descricao: "atualizada" }, ctxCriador);

    const avisos = await prisma.notificacao.findMany({
      where: { userId: responsavelId, tipo: "tarefa_prazo_alterado", entidadeId: tarefa.id },
    });
    expect(avisos).toHaveLength(0);
  });

  it("NÃO dispara quando a tarefa não tem responsável (além de quem a criou e mudou o prazo)", async () => {
    // Sem responsavelIds, normalizarResponsaveis cai no próprio criador — que é quem
    // fez a mudança, então não deve virar destinatário do próprio aviso.
    const prazoInicial = new Date("2026-10-01T12:00:00Z");
    const prazoNovo = new Date("2026-10-20T12:00:00Z");
    const tarefa = await createTarefa(
      {
        titulo: `${PFX} tarefa-sem-resp`,
        descricao: "",
        responsavelIds: [],
        prazo: prazoInicial,
        prioridade: "NORMAL",
        clienteId: "",
        projetoId: "",
      },
      ctxCriador,
    );

    await updateTarefa({ id: tarefa.id, prazo: prazoNovo }, ctxCriador);

    const avisos = await prisma.notificacao.findMany({
      where: { tipo: "tarefa_prazo_alterado", entidadeId: tarefa.id },
    });
    expect(avisos).toHaveLength(0);
  });
});

/**
 * Achado de auditoria: a aba "Da equipe" não tinha selo nenhum — `contarTarefas` só somava
 * COMIGO/DELEGUEI, e a tela não tinha como destacar "tem gente atrasada". Estes testes provam
 * o contador novo E que ele respeita a mesma régua de quem pode VER a aba (`listTarefas`).
 */
describe("contarTarefas — selo da aba \"Da equipe\"", () => {
  const PFX = `tcontar-${randomBytes(4).toString("hex")}`;
  let adminId: string;
  let funcionarioId: string;
  let outroId: string;
  let ctxAdmin: Ctx;
  let ctxFuncionario: Ctx;

  beforeAll(async () => {
    exigirBancoDeTeste();
    const [admin, func, outro] = await Promise.all([
      prisma.user.create({ data: { nome: `${PFX}-admin`, email: `${PFX}-admin@example.test`, role: "ADMIN" } }),
      prisma.user.create({ data: { nome: `${PFX}-func`, email: `${PFX}-func@example.test`, role: "FUNCIONARIO" } }),
      prisma.user.create({ data: { nome: `${PFX}-outro`, email: `${PFX}-outro@example.test`, role: "FUNCIONARIO" } }),
    ]);
    adminId = admin.id;
    funcionarioId = func.id;
    outroId = outro.id;
    ctxAdmin = { userId: adminId, role: "ADMIN" };
    ctxFuncionario = { userId: funcionarioId, role: "FUNCIONARIO" };

    // Uma tarefa aberta no prazo e outra aberta e vencida — nenhuma delas de `funcionarioId`,
    // para provar que "Da equipe" enxerga tarefa de QUALQUER pessoa.
    await createTarefa(
      { titulo: `${PFX}-no-prazo`, descricao: "", responsavelIds: [outroId], prazo: new Date(Date.now() + 86_400_000), prioridade: "NORMAL", clienteId: "", projetoId: "" },
      { userId: outroId, role: "FUNCIONARIO" },
    );
    await createTarefa(
      { titulo: `${PFX}-vencida`, descricao: "", responsavelIds: [outroId], prazo: new Date(Date.now() - 86_400_000), prioridade: "NORMAL", clienteId: "", projetoId: "" },
      { userId: outroId, role: "FUNCIONARIO" },
    );
  });

  afterAll(async () => {
    await prisma.notificacao.deleteMany({ where: { userId: { in: [adminId, funcionarioId, outroId] } } });
    await prisma.tarefaResponsavel.deleteMany({ where: { userId: { in: [adminId, funcionarioId, outroId] } } });
    await prisma.tarefa.deleteMany({ where: { criadoPorId: outroId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, funcionarioId, outroId] } } });
  });

  it("ADMIN+ vê quantas tarefas a equipe tem abertas e quantas venceram", async () => {
    const c = await contarTarefas(ctxAdmin);
    expect(c.equipe).toBeGreaterThanOrEqual(2);
    expect(c.equipeAtrasadas).toBeGreaterThanOrEqual(1);
  });

  it("funcionário não recebe a contagem da equipe — mesma régua que recusa a aba", async () => {
    const c = await contarTarefas(ctxFuncionario);
    expect(c.equipe).toBe(0);
    expect(c.equipeAtrasadas).toBe(0);
  });
});
