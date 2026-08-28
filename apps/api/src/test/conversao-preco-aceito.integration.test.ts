import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { convertLead } from "../modules/leads/leads.service.js";
import { ativarServicoCliente } from "../modules/servicos/servicos-cliente.service.js";
import { hashPassword } from "../lib/password.js";

/**
 * O DINHEIRO QUE DIVERGIA ENTRE A FICHA E O FINANCEIRO (F1, C3 e C4 da descoberta de 28/08).
 *
 * Três caminhos diferentes chegavam ao mesmo estrago: a ficha do cliente mostrando um valor e a
 * conta a receber trazendo outro, sem nada na tela explicando a diferença.
 *
 *  - **C3** — a conversão do lead provisionava pelo preço de CATÁLOGO, ignorando o preço que o
 *    cliente aceitou na proposta; e contratava TODOS os serviços que o lead pediu lá atrás, não
 *    só os que a proposta vendeu.
 *  - **C4** — contratar pela ficha combinando outro preço gerava a conta pelo preço de tabela;
 *    e serviço sem preço de tabela, contratado por um valor combinado, não gerava conta nenhuma.
 *  - **F1** — lead de Faturamento (só percentual) virava uma conta a receber AVULSA, de valor
 *    fixo, com o número derivado da ADR-125.
 *
 * Roda contra o MySQL de verdade porque o que se prova aqui é **qual número foi gravado em qual
 * linha** — tipo verde não diz nada sobre isso, e foi exatamente assim que os três passaram.
 */

const PFX = `preco-${randomBytes(4).toString("hex")}`;
let userId: string;
let stageId: string;
const criados: string[] = [];

const contasDo = (clienteId: string) =>
  prisma.conta.findMany({ where: { clienteId }, select: { descricao: true, valor: true, recorrencia: true } });

async function novoServico(nome: string, dados: { valor?: number | null; valorRecorrencia?: string; percentual?: number | null }) {
  return prisma.servico.create({
    data: {
      nome: `${PFX}-${nome}`,
      valor: dados.valor ?? null,
      valorRecorrencia: (dados.valorRecorrencia ?? "MENSAL") as never,
      percentual: dados.percentual ?? null,
    },
  });
}

async function novoLead(sufixo: string, servicoIds: string[], valorEstimado: number | null) {
  const lead = await prisma.lead.create({
    data: {
      nome: `${PFX}-${sufixo}`,
      empresa: `${PFX}-${sufixo}-clinica`,
      pipelineStageId: stageId,
      valorEstimado,
      servicos: { connect: servicoIds.map((id) => ({ id })) },
    },
  });
  criados.push(lead.id);
  return lead;
}

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
  await prisma.conta.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.activityLog.deleteMany({ where: { entidadeId: { in: [...ids, ...criados] } } });
  await prisma.clienteServico.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.documento.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.card.deleteMany({ where: { projeto: { clienteId: { in: ids } } } });
  await prisma.projeto.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.evento.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.cliente.deleteMany({ where: { id: { in: ids } } });
  await prisma.servico.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { nome: { startsWith: PFX } } });
});

