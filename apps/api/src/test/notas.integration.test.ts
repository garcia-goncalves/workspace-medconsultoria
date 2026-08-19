import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { addNota, arquivarNota } from "../modules/clientes/clientes.service";
import { hashPassword } from "../lib/password";

const PFX = `nota-${randomBytes(4).toString("hex")}`;
let clienteId: string;
let userId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const c = await prisma.cliente.create({ data: { nome: `${PFX}-cli` } });
  clienteId = c.id;
  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "FUNCIONARIO" },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.nota.deleteMany({ where: { entidadeId: clienteId } });
  await prisma.cliente.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("Notas — histórico imutável + arquivamento (decisão #2)", () => {
  it("arquivar/desarquivar NÃO altera o conteúdo original", async () => {
    const nota = await addNota({ entidadeTipo: "cliente", entidadeId: clienteId, conteudo: "Conteúdo ORIGINAL" }, userId);
    expect(nota.arquivadaEm).toBeNull();

    const arq = await arquivarNota(nota.id, userId, true);
    expect(arq.arquivadaEm).not.toBeNull();
    expect(arq.arquivadaPorId).toBe(userId);
    expect(arq.conteudo, "conteúdo preservado ao arquivar").toBe("Conteúdo ORIGINAL");

    const desarq = await arquivarNota(nota.id, userId, false);
    expect(desarq.arquivadaEm).toBeNull();
    expect(desarq.conteudo, "conteúdo preservado ao desarquivar").toBe("Conteúdo ORIGINAL");
  });

  it("não existe função de EDITAR conteúdo de nota (imutabilidade por design)", async () => {
    const svc = await import("../modules/clientes/clientes.service");
    expect((svc as Record<string, unknown>).editarNota).toBeUndefined();
    expect((svc as Record<string, unknown>).updateNota).toBeUndefined();
  });
});

describe("situacaoComercial — enum preserva os valores (decisão #1)", () => {
  it("aceita os valores válidos e persiste", async () => {
    for (const s of ["PROSPECT", "NEGOCIACAO", "ATIVO", "INATIVO", "PERDIDO"] as const) {
      const c = await prisma.cliente.create({ data: { nome: `${PFX}-${s}`, situacaoComercial: s } });
      const lido = await prisma.cliente.findUniqueOrThrow({ where: { id: c.id } });
      expect(lido.situacaoComercial).toBe(s);
    }
  });
});
