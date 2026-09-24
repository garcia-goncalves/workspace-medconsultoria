import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import {
  ativarServicoCliente,
  cancelarServicoCliente,
  sincronizarServicosContratados,
} from "../modules/servicos/servicos-cliente.service.js";
import { hashPassword } from "../lib/password.js";

/**
 * A PROVISÃO/O ENCERRAMENTO DA CONTA CONTINUAM BEST-EFFORT — MAS NUNCA MAIS EM SILÊNCIO.
 *
 * `catch { /* provisão financeira é best-effort — não bloqueia a contratação *\/ }` engolia o
 * erro por inteiro: o serviço ficava contratado (ou cancelado), a conta simplesmente não nascia
 * (ou não parava de ser gerada), e nem a tela nem o painel de erros do ROOT diziam uma palavra.
 * "Vendi e não lancei no Financeiro" — ou pior, "cancelei e a mensalidade continuou saindo" — só
 * apareceria meses depois, se alguém cruzasse a ficha com as contas.
 *
 * Hoje a contratação/o cancelamento continuam NÃO caindo por causa disto (best-effort é
 * intencional), mas: (1) o erro vai para `ErrorLog`, onde `SISTEMA → Erros` lê; (2) o retorno
 * traz `avisoFinanceiro`, que a tela mostra na hora. ⚠️ **Vistos reprovando antes da correção**:
 * com o `catch` vazio original, `avisoFinanceiro` não existia e nenhuma linha nascia em
 * `ErrorLog` — as sabotagens abaixo (forçar `prisma.conta.*` a falhar) já existiam como cenário
 * possível; o que faltava era a régua que prova que a falha NÃO é mais silenciosa.
 */

const PFX = `provisao-falha-${randomBytes(4).toString("hex")}`;
let ator: { id: string };
let clienteId: string;

beforeAll(async () => {
  const url = process.env["DATABASE_URL"] ?? "";
  expect(url).toContain("_test");

  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  ator = { id: u.id };

  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica`, situacaoComercial: "ATIVO" } })).id;
});

afterAll(async () => {
  await prisma.conta.deleteMany({ where: { clienteId } });
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.activityLog.deleteMany({ where: { entidadeId: clienteId } });
  await prisma.errorLog.deleteMany({ where: { rota: { startsWith: "servicosCliente." } } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.servico.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

// Salvar/repor à mão — `vi.spyOn(...).mockRestore()` NÃO devolve o delegate do Prisma ao estado
// original (visto quebrando testes seguintes numa rodada anterior desta casa).
function sabotarContaCreate() {
  const original = prisma.conta.create;
  (prisma.conta as { create: unknown }).create = () => Promise.reject(new Error("Can't reach database server"));
  return () => {
    (prisma.conta as { create: unknown }).create = original;
  };
}
function sabotarContaFindMany() {
  const original = prisma.conta.findMany;
  (prisma.conta as { findMany: unknown }).findMany = () => Promise.reject(new Error("Can't reach database server"));
  return () => {
    (prisma.conta as { findMany: unknown }).findMany = original;
  };
}

describe("ativarServicoCliente — provisão que tropeça avisa, não some", () => {
  it("conta.create falhando: contratação continua, avisoFinanceiro vem preenchido e ErrorLog recebe a ocorrência", async () => {
    const servico = await prisma.servico.create({
      data: { nome: `${PFX}-ativar`, categoria: "GESTAO", valor: 1000, ordem: 990 },
    });
    const restaurar = sabotarContaCreate();
    try {
      const r = await ativarServicoCliente(clienteId, servico.id, { valor: 1000 }, ator);
      expect(r.status, "a contratação em si não pode cair por causa do Financeiro").toBe("ATIVO");
      expect(r.avisoFinanceiro).toMatch(/conta a receber não foi lançada/);
    } finally {
      restaurar();
    }

    const conta = await prisma.conta.findFirst({ where: { clienteId, origemServicoId: servico.id } });
    expect(conta, "de fato não deveria ter sido criada nesta tentativa").toBeNull();

    const erro = await prisma.errorLog.findFirst({ where: { rota: "servicosCliente.ativarServicoCliente" } });
    expect(erro, "a falha tem de aparecer onde SISTEMA → Erros lê").not.toBeNull();
    expect(erro!.mensagem).toContain(servico.id);
  });

  it("sem sabotagem: avisoFinanceiro vem nulo e a conta nasce normalmente", async () => {
    const servico = await prisma.servico.create({
      data: { nome: `${PFX}-ativar-ok`, categoria: "GESTAO", valor: 700, ordem: 991 },
    });
    const r = await ativarServicoCliente(clienteId, servico.id, { valor: 700 }, ator);
    expect(r.avisoFinanceiro).toBeNull();
    const conta = await prisma.conta.findFirst({ where: { clienteId, origemServicoId: servico.id } });
    expect(conta).not.toBeNull();
  });
});

describe("cancelarServicoCliente — encerrar a cobrança que tropeça avisa, não some", () => {
  it("conta.findMany falhando: cancelamento continua, avisoFinanceiro vem preenchido e ErrorLog recebe a ocorrência", async () => {
    const servico = await prisma.servico.create({
      data: { nome: `${PFX}-cancelar`, categoria: "GESTAO", valor: 800, valorRecorrencia: "MENSAL", ordem: 992 },
    });
    await ativarServicoCliente(clienteId, servico.id, { valor: 800 }, ator);

    const restaurar = sabotarContaFindMany();
    try {
      const r = await cancelarServicoCliente(clienteId, servico.id, "EQUIPE", undefined, ator.id);
      expect(r.status, "o cancelamento em si não pode cair por causa do Financeiro").toBe("CANCELADO");
      expect(r.avisoFinanceiro).toMatch(/cobranças futuras falhou/);
    } finally {
      restaurar();
    }

    const erro = await prisma.errorLog.findFirst({ where: { rota: "servicosCliente.cancelarServicoCliente" } });
    expect(erro, "a falha tem de aparecer onde SISTEMA → Erros lê").not.toBeNull();
    expect(erro!.mensagem).toContain(servico.id);
  });
});

describe("provisionarUpsellAceito (via sincronizarServicosContratados) — mesma régua", () => {
  it("conta.create falhando: a sincronização não lança, mas registra o erro", async () => {
    const servico = await prisma.servico.create({
      data: { nome: `${PFX}-upsell`, categoria: "GESTAO", valor: 900, ordem: 993 },
    });
    // Cliente sem lead ativo: `aConversaoAindaVaiCobrar` é falso e o upsell tenta provisionar.
    const restaurar = sabotarContaCreate();
    try {
      await expect(
        sincronizarServicosContratados(clienteId, [{ servicoId: servico.id, valor: 900, recorrencia: "AVULSO" }], ator),
      ).resolves.toBeUndefined();
    } finally {
      restaurar();
    }

    const erro = await prisma.errorLog.findFirst({ where: { rota: "servicosCliente.provisionarUpsellAceito" } });
    expect(erro, "a falha tem de aparecer onde SISTEMA → Erros lê, não só como comentário que promete e não cumpre").not.toBeNull();
    expect(erro!.mensagem).toContain(clienteId);
  });
});
