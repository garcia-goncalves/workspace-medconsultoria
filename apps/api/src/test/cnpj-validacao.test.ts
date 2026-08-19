import { describe, it, expect } from "vitest";
import { validarCNPJ, formatarCNPJ } from "@app/shared";

/**
 * Validação de CNPJ por dígito verificador.
 *
 * Existe porque até aqui a aplicação só aplicava MÁSCARA: "11.111.111/1111-11" passava,
 * e um CNPJ digitado errado só aparecia meses depois, num contrato ou numa nota.
 *
 * O CNPJ **alfanumérico** (Receita Federal, IN 2.229/2024, em vigor desde julho/2026)
 * é aceito: os 12 primeiros caracteres podem ser letras ou números, e só os 2 dígitos
 * verificadores são obrigatoriamente numéricos. O cálculo é o mesmo módulo 11 de sempre,
 * trocando cada caractere pelo seu código ASCII menos 48 ("0"→0 … "9"→9, "A"→17, "B"→18…).
 * Um validador só-numérico recusaria empresa aberta a partir de julho — bug na cara da Thaís.
 */
describe("validarCNPJ", () => {
  it("aceita CNPJ numérico válido, com ou sem pontuação", () => {
    expect(validarCNPJ("11.222.333/0001-81")).toBe(true);
    expect(validarCNPJ("11222333000181")).toBe(true);
    expect(validarCNPJ(" 11222333000181 ")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(validarCNPJ("11.222.333/0001-82")).toBe(false);
    expect(validarCNPJ("11222333000180")).toBe(false);
  });

  it("recusa tamanho errado, vazio e nulo", () => {
    expect(validarCNPJ("1122233300018")).toBe(false);
    expect(validarCNPJ("112223330001811")).toBe(false);
    expect(validarCNPJ("")).toBe(false);
    expect(validarCNPJ(null)).toBe(false);
    expect(validarCNPJ("não é documento")).toBe(false);
  });

  it("recusa a sequência de caracteres repetidos (00000000000000, 11111111111111…)", () => {
    expect(validarCNPJ("00.000.000/0000-00")).toBe(false);
    expect(validarCNPJ("11111111111111")).toBe(false);
  });

  it("aceita o CNPJ ALFANUMÉRICO (formato novo, desde julho/2026)", () => {
    // Exemplo da própria Receita/Serpro: 12.ABC.345/01DE-35.
    expect(validarCNPJ("12.ABC.345/01DE-35")).toBe(true);
    expect(validarCNPJ("12ABC34501DE35")).toBe(true);
    expect(validarCNPJ("12abc34501de35")).toBe(true); // minúscula é a mesma coisa
  });

  it("recusa alfanumérico com verificador errado", () => {
    expect(validarCNPJ("12.ABC.345/01DE-36")).toBe(false);
  });

  it("recusa letra nos dois dígitos verificadores (eles são sempre numéricos)", () => {
    expect(validarCNPJ("12ABC34501DEA5")).toBe(false);
  });
});

describe("formatarCNPJ", () => {
  it("formata numérico e alfanumérico no mesmo desenho", () => {
    expect(formatarCNPJ("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarCNPJ("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
  });

  it("devolve o que veio quando não dá para formatar (nunca inventa)", () => {
    expect(formatarCNPJ("123")).toBe("123");
    expect(formatarCNPJ("")).toBe("");
    expect(formatarCNPJ(null)).toBe("");
  });
});
