import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { APROVACAO_CREDENCIAMENTO_SO_ADMIN } from "@app/shared";
import { mudarStatusCredenciamento, salvarGrade } from "../modules/servicos/credenciamento-grade.service.js";
import { hashPassword } from "../lib/password.js";

/**
 * ONDA 1, ITEM A — APROVAR CREDENCIAMENTO PASSA A SER SÓ DE ADMIN+.
 *
 * Aprovar é o que lança a cobrança (§3.3/§6.3): a conta a receber do honorário nasce na
 * transição para `APROVADO`, e a mesma cobrança pode nascer por uma SEGUNDA porta — o acerto
 * do valor "a combinar" de um cruzamento já aprovado, em `salvarGrade` (M15). Decisão do dono:
 * as duas portas exigem ADMIN+. `FUNCIONARIO` continua podendo protocolar, pedir análise, negar
 * (com motivo) e abrir nova tentativa — só o gesto que cria dinheiro fica reservado.
 */

// ⚠️ Prefixo e sufixos CURTOS de propósito: `credenciamento_negado` interpola operadora,
// profissional, cliente e motivo dentro de um `corpo` VARCHAR(191) — nomes de teste compridos
// (visto acontecendo com um prefixo maior) estouram a coluna e o Prisma recusa a notificação.
const PFX = `sa-${randomBytes(4).toString("hex")}`;
let funcionario: { id: string; role: "FUNCIONARIO" };
let admin: { id: string; role: "ADMIN" };
let clienteId: string;
let profissionalId: string;
let operadoraId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const [uf, ua] = await Promise.all([
    prisma.user.create({
      data: { nome: `${PFX}-func`, email: `${PFX}-func@example.test`, passwordHash: await hashPassword("x"), role: "FUNCIONARIO" },
    }),
    prisma.user.create({
      data: { nome: `${PFX}-admin`, email: `${PFX}-admin@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
    }),
  ]);
  funcionario = { id: uf.id, role: "FUNCIONARIO" };
  admin = { id: ua.id, role: "ADMIN" };

  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-cli` } })).id;
  profissionalId = (
    await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-med`, conselho: "CRM", especialidade: "ortopedista", anoFormatura: 2012 },
    })
  ).id;
  operadoraId = (await prisma.operadora.create({ data: { nome: `${PFX}-op`, ordem: 996 } })).id;
});

afterAll(async () => {
  await prisma.credenciamento.deleteMany({ where: { clienteId } });
  await prisma.conta.deleteMany({ where: { clienteId } });
  await prisma.profissional.deleteMany({ where: { clienteId } });
  await prisma.operadora.deleteMany({ where: { id: operadoraId } });
  await prisma.activityLog.deleteMany({ where: { entidadeId: clienteId } });
  await prisma.notificacao.deleteMany({ where: { entidadeId: clienteId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

const contasDoCliente = () => prisma.conta.findMany({ where: { clienteId, deletedAt: null } });

async function novaCelula(tentativa: number, valor: number) {
  return prisma.credenciamento.create({ data: { clienteId, profissionalId, operadoraId, valor, tentativa } });
}

describe("aprovar credenciamento exige ADMIN+", () => {
  it("funcionário protocola e pede análise normalmente", async () => {
    const celula = await novaCelula(1, 2500);
    await mudarStatusCredenciamento({ id: celula.id, status: "PROTOCOLADO" }, funcionario);
    const emAnalise = await mudarStatusCredenciamento({ id: celula.id, status: "EM_ANALISE" }, funcionario);
    expect(emAnalise.status).toBe("EM_ANALISE");
  });

  it("funcionário NÃO aprova — FORBIDDEN, com a mensagem certa, e nada muda", async () => {
    const celula = await prisma.credenciamento.findFirstOrThrow({ where: { clienteId, tentativa: 1 } });

    await expect(mudarStatusCredenciamento({ id: celula.id, status: "APROVADO" }, funcionario)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: APROVACAO_CREDENCIAMENTO_SO_ADMIN,
    });

    const depois = await prisma.credenciamento.findUniqueOrThrow({ where: { id: celula.id } });
    expect(depois.status, "a recusa não muda o status").toBe("EM_ANALISE");
    expect(depois.contaId, "e não cria conta nenhuma").toBeNull();
    expect(await contasDoCliente()).toHaveLength(0);
  });

  it("funcionário ainda nega, com motivo", async () => {
    const celula = await prisma.credenciamento.findFirstOrThrow({ where: { clienteId, tentativa: 1 } });
    const negada = await mudarStatusCredenciamento(
      { id: celula.id, status: "NEGADO", motivoNegativa: "rede fechada para a especialidade" },
      funcionario,
    );
    expect(negada.status).toBe("NEGADO");
    expect(negada.motivoNegativa).toBe("rede fechada para a especialidade");
  });

  it("admin aprova — cria exatamente 1 conta a receber", async () => {
    const celula = await novaCelula(2, 3000);
    await mudarStatusCredenciamento({ id: celula.id, status: "PROTOCOLADO" }, admin);
    const aprovada = await mudarStatusCredenciamento({ id: celula.id, status: "APROVADO" }, admin);

    expect(aprovada.status).toBe("APROVADO");
    expect(aprovada.contaId).not.toBeNull();
    const contas = await contasDoCliente();
    expect(contas).toHaveLength(1);
    expect(Number(contas[0]!.valor)).toBe(3000);
  });

  it("funcionário NÃO acerta o honorário 'a combinar' de um já aprovado — FORBIDDEN, sem conta", async () => {
    // Cruzamento aprovado com honorário zerado (M15): a segunda porta que lança a mesma
    // cobrança é `salvarGrade`, quando o valor novo passa a ser > 0 para um par já APROVADO
    // sem `contaId`. Essa porta exige ADMIN+ tanto quanto a primeira.
    const celula = await novaCelula(3, 0);
    await mudarStatusCredenciamento({ id: celula.id, status: "PROTOCOLADO" }, admin);
    const aprovadaZerada = await mudarStatusCredenciamento({ id: celula.id, status: "APROVADO" }, admin);
    expect(aprovadaZerada.contaId, "aprovado com honorário a combinar não cria conta").toBeNull();

    // O teste anterior ("admin aprova") já deixou 1 conta para este cliente — a régua aqui é
    // "não nasce uma SEGUNDA", não "zero contas no total".
    const totalAntes = (await contasDoCliente()).length;

    await expect(
      salvarGrade({ clienteId, celulas: [{ profissionalId, operadoraId: aprovadaZerada.operadoraId, valor: 1200 }] }, funcionario),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: APROVACAO_CREDENCIAMENTO_SO_ADMIN });

    const depois = await prisma.credenciamento.findUniqueOrThrow({ where: { id: celula.id } });
    expect(Number(depois.valor), "a tentativa recusada não altera o valor").toBe(0);
    expect(depois.contaId).toBeNull();
    expect(await contasDoCliente()).toHaveLength(totalAntes);
  });
});
