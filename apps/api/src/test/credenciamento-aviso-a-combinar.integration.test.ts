import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { mudarStatusCredenciamento } from "../modules/servicos/credenciamento-grade.service.js";
import { hashPassword } from "../lib/password.js";

/**
 * ONDA 1, ITEM B — O LEMBRETE DO HONORÁRIO "A COMBINAR" APROVADO.
 *
 * Aprovar com honorário zerado (M15) não cria conta e só grava um aviso nas observações do
 * cruzamento — visível apenas a quem abre AQUELA ficha por acaso. Além disso, quem cuida do
 * cliente (ADMIN/ROOT + o responsável) recebe a notificação `credenciamento_a_combinar` pelo
 * mesmo caminho de qualquer outro fato do cliente (`notificar`, best-effort).
 */

// ⚠️ Nomes CURTOS de propósito — ver a nota em `credenciamento-aprovacao-so-admin.integration.test.ts`
// sobre o `corpo` VARCHAR(191) dos templates de e-mail.
const PFX = `avac-${randomBytes(4).toString("hex")}`;
let admin: { id: string; role: "ADMIN" };
let clienteId: string;
let profissionalId: string;
let operadoraId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const u = await prisma.user.create({
    data: { nome: `${PFX}-adm`, email: `${PFX}-adm@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  admin = { id: u.id, role: "ADMIN" };

  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-cli` } })).id;
  profissionalId = (
    await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-med`, conselho: "CRM", especialidade: "ortopedista", anoFormatura: 2012 },
    })
  ).id;
  operadoraId = (await prisma.operadora.create({ data: { nome: `${PFX}-op`, ordem: 995 } })).id;
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

describe("aprovar com honorário 'a combinar' avisa quem cuida do cliente", () => {
  it("cria a notificação credenciamento_a_combinar para o ADMIN responsável", async () => {
    const celula = await prisma.credenciamento.create({
      data: { clienteId, profissionalId, operadoraId, valor: 0, tentativa: 1 },
    });
    await mudarStatusCredenciamento({ id: celula.id, status: "PROTOCOLADO" }, admin);
    const aprovada = await mudarStatusCredenciamento({ id: celula.id, status: "APROVADO" }, admin);
    expect(aprovada.contaId, "honorário a combinar não cria conta").toBeNull();

    // `equipeDoCliente` avisa ADMIN/ROOT ativos + o responsável — o próprio admin do teste
    // está nesse conjunto.
    const avisos = await prisma.notificacao.findMany({
      where: { entidadeId: clienteId, tipo: "credenciamento_a_combinar" },
    });
    expect(avisos.length, "pelo menos um ADMIN/ROOT é avisado").toBeGreaterThan(0);
    expect(avisos.some((a) => a.userId === admin.id)).toBe(true);
    expect(avisos[0]!.titulo).toContain("a combinar");
  });

  it("aprovar com valor já acertado NÃO dispara o lembrete", async () => {
    const celula = await prisma.credenciamento.create({
      data: { clienteId, profissionalId, operadoraId, valor: 1500, tentativa: 2 },
    });
    await mudarStatusCredenciamento({ id: celula.id, status: "PROTOCOLADO" }, admin);
    await mudarStatusCredenciamento({ id: celula.id, status: "APROVADO" }, admin);

    const avisos = await prisma.notificacao.findMany({
      where: { entidadeId: clienteId, tipo: "credenciamento_a_combinar", userId: admin.id },
    });
    // Só o cruzamento zerado do teste anterior gerou aviso — este, com valor já certo, não soma.
    expect(avisos).toHaveLength(1);
  });
});
