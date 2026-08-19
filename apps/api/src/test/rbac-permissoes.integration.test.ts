import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import type { Role } from "@app/shared";
import { appRouter } from "../trpc/router";
import { hashPassword } from "../lib/password";

// Bloco 4 — RBAC de exclusão/administração (regras do dono, 2026-07-17), validado no
// BACKEND (via createCaller, i.e. a própria API — não só escondendo botões):
//   Clientes: arquivar/desativar = ADMIN+ ; excluir definitivo = ROOT (bloqueado se há vínculos).
//   Arquivos: remover = ADMIN+ ; FUNCIONARIO envia/atualiza, não exclui.
//   Modelos/Operadoras: administrar (criar/editar/remover) = ADMIN+ ; FUNCIONARIO usa/consulta.

const PFX = `rbac-${randomBytes(4).toString("hex")}`;

type U = { id: string; nome: string; email: string; role: Role; clienteId: string | null };
const caller = (u: U) => appRouter.createCaller({ user: u, req: {}, res: {} } as never);

const users = {} as Record<"func" | "admin" | "root", U>;
let cliArch: string, cliVinc: string, cliLimpo: string, cliAtivo: string;
let arquivoId: string, modeloId: string, operadoraId: string, projetoVincId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "os testes devem usar o banco _test").toContain("_test");

  const mk = async (role: Role): Promise<U> => {
    const u = await prisma.user.create({
      data: { nome: `${PFX}-${role}`, email: `${PFX}-${role}@example.test`, passwordHash: await hashPassword("x"), role },
    });
    return { id: u.id, nome: u.nome, email: u.email, role, clienteId: null };
  };
  users.func = await mk("FUNCIONARIO");
  users.admin = await mk("ADMIN");
  users.root = await mk("ROOT");

  const mkCli = async (suf: string) => (await prisma.cliente.create({ data: { nome: `${PFX}-${suf}` } })).id;
  cliArch = await mkCli("arch");
  cliVinc = await mkCli("vinc");
  cliLimpo = await mkCli("limpo");
  cliAtivo = await mkCli("ativo");

  // Vínculo em cliVinc: um projeto (bloqueia exclusão definitiva + prova preservação).
  projetoVincId = (await prisma.projeto.create({ data: { clienteId: cliVinc, nome: `${PFX}-proj` } })).id;

  arquivoId = (
    await prisma.arquivo.create({
      data: { clienteId: cliArch, nome: `${PFX}.pdf`, mimetype: "application/pdf", tamanho: 10, caminho: `clientes/${cliArch}/x.pdf`, enviadoPorTipo: "CLIENTE" },
    })
  ).id;
  modeloId = (await prisma.modeloDocumento.create({ data: { nome: `${PFX}-modelo`, tipo: "ONBOARDING", corpo: "corpo" } })).id;
  operadoraId = (await prisma.operadora.create({ data: { nome: `${PFX}-op` } })).id;
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { entidadeId: { in: [arquivoId, cliArch, cliVinc, cliLimpo, cliAtivo] } } });
  await prisma.projeto.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.arquivo.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.modeloDocumento.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.operadora.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.contato.deleteMany({ where: { cliente: { nome: { startsWith: PFX } } } });
  await prisma.cliente.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("RBAC — Clientes (arquivar/desativar = ADMIN+; excluir definitivo = ROOT)", () => {
  it("desativar: FUNCIONARIO é NEGADO; ADMIN é PERMITIDO", async () => {
    await expect(caller(users.func).clientes.setAtivo({ id: cliAtivo, ativo: false })).rejects.toThrow(/permiss/i);
    await expect(caller(users.admin).clientes.setAtivo({ id: cliAtivo, ativo: false })).resolves.toMatchObject({ ok: true });
    const c = await prisma.cliente.findUnique({ where: { id: cliAtivo }, select: { situacaoComercial: true } });
    expect(c?.situacaoComercial).toBe("INATIVO");
  });

  it("arquivar (remove lógico): FUNCIONARIO NEGADO; ADMIN PERMITIDO e preserva vínculos", async () => {
    await expect(caller(users.func).clientes.remove({ id: cliArch })).rejects.toThrow(/permiss/i);
    await expect(caller(users.admin).clientes.remove({ id: cliArch })).resolves.toMatchObject({ ok: true });
    // Exclusão LÓGICA: deletedAt setado, mas o registro (e o arquivo vinculado) continuam no banco.
    const c = await prisma.cliente.findUnique({ where: { id: cliArch }, select: { deletedAt: true } });
    expect(c?.deletedAt).not.toBeNull();
    const arq = await prisma.arquivo.findUnique({ where: { id: arquivoId } });
    expect(arq, "arquivo do cliente arquivado é preservado").not.toBeNull();
  });

  it("excluir definitivo: ADMIN é NEGADO (só ROOT)", async () => {
    await expect(caller(users.admin).clientes.excluirDefinitivo({ id: cliLimpo })).rejects.toThrow(/permiss/i);
  });

  it("excluir definitivo (ROOT): BLOQUEADO quando há vínculos + PRESERVA os dados", async () => {
    await expect(caller(users.root).clientes.excluirDefinitivo({ id: cliVinc })).rejects.toThrow(/vínculos|bloqueada/i);
    expect(await prisma.cliente.findUnique({ where: { id: cliVinc } }), "cliente com vínculo é preservado").not.toBeNull();
    expect(await prisma.projeto.findUnique({ where: { id: projetoVincId } }), "projeto vinculado é preservado").not.toBeNull();
  });

  it("excluir definitivo (ROOT): PERMITIDO em cliente sem vínculos (remoção física)", async () => {
    await prisma.contato.create({ data: { clienteId: cliLimpo, nome: `${PFX}-contato` } });
    await expect(caller(users.root).clientes.excluirDefinitivo({ id: cliLimpo })).resolves.toMatchObject({ ok: true });
    expect(await prisma.cliente.findUnique({ where: { id: cliLimpo } }), "cliente limpo é removido fisicamente").toBeNull();
    expect(await prisma.contato.findFirst({ where: { clienteId: cliLimpo } }), "contatos removidos junto").toBeNull();
  });
});

