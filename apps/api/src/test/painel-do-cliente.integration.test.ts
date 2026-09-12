import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { hashPassword } from "../lib/password.js";
import { createSession, getUserFromSession } from "../lib/session.js";
import { abrirPainelDoCliente, voltarDoPainel } from "../modules/auth/painel-cliente.service.js";
import { acessoAoPortal } from "../lib/acesso-portal.js";
import { garantirAcessoPortal } from "../modules/usuarios/usuarios.service.js";

/**
 * O PAINEL DO CLIENTE visto pela equipe — a sessão de suporte (ADR-128).
 *
 * Roda contra o MySQL de VERDADE porque o que se prova aqui é comportamento de SESSÃO, e sessão
 * é linha em tabela: quem é o dono, quem entrou, quando expira, e o que acontece com o cookie
 * quando a pessoa volta. Tipo verde não diz nada sobre nenhuma dessas quatro coisas.
 *
 * O que estes testes guardam, e não pode regredir:
 *  1. a sessão pertence ao CLIENTE e guarda QUEM DA EQUIPE entrou — sem isso o histórico culpa
 *     o cliente por tudo o que a equipe fizer lá dentro;
 *  2. o acesso fica REGISTRADO (é dado pessoal de terceiro);
 *  3. quem não pode, não entra: funcionário só nos clientes sob a responsabilidade dele;
 *  4. cliente sem conta ativa não tem painel a abrir;
 *  5. não aninha: quem está em suporte volta antes de entrar em outro painel;
 *  6. voltar devolve a sessão ORIGINAL do operador, sem novo login;
 *  7. a marca do operador chega preenchida do banco — é dela que o portão do Portal se defende.
 */

const PFX = `pnl-${randomBytes(4).toString("hex")}`;
let adminId: string;
let funcionarioId: string;
let clienteId: string;
let clienteDeOutroId: string;
let portalUserId: string;

const sessoes: string[] = [];

async function sessionUser(sid: string) {
  const u = await getUserFromSession(sid);
  if (!u) throw new Error("sessão inválida");
  return u;
}

beforeAll(async () => {
  expect(process.env["DATABASE_URL"]).toContain("_test");
  const senha = await hashPassword("x");

  const [admin, funcionario] = await Promise.all([
    prisma.user.create({ data: { nome: `${PFX}-admin`, email: `${PFX}-a@example.test`, passwordHash: senha, role: "ADMIN" } }),
    prisma.user.create({ data: { nome: `${PFX}-func`, email: `${PFX}-f@example.test`, passwordHash: senha, role: "FUNCIONARIO" } }),
  ]);
  adminId = admin.id;
  funcionarioId = funcionario.id;

  // Um cliente do ADMIN e outro sob responsabilidade do FUNCIONÁRIO — é o par que prova a regra
  // de "só os seus" sem depender de nenhuma outra.
  const [c1, c2] = await Promise.all([
    prisma.cliente.create({ data: { nome: `${PFX}-clinica`, email: `${PFX}-c1@example.test`, responsavelId: adminId } }),
    prisma.cliente.create({ data: { nome: `${PFX}-outra`, email: `${PFX}-c2@example.test`, responsavelId: adminId } }),
  ]);
  clienteId = c1.id;
  clienteDeOutroId = c2.id;

  await garantirAcessoPortal(clienteId, c1.nome, c1.email, "EQUIPE");
  const conta = await prisma.user.findFirstOrThrow({ where: { clienteId, role: "CLIENTE" } });
  portalUserId = conta.id;
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { OR: [{ id: { in: sessoes } }, { userId: portalUserId }] } });
  await prisma.activityLog.deleteMany({ where: { userId: { in: [adminId, funcionarioId] } } });
  await prisma.user.deleteMany({ where: { id: portalUserId } });
  await prisma.cliente.deleteMany({ where: { id: { in: [clienteId, clienteDeOutroId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, funcionarioId] } } });
});

