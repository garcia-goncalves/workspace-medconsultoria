import { describe, it, expect } from "vitest";
import { precisaTrocarSenha } from "@app/shared";

/**
 * Regra do "defina sua senha no 1º acesso" (ADR-91).
 *
 * `senhaTrocadaEm` nulo = a pessoa NUNCA definiu a própria senha (a conta nasceu do seed,
 * com uma senha compartilhada). Vale só para papéis INTERNOS: o cliente do Portal já
 * escolhe a senha dele ao aceitar o convite, então não faz sentido incomodá-lo.
 */
describe("precisa trocar a senha no primeiro acesso", () => {
  it("conta interna que nunca trocou é convidada a trocar", () => {
    expect(precisaTrocarSenha({ role: "ROOT", senhaTrocadaEm: null })).toBe(true);
    expect(precisaTrocarSenha({ role: "ADMIN", senhaTrocadaEm: null })).toBe(true);
    expect(precisaTrocarSenha({ role: "FUNCIONARIO", senhaTrocadaEm: null })).toBe(true);
  });

  it("cliente do Portal NUNCA é incomodado (já escolheu a senha no convite)", () => {
    expect(precisaTrocarSenha({ role: "CLIENTE", senhaTrocadaEm: null })).toBe(false);
  });

  it("quem já trocou não é incomodado de novo", () => {
    const quando = new Date("2026-08-03T12:00:00.000Z");
    expect(precisaTrocarSenha({ role: "ROOT", senhaTrocadaEm: quando })).toBe(false);
    expect(precisaTrocarSenha({ role: "FUNCIONARIO", senhaTrocadaEm: quando })).toBe(false);
  });
});
