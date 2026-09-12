import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { ativarServicoCliente } from "../modules/servicos/servicos-cliente.service.js";
import { hashPassword } from "../lib/password.js";

/**
 * TODA COBRANÇA DE SERVIÇO PRECISA DIZER DE QUE SERVIÇO VEIO — pelas DUAS portas.
 *
 * A conferência que impede cobrar duas vezes o mesmo serviço casava por TEXTO da descrição
 * (`"<Serviço> — <Cliente>"`). Renomear a clínica muda a descrição das cobranças seguintes: a
 * conferência deixa de casar com as antigas e a próxima proposta lança tudo de novo — **em
 * silêncio, porque duas contas com descrições diferentes não se parecem com duplicata para quem
 * olha o Financeiro**. `Conta.origemServicoId` existe para ser o elo que o rename não quebra.
 *
 * ⚠️ **E SÃO DUAS PORTAS QUE CRIAM ESSA COBRANÇA.** Contratar pela ficha do cliente
 * (`ativarServicoCliente`) e aceitar a proposta (`provisionarUpsellAceito`). Gravar a origem em
 * só uma delas reabre o buraco pela outra — foi o achado do revisor de banco nesta mesma rodada,
 * e é literalmente o padrão que a ADR-148 descreve: *a correção existe, mas só num dos lugares
 * onde o defeito mora*. Este teste cobre as duas de propósito.
 */

const PFX = `origem-${randomBytes(4).toString("hex")}`;
let ator: { id: string };
let clienteId: string;
let servicoId: string;

beforeAll(async () => {
  const url = process.env["DATABASE_URL"] ?? "";
  expect(url).toContain("_test");

  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  ator = { id: u.id };

  // Cliente ATIVO e sem lead no funil: assim `aConversaoAindaVaiCobrar` é falso e a
  // contratação pela ficha realmente provisiona a conta.
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica`, situacaoComercial: "ATIVO" } })).id;

  servicoId = (
    await prisma.servico.create({
      data: { nome: `${PFX}-servico`, categoria: "GESTAO", valor: 1000, ordem: 990 },
    })
  ).id;
});

afterAll(async () => {
  await prisma.conta.deleteMany({ where: { clienteId } });
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.activityLog.deleteMany({ where: { entidadeId: clienteId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.servico.deleteMany({ where: { id: servicoId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("a conta a receber sabe de que serviço veio", () => {
  it("contratar pela ficha grava `origemServicoId` — a porta que o revisor pegou faltando", async () => {
    await ativarServicoCliente(clienteId, servicoId, { valor: 1000 }, ator);

    const contas = await prisma.conta.findMany({ where: { clienteId, tipo: "RECEBER", deletedAt: null } });
    expect(contas.length, "contratar pela ficha tem de provisionar a cobrança").toBe(1);
    expect(
      contas[0]!.origemServicoId,
      "sem o id, esta conta volta a ser conferida só pela descrição — e o rename da clínica cobra de novo",
    ).toBe(servicoId);
  });

  it("renomear a clínica NÃO desliga a conferência: o elo é o id, não o texto", async () => {
    // O cenário que motivou a coluna: a descrição gravada embute o nome antigo.
    const antes = await prisma.conta.findFirst({ where: { clienteId, tipo: "RECEBER", deletedAt: null } });
    await prisma.cliente.update({ where: { id: clienteId }, data: { nome: `${PFX}-clinica-RENOMEADA` } });

    // A descrição deixou de casar — é exatamente por isso que o texto sozinho não bastava.
    expect(antes!.descricao).toContain(`${PFX}-clinica`);
    expect(antes!.descricao).not.toContain("RENOMEADA");

    // E o id continua apontando para o mesmo serviço, que é o que a conferência passa a usar.
    expect(antes!.origemServicoId).toBe(servicoId);
  });
});
