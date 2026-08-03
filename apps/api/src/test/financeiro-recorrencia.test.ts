import { describe, it, expect } from "vitest";
import { proximo } from "../modules/financeiro/contas.service.js";

/**
 * Trava dos bugs de recorrência do Financeiro corrigidos em 28/07/2026 — que foram
 * corrigidos SEM teste e portanto podiam voltar num refactor sem ninguém perceber.
 *
 * Tudo em UTC: as datas de vencimento são gravadas em meia-noite UTC (campo date-only).
 */
const utc = (ano: number, mes: number, dia: number) => new Date(Date.UTC(ano, mes - 1, dia));
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("recorrência de contas — próxima ocorrência", () => {
  it("DIARIA anda 1 dia e SEMANAL anda 7", () => {
    expect(iso(proximo(utc(2026, 1, 31), "DIARIA"))).toBe("2026-02-01");
    expect(iso(proximo(utc(2026, 1, 31), "SEMANAL"))).toBe("2026-02-07");
  });

  it("NENHUMA não anda", () => {
    expect(iso(proximo(utc(2026, 3, 10), "NENHUMA"))).toBe("2026-03-10");
  });

  it("MENSAL não vaza para o mês seguinte (31/01 → 28/02, nunca 03/03)", () => {
    // O bug original: somar 1 mês em 31/01 dava 31/02 → o JS estourava para 03/03,
    // PULANDO fevereiro inteiro na série.
    expect(iso(proximo(utc(2026, 1, 31), "MENSAL"))).toBe("2026-02-28");
  });

  it("MENSAL respeita ano bissexto", () => {
    expect(iso(proximo(utc(2028, 1, 31), "MENSAL"))).toBe("2028-02-29");
  });

  it("MENSAL vira o ano corretamente (31/12 → 31/01)", () => {
    expect(iso(proximo(utc(2026, 12, 31), "MENSAL"))).toBe("2027-01-31");
  });

  it("MENSAL preserva o dia quando o mês alvo comporta", () => {
    expect(iso(proximo(utc(2026, 3, 15), "MENSAL"))).toBe("2026-04-15");
    expect(iso(proximo(utc(2026, 3, 31), "MENSAL"))).toBe("2026-04-30");
  });

  it("MENSAL volta ao dia da ÂNCORA depois de um mês curto (não degrada para sempre)", () => {
    // Bug remanescente: o clamp era calculado a partir da ocorrência ANTERIOR, então uma
    // série ancorada no dia 31 virava 28/02 e daí em diante ficava presa no dia 28.
    // Com a âncora explícita, 28/02 (série do dia 31) volta para 31/03.
    expect(iso(proximo(utc(2026, 2, 28), "MENSAL", 31))).toBe("2026-03-31");
    expect(iso(proximo(utc(2026, 4, 30), "MENSAL", 31))).toBe("2026-05-31");
    // E continua clampando quando o mês alvo não comporta a âncora.
    expect(iso(proximo(utc(2026, 1, 31), "MENSAL", 31))).toBe("2026-02-28");
  });

  it("a âncora só afeta o MENSAL", () => {
    expect(iso(proximo(utc(2026, 2, 28), "DIARIA", 31))).toBe("2026-03-01");
    expect(iso(proximo(utc(2026, 2, 28), "SEMANAL", 31))).toBe("2026-03-07");
  });
});
