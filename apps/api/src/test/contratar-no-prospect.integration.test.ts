import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { convertLead } from "../modules/leads/leads.service.js";
import { ativarServicoCliente } from "../modules/servicos/servicos-cliente.service.js";
import { hashPassword } from "../lib/password.js";

/**
 * M1 — CONTRATAR NA FICHA DO PROSPECT E DEPOIS CONVERTER COBRAVA DUAS VEZES.
 *
 * Todo lead tem (ou ganha) um `Cliente` PROSPECT por trás (ADR-132), e a ficha desse prospect
 * já deixa contratar serviço. Quando alguém contratava ali, `ativarServicoCliente` provisionava
 * a conta a receber; a conversão do lead, logo depois, provisionava **de novo** a partir dos
 * mesmos serviços. Duas contas, o mesmo trabalho, o dobro do dinheiro na tela do Financeiro.
 *
 * ⚠️ A guarda contra cobrar duas vezes JÁ EXISTIA no repositório e é o **LEAD ATIVO** — foi ela
 * que a ADR-140 escreveu para o upsell aceito (`provisionarUpsellAceito`). Havendo lead não
 * convertido, quem cobra é a conversão; sem lead, a porta que se está usando é a única que
 * sobrou. O que faltava era a contratação pela ficha passar pela mesma régua: eram DUAS PORTAS
 * para o mesmo dinheiro e só uma delas conhecia a regra.
 *
 * Roda contra o MySQL de verdade porque o que se prova é **quantas linhas foram gravadas**.
 */

const PFX = `m1-${randomBytes(4).toString("hex")}`;
let userId: string;
let stageId: string;

const contasDo = (clienteId: string) =>
  prisma.conta.findMany({
    where: { clienteId, deletedAt: null },
    select: { descricao: true, valor: true, recorrencia: true },
  });

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "os testes devem usar o banco _test").toContain("_test");
  const u = await prisma.user.create({
    data: { nome: `${PFX}-admin`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  userId = u.id;
  stageId = (await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } })).id;
});

afterAll(async () => {
  const clientes = await prisma.cliente.findMany({ where: { nome: { startsWith: PFX } }, select: { id: true } });
  const ids = clientes.map((c) => c.id);
  const leads = await prisma.lead.findMany({ where: { nome: { startsWith: PFX } }, select: { id: true } });
  await prisma.conta.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.activityLog.deleteMany({ where: { entidadeId: { in: [...ids, ...leads.map((l) => l.id)] } } });
  await prisma.clienteServico.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.documento.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.card.deleteMany({ where: { projeto: { clienteId: { in: ids } } } });
  await prisma.projeto.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.evento.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.cliente.deleteMany({ where: { id: { in: ids } } });
  await prisma.servico.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

async function novoServico(sufixo: string, valor: number, recorrencia: "AVULSO" | "MENSAL") {
  return prisma.servico.create({
    data: { nome: `${PFX}-${sufixo}`, valor, valorRecorrencia: recorrencia as never },
  });
}

describe("M1 — contratar na ficha do prospect não cobra duas vezes", () => {
  it("contratar no prospect e converter depois deixa UMA conta, não duas", async () => {
    const gestao = await novoServico("gestao", 3500, "MENSAL");
    const clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-prospect-clinica` } })).id;
    const lead = await prisma.lead.create({
      data: {
        nome: `${PFX}-prospect`,
        pipelineStageId: stageId,
        clienteId,
        valorEstimado: 3500,
        servicos: { connect: [{ id: gestao.id }] },
      },
    });

    // 1) A equipe contrata pela ficha do prospect, antes de converter.
    await ativarServicoCliente(clienteId, gestao.id, {}, { id: userId });
    expect(
      await contasDo(clienteId),
      "com lead ativo, quem cobra é a conversão — contratar não provisiona",
    ).toHaveLength(0);

    // 2) A conversão vem logo atrás e é ela que cobra.
    await convertLead(lead.id, userId);

    const contas = await contasDo(clienteId);
    expect(contas, "uma cobrança só para um trabalho só").toHaveLength(1);
    expect(Number(contas[0]!.valor)).toBe(3500);
    expect(contas[0]!.recorrencia).toBe("MENSAL");
  });

  it("sem lead ativo, contratar pela ficha continua cobrando (a guarda não pode exagerar)", async () => {
    const gestao = await novoServico("gestao-cliente", 1200, "MENSAL");
    const clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-cliente-clinica` } })).id;

    await ativarServicoCliente(clienteId, gestao.id, {}, { id: userId });

    const contas = await contasDo(clienteId);
    expect(contas, "esta é a única porta que sobrou — se ela não cobrar, ninguém cobra").toHaveLength(1);
    expect(Number(contas[0]!.valor)).toBe(1200);
  });

  it("lead JÁ CONVERTIDO não segura mais a cobrança do upsell contratado pela ficha", async () => {
    const extra = await novoServico("upsell", 800, "AVULSO");
    const clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-convertido-clinica` } })).id;
    // Lead fechado: já virou este cliente. A conversão dele não vai cobrar nada de novo.
    await prisma.lead.create({
      data: {
        nome: `${PFX}-convertido`,
        pipelineStageId: stageId,
        clienteId,
        convertidoEmClienteId: clienteId,
      },
    });

    await ativarServicoCliente(clienteId, extra.id, {}, { id: userId });

    const contas = await contasDo(clienteId);
    expect(contas, "lead histórico não é lead ativo").toHaveLength(1);
    expect(Number(contas[0]!.valor)).toBe(800);
  });

  it("lead PERDIDO também não segura a cobrança", async () => {
    const extra = await novoServico("perdido-servico", 640, "AVULSO");
    const clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-perdido-clinica` } })).id;
    await prisma.lead.create({
      data: {
        nome: `${PFX}-perdido`,
        pipelineStageId: stageId,
        clienteId,
        perdidoEm: new Date(),
      },
    });

    await ativarServicoCliente(clienteId, extra.id, {}, { id: userId });

    expect(await contasDo(clienteId), "lead perdido nunca vai converter, logo nunca vai cobrar").toHaveLength(1);
  });
});
