import { describe, expect, it } from "vitest";
import { lerBuscaDaAgenda } from "./busca-na-url";

describe("estado da Agenda na URL", () => {
  it("lê data (dia ou instante ISO) e o evento a abrir", () => {
    expect(lerBuscaDaAgenda({ data: "2026-10-10T13:00:00.000Z", abrir: "cm123abc" })).toEqual({
      data: "2026-10-10T13:00:00.000Z",
      abrir: "cm123abc",
    });
    expect(lerBuscaDaAgenda({ data: "2026-10-10" })).toEqual({ data: "2026-10-10" });
  });

  it("descarta o que está fora do formato em vez de explodir", () => {
    expect(lerBuscaDaAgenda({ data: "amanhã", abrir: "../etc" })).toEqual({});
    expect(lerBuscaDaAgenda({ data: "2026-13-45" })).toEqual({});
    expect(lerBuscaDaAgenda({ data: 42, abrir: ["x"] })).toEqual({});
    expect(lerBuscaDaAgenda({})).toEqual({});
  });
});