describe("os três estados do acesso ao Portal", () => {
  it("conta recém-criada pela equipe está CONVIDADA, não ativa — e o e-mail não saiu", async () => {
    const conta = await prisma.user.findFirstOrThrow({
      where: { id: portalUserId },
      select: { ativo: true, passwordHash: true, createdAt: true, ultimoAcessoEm: true },
    });
    // Cadastro pela EQUIPE não manda convite (ADR-128): a conta nasce pendente e em silêncio.
    expect(conta.passwordHash).toBeNull();
    expect(acessoAoPortal([conta]).estado).toBe("CONVIDADO");
    expect(acessoAoPortal([conta]).ultimoAcessoEm).toBeNull();
  });

  it("sem conta nenhuma, o estado é SEM_ACESSO", () => {
    expect(acessoAoPortal([]).estado).toBe("SEM_ACESSO");
    expect(acessoAoPortal(null).estado).toBe("SEM_ACESSO");
    expect(acessoAoPortal(undefined).convidadoEm).toBeNull();
  });

  it("com senha definida e conta ativa, o estado é ATIVO", () => {
    const agora = new Date();
    const conta = { ativo: true, passwordHash: "hash", createdAt: agora, ultimoAcessoEm: agora };
    expect(acessoAoPortal([conta]).estado).toBe("ATIVO");
    expect(acessoAoPortal([conta]).ultimoAcessoEm).toEqual(agora);
  });

  it("com DUAS contas, manda a que abre a porta — o defeito achado na tela", () => {
    // Caso real do banco local em 26/08/2026: a "Clínica teste" tinha uma conta pendente ANTIGA
    // e uma ativa mais nova. Escolhendo "a primeira por data", a ficha mostrava "Enviar acesso"
    // para um cliente que entrava no Portal normalmente.
    const velha = { ativo: false, passwordHash: null, createdAt: new Date("2026-01-01"), ultimoAcessoEm: null };
    const nova = { ativo: true, passwordHash: "hash", createdAt: new Date("2026-08-01"), ultimoAcessoEm: new Date("2026-08-20") };
    expect(acessoAoPortal([velha, nova]).estado).toBe("ATIVO");
    expect(acessoAoPortal([nova, velha]).estado).toBe("ATIVO");
    expect(acessoAoPortal([velha, nova]).ultimoAcessoEm).toEqual(new Date("2026-08-20"));
  });

  it("sem nenhuma ativa, a régua do 'convidado há N dias' é a conta MAIS ANTIGA", () => {
    // Reenviar o convite não zera a espera do cliente: quem manda é quando ele foi chamado da
    // primeira vez, senão o card diria "convidado hoje" para quem espera há dois meses.
    const velha = { ativo: false, passwordHash: null, createdAt: new Date("2026-06-01"), ultimoAcessoEm: null };
    const nova = { ativo: false, passwordHash: null, createdAt: new Date("2026-08-01"), ultimoAcessoEm: null };
    expect(acessoAoPortal([nova, velha]).convidadoEm).toEqual(new Date("2026-06-01"));
  });
});

