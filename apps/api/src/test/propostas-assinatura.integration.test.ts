import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { hashPassword } from "../lib/password";
import { habilitarAceite, responder } from "../modules/propostas/propostas.service";
import { solicitar as solicitarAssinatura, assinar } from "../modules/assinaturas/assinaturas.service";

const PFX = `paint-${randomBytes(4).toString("hex")}`;
let clienteId: string;
let ator: { id: string; nome: string; email: string };

async function criarDoc(titulo: string, conteudo: string) {
  return prisma.documento.create({
    data: { clienteId, titulo: `${PFX}-${titulo}`, conteudo, status: "ENVIADO", criadoPorId: ator.id },
  });
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const c = await prisma.cliente.create({ data: { nome: `${PFX}-cli`, email: `${PFX}-cli@example.test` } });
  clienteId = c.id;
  const u = await prisma.user.create({
    data: { nome: `${PFX}-ator`, email: `${PFX}-ator@example.test`, passwordHash: await hashPassword("x"), role: "FUNCIONARIO" },
  });
  ator = { id: u.id, nome: u.nome, email: u.email };
});

afterAll(async () => {
  const docs = await prisma.documento.findMany({ where: { titulo: { startsWith: PFX } }, select: { id: true } });
  const ids = docs.map((d) => d.id);
  await prisma.assinatura.deleteMany({ where: { documentoId: { in: ids } } });
  await prisma.documento.deleteMany({ where: { id: { in: ids } } });
  await prisma.activityLog.deleteMany({ where: { entidadeId: { in: ids } } });
  await prisma.cliente.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("Proposta — aceite público, dup e integridade", () => {
  it("aceita por token e grava IP; bloqueia aceite duplicado", async () => {
    const doc = await criarDoc("prop", "Proposta v1");
    const { token } = await habilitarAceite(doc.id, ator, false);
    expect(token).toBeTruthy();

    const r1 = await responder({ token, decisao: "ACEITA" }, "203.0.113.5");
    expect(r1.decisao).toBe("ACEITA");
    const d1 = await prisma.documento.findUniqueOrThrow({ where: { id: doc.id } });
    expect(d1.propostaStatus).toBe("ACEITA");
    expect(d1.propostaRespIp).toBe("203.0.113.5");

    // Aceite duplicado: não sobrescreve, retorna jaRespondida.
    const r2 = await responder({ token, decisao: "RECUSADA", motivo: "tentando de novo" }, "203.0.113.6");
    expect(r2.jaRespondida).toBe(true);
    const d2 = await prisma.documento.findUniqueOrThrow({ where: { id: doc.id } });
    expect(d2.propostaStatus, "continua ACEITA").toBe("ACEITA");
  });

  it("rejeita aceite se o conteúdo mudou depois do envio (hash)", async () => {
    const doc = await criarDoc("prop2", "Proposta original");
    const { token } = await habilitarAceite(doc.id, ator, false);
    // Adultera o conteúdo após habilitar (hash congelado não bate mais).
    await prisma.documento.update({ where: { id: doc.id }, data: { conteudo: "Proposta ADULTERADA" } });
    await expect(responder({ token, decisao: "ACEITA" }, "203.0.113.7")).rejects.toThrow(/alterada/i);
  });
});

describe("Assinatura — token criptográfico, trilha e integridade", () => {
  it("gera token criptográfico, assina com IP/agente/hash e conclui", async () => {
    const doc = await criarDoc("contrato", "Contrato v1");
    await solicitarAssinatura(doc.id, ator, false);
    const assinaturas = await prisma.assinatura.findMany({ where: { documentoId: doc.id }, orderBy: { ordem: "asc" } });
    expect(assinaturas.length).toBe(2);
    const tokenCliente = assinaturas[0]!.token;
    // Token criptográfico (base64url ~43 chars), não cuid.
    expect(tokenCliente).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(tokenCliente.startsWith("c") && tokenCliente.length <= 25).toBe(false);

    const res = await assinar({ token: tokenCliente, metodo: "DIGITADO", nomeDigitado: "Fulano de Tal", consentimento: true }, "198.51.100.9", "Mozilla/Teste");
    expect(res.ok).toBe(true);
    const a = await prisma.assinatura.findUniqueOrThrow({ where: { token: tokenCliente } });
    expect(a.status).toBe("ASSINADO");
    expect(a.ip).toBe("198.51.100.9");
    expect(a.userAgent).toBe("Mozilla/Teste");
    expect(a.hashDocumento).toBeTruthy();
    expect(a.assinadoEm).not.toBeNull();
  });

  it("rejeita assinatura se o conteúdo mudou depois do envio", async () => {
    const doc = await criarDoc("contrato2", "Contrato base");
    await solicitarAssinatura(doc.id, ator, false);
    const a = await prisma.assinatura.findFirstOrThrow({ where: { documentoId: doc.id }, orderBy: { ordem: "asc" } });
    await prisma.documento.update({ where: { id: doc.id }, data: { conteudo: "Contrato ADULTERADO" } });
    await expect(
      assinar({ token: a.token, metodo: "DIGITADO", nomeDigitado: "X", consentimento: true }, "198.51.100.1", "UA"),
    ).rejects.toThrow(/alterado/i);
  });
});