describe("RBAC — Arquivos (remover = ADMIN+; FUNCIONARIO não exclui)", () => {
  it("FUNCIONARIO é NEGADO ao remover arquivo", async () => {
    await expect(caller(users.func).clientes.removerArquivo({ id: arquivoId })).rejects.toThrow(/permiss/i);
  });
  it("ADMIN remove (soft-delete) e registra auditoria de quem removeu", async () => {
    await expect(caller(users.admin).clientes.removerArquivo({ id: arquivoId })).resolves.toMatchObject({ ok: true });
    const arq = await prisma.arquivo.findUnique({ where: { id: arquivoId }, select: { deletedAt: true } });
    expect(arq?.deletedAt).not.toBeNull();
    const log = await prisma.activityLog.findFirst({ where: { acao: "arquivo.removido", entidadeId: arquivoId, userId: users.admin.id } });
    expect(log, "registro de auditoria da remoção").not.toBeNull();
  });
});

describe("RBAC — Modelos (administrar = ADMIN+; FUNCIONARIO usa)", () => {
  it("FUNCIONARIO USA (list) mas NÃO administra (create/remove)", async () => {
    await expect(caller(users.func).documentos.modelos.list()).resolves.toBeDefined();
    await expect(caller(users.func).documentos.modelos.create({ nome: `${PFX}-x`, tipo: "ONBOARDING", corpo: "c" })).rejects.toThrow(/permiss/i);
    await expect(caller(users.func).documentos.modelos.remove({ id: modeloId })).rejects.toThrow(/permiss/i);
  });
  it("ADMIN administra (remove)", async () => {
    await expect(caller(users.admin).documentos.modelos.remove({ id: modeloId })).resolves.toBeTruthy();
  });
});

describe("RBAC — Operadoras (administrar = ADMIN+; FUNCIONARIO consulta)", () => {
  it("FUNCIONARIO CONSULTA (list) mas NÃO administra (criar/remover)", async () => {
    await expect(caller(users.func).documentos.operadoras.list()).resolves.toBeDefined();
    await expect(caller(users.func).documentos.operadoras.criar({ nome: `${PFX}-y` })).rejects.toThrow(/permiss/i);
    await expect(caller(users.func).documentos.operadoras.remover({ id: operadoraId })).rejects.toThrow(/permiss/i);
  });
  it("ADMIN administra (remover)", async () => {
    await expect(caller(users.admin).documentos.operadoras.remover({ id: operadoraId })).resolves.toBeTruthy();
  });
});
