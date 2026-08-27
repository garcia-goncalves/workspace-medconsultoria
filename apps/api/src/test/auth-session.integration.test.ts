import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@app/db";
import { hashPassword, algoritmoDoHash } from "../lib/password";
import { login, changePassword } from "../modules/auth/auth.service";
import { createSession, getUserFromSession, destroySession } from "../lib/session";

// Sufixo único por execução — os testes criam/limpam os próprios usuários no banco de TESTE.
const PFX = `itest-${randomBytes(4).toString("hex")}`;
const email = (s: string) => `${PFX}-${s}@example.test`;
const ip = () => `10.${Math.floor(Math.random() * 255)}.0.1`;
const SENHA = "SenhaForte#2026";

async function criarUsuario(sufixo: string, opts: { hash?: string; ativo?: boolean; deletado?: boolean } = {}) {
  return prisma.user.create({
    data: {
      nome: `Teste ${sufixo}`,
      email: email(sufixo),
      passwordHash: opts.hash === undefined ? await hashPassword(SENHA) : opts.hash,
      role: "FUNCIONARIO",
      ativo: opts.ativo ?? true,
      deletedAt: opts.deletado ? new Date() : null,
    },
  });
}

beforeAll(async () => {
  // Garante banco de TESTE (nunca o de dev): a URL deve conter "_test".
  expect(process.env.DATABASE_URL, "os testes devem usar o banco _test").toContain("_test");
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { user: { email: { startsWith: PFX } } } });
  await prisma.activityLog.deleteMany({ where: { user: { email: { startsWith: PFX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("Auth — login", () => {
  it("aceita credenciais válidas e devolve sessão + usuário", async () => {
    await criarUsuario("ok");
    const r = await login({ email: email("ok"), password: SENHA }, "ua", ip());
    expect(r.sid).toBeTruthy();
    expect(r.user.role).toBe("FUNCIONARIO");
  });

  it("rejeita senha incorreta", async () => {
    await criarUsuario("wrongpw");
    await expect(login({ email: email("wrongpw"), password: "errada" }, "ua", ip())).rejects.toThrow();
  });

  it("rejeita usuário inativo", async () => {
    await criarUsuario("inativo", { ativo: false });
    await expect(login({ email: email("inativo"), password: SENHA }, "ua", ip())).rejects.toThrow();
  });

  it("rejeita usuário excluído (soft-delete)", async () => {
    await criarUsuario("deletado", { deletado: true });
    await expect(login({ email: email("deletado"), password: SENHA }, "ua", ip())).rejects.toThrow();
  });

  it("rejeita convite pendente (sem passwordHash)", async () => {
    await criarUsuario("pendente", { hash: null as unknown as string });
    await expect(login({ email: email("pendente"), password: SENHA }, "ua", ip())).rejects.toThrow();
  });

  it("faz rehash de hash legado (bcrypt) para Argon2id no login", async () => {
    const legado = await bcrypt.hash(SENHA, 8);
    const u = await criarUsuario("rehash", { hash: legado });
    expect(algoritmoDoHash(legado)).toBe("bcrypt");
    const r = await login({ email: email("rehash"), password: SENHA }, "ua", ip());
    expect(r.sid).toBeTruthy();
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(algoritmoDoHash(depois.passwordHash!)).toBe("argon2id"); // migrou
  });
});

describe("Sessão", () => {
  it("cria, valida e destrói a sessão", async () => {
    const u = await criarUsuario("sess");
    const sid = await createSession(u.id, { userAgent: "ua", ip: ip() });
    const atual = await getUserFromSession(sid);
    expect(atual?.id).toBe(u.id);
    await destroySession(sid);
    expect(await getUserFromSession(sid)).toBeNull();
  });

  it("sessão de usuário inativado deixa de valer", async () => {
    const u = await criarUsuario("sess-inat");
    const sid = await createSession(u.id);
    expect(await getUserFromSession(sid)).not.toBeNull();
    await prisma.user.update({ where: { id: u.id }, data: { ativo: false } });
    expect(await getUserFromSession(sid)).toBeNull();
  });
});

describe("Troca de senha", () => {
  it("exige a senha atual correta e revoga as outras sessões", async () => {
    const u = await criarUsuario("chpw");
    const sidAtual = await createSession(u.id);
    const sidOutra = await createSession(u.id);
    // senha atual errada → erro
    await expect(changePassword(u.id, "errada", "NovaSenha#2026", sidAtual)).rejects.toThrow();
    // correta → troca e revoga as demais (mantém a atual)
    await changePassword(u.id, SENHA, "NovaSenha#2026", sidAtual);
    expect(await getUserFromSession(sidAtual)).not.toBeNull();
    expect(await getUserFromSession(sidOutra)).toBeNull();
    // a nova senha funciona no login
    const r = await login({ email: email("chpw"), password: "NovaSenha#2026" }, "ua", ip());
    expect(r.sid).toBeTruthy();
  });
});
