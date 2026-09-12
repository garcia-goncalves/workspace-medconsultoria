import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { hashPassword } from "../lib/password.js";
import { credenciamentoDoCliente, NOME_SERVICO_CREDENCIAMENTO } from "../modules/servicos/credenciamento.service.js";

/**
 * M13 — DESATIVAR UM MÉDICO ESCONDIA A PAPELADA DELE E INFLAVA O PROGRESSO.
 *
 * `credenciamentoDoCliente` buscava só `profissional { ativo: true }` para TUDO, inclusive o
 * denominador do progresso (`vagasCredenciamento`). Desativar um médico com papelada faltando
 * tirava as vagas dele do TOTAL — "X de Y enviados" subia sozinho, sem ninguém enviar nada.
 *
 * A ADR-105 já decidiu, para a GRADE, que médico desativado FICA visível (marcado "fora da
 * lista") justamente para não sumir com o rastro dele. Aqui a mesma lição: o PROGRESSO usa
 * todos os médicos (ativos + inativos); só a triagem e as listas voltadas ao cliente/à ficha
 * continuam mostrando apenas os ativos.
 */

const PFX = `desat-${randomBytes(4).toString("hex")}`;
let ator: { id: string };
let clienteId: string;
let servicoCredId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  ator = { id: u.id };
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } })).id;

  const existente = await prisma.servico.findFirst({ where: { nome: NOME_SERVICO_CREDENCIAMENTO }, select: { id: true } });
  servicoCredId = existente
    ? existente.id
    : (
        await prisma.servico.create({
          data: { nome: NOME_SERVICO_CREDENCIAMENTO, valor: 2000, valorRecorrencia: "AVULSO", ehCredenciamento: true },
          select: { id: true },
        })
      ).id;
  await prisma.clienteServico.upsert({
    where: { clienteId_servicoId: { clienteId, servicoId: servicoCredId } },
    update: { status: "ATIVO" },
    create: { clienteId, servicoId: servicoCredId, status: "ATIVO" },
  });
});

afterAll(async () => {
  await prisma.arquivo.deleteMany({ where: { clienteId } });
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.profissional.deleteMany({ where: { clienteId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  void ator;
  await prisma.$disconnect();
});

describe("M13 — desativar médico não infla o progresso", () => {
  it("o total de vagas continua o mesmo antes e depois de desativar um médico com papelada faltando", async () => {
    const p1 = await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-p1`, conselho: "CRM", anoFormatura: 2010 },
    });
    await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-p2`, conselho: "CRM", anoFormatura: 2010 },
    });

    const antes = await credenciamentoDoCliente(clienteId);
    expect(antes.progresso.total).toBeGreaterThan(0);

    await prisma.profissional.update({ where: { id: p1.id }, data: { ativo: false } });

    const depois = await credenciamentoDoCliente(clienteId);
    expect(depois.progresso.total, "o total NÃO pode encolher só por causa da desativação").toBe(antes.progresso.total);
    expect(depois.progresso.atendidas, "nada foi enviado — atendidas continua igual").toBe(antes.progresso.atendidas);
    expect(depois.progresso.percentual, "e por isso o percentual não pode subir sozinho").toBe(antes.progresso.percentual);
  });

  it("o médico desativado some das listas voltadas à ficha/Portal (porProfissional) — só o total do progresso o mantém", async () => {
    const v = await credenciamentoDoCliente(clienteId);
    const nomes = v.porProfissional.map((x) => x.profissional.nome);
    expect(nomes).not.toContain(`${PFX}-p1`);
    expect(nomes).toContain(`${PFX}-p2`);
  });
});
