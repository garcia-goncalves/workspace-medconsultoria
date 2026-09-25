import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import type { SessionUser } from "@app/shared";
import { hashPassword } from "../lib/password";
import { criarToken } from "../lib/tokens";
import { base32Decodificar, codigoDoPasso, passoDoInstante } from "../lib/totp";
import { login, redefinirSenha, changePassword, concluirEntradaComSegundoFator } from "../modules/auth/auth.service";
import {
  iniciarAtivacao,
  confirmarAtivacao,
  desativarSegundoFator,
  statusSegundoFator,
  emitirDesafio,
  lerDesafio,
  _limparFreiosSegundoFator,
} from "../modules/auth/segundo-fator.service";
import { appRouter } from "../trpc/router";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste";

/**
 * VERIFICAÇÃO EM DUAS ETAPAS (onda 4C) contra o MySQL de verdade.
 *
 * O que se prova aqui é o que não se prova lendo código: que a senha certa de quem ativou o 2FA
 * NÃO cria sessão; que o código é de uso único mesmo dentro da janela de ±30 s; que o código de
 * recuperação vale uma vez; que o freio segura a força bruta; e que redefinir a senha pelo
 * e-mail não é um atalho para pular a segunda etapa.
 */

const PFX = `it2fa-${randomBytes(4).toString("hex")}`;
const email = (s: string) => `${PFX}-${s}@example.test`;
const SENHA = "SenhaForte#2026";
let ipSeq = 0;
const ip = () => `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

async function criarUsuario(sufixo: string, role: "ADMIN" | "ROOT" | "FUNCIONARIO" = "ADMIN") {
  const u = await prisma.user.create({
    data: { nome: `Teste ${sufixo}`, email: email(sufixo), passwordHash: await hashPassword(SENHA), role },
  });
  const sessao: SessionUser = {
    id: u.id,
    nome: u.nome,
    email: u.email,
    role: u.role,
    avatarUrl: null,
    clienteId: null,
    senhaTrocadaEm: null,
  };
  return { u, sessao };
}

/** Ativa o 2FA de ponta a ponta e devolve o segredo + o passo que a ativação consumiu. */
async function ativar(sessao: SessionUser) {
  const { chave } = await iniciarAtivacao(sessao);
  const segredo = base32Decodificar(chave);
  const passo = passoDoInstante(Date.now());
  const { codigosRecuperacao } = await confirmarAtivacao(sessao, SENHA, codigoDoPasso(segredo, passo), ip());
  return { segredo, passo, codigosRecuperacao, chave };
}

const sessoesDe = (userId: string) => prisma.session.count({ where: { userId } });

beforeAll(() => exigirBancoDeTeste());
beforeEach(() => _limparFreiosSegundoFator());

afterAll(async () => {
  const onde = { user: { email: { startsWith: PFX } } };
  await prisma.codigoRecuperacao.deleteMany({ where: onde });
  await prisma.segundoFator.deleteMany({ where: onde });
  await prisma.session.deleteMany({ where: onde });
  await prisma.token.deleteMany({ where: onde });
  await prisma.activityLog.deleteMany({ where: onde });
  const ids = (await prisma.user.findMany({ where: { email: { startsWith: PFX } }, select: { id: true } })).map((u) => u.id);
  await prisma.notificacao.deleteMany({ where: { userId: { in: ids } } });
  await prisma.emailEnviado.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("2FA — ativação", () => {
  it("só confirma com um código válido; antes disso o login NÃO pede código", async () => {
    const { u, sessao } = await criarUsuario("ativa");
    const { chave, uri } = await iniciarAtivacao(sessao);
    expect(chave).toMatch(/^[A-Z2-7]{32}$/);
    expect(uri).toContain("otpauth://totp/");

    // Ativação começada e NÃO confirmada: quem desistiu no meio não fica trancado fora.
    const r0 = await login({ email: u.email, password: SENHA }, "ua", ip());
    expect(r0.sid).toBeTruthy();

    await expect(confirmarAtivacao(sessao, SENHA, "000000", ip())).rejects.toThrow(/incorretos/);
    expect((await statusSegundoFator(sessao)).ativo).toBe(false);

    const segredo = base32Decodificar(chave);
    // Sem a senha certa não ativa, mesmo com o código certo (sessão roubada não basta).
    const codigoAgora = codigoDoPasso(segredo, passoDoInstante(Date.now()));
    await expect(confirmarAtivacao(sessao, "senha-errada", codigoAgora, ip())).rejects.toThrow(/incorretos/);
    expect((await statusSegundoFator(sessao)).ativo).toBe(false);

    const { codigosRecuperacao } = await confirmarAtivacao(sessao, SENHA, codigoAgora, ip());
    expect(codigosRecuperacao).toHaveLength(10);
    expect(new Set(codigosRecuperacao).size).toBe(10);
    for (const c of codigosRecuperacao) expect(c).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);

    const st = await statusSegundoFator(sessao);
    expect(st).toMatchObject({ ativo: true, codigosRestantes: 10, disponivel: true, recomendado: true });
    // O status nunca devolve segredo.
    expect(JSON.stringify(st)).not.toContain(chave);
  });

  it("ativar derruba as OUTRAS sessões e mantém a atual", async () => {
    const { u, sessao } = await criarUsuario("derruba");
    const atual = await prisma.session.create({ data: { userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.session.create({ data: { userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    const { chave } = await iniciarAtivacao(sessao);
    const cod = codigoDoPasso(base32Decodificar(chave), passoDoInstante(Date.now()));
    await confirmarAtivacao(sessao, SENHA, cod, ip(), atual.id);
    const restantes = await prisma.session.findMany({ where: { userId: u.id }, select: { id: true } });
    expect(restantes.map((x) => x.id)).toEqual([atual.id]);
  });

  it("ativar revoga as delegações da API do agente (B2) — a terceira porta, como na troca de senha", async () => {
    const { u, sessao } = await criarUsuario("delega");
    const cliente = await prisma.agentClient.create({
      data: { nome: `${PFX}-agente`, segredoHash: randomBytes(32).toString("hex") },
    });
    const viva = await prisma.agentDelegation.create({
      data: {
        clientId: cliente.id,
        userId: u.id,
        tokenHash: randomBytes(32).toString("hex"),
        escopos: "tasks:read",
        expiraEm: new Date(Date.now() + 3_600_000),
      },
    });
    try {
      await ativar(sessao);
      expect((await prisma.agentDelegation.findUniqueOrThrow({ where: { id: viva.id } })).revogadaEm).not.toBeNull();
    } finally {
      await prisma.agentClient.delete({ where: { id: cliente.id } }); // cascata leva a delegação
    }
  });

  it("guarda o segredo CIFRADO e os códigos só como HASH", async () => {
    const { u, sessao } = await criarUsuario("guarda");
    const { chave, codigosRecuperacao } = await ativar(sessao);
    const sf = await prisma.segundoFator.findUniqueOrThrow({ where: { userId: u.id } });
    expect(sf.segredoCifrado.startsWith("v1:")).toBe(true);
    expect(sf.segredoCifrado).not.toContain(chave);
    const hashes = await prisma.codigoRecuperacao.findMany({ where: { userId: u.id } });
    expect(hashes).toHaveLength(10);
    for (const h of hashes) {
      expect(h.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(codigosRecuperacao.map((c) => c.replace(/-/g, ""))).not.toContain(h.hash);
    }
    // Nem o rastro guarda segredo ou código.
    const rastro = JSON.stringify(await prisma.activityLog.findMany({ where: { userId: u.id } }));
    expect(rastro).not.toContain(chave);
    for (const c of codigosRecuperacao) expect(rastro).not.toContain(c);
  });

  it("FUNCIONÁRIO não ativa, e sessão de suporte também não", async () => {
    const { sessao } = await criarUsuario("func", "FUNCIONARIO");
    await expect(iniciarAtivacao(sessao)).rejects.toThrow(/administradores/);
    const { sessao: adm } = await criarUsuario("suporte");
    await expect(iniciarAtivacao({ ...adm, operador: { id: "x", nome: "Op" } })).rejects.toThrow(/Volte ao seu acesso/);
  });

  it("iniciar de novo com o 2FA já ativo é recusado (não sobrescreve o segredo em uso)", async () => {
    const { u, sessao } = await criarUsuario("reinicia");
    await ativar(sessao);
    const antes = (await prisma.segundoFator.findUniqueOrThrow({ where: { userId: u.id } })).segredoCifrado;
    await expect(iniciarAtivacao(sessao)).rejects.toThrow(/já está ativa/);
    const depois = await prisma.segundoFator.findUniqueOrThrow({ where: { userId: u.id } });
    expect(depois.segredoCifrado).toBe(antes);
    expect(depois.ativadoEm).not.toBeNull();
  });
});

describe("2FA — login", () => {
  it("senha certa NÃO cria sessão: devolve só o desafio", async () => {
    const { u, sessao } = await criarUsuario("login");
    await ativar(sessao);
    const antes = await sessoesDe(u.id);
    const r = await login({ email: u.email, password: SENHA }, "ua", ip());
    expect(r.sid).toBeUndefined();
    expect(r.user).toBeUndefined();
    expect(typeof r.desafio).toBe("string");
    expect(await sessoesDe(u.id)).toBe(antes);
    // O último acesso também espera: com a senha só, a pessoa ainda não entrou.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).ultimoAcessoEm).toBeNull();
  });

  it("código certo vira sessão; errado, antigo e REUSADO são recusados", async () => {
    const { u, sessao } = await criarUsuario("codigo");
    const { segredo, passo } = await ativar(sessao);
    const { desafio } = await login({ email: u.email, password: SENHA }, "ua", ip());

    await expect(concluirEntradaComSegundoFator(desafio!, "123456" === codigoDoPasso(segredo, passo + 1) ? "654321" : "123456", "ua", ip())).rejects.toThrow(
      /Código inválido/,
    );
    // Antigo: dois passos atrás, fora da janela.
    await expect(concluirEntradaComSegundoFator(desafio!, codigoDoPasso(segredo, passo - 2), "ua", ip())).rejects.toThrow(
      /Código inválido/,
    );
    // REUSO: o código que a ATIVAÇÃO acabou de consumir continua dentro da janela — e é recusado.
    await expect(concluirEntradaComSegundoFator(desafio!, codigoDoPasso(segredo, passo), "ua", ip())).rejects.toThrow(
      /Código inválido/,
    );
    expect(await sessoesDe(u.id)).toBe(0);

    const ok = await concluirEntradaComSegundoFator(desafio!, codigoDoPasso(segredo, passo + 1), "ua", ip());
    expect(ok.sid).toBeTruthy();
    expect(ok.user.id).toBe(u.id);
    expect(await sessoesDe(u.id)).toBe(1);

    // O mesmo código, de novo (outra aba, alguém que espiou): recusado.
    await expect(concluirEntradaComSegundoFator(desafio!, codigoDoPasso(segredo, passo + 1), "ua", ip())).rejects.toThrow(
      /Código inválido/,
    );
    const log = await prisma.activityLog.findFirst({ where: { userId: u.id, acao: "login" }, orderBy: { createdAt: "desc" } });
    expect(log?.dados).toMatchObject({ segundoFator: "totp" });
  });

  it("dois envios SIMULTÂNEOS do mesmo código: só um vira sessão", async () => {
    const { u, sessao } = await criarUsuario("corrida");
    const { segredo, passo } = await ativar(sessao);
    const { desafio } = await login({ email: u.email, password: SENHA }, "ua", ip());
    const cod = codigoDoPasso(segredo, passo + 1);
    const r = await Promise.allSettled([
      concluirEntradaComSegundoFator(desafio!, cod, "ua", ip()),
      concluirEntradaComSegundoFator(desafio!, cod, "ua", ip()),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await sessoesDe(u.id)).toBe(1);
  });

  it("código de recuperação vale UMA vez (e aceita minúscula/sem hífen)", async () => {
    const { u, sessao } = await criarUsuario("recupera");
    const { codigosRecuperacao } = await ativar(sessao);
    const cod = codigosRecuperacao[3]!;

    const d1 = (await login({ email: u.email, password: SENHA }, "ua", ip())).desafio!;
    const ok = await concluirEntradaComSegundoFator(d1, cod.toLowerCase().replace(/-/g, ""), "ua", ip());
    expect(ok.sid).toBeTruthy();
    expect((await statusSegundoFator(sessao)).codigosRestantes).toBe(9);

    const d2 = (await login({ email: u.email, password: SENHA }, "ua", ip())).desafio!;
    await expect(concluirEntradaComSegundoFator(d2, cod, "ua", ip())).rejects.toThrow(/Código inválido/);
    expect(await prisma.activityLog.count({ where: { userId: u.id, acao: "seguranca.2fa_codigo_recuperacao_usado" } })).toBe(1);
  });

  it("FREIO contra RAJADA: 20 códigos errados SIMULTÂNEOS — no máximo 5 chegam a ser conferidos", async () => {
    const { u, sessao } = await criarUsuario("rajada");
    const { segredo, passo } = await ativar(sessao);
    const { desafio } = await login({ email: u.email, password: SENHA }, "ua", ip());
    const certo = codigoDoPasso(segredo, passo + 1);
    const errado = certo === "111111" ? "222222" : "111111";
    const r = await Promise.allSettled(
      Array.from({ length: 20 }, () => concluirEntradaComSegundoFator(desafio!, errado, "ua", ip())),
    );
    const motivos = r.map((x) => (x.status === "rejected" ? String((x.reason as Error).message) : "ok"));
    expect(motivos.filter((m) => /Código inválido/.test(m)).length).toBeLessThanOrEqual(5);
    expect(motivos.filter((m) => /Muitas tentativas/.test(m)).length).toBeGreaterThanOrEqual(15);
    await expect(concluirEntradaComSegundoFator(desafio!, certo, "ua", ip())).rejects.toThrow(/Muitas tentativas/);
  });

  it("FREIO: 5 erros seguram a 6ª tentativa, mesmo com o código certo", async () => {
    const { u, sessao } = await criarUsuario("freio");
    const { segredo, passo } = await ativar(sessao);
    const { desafio } = await login({ email: u.email, password: SENHA }, "ua", ip());
    const certo = codigoDoPasso(segredo, passo + 1);
    const errado = certo === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) {
      await expect(concluirEntradaComSegundoFator(desafio!, errado, "ua", ip())).rejects.toThrow(/Código inválido/);
    }
    await expect(concluirEntradaComSegundoFator(desafio!, certo, "ua", ip())).rejects.toThrow(/Muitas tentativas/);
    expect(await sessoesDe(u.id)).toBe(0);
  });

  it("desafio adulterado, vencido ou de senha que mudou é recusado", async () => {
    const { u, sessao } = await criarUsuario("desafio");
    const { segredo, passo } = await ativar(sessao);
    const { desafio } = await login({ email: u.email, password: SENHA }, "ua", ip());

    // Adulterado: troca o id da pessoa no corpo.
    const [corpo, assinatura] = desafio!.split(".");
    const outro = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(corpo!, "base64url").toString()), u: "outra-pessoa" }),
    ).toString("base64url");
    expect(lerDesafio(`${outro}.${assinatura}`)).toBeNull();
    await expect(concluirEntradaComSegundoFator(`${outro}.${assinatura}`, codigoDoPasso(segredo, passo + 1))).rejects.toThrow(
      /expirou/,
    );

    // Vencido: 5 minutos e 1 segundo depois.
    expect(lerDesafio(desafio!, Date.now() + 5 * 60 * 1000 + 1000)).toBeNull();
    expect(lerDesafio(emitirDesafio({ id: u.id, senhaTrocadaEm: null }))).not.toBeNull();

    // Senha trocada nos 5 minutos: o desafio antigo morre.
    await changePassword(u.id, SENHA, "OutraSenha#2026");
    await expect(concluirEntradaComSegundoFator(desafio!, codigoDoPasso(segredo, passo + 1), "ua", ip())).rejects.toThrow(
      /expirou/,
    );
  });

  it("conta desativada nos 5 minutos do desafio não entra", async () => {
    const { u, sessao } = await criarUsuario("desativada");
    const { segredo, passo } = await ativar(sessao);
    const { desafio } = await login({ email: u.email, password: SENHA }, "ua", ip());
    await prisma.user.update({ where: { id: u.id }, data: { ativo: false } });
    await expect(concluirEntradaComSegundoFator(desafio!, codigoDoPasso(segredo, passo + 1), "ua", ip())).rejects.toThrow(
      /expirou/,
    );
  });
});

describe("2FA — redefinir e trocar a senha", () => {
  it("REDEFINIR pelo e-mail não pula o 2FA: grava a senha, derruba sessões, e pede o código", async () => {
    const { u, sessao } = await criarUsuario("reset");
    const { segredo, passo } = await ativar(sessao);
    await prisma.session.create({ data: { userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) } });

    const token = await criarToken(u.id, "RESET", 60 * 60 * 1000);
    const r = await redefinirSenha(token, "NovaSenha#2026", "ua", ip());
    expect(r.sid).toBeUndefined();
    expect(typeof r.desafio).toBe("string");
    expect(await sessoesDe(u.id)).toBe(0);
    expect((await statusSegundoFator(sessao)).ativo).toBe(true); // não desliga o 2FA

    // E o login com a senha nova continua pedindo o código.
    const l = await login({ email: u.email, password: "NovaSenha#2026" }, "ua", ip());
    expect(l.desafio).toBeTruthy();
    const ok = await concluirEntradaComSegundoFator(r.desafio!, codigoDoPasso(segredo, passo + 1), "ua", ip());
    expect(ok.sid).toBeTruthy();
  });

  it("TROCAR a senha não desliga o 2FA", async () => {
    const { u, sessao } = await criarUsuario("troca");
    await ativar(sessao);
    await changePassword(u.id, SENHA, "OutraSenha#2026");
    expect((await statusSegundoFator(sessao)).ativo).toBe(true);
    expect((await login({ email: u.email, password: "OutraSenha#2026" }, "ua", ip())).desafio).toBeTruthy();
  });
});

describe("2FA — desativar", () => {
  it("exige a senha E um código; com os dois, desliga e o login volta a ser só senha", async () => {
    const { u, sessao } = await criarUsuario("desliga");
    const { segredo, passo } = await ativar(sessao);

    await expect(desativarSegundoFator(sessao, "senha-errada", codigoDoPasso(segredo, passo + 1), ip())).rejects.toThrow(
      /Senha ou código incorretos/,
    );
    await expect(desativarSegundoFator(sessao, SENHA, "000000" === codigoDoPasso(segredo, passo + 1) ? "999999" : "000000", ip())).rejects.toThrow(
      /Senha ou código incorretos/,
    );
    expect((await statusSegundoFator(sessao)).ativo).toBe(true);

    await desativarSegundoFator(sessao, SENHA, codigoDoPasso(segredo, passo + 1), ip());
    expect((await statusSegundoFator(sessao)).ativo).toBe(false);
    expect(await prisma.codigoRecuperacao.count({ where: { userId: u.id } })).toBe(0);
    expect((await login({ email: u.email, password: SENHA }, "ua", ip())).sid).toBeTruthy();
  });
});

describe("2FA — o freio por pessoa não zera com a senha certa (M1)", () => {
  /**
   * ⚠️ O defeito: `desativar` cobrava a tentativa, e a SENHA CERTA a "devolvia" apagando o
   * contador inteiro da pessoa — depois o código cobrava +1. O contador nunca passava de 1, e o
   * único teto que sobrava era o por IP: com vários IPs, a força bruta do TOTP por conta voltava a
   * ser viável para quem tem a senha e uma sessão aberta. IP diferente a cada chamada, de propósito.
   */
  it("6 desativações seguidas com senha certa e código errado: a 6ª é freada", async () => {
    const { sessao } = await criarUsuario("m1-desativa");
    const { segredo, passo } = await ativar(sessao);
    const certo = codigoDoPasso(segredo, passo + 1);
    const errado = certo === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) {
      await expect(desativarSegundoFator(sessao, SENHA, errado, ip())).rejects.toThrow(/Senha ou código incorretos/);
    }
    await expect(desativarSegundoFator(sessao, SENHA, errado, ip())).rejects.toThrow(/Muitas tentativas/);
    // Nem o código certo passa enquanto o freio está de pé.
    await expect(desativarSegundoFator(sessao, SENHA, certo, ip())).rejects.toThrow(/Muitas tentativas/);
    expect((await statusSegundoFator(sessao)).ativo).toBe(true);
  });

  it("desativar com senha certa NÃO zera os erros da 2ª etapa do login", async () => {
    const { u, sessao } = await criarUsuario("m1-intercala");
    const { segredo, passo } = await ativar(sessao);
    const { desafio } = await login({ email: u.email, password: SENHA }, "ua", ip());
    const certo = codigoDoPasso(segredo, passo + 1);
    const errado = certo === "111111" ? "222222" : "111111";
    // Intercala: login errado, desativar com senha certa e código errado, login errado...
    for (let i = 0; i < 5; i++) {
      const tentativa =
        i % 2 === 0
          ? concluirEntradaComSegundoFator(desafio!, errado, "ua", ip())
          : desativarSegundoFator(sessao, SENHA, errado, ip());
      await expect(tentativa).rejects.toThrow(/inválido|incorretos/);
    }
    await expect(concluirEntradaComSegundoFator(desafio!, certo, "ua", ip())).rejects.toThrow(/Muitas tentativas/);
    await expect(desativarSegundoFator(sessao, SENHA, certo, ip())).rejects.toThrow(/Muitas tentativas/);
    expect(await sessoesDe(u.id)).toBe(0);
  });
});

describe("2FA — código errado deixa rastro e avisa o dono (B1)", () => {
  const avisos = (userId: string) =>
    prisma.notificacao.count({ where: { userId, tipo: "seguranca_2fa_codigo_errado" } });

  it("código errado na 2ª etapa grava o rastro SEM o código e avisa o dono uma vez; o freio também fica registrado", async () => {
    const { u, sessao } = await criarUsuario("b1-login");
    const { segredo, passo } = await ativar(sessao);
    const { desafio } = await login({ email: u.email, password: SENHA }, "ua", ip());
    const errado = codigoDoPasso(segredo, passo + 1) === "111111" ? "222222" : "111111";

    for (let i = 0; i < 5; i++) {
      await expect(concluirEntradaComSegundoFator(desafio!, errado, "ua", ip())).rejects.toThrow(/Código inválido/);
    }
    await expect(concluirEntradaComSegundoFator(desafio!, errado, "ua", ip())).rejects.toThrow(/Muitas tentativas/);
    await expect(concluirEntradaComSegundoFator(desafio!, errado, "ua", ip())).rejects.toThrow(/Muitas tentativas/);

    const errados = await prisma.activityLog.findMany({ where: { userId: u.id, acao: "seguranca.2fa_codigo_errado" } });
    expect(errados).toHaveLength(5);
    expect(JSON.stringify(errados)).not.toContain(errado);
    expect(errados[0]!.dados).toMatchObject({ origem: "login" });
    await vi.waitFor(async () => {
      // Um registro por janela do freio, não um por recusa.
      expect(await prisma.activityLog.count({ where: { userId: u.id, acao: "seguranca.2fa_freio" } })).toBe(1);
    });
    // Sete recusas, UM aviso: o teto é de um por hora.
    expect(await avisos(u.id)).toBe(1);
  });

  it("desativar com a senha certa e o código errado também avisa", async () => {
    const { u, sessao } = await criarUsuario("b1-desativa");
    const { segredo, passo } = await ativar(sessao);
    const errado = codigoDoPasso(segredo, passo + 1) === "111111" ? "222222" : "111111";
    await expect(desativarSegundoFator(sessao, SENHA, errado, ip())).rejects.toThrow(/incorretos/);
    expect(await prisma.activityLog.count({ where: { userId: u.id, acao: "seguranca.2fa_codigo_errado" } })).toBe(1);
    expect(await avisos(u.id)).toBe(1);
    // Senha ERRADA não é o sinal (não prova que a senha vazou): não grava nem avisa de novo.
    await expect(desativarSegundoFator(sessao, "senha-errada", errado, ip())).rejects.toThrow(/incorretos/);
    expect(await prisma.activityLog.count({ where: { userId: u.id, acao: "seguranca.2fa_codigo_errado" } })).toBe(1);
  });
});

describe("2FA — pelo router (o que vai ao navegador)", () => {
  it("login com 2FA NÃO põe cookie; confirmarSegundoFator põe", async () => {
    const { u, sessao } = await criarUsuario("router");
    const { segredo, passo } = await ativar(sessao);
    const cookies: string[] = [];
    const ctx = {
      user: null,
      req: { ip: ip(), headers: {} },
      res: { setCookie: (nome: string) => cookies.push(nome) },
    };
    const caller = appRouter.createCaller(ctx as never);
    const r = await caller.auth.login({ email: u.email, password: SENHA });
    expect(r.segundoFator).toBe(true);
    expect(cookies).toHaveLength(0);
    if (!r.segundoFator) throw new Error("esperava desafio");
    const user = await caller.auth.confirmarSegundoFator({ desafio: r.desafio, codigo: codigoDoPasso(segredo, passo + 1) });
    expect(user.id).toBe(u.id);
    expect(cookies).toEqual(["sid"]);
  });

  it("login SEM 2FA continua igual: põe o cookie e devolve o usuário", async () => {
    const { u } = await criarUsuario("router-sem", "FUNCIONARIO");
    const cookies: string[] = [];
    const caller = appRouter.createCaller({
      user: null,
      req: { ip: ip(), headers: {} },
      res: { setCookie: (nome: string) => cookies.push(nome) },
    } as never);
    const r = await caller.auth.login({ email: u.email, password: SENHA });
    expect(r).toMatchObject({ segundoFator: false, user: { id: u.id } });
    expect(cookies).toEqual(["sid"]);
  });
});
