/**
 * A senha ESCOLHIDA do `pnpm senha:rotacionar <senha>` é gravada dentro de aspas duplas na
 * linha `SEED_ROOT_PASSWORD` do `.env`. Um caractere errado ali não dá erro: corrompe o
 * arquivo em silêncio, e o `.env` é o que a aplicação, os testes e o `pnpm acessos` leem —
 * o desfecho é NADA autenticar no ambiente local, com a senha "certa" na mão.
 *
 * Por isso a validação é uma função pura e testada, e não uma checagem improvisada dentro
 * do script. O caso que originou: aspas duplas fecham a string do `.env` no meio.
 */
import { describe, it, expect } from "vitest";
import { validarSenhaEscolhida } from "@app/db";

describe("validarSenhaEscolhida", () => {
  it("aceita uma senha comum de ambiente local", () => {
    expect(validarSenhaEscolhida("medconsultoria123")).toEqual({ valida: true, motivo: "" });
  });

  it("recusa senha curta demais — 8 caracteres é o piso", () => {
    expect(validarSenhaEscolhida("abc123").valida).toBe(false);
    expect(validarSenhaEscolhida("12345678").valida).toBe(true);
  });

  it("recusa senha vazia ou só espaços", () => {
    expect(validarSenhaEscolhida("").valida).toBe(false);
    expect(validarSenhaEscolhida("        ").valida).toBe(false);
  });

  it("recusa aspas duplas — fechariam a string do .env no meio", () => {
    expect(validarSenhaEscolhida('minha"senha123').valida).toBe(false);
  });

  it("recusa barra invertida — vira escape na leitura do .env", () => {
    expect(validarSenhaEscolhida("minha\\senha123").valida).toBe(false);
  });

  it("recusa quebra de linha — partiria o .env em duas linhas", () => {
    expect(validarSenhaEscolhida("minha\nsenha123").valida).toBe(false);
    expect(validarSenhaEscolhida("minha\rsenha123").valida).toBe(false);
  });

  it("recusa espaço nas pontas — some na leitura e ninguém entende por que não entra", () => {
    expect(validarSenhaEscolhida(" medconsultoria123").valida).toBe(false);
    expect(validarSenhaEscolhida("medconsultoria123 ").valida).toBe(false);
  });

  it("aceita espaço no meio — frase-senha é legítima", () => {
    expect(validarSenhaEscolhida("a senha do local").valida).toBe(true);
  });

  it("sempre explica o motivo quando recusa", () => {
    for (const ruim of ["", "curta", 'com"aspas', "com\\barra", "com\nquebra", " pontas "]) {
      const r = validarSenhaEscolhida(ruim);
      expect(r.valida).toBe(false);
      expect(r.motivo.length).toBeGreaterThan(0);
    }
  });
});
