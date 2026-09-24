import { describe, expect, it } from "vitest";
import { data, dataUTC, hojeEmBrasiliaISO } from "./format-date";

/**
 * Às 21h30 de Brasília (UTC−3) já é o dia seguinte em UTC — é a hora em que o dia "vira" errado.
 * Os dois casos precisam continuar distintos: INSTANTE vai pelo fuso de Brasília; DIA puro
 * (gravado como meia-noite UTC) vai por UTC, senão recua um dia.
 */
describe("datas às 21h30 de Brasília", () => {
  const instante = new Date("2026-09-24T00:30:00Z"); // 23/09 21:30 em Brasília

  it("instante (fechado em, importado em) aparece no dia de Brasília", () => {
    expect(data(instante)).toBe("23/09/2026");
  });

  it("dia puro (data da cirurgia, meia-noite UTC) aparece no próprio dia", () => {
    expect(dataUTC(new Date("2026-09-24T00:00:00Z"))).toBe("24/09/2026");
    expect(dataUTC("2026-09-24")).toBe("24/09/2026");
  });

  it("hoje, para o <input type=date>, é o dia de Brasília e não o de UTC", () => {
    expect(hojeEmBrasiliaISO(instante)).toBe("2026-09-23");
    expect(hojeEmBrasiliaISO(new Date("2026-09-24T03:00:00Z"))).toBe("2026-09-24");
    expect(hojeEmBrasiliaISO(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});