describe("abrir o painel do cliente", () => {
  it("cliente que ainda não definiu a senha NÃO tem painel a abrir", async () => {
    const sid = await createSession(adminId);
    sessoes.push(sid);
    await expect(abrirPainelDoCliente(clienteId, await sessionUser(sid), sid)).rejects.toThrow(/ainda não definiu a senha/i);
  });

  it("cliente SEM conta de Portal manda enviar o acesso primeiro", async () => {
    const sid = await createSession(adminId);
    sessoes.push(sid);
    await expect(abrirPainelDoCliente(clienteDeOutroId, await sessionUser(sid), sid)).rejects.toThrow(/não tem acesso ao Portal/i);
  });

  it("com a conta ativa, a sessão nasce do CLIENTE e guarda quem da equipe entrou", async () => {
    await prisma.user.update({ where: { id: portalUserId }, data: { ativo: true, passwordHash: "hash", senhaTrocadaEm: new Date() } });

    const doAdmin = await createSession(adminId);
    sessoes.push(doAdmin);
    const { sid, cliente } = await abrirPainelDoCliente(clienteId, await sessionUser(doAdmin), doAdmin);
    sessoes.push(sid);
    expect(cliente).toContain("clinica");

    const suporte = await sessionUser(sid);
    // O DONO da sessão é o cliente — é isso que faz o isolamento do Portal continuar valendo.
    expect(suporte.id).toBe(portalUserId);
    expect(suporte.role).toBe("CLIENTE");
    expect(suporte.clienteId).toBe(clienteId);
    // E o operador está marcado: o histórico sabe quem realmente agiu.
    expect(suporte.operador?.id).toBe(adminId);
    expect(suporte.voltarParaSessionId).toBe(doAdmin);
  });

  it("dura 30 minutos, não 30 dias — aba esquecida não vira acesso permanente", async () => {
    const doAdmin = await createSession(adminId);
    sessoes.push(doAdmin);
    const { sid } = await abrirPainelDoCliente(clienteId, await sessionUser(doAdmin), doAdmin);
    sessoes.push(sid);
    const linha = await prisma.session.findUniqueOrThrow({ where: { id: sid }, select: { expiresAt: true } });
    const minutos = (linha.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(25);
    expect(minutos).toBeLessThan(35);
  });

  it("o acesso fica REGISTRADO — é dado pessoal de terceiro", async () => {
    const registros = await prisma.activityLog.count({
      where: { userId: adminId, acao: "painel_cliente.entrou", entidadeId: clienteId },
    });
    expect(registros).toBeGreaterThan(0);
  });

  it("funcionário NÃO entra no painel de cliente que não é dele", async () => {
    const doFunc = await createSession(funcionarioId);
    sessoes.push(doFunc);
    await expect(abrirPainelDoCliente(clienteId, await sessionUser(doFunc), doFunc)).rejects.toThrow(
      /sob a sua responsabilidade/i,
    );
  });

  it("funcionário entra no painel do cliente sob a responsabilidade dele", async () => {
    await prisma.cliente.update({ where: { id: clienteId }, data: { responsavelId: funcionarioId } });
    const doFunc = await createSession(funcionarioId);
    sessoes.push(doFunc);
    const { sid } = await abrirPainelDoCliente(clienteId, await sessionUser(doFunc), doFunc);
    sessoes.push(sid);
    expect((await sessionUser(sid)).operador?.id).toBe(funcionarioId);
    await prisma.cliente.update({ where: { id: clienteId }, data: { responsavelId: adminId } });
  });

  it("NÃO aninha: quem está em suporte volta antes de abrir outro painel", async () => {
    const doAdmin = await createSession(adminId);
    sessoes.push(doAdmin);
    const { sid } = await abrirPainelDoCliente(clienteId, await sessionUser(doAdmin), doAdmin);
    sessoes.push(sid);
    await expect(abrirPainelDoCliente(clienteId, await sessionUser(sid), sid)).rejects.toThrow(/Volte ao seu acesso/i);
  });
});

describe("voltar do painel", () => {
  it("devolve a sessão ORIGINAL do operador e encerra a de suporte", async () => {
    const doAdmin = await createSession(adminId);
    sessoes.push(doAdmin);
    const { sid } = await abrirPainelDoCliente(clienteId, await sessionUser(doAdmin), doAdmin);
    sessoes.push(sid);

    const { sid: volta } = await voltarDoPainel(await sessionUser(sid), sid);
    expect(volta).toBe(doAdmin);
    // A de suporte morreu; a original continua valendo, sem novo login.
    expect(await getUserFromSession(sid)).toBeNull();
    expect((await sessionUser(doAdmin)).id).toBe(adminId);
  });

  it("com a sessão original já expirada, devolve null — a tela manda para o login", async () => {
    const doAdmin = await createSession(adminId);
    const { sid } = await abrirPainelDoCliente(clienteId, await sessionUser(doAdmin), doAdmin);
    sessoes.push(sid);
    await prisma.session.delete({ where: { id: doAdmin } });
    const { sid: volta } = await voltarDoPainel(await sessionUser(sid), sid);
    expect(volta).toBeNull();
  });

  it("sessão normal não tem de onde voltar", async () => {
    const doAdmin = await createSession(adminId);
    sessoes.push(doAdmin);
    await expect(voltarDoPainel(await sessionUser(doAdmin), doAdmin)).rejects.toThrow(/não está em uma sessão de suporte/i);
  });
});

describe("vê tudo, não assina nada", () => {
  it("a sessão de suporte é reconhecível — é dela que o portão do Portal se defende", async () => {
    const doAdmin = await createSession(adminId);
    sessoes.push(doAdmin);
    const { sid } = await abrirPainelDoCliente(clienteId, await sessionUser(doAdmin), doAdmin);
    sessoes.push(sid);

    // O `portalProcedure` barra toda MUTAÇÃO quando `operador` está preenchido; aqui provamos a
    // parte que o middleware não pode provar sozinho — que o campo chega preenchido de verdade,
    // vindo do banco, e vazio numa sessão normal do próprio cliente.
    expect((await sessionUser(sid)).operador?.nome).toContain("admin");
    await prisma.session.update({ where: { id: sid }, data: { operadorId: null } });
    expect((await sessionUser(sid)).operador).toBeNull();
  });
});
