import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * O histórico de e-mails (`EmailEnviado`) guardava o corpo em texto puro — e o corpo dos e-mails
 * transacionais traz o LINK COM TOKEN (redefinir senha, convite, boas-vindas do Portal). Como a
 * ficha do cliente mostra esse corpo para qualquer funcionário, e como o e-mail do cliente é
 * gravável por qualquer funcionário, dava uma cadeia de tomada de conta:
 *
 *   pôr `root@medconsultoria.com.br` no cadastro de um cliente → pedir "esqueci minha senha" na
 *   tela pública → abrir a ficha → ler o link → redefinir a senha do ROOT.
 *
 * Duas camadas fecham isso e as duas têm teste aqui:
 *   1. o segredo não é GRAVADO (`redigirSegredos` antes do `create`);
 *   2. o corpo não é DEVOLVIDO para a ficha (`listPorCliente`/`listPorLead` sem `corpo`).
 */

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  clienteFindFirst: vi.fn(),
  leadFindFirst: vi.fn(),
  clienteFindUnique: vi.fn(),
  leadFindUnique: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
  enviarEmail: vi.fn(),
  renderTemplate: vi.fn(),
  ehDaCasa: vi.fn(),
}));

vi.mock("@app/db", () => ({
  prisma: {
    user: { findFirst: mocks.userFindFirst },
    cliente: { findFirst: mocks.clienteFindFirst, findUnique: mocks.clienteFindUnique },
    lead: { findFirst: mocks.leadFindFirst, findUnique: mocks.leadFindUnique },
    emailEnviado: { create: mocks.create, findMany: mocks.findMany },
  },
}));

vi.mock("../../lib/email.js", () => ({ enviarEmail: mocks.enviarEmail }));
vi.mock("./emails.service.js", () => ({ renderTemplate: mocks.renderTemplate }));
vi.mock("../email/casa.js", () => ({ ehDaCasa: mocks.ehDaCasa }));

const { redigirSegredos, registrarEmailEnviado, enviarEmailTemplate, listPorCliente, listPorLead } =
  await import("./enviados.service.js");
const { montarEmail } = await import("../../lib/email-template.js");

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.userFindFirst.mockResolvedValue(null);
  mocks.clienteFindFirst.mockResolvedValue(null);
  mocks.leadFindFirst.mockResolvedValue(null);
  mocks.clienteFindUnique.mockResolvedValue({ email: "cliente@exemplo.com" });
  mocks.leadFindUnique.mockResolvedValue({ email: "lead@exemplo.com" });
  mocks.create.mockResolvedValue({});
  mocks.findMany.mockResolvedValue([]);
  mocks.enviarEmail.mockResolvedValue({ enviado: true });
  mocks.ehDaCasa.mockResolvedValue(false);
});

// ── Camada 1: o segredo não é gravado ─────────────────────────────────────────────────────

describe("redigirSegredos", () => {
  it("apaga o token do primeiro parâmetro (?token=)", () => {
    expect(redigirSegredos("Abra https://app.exemplo.com/redefinir-senha?token=abc123")).toBe(
      "Abra https://app.exemplo.com/redefinir-senha?token=[removido]",
    );
  });

  it("apaga o token quando ele vem depois de & (e preserva o resto da URL)", () => {
    expect(redigirSegredos("https://app.exemplo.com/x?a=1&token=abc123&b=2")).toBe(
      "https://app.exemplo.com/x?a=1&token=[removido]&b=2",
    );
  });

  it("apaga o token que termina a string", () => {
    expect(redigirSegredos("link: /convite?token=ZmFrZS10b2tlbg")).toBe("link: /convite?token=[removido]");
  });

  it("apaga TODOS os tokens do texto, não só o primeiro", () => {
    const texto = "um /a?token=um\ndois /b?token=dois";
    expect(redigirSegredos(texto)).toBe("um /a?token=[removido]\ndois /b?token=[removido]");
  });

  it("apaga os equivalentes: code, secret e key", () => {
    expect(redigirSegredos("/a?code=1 /b?secret=2 /c?key=3")).toBe(
      "/a?code=[removido] /b?secret=[removido] /c?key=[removido]",
    );
  });

  /**
   * Nem todo segredo mora numa query string: `/assinar/{token}` e `/proposta/{token}` levam o
   * token NO CAMINHO, e quem tem o link assina o contrato ou aceita a proposta no lugar do
   * cliente. São as duas únicas rotas assim (`grep 'WEB_ORIGIN}/'` na API).
   */
  it("apaga o token que vem no CAMINHO de /assinar e /proposta", () => {
    expect(redigirSegredos("Assine em https://app.exemplo.com/assinar/AbC-123_x")).toBe(
      "Assine em https://app.exemplo.com/assinar/[removido]",
    );
    expect(redigirSegredos("https://app.exemplo.com/proposta/AbC-123_x")).toBe(
      "https://app.exemplo.com/proposta/[removido]",
    );
  });

  it("não confunde outra rota que comece igual", () => {
    const texto = "https://app.exemplo.com/propostas-do-mes e /assinaturas";
    expect(redigirSegredos(texto)).toBe(texto);
  });

  it("texto sem token nenhum fica intacto", () => {
    const texto = "Olá, Thaís.\nSua reunião é amanhã às 10h. https://app.exemplo.com/agenda?dia=2026-08-05";
    expect(redigirSegredos(texto)).toBe(texto);
  });
});

