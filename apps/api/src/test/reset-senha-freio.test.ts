import { describe, it, expect, beforeEach } from "vitest";
import { podeEnviarReset, _limparFreioReset } from "../modules/auth/auth.service";

/**
 * O "esqueci minha senha" é anônimo e dispara e-mail real. Sem freio, qualquer pessoa
 * bombardeia a caixa de um funcionário e queima a reputação do nosso SMTP — o mesmo que
 * manda proposta e contrato para cliente.
 */
describe("freio do pedido de redefinição de senha", () => {
  beforeEach(() => _limparFreioReset());

  it("deixa passar os 3 primeiros pedidos da mesma caixa", () => {
    expect(podeEnviarReset("alvo@medconsultoria.com.br")).toBe(true);
    expect(podeEnviarReset("alvo@medconsultoria.com.br")).toBe(true);
    expect(podeEnviarReset("alvo@medconsultoria.com.br")).toBe(true);
  });

  it("segura do 4º em diante dentro da mesma hora", () => {
    for (let i = 0; i < 3; i++) podeEnviarReset("alvo@medconsultoria.com.br");
    expect(podeEnviarReset("alvo@medconsultoria.com.br")).toBe(false);
    expect(podeEnviarReset("alvo@medconsultoria.com.br")).toBe(false);
  });

  it("conta por CAIXA, não por quem pede — outra caixa não é afetada", () => {
    for (let i = 0; i < 5; i++) podeEnviarReset("alvo@medconsultoria.com.br");
    expect(podeEnviarReset("outra@medconsultoria.com.br")).toBe(true);
  });

  it("ignora diferença de caixa alta e espaço em volta (senão o teto é contornável)", () => {
    podeEnviarReset("Alvo@Medconsultoria.com.br");
    podeEnviarReset("  alvo@medconsultoria.com.br  ");
    podeEnviarReset("ALVO@MEDCONSULTORIA.COM.BR");
    expect(podeEnviarReset("alvo@medconsultoria.com.br")).toBe(false);
  });

  it("libera de novo depois que a janela de 1 hora passa", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) podeEnviarReset("alvo@medconsultoria.com.br", t0);
    expect(podeEnviarReset("alvo@medconsultoria.com.br", t0 + 61 * 60 * 1000)).toBe(true);
  });
});
