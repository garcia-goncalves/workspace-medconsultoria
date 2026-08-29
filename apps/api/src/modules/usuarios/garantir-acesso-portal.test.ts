import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * M11 — `garantirAcessoPortal` respondia `jaTinhaAcesso: true` também quando o e-mail
 * pertencia a OUTRA clínica (ou a conta interna). Efeito real: o convite não saía e a
 * chamadora tratava como "já tem acesso, nada a fazer" — a Thaís nunca descobria que o
 * motivo era outro cadastro dono daquele e-mail. Este teste trava a distinção.
 */

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  userCreate: vi.fn(),
}));

vi.mock("@app/db", () => ({
  prisma: {
    user: { findFirst: mocks.userFindFirst, create: mocks.userCreate },
  },
}));

const { garantirAcessoPortal } = await import("./usuarios.service.js");

beforeEach(() => {
  mocks.userFindFirst.mockReset();
  mocks.userCreate.mockReset();
});

describe("garantirAcessoPortal — distinguir os dois motivos de não criar acesso", () => {
  it("cliente sem e-mail: nada a fazer, e nenhum dos dois motivos é marcado", async () => {
    const r = await garantirAcessoPortal("cliente-1", "Clínica A", null, "EQUIPE");
    expect(r).toEqual({
      criou: false,
      jaTinhaAcesso: false,
      emailEmUsoPorOutraConta: false,
      emailEnviado: false,
      conviteUrl: null,
    });
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });

  it("ESTE cliente já tem conta de Portal: jaTinhaAcesso=true, e NÃO é a outra trava", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({ id: "u-1" }); // doCliente encontra
    const r = await garantirAcessoPortal("cliente-1", "Clínica A", "contato@clinica-a.com", "EQUIPE");
    expect(r.jaTinhaAcesso).toBe(true);
    expect(r.emailEmUsoPorOutraConta).toBe(false);
    expect(r.criou).toBe(false);
  });

  it("o e-mail já é usado por OUTRA clínica: emailEmUsoPorOutraConta=true, e NÃO 'jaTinhaAcesso'", async () => {
    mocks.userFindFirst
      .mockResolvedValueOnce(null) // doCliente: este cliente não tem conta
      .mockResolvedValueOnce({ id: "u-2", clienteId: "cliente-OUTRA" }); // doEmail: é de outra clínica
    const r = await garantirAcessoPortal("cliente-1", "Clínica A", "compartilhado@x.com", "EQUIPE");
    expect(r.emailEmUsoPorOutraConta).toBe(true);
    expect(r.jaTinhaAcesso).toBe(false);
    expect(r.criou).toBe(false);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("o e-mail é de uma conta INTERNA (sem clienteId): também é emailEmUsoPorOutraConta, não jaTinhaAcesso", async () => {
    mocks.userFindFirst
      .mockResolvedValueOnce(null) // doCliente
      .mockResolvedValueOnce({ id: "u-3", clienteId: null }); // doEmail: conta interna (ADMIN/FUNCIONARIO)
    const r = await garantirAcessoPortal("cliente-1", "Clínica A", "thais@medconsultoria.com.br", "EQUIPE");
    expect(r.emailEmUsoPorOutraConta).toBe(true);
    expect(r.jaTinhaAcesso).toBe(false);
  });
});
