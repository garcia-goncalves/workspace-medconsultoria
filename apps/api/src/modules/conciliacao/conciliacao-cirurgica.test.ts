import { describe, it, expect } from "vitest";
import { glosaDe, repartirRecebido, statusDaConciliacao } from "./conciliacao-cirurgica.js";

const base = { statusTasy: "EXECUTADA" as const, naoCobrar: false, atendimento: "19100842", cobrado: 1000, recebido: null };

describe("statusDaConciliacao", () => {
  it("cirurgia não realizada nunca entra na conta de dinheiro", () => {
    expect(statusDaConciliacao({ ...base, statusTasy: "RESERVADA", recebido: 500 })).toBe("NAO_REALIZADA");
  });

  it("marcada como não cobrar sai da conta, mesmo com valor", () => {
    expect(statusDaConciliacao({ ...base, naoCobrar: true })).toBe("NAO_COBRAR");
  });

  it("sem recebido: a receber, ou o que impede saber", () => {
    expect(statusDaConciliacao(base)).toBe("A_RECEBER");
    expect(statusDaConciliacao({ ...base, atendimento: null })).toBe("SEM_ATENDIMENTO");
    expect(statusDaConciliacao({ ...base, cobrado: null })).toBe("SEM_VALOR");
  });

  it("com recebido: pago, glosa parcial, glosa total, pago a mais", () => {
    expect(statusDaConciliacao({ ...base, recebido: 1000 })).toBe("PAGO");
    expect(statusDaConciliacao({ ...base, recebido: 999.995 })).toBe("PAGO"); // centavo de arredondamento não é glosa
    expect(statusDaConciliacao({ ...base, recebido: 700 })).toBe("GLOSA_PARCIAL");
    expect(statusDaConciliacao({ ...base, recebido: 0 })).toBe("GLOSA_TOTAL");
    expect(statusDaConciliacao({ ...base, recebido: 1200 })).toBe("PAGO_A_MAIS");
  });

  it("recebeu sem saber quanto devia: não inventa pago nem glosa", () => {
    expect(statusDaConciliacao({ ...base, cobrado: null, recebido: 800 })).toBe("RECEBIDO_SEM_VALOR");
  });

  it("recebido chega mesmo sem número de atendimento (ex.: preenchido à mão) e vale", () => {
    expect(statusDaConciliacao({ ...base, atendimento: null, recebido: 1000 })).toBe("PAGO");
  });
});

describe("glosaDe", () => {
  it("é cobrado − recebido, nunca negativa, e só existe quando houve recebimento", () => {
    expect(glosaDe(1000, 700)).toBe(300);
    expect(glosaDe(1000, 1200)).toBe(0);
    expect(glosaDe(1000, null)).toBeNull();
    expect(glosaDe(null, 700)).toBeNull();
    expect(glosaDe(0.1 + 0.2, 0.3)).toBe(0); // sem ruído de ponto flutuante
  });
});

describe("repartirRecebido — um atendimento, várias cirurgias", () => {
  it("uma cirurgia só leva tudo", () => {
    expect(repartirRecebido([{ id: "a", cobrado: 1000 }], 800)).toEqual(new Map([["a", 800]]));
  });

  it("várias com valor: proporcional ao cobrado, e a soma bate no centavo", () => {
    const r = repartirRecebido(
      [
        { id: "a", cobrado: 1000 },
        { id: "b", cobrado: 2000 },
      ],
      100,
    );
    expect(r.get("a")).toBe(33.33);
    expect(r.get("b")).toBe(66.67);
    expect((r.get("a")! * 100 + r.get("b")! * 100) / 100).toBe(100);
  });

  it("sem valor de referência: tudo na primeira, as outras ficam com zero — nada é inventado", () => {
    const r = repartirRecebido(
      [
        { id: "a", cobrado: null },
        { id: "b", cobrado: 500 },
      ],
      300,
    );
    expect(r.get("a")).toBe(300);
    expect(r.get("b")).toBe(0);
  });
});
