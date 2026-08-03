import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";

const USER = process.env.EMAIL_TESTE_USER;
const PASS = process.env.EMAIL_TESTE_PASS;
const temCaixa = !!(USER && PASS);

// Sem credencial no .env local, o teste é pulado em vez de falhar — o CI não tem a caixa.
const talvez = temCaixa ? describe : describe.skip;

talvez("plugar caixa (integração, caixa real de teste)", () => {
  let userId = "";

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toContain("_test");
    process.env.EMAIL_CRYPTO_KEY ||= randomBytes(32).toString("base64");
    const u = await prisma.user.create({
      data: {
        nome: "Teste E-mail",
        email: `email-teste-${randomBytes(4).toString("hex")}@exemplo.local`,
        passwordHash: "x",
        role: "FUNCIONARIO",
      },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("recusa senha errada, sem gravar a caixa", async () => {
    const { plugarCaixa } = await import("../modules/email/caixas.service.js");
    await expect(
      plugarCaixa(userId, { email: USER!, senha: "senha-errada-de-proposito", nomeExibicao: "Teste" }),
    ).rejects.toThrow(/senha|autentic/i);
    expect(await prisma.caixaEmail.count({ where: { userId } })).toBe(0);
  });

  it("pluga com a senha certa e NÃO devolve o segredo", async () => {
    const { plugarCaixa, listarCaixas } = await import("../modules/email/caixas.service.js");
    await plugarCaixa(userId, { email: USER!, senha: PASS!, nomeExibicao: "Caixa de teste" });
    const caixas = await listarCaixas(userId);
    expect(caixas).toHaveLength(1);
    expect(caixas[0]!.email).toBe(USER);
    expect(caixas[0]!.estado).toBe("OK");
    expect(JSON.stringify(caixas)).not.toContain("segredo");
  });

  it("não deixa a mesma pessoa plugar o mesmo endereço duas vezes", async () => {
    const { plugarCaixa } = await import("../modules/email/caixas.service.js");
    await expect(
      plugarCaixa(userId, { email: USER!, senha: PASS!, nomeExibicao: "De novo" }),
    ).rejects.toThrow(/já/i);
  });

  it("descobre as pastas do servidor com os papéis certos", async () => {
    const { sincronizarPastas, listarPastas } = await import("../modules/email/pastas.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });

    await sincronizarPastas(caixa.id);
    const pastas = await listarPastas(userId, caixa.id);

    const papeis = pastas.map((p) => p.papel);
    expect(papeis).toContain("INBOX");
    expect(papeis).toContain("SENT");
    expect(papeis).toContain("TRASH");
    expect(pastas.find((p) => p.papel === "INBOX")!.nome).toBe("Caixa de entrada");
    // A INBOX aparece primeiro (ordem 0).
    expect(pastas[0]!.papel).toBe("INBOX");
  });
});
