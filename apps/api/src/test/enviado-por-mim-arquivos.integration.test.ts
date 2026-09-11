import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { listarArquivos } from "../modules/arquivos/arquivos.service";
import { hashPassword } from "../lib/password";

/**
 * Achado da auditoria de 04/09: "'Enviado por você' no Portal atribui a qualquer pessoa da
 * clínica um documento que outra pessoa enviou." Desde a ADR-131 (vários usuários por clínica),
 * o Portal tem RESPONSAVEL e EQUIPE — pessoas distintas, cada uma com o próprio login — e o
 * rótulo "por você" precisa identificar a PESSOA (`enviadoPorId`), não só o LADO
 * (`enviadoPorTipo`: CLIENTE × EQUIPE).
 */
const PFX = `envpormim-${randomBytes(4).toString("hex")}`;

let clienteId: string;
let pessoaAId: string;
let pessoaBId: string;
let arquivoDeAId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "os testes devem usar o banco _test").toContain("_test");

  const cliente = await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } });
  clienteId = cliente.id;

  const pessoaA = await prisma.user.create({
    data: {
      nome: `${PFX}-pessoaA`,
      email: `${PFX}-a@example.test`,
      passwordHash: await hashPassword("x"),
      role: "CLIENTE",
      clienteId,
      papelPortal: "RESPONSAVEL",
    },
  });
  const pessoaB = await prisma.user.create({
    data: {
      nome: `${PFX}-pessoaB`,
      email: `${PFX}-b@example.test`,
      passwordHash: await hashPassword("x"),
      role: "CLIENTE",
      clienteId,
      papelPortal: "EQUIPE",
    },
  });
  pessoaAId = pessoaA.id;
  pessoaBId = pessoaB.id;

  const arquivo = await prisma.arquivo.create({
    data: {
      clienteId,
      nome: `${PFX}-rg.pdf`,
      mimetype: "application/pdf",
      tamanho: 10,
      caminho: `clientes/${clienteId}/rg.pdf`,
      enviadoPorTipo: "CLIENTE",
      enviadoPorId: pessoaAId,
    },
  });
  arquivoDeAId = arquivo.id;
});

afterAll(async () => {
  await prisma.arquivo.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.cliente.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("Enviado por você' é sobre a PESSOA, não sobre o lado CLIENTE × EQUIPE", () => {
  it("a lista traz o userId E o nome de quem enviou, não só CLIENTE/EQUIPE", async () => {
    const arquivos = await listarArquivos(clienteId);
    const arquivo = arquivos.find((a) => a.id === arquivoDeAId);
    expect(arquivo).toBeDefined();
    // O front-end decide "é você?" comparando ISTO com o userId da sessão — não com
    // `enviadoPorTipo`, que é igual para as duas pessoas da mesma clínica.
    expect(arquivo?.enviadoPorId).toBe(pessoaAId);
    expect(arquivo?.enviadoPorNome).toContain("pessoaA");
  });

  it("o enviadoPorId de A é DIFERENTE do de B — B não pode ser confundido com quem enviou", async () => {
    const arquivos = await listarArquivos(clienteId);
    const arquivo = arquivos.find((a) => a.id === arquivoDeAId);
    expect(arquivo?.enviadoPorId).not.toBe(pessoaBId);
  });
});