describe("registrarEmailEnviado", () => {
  it("grava o corpo JÁ redigido — o token nunca chega ao banco", async () => {
    await registrarEmailEnviado(
      "root@medconsultoria.com.br",
      "Redefinir senha",
      "Use https://app.exemplo.com/redefinir-senha?token=SEGREDO-DO-ROOT",
      "senha_reset",
      true,
    );
    const gravado = mocks.create.mock.calls[0]![0].data.corpo as string;
    expect(gravado).not.toContain("SEGREDO-DO-ROOT");
    expect(gravado).toContain("token=[removido]");
  });

  it("REGRESSÃO: e-mail montado com CTA de verdade não deixa o token no banco", async () => {
    // O texto exato que `montarEmail` produz — é ele que vai para `EmailEnviado.corpo`.
    const { texto } = montarEmail({
      preheader: "Redefinir senha",
      titulo: "Redefinir sua senha",
      paragrafos: ["Você pediu para redefinir a senha."],
      cta: { texto: "Redefinir senha", url: "https://app.exemplo.com/redefinir-senha?token=SEGREDO-DO-ROOT" },
    });
    expect(texto).toContain("SEGREDO-DO-ROOT"); // o e-mail REAL leva o token — é o log que não pode
    mocks.renderTemplate.mockResolvedValue({ assunto: "Redefinir sua senha", html: "<p>x</p>", texto });

    await enviarEmailTemplate("senha_reset", "root@medconsultoria.com.br", {});

    const gravado = mocks.create.mock.calls[0]![0].data.corpo as string;
    expect(gravado).not.toContain("SEGREDO-DO-ROOT");
    // E o e-mail de verdade continuou saindo com o link inteiro.
    expect(mocks.enviarEmail.mock.calls[0]![0].texto).toContain("SEGREDO-DO-ROOT");
  });
});

// ── Camada 2: o corpo não é devolvido para a ficha ────────────────────────────────────────

describe("a ficha do cliente/lead não recebe o corpo do e-mail", () => {
  it("listPorCliente não PEDE nem DEVOLVE corpo", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "e-1",
        para: "cliente@exemplo.com",
        assunto: "Boas-vindas",
        template: "cliente_boas_vindas",
        status: "ENVIADO",
        erro: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
      },
    ]);

    const r = await listPorCliente("cli-1");
    expect(mocks.findMany.mock.calls[0]![0].select.corpo).toBeUndefined();
    expect(r[0]).not.toHaveProperty("corpo");
    // O resto do card continua de pé.
    expect(r[0]!.assunto).toBe("Boas-vindas");
  });

  it("listPorLead não PEDE corpo", async () => {
    await listPorLead("lead-1");
    expect(mocks.findMany.mock.calls[0]![0].select.corpo).toBeUndefined();
  });
});

/**
 * A outra metade da mesma falha: aqui o JOIN é por `EmailEnviado.para`, e o `para` vem do CADASTRO
 * — gravável por qualquer funcionário e, no Portal, pelo próprio cliente. Sem a trava, um cliente
 * de fora da empresa punha `root@medconsultoria.com.br` no perfil e listava, pelo Portal, os
 * transacionais mandados ao ROOT (assunto, tipo, data, falha). Ver `casa.ts`.
 */
describe("endereço da casa não vira chave do histórico automático", () => {
  it("cadastro com endereço da casa cai para o vínculo gravado pelo servidor (clienteId)", async () => {
    mocks.clienteFindUnique.mockResolvedValue({ email: "root@medconsultoria.com.br" });
    mocks.ehDaCasa.mockResolvedValue(true);

    await listPorCliente("cli-1");

    expect(mocks.findMany.mock.calls[0]![0].where).toEqual({ clienteId: "cli-1" });
  });

  it("lead com endereço da casa idem", async () => {
    mocks.leadFindUnique.mockResolvedValue({ email: "comercial@medconsultoria.com.br" });
    mocks.ehDaCasa.mockResolvedValue(true);

    await listPorLead("lead-1");

    expect(mocks.findMany.mock.calls[0]![0].where).toEqual({ leadId: "lead-1" });
  });

  it("cliente de verdade continua casando também pelo e-mail (quem trocou de endereço não perde o histórico)", async () => {
    await listPorCliente("cli-1");

    expect(mocks.findMany.mock.calls[0]![0].where).toEqual({
      OR: [{ clienteId: "cli-1" }, { para: "cliente@exemplo.com" }],
    });
  });
});