describe("C3 — a conversão respeita o preço ACEITO, não o de catálogo", () => {
  it("com proposta aceita, a conta sai pelo valor aceito e só pelos serviços vendidos", async () => {
    const gestao = await novoServico("gestao", { valor: 3500, valorRecorrencia: "MENSAL" });
    const site = await novoServico("site", { valor: 12000, valorRecorrencia: "AVULSO" });
    // O lead pediu DOIS serviços; a proposta vendeu UM, e por um preço menor.
    const lead = await novoLead("aceito", [gestao.id, site.id], 15500);
    const clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-aceito-clinica` } })).id;
    await prisma.lead.update({ where: { id: lead.id }, data: { clienteId } });

    // O aceite (que roda antes da conversão) já gravou o serviço e o preço combinados.
    await prisma.clienteServico.create({
      data: { clienteId, servicoId: gestao.id, status: "ATIVO", origem: "FUNIL", valor: 2500, valorRecorrencia: "MENSAL" },
    });
    await prisma.documento.create({
      data: { clienteId, titulo: `${PFX}-proposta`, conteudo: "x", status: "ENVIADO", propostaStatus: "ACEITA" },
    });

    await convertLead(lead.id, userId);

    const servicos = await prisma.clienteServico.findMany({ where: { clienteId, status: "ATIVO" } });
    // O serviço que a proposta NÃO vendeu não entra na ficha por causa da conversão.
    expect(servicos.map((s) => s.servicoId)).toEqual([gestao.id]);

    const contas = await contasDo(clienteId);
    expect(contas).toHaveLength(1);
    expect(Number(contas[0]!.valor)).toBe(2500);
    expect(contas[0]!.recorrencia).toBe("MENSAL");
  });

  it("sem proposta aceita, nada muda: contrata o que o lead pediu, pelo preço de catálogo", async () => {
    const gestao = await novoServico("gestao2", { valor: 3500, valorRecorrencia: "MENSAL" });
    const lead = await novoLead("catalogo", [gestao.id], 3500);

    await convertLead(lead.id, userId);
    const convertido = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    const clienteId = convertido.convertidoEmClienteId!;

    const contas = await contasDo(clienteId);
    expect(contas).toHaveLength(1);
    expect(Number(contas[0]!.valor)).toBe(3500);
  });
});

describe("F1 — lead de Faturamento não vira conta fixa", () => {
  it("converter um lead só de percentual não cria conta a receber nenhuma", async () => {
    const fat = await novoServico("faturamento", { valor: null, percentual: 5 });
    // R$ 6.000 = 5% de R$ 120.000 — o número derivado da ADR-125, que virava conta avulsa.
    const lead = await novoLead("faturamento", [fat.id], 6000);

    await convertLead(lead.id, userId);
    const convertido = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    const clienteId = convertido.convertidoEmClienteId!;

    expect(await contasDo(clienteId)).toHaveLength(0);
    // Mas o serviço fica contratado, com o percentual — o cliente paga, só não por valor fixo.
    const cs = await prisma.clienteServico.findFirstOrThrow({ where: { clienteId, servicoId: fat.id } });
    expect(Number(cs.percentual)).toBe(5);
  });
});

describe("C4 — contratar pela ficha cobra o preço combinado", () => {
  it("preço combinado na ficha é o preço da conta, não o de tabela", async () => {
    const gestao = await novoServico("gestao3", { valor: 3500, valorRecorrencia: "MENSAL" });
    const clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-ficha` } })).id;

    await ativarServicoCliente(clienteId, gestao.id, { valor: 2500 }, { id: userId });

    const contas = await contasDo(clienteId);
    expect(contas).toHaveLength(1);
    expect(Number(contas[0]!.valor)).toBe(2500);
  });

  it("serviço SEM preço de tabela, contratado por um valor combinado, gera conta", async () => {
    // Antes a guarda olhava o catálogo: este caso não gerava conta nenhuma, e o dinheiro
    // simplesmente não era cobrado.
    const sob = await novoServico("sob-medida", { valor: null, valorRecorrencia: "AVULSO" });
    const clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-sobmedida` } })).id;

    await ativarServicoCliente(clienteId, sob.id, { valor: 9000 }, { id: userId });

    const contas = await contasDo(clienteId);
    expect(contas).toHaveLength(1);
    expect(Number(contas[0]!.valor)).toBe(9000);
    expect(contas[0]!.recorrencia).toBe("NENHUMA");
  });

  it("serviço só percentual não gera conta ao ser contratado pela ficha", async () => {
    const fat = await novoServico("faturamento2", { valor: null, percentual: 5 });
    const clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-pct` } })).id;

    await ativarServicoCliente(clienteId, fat.id, {}, { id: userId });

    expect(await contasDo(clienteId)).toHaveLength(0);
  });
});
