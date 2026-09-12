import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { salvarGrade } from "../modules/servicos/credenciamento-grade.service.js";

/**
 * A 2ª PROPOSTA DE CREDENCIAMENTO NÃO PODE APAGAR AS LINHAS DA 1ª.
 *
 * Cada proposta de credenciamento é de UMA operadora (ADR-126). O construtor manda para
 * `salvarGrade` só as células daquela operadora — e a grade, que foi escrita para a tela da
 * ficha (onde a carga é o cliente INTEIRO), lia todo par ausente como "desmarcado" e apagava.
 *
 * Efeito prático: a Thaís emitia a proposta da Unimed, depois a da Bradesco, e os cruzamentos
 * ainda `A_PROTOCOLAR` da Unimed sumiam da grade, sem aviso e sem erro na tela.
 *
 * A trava é `somenteOperadorasDaGrade`. Ligada (proposta), a remoção fica confinada às
 * operadoras que vieram na carga. Desligada (grade da ficha), o comportamento antigo continua
 * valendo — e o segundo caso deste arquivo é o que impede alguém de "consertar" isso ligando a
 * marca para todo mundo.
 */

const PFX = `gradeop-${randomBytes(4).toString("hex")}`;
const ATOR = { id: "" };
let clienteId: string;
let medicoId: string;
let opAId: string;
let opBId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const cliente = await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } });
  clienteId = cliente.id;

  const medico = await prisma.profissional.create({
    data: { clienteId, nome: `${PFX}-medico`, conselho: "CRM" },
  });
  medicoId = medico.id;

  const [a, b] = await Promise.all([
    prisma.operadora.create({ data: { nome: `${PFX}-unimed`, ordem: 990 } }),
    prisma.operadora.create({ data: { nome: `${PFX}-bradesco`, ordem: 991 } }),
  ]);
  opAId = a.id;
  opBId = b.id;

  const ator = await prisma.user.create({
    data: { nome: `${PFX}-ator`, email: `${PFX}@teste.local`, role: "ADMIN" },
  });
  ATOR.id = ator.id;
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { userId: ATOR.id } });
  await prisma.credenciamento.deleteMany({ where: { clienteId } });
  await prisma.profissional.deleteMany({ where: { clienteId } });
  await prisma.operadora.deleteMany({ where: { id: { in: [opAId, opBId] } } });
  await prisma.cliente.delete({ where: { id: clienteId } });
  await prisma.user.delete({ where: { id: ATOR.id } });
});

describe("salvarGrade — escopo por operadora", () => {
  it("a proposta da 2ª operadora PRESERVA os cruzamentos da 1ª", async () => {
    // 1ª proposta: operadora A.
    await salvarGrade(
      {
        clienteId,
        celulas: [{ profissionalId: medicoId, operadoraId: opAId, valor: 250 }],
        somenteOperadorasDaGrade: true,
      },
      ATOR,
    );
    expect(await prisma.credenciamento.count({ where: { clienteId, operadoraId: opAId } })).toBe(1);

    // 2ª proposta: operadora B. A carga não menciona a A — e não pode apagá-la.
    const r = await salvarGrade(
      {
        clienteId,
        celulas: [{ profissionalId: medicoId, operadoraId: opBId, valor: 300 }],
        somenteOperadorasDaGrade: true,
      },
      ATOR,
    );

    expect(r.removidos).toBe(0);
    expect(await prisma.credenciamento.count({ where: { clienteId, operadoraId: opAId } })).toBe(1);
    expect(await prisma.credenciamento.count({ where: { clienteId, operadoraId: opBId } })).toBe(1);
  });

  it("a grade da ficha (carga do cliente inteiro) CONTINUA apagando o que foi desmarcado", async () => {
    // Sem a marca, mandar só a operadora B significa "tirei a A" — e é para apagar mesmo.
    const r = await salvarGrade(
      { clienteId, celulas: [{ profissionalId: medicoId, operadoraId: opBId, valor: 300 }] },
      ATOR,
    );

    expect(r.removidos).toBe(1);
    expect(await prisma.credenciamento.count({ where: { clienteId, operadoraId: opAId } })).toBe(0);
    expect(await prisma.credenciamento.count({ where: { clienteId, operadoraId: opBId } })).toBe(1);
  });
});
