import { describe, expect, it } from "vitest";
import { periodoDoPreset } from "./relatorio-periodo";

describe("períodos do Relatório de entregas", () => {
  it("este mês vai do dia 1 ao último dia", () => {
    expect(periodoDoPreset("MES_ATUAL", new Date(2026, 8, 25))).toEqual({ de: "2026-09-01", ate: "2026-09-30" });
    expect(periodoDoPreset("MES_ATUAL", new Date(2028, 1, 10))).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
  });

  it("mês passado atravessa a virada do ano", () => {
    expect(periodoDoPreset("MES_ANTERIOR", new Date(2027, 0, 15))).toEqual({ de: "2026-12-01", ate: "2026-12-31" });
    expect(periodoDoPreset("MES_ANTERIOR", new Date(2026, 2, 31))).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
  });
});
