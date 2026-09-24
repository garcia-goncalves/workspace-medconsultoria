import { describe, it, expect } from "vitest";
import { dataBRT } from "./datas";

describe("dataBRT — instante escrito no dia de Brasília", () => {
  it("às 21h30 de Brasília (00:30Z do dia seguinte) ainda é o dia de Brasília", () => {
    expect(dataBRT(new Date("2026-09-24T00:30:00Z"))).toBe("23/09/2026");
  });

  it("a partir das 03:00Z já é o dia seguinte em Brasília", () => {
    expect(dataBRT(new Date("2026-09-24T03:00:00Z"))).toBe("24/09/2026");
  });
});
