import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { emReais, emReaisOu } from "./dinheiro";

describe("dinheiro — a fronteira entre o Decimal do banco e o number da tela", () => {
  it("converte Decimal do Prisma para número", () => {
    expect(emReais(new Prisma.Decimal("2500.00"))).toBe(2500);
    expect(emReais(new Prisma.Decimal("0.10"))).toBe(0.1);
  });

  it("deixa passar número e nulo", () => {
    expect(emReais(1234.56)).toBe(1234.56);
    expect(emReais(null)).toBeNull();
    expect(emReais(undefined)).toBeNull();
  });

  it("emReaisOu troca nulo pelo padrão", () => {
    expect(emReaisOu(null)).toBe(0);
    expect(emReaisOu(undefined, 10)).toBe(10);
    expect(emReaisOu(new Prisma.Decimal("99.90"))).toBe(99.9);
  });

  it("guarda o centavo que o Float perdia", () => {
    // Em Float, 0.1 somado 10 vezes dá 0.9999999999999999.
    const dez = Array.from({ length: 10 }, () => new Prisma.Decimal("0.10"));
    const soma = dez.reduce((a, d) => a.plus(d), new Prisma.Decimal(0));
    expect(soma.toNumber()).toBe(1);
    expect(soma.toFixed(2)).toBe("1.00");
  });
});
