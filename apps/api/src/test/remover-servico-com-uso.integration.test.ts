import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { removerServico } from "../modules/servicos/servicos.service.js";
import { ativarServicoCliente } from "../modules/servicos/servicos-cliente.service.js";
import { hashPassword } from "../lib/password.js";

/**
 * EXCLUIR UM SERVIÇO DO CATÁLOGO NÃO PODE APAGAR CONTRATO DE CLIENTE EM SILÊNCIO.
 *
 * `ClienteServico.servico` é `onDelete: Cascade` (schema.prisma) — sem trava na aplicação,
 * `prisma.servico.delete` apaga em cascata o preço combinado e os convênios de todo cliente
 * que contratou aquele serviço, e a confirmação da tela só avisava sobre leads. Este teste
 * exercita a trava de `removerServico`: recusa quando há `ClienteServico` (mesmo cancelado —
 * cancelar é `update`, nunca `delete`) e recusa quando sobra uma `Conta.origemServicoId` órfã;
 * exclui normalmente quando não há vínculo nenhum.
 */

const PFX = `rm-servico-${randomBytes(4).toString("hex")}`;
let ator: { id: string };
let clienteId: string;

beforeAll(async () => {
  const url = process.env["DATABASE_URL"] ?? "";
  expect(url).toContain("_test");

  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  ator = { id: u.id };

  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica`, situacaoComercial: "ATIVO" } })).id;
});

afterAll(async () => {
  await prisma.conta.deleteMany({ where: { clienteId } });
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.activityLog.deleteMany({ where: { entidadeId: clienteId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.servico.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("removerServico recusa apagar contrato de cliente em silêncio", () => {
  it("serviço contratado (ativo): exclusão é recusada, nada é apagado", async () => {
    const servico = await prisma.servico.create({
      data: { nome: `${PFX}-contratado-ativo`, categoria: "GESTAO", valor: 1000, ordem: 990 },
    });
    await ativarServicoCliente(clienteId, servico.id, { valor: 1000 }, ator);

    await expect(removerServico(servico.id)).rejects.toThrow(/contratado/);

    const aindaExiste = await prisma.servico.findUnique({ where: { id: servico.id } });
    expect(aindaExiste, "o serviço não pode ter sido apagado").not.toBeNull();
    const cs = await prisma.clienteServico.findUnique({
      where: { clienteId_servicoId: { clienteId, servicoId: servico.id } },
    });
    expect(cs, "a contratação (preço combinado) não pode ter sido apagada em cascata").not.toBeNull();
  });

  it("serviço contratado e depois CANCELADO: continua recusando — cancelar não apaga a linha", async () => {
    const servico = await prisma.servico.create({
      data: { nome: `${PFX}-contratado-cancelado`, categoria: "GESTAO", valor: 500, ordem: 991 },
    });
    await ativarServicoCliente(clienteId, servico.id, { valor: 500 }, ator);
    await prisma.clienteServico.update({
      where: { clienteId_servicoId: { clienteId, servicoId: servico.id } },
      data: { status: "CANCELADO", canceladoEm: new Date() },
    });

    await expect(removerServico(servico.id)).rejects.toThrow(/contratado/);

    const aindaExiste = await prisma.servico.findUnique({ where: { id: servico.id } });
    expect(aindaExiste, "histórico cancelado também conta — o serviço não pode ter sido apagado").not.toBeNull();
  });

  it("conta órfã com origemServicoId (sem ClienteServico): também recusa", async () => {
    const servico = await prisma.servico.create({
      data: { nome: `${PFX}-so-conta`, categoria: "GESTAO", valor: 200, ordem: 992 },
    });
    await prisma.conta.create({
      data: {
        tipo: "RECEBER",
        descricao: `${PFX}-conta-orfa`,
        valor: 200,
        vencimento: new Date(),
        clienteId,
        origemServicoId: servico.id,
      },
    });

    await expect(removerServico(servico.id)).rejects.toThrow(/Financeiro/);

    const aindaExiste = await prisma.servico.findUnique({ where: { id: servico.id } });
    expect(aindaExiste).not.toBeNull();
  });

  it("serviço sem nenhum vínculo: exclui normalmente", async () => {
    const servico = await prisma.servico.create({
      data: { nome: `${PFX}-sem-vinculo`, categoria: "GESTAO", valor: 100, ordem: 993 },
    });

    await expect(removerServico(servico.id)).resolves.toEqual({ ok: true });

    const apagado = await prisma.servico.findUnique({ where: { id: servico.id } });
    expect(apagado).toBeNull();
  });
});
