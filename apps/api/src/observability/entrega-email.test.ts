import { describe, it, expect } from "vitest";
import { falhasSeguidas, LIMITE_MESMO_DESTINATARIO } from "./entrega-email.js";

/**
 * O caso que esta regra existe para pegar é real e custou semanas: em agosto de 2026,
 * 100% dos e-mails de produção falhavam no certificado do SMTP e NADA avisou.
 */
describe("falhas seguidas de e-mail", () => {
  const para = (...enderecos: string[]) => enderecos.map((p) => ({ para: p }));

  it("sem falha depois do último sucesso devolve zero — é o que resolve o incidente", () => {
    expect(falhasSeguidas([])).toBe(0);
  });

  it("o caso da ADR-122: muitas falhas, vários destinatários, nenhum sucesso", () => {
    const enxurrada = Array.from({ length: 25 }, (_, i) => ({ para: `pessoa${i}@exemplo.com` }));
    expect(falhasSeguidas(enxurrada)).toBe(25);
  });

  it("três falhas em destinatários diferentes já é sintoma de transporte", () => {
    expect(falhasSeguidas(para("a@x.com", "b@y.com", "c@z.com"))).toBe(3);
  });

  it("conta abaixo do limiar é avaliada, não escondida — quem decide disparar é o motor", () => {
    expect(falhasSeguidas(para("a@x.com", "b@y.com"))).toBe(2);
  });

  it("poucas falhas para o MESMO destinatário não avaliam: endereço errado é problema dele", () => {
    expect(falhasSeguidas(para("caixa-cheia@x.com"))).toBeNull();
    expect(falhasSeguidas(para("caixa-cheia@x.com", "caixa-cheia@x.com", "caixa-cheia@x.com"))).toBeNull();
  });

  it("insistir no mesmo destinatário deixa de ser desculpa a partir do limite", () => {
    const mesmo = Array.from({ length: LIMITE_MESMO_DESTINATARIO }, () => ({ para: "so-ele@x.com" }));
    expect(falhasSeguidas(mesmo)).toBe(LIMITE_MESMO_DESTINATARIO);
    expect(falhasSeguidas(mesmo.slice(0, LIMITE_MESMO_DESTINATARIO - 1))).toBeNull();
  });

  it("maiúscula e espaço não inventam um segundo destinatário", () => {
    expect(falhasSeguidas(para("Ana@X.com", " ana@x.com ", "ANA@x.com"))).toBeNull();
  });

  it("destinatário vazio não inventa diversidade", () => {
    expect(falhasSeguidas(para("", "a@x.com", "a@x.com"))).toBeNull();
  });
});
