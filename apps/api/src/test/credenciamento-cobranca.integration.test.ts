import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { hashConteudo } from "../lib/hash.js";
import { mudarStatusCredenciamento } from "../modules/servicos/credenciamento-grade.service.js";
import { NOME_SERVICO_CREDENCIAMENTO } from "../modules/servicos/credenciamento.service.js";
import { ativarServicoCliente } from "../modules/servicos/servicos-cliente.service.js";
import { responder } from "../modules/propostas/propostas.service.js";
import { hashPassword } from "../lib/password.js";

/**
 * A ÚNICA mudança de comportamento em dinheiro do credenciamento (spec §3.3 e §6.3):
 * **o honorário é no sucesso**. A conta a receber nasce quando a OPERADORA APROVA — não
 * quando o cliente aceita a proposta, não quando o serviço é contratado na ficha, não na
 * conversão do lead.
 *
 * O teste existe porque as três portas erradas já estavam abertas: contratar um serviço com
 * valor de referência provisionava cobrança, e a conversão do lead somava os serviços
 * contratados numa conta única. Nenhuma delas sabia que este serviço se cobra diferente.
 */

const PFX = `cred-${randomBytes(4).toString("hex")}`;
let ator: { id: string };
let clienteId: string;
let profissionalId: string;
let operadoraId: string;
let servicoCredId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  ator = { id: u.id };

  const cliente = await prisma.cliente.create({ data: { nome: `${PFX}-clinica`, tipo: "PJ" } });
  clienteId = cliente.id;

  const prof = await prisma.profissional.create({
    data: { clienteId, nome: `${PFX}-medico`, conselho: "CRM", especialidade: "cardiologista", anoFormatura: 2010 },
  });
  profissionalId = prof.id;

  const op = await prisma.operadora.create({ data: { nome: `${PFX}-operadora`, ordem: 999 } });
  operadoraId = op.id;

  // O serviço de credenciamento COM valor de referência — é justamente o valor que fazia a
  // contratação provisionar cobrança antes da hora.
  const existente = await prisma.servico.findFirst({
    where: { nome: NOME_SERVICO_CREDENCIAMENTO },
    select: { id: true },
  });
  const servico = existente
    ? await prisma.servico.update({ where: { id: existente.id }, data: { valor: 2000 }, select: { id: true } })
    : await prisma.servico.create({
        data: { nome: NOME_SERVICO_CREDENCIAMENTO, valor: 2000, valorRecorrencia: "AVULSO" },
        select: { id: true },
      });
  servicoCredId = servico.id;
});

afterAll(async () => {
  await prisma.credenciamento.deleteMany({ where: { clienteId } });
  await prisma.conta.deleteMany({ where: { clienteId } });
  await prisma.documento.deleteMany({ where: { clienteId } });
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.projeto.deleteMany({ where: { clienteId } });
  await prisma.profissional.deleteMany({ where: { clienteId } });
  await prisma.operadora.deleteMany({ where: { id: operadoraId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

const contasDoCliente = () => prisma.conta.findMany({ where: { clienteId, deletedAt: null } });

async function novaCelula(tentativa: number, valor = 1500) {
  return prisma.credenciamento.create({
    data: { clienteId, profissionalId, operadoraId, valor, tentativa },
  });
}

describe("a cobrança do credenciamento nasce na APROVAÇÃO", () => {
  it("contratar o serviço de credenciamento na ficha NÃO cria conta a receber", async () => {
    await ativarServicoCliente(clienteId, servicoCredId, { origem: "MANUAL" }, ator);
    const contas = await contasDoCliente();
    expect(contas, "o honorário é no sucesso — contratar não cobra").toHaveLength(0);
  });

  it("o cliente ACEITAR a proposta de credenciamento NÃO cria conta a receber", async () => {
    const conteudo = `${PFX} proposta de credenciamento`;
    const doc = await prisma.documento.create({
      data: {
        clienteId,
        titulo: `${PFX}-proposta`,
        conteudo,
        criadoPorId: ator.id,
        propostaToken: `${PFX}-token`,
        propostaStatus: "PENDENTE",
        propostaHash: hashConteudo(conteudo),
      },
    });

    const r = await responder({ token: `${PFX}-token`, decisao: "ACEITA" }, "127.0.0.1");
    expect(r.decisao).toBe("ACEITA");
    // As automações do aceite rodam soltas (void) — dá tempo delas terminarem antes de conferir.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const contas = await contasDoCliente();
    expect(contas, "aceite não é sucesso: a operadora ainda não disse nada").toHaveLength(0);
    expect((await prisma.documento.findUnique({ where: { id: doc.id } }))?.propostaStatus).toBe("ACEITA");
  });

  it("APROVADO cria a conta a receber no valor da célula, e prende as duas", async () => {
    const celula = await novaCelula(1, 1500);
    await mudarStatusCredenciamento({ id: celula.id, status: "PROTOCOLADO" }, ator);
    const aprovada = await mudarStatusCredenciamento({ id: celula.id, status: "APROVADO" }, ator);

    const contas = await contasDoCliente();
    expect(contas).toHaveLength(1);
    expect(Number(contas[0]!.valor)).toBe(1500);
    expect(contas[0]!.tipo).toBe("RECEBER");
    expect(contas[0]!.pago).toBe(false);
    expect(aprovada.contaId, "a célula guarda qual conta é dela").toBe(contas[0]!.id);
  });

  it("aprovar duas vezes NÃO cobra duas vezes", async () => {
    const antes = await contasDoCliente();
    const celula = await prisma.credenciamento.findFirst({ where: { clienteId, status: "APROVADO" } });
    // A transição já não é permitida (APROVADO só vai para ENCERRADO); o que este teste
    // garante é que nem por outro caminho o cliente é cobrado de novo pelo mesmo sucesso.
    await expect(mudarStatusCredenciamento({ id: celula!.id, status: "APROVADO" }, ator)).rejects.toThrow();
    expect(await contasDoCliente()).toHaveLength(antes.length);
  });

  it("NEGADO não cria conta nenhuma", async () => {
    const antes = (await contasDoCliente()).length;
    const outraOp = await prisma.operadora.create({ data: { nome: `${PFX}-op2`, ordem: 998 } });
    const celula = await prisma.credenciamento.create({
      data: { clienteId, profissionalId, operadoraId: outraOp.id, valor: 900 },
    });
    // Negativa só existe depois de protocolar — não se é recusado num pedido que não foi feito.
    await mudarStatusCredenciamento({ id: celula.id, status: "PROTOCOLADO" }, ator);
    await mudarStatusCredenciamento(
      { id: celula.id, status: "NEGADO", motivoNegativa: "Rede fechada para a especialidade." },
      ator,
    );
    expect(await contasDoCliente()).toHaveLength(antes);

    await prisma.credenciamento.deleteMany({ where: { id: celula.id } });
    await prisma.operadora.deleteMany({ where: { id: outraOp.id } });
  });
});
