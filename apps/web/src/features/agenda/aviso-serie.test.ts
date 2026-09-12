import { describe, it, expect } from "vitest";
import { avisoDeSerie } from "./aviso-serie";

// Datas em BRT (o formatador fixa America/Sao_Paulo).
const em = (iso: string) => new Date(iso);

describe("avisoDeSerie", () => {
  it("evento sem repetição não avisa nada", () => {
    expect(
      avisoDeSerie({ recorrencia: "NENHUMA", ocorrenciaClicada: em("2026-08-24T13:00:00Z"), baseInicio: em("2026-08-03T13:00:00Z") }),
    ).toBeNull();
  });

  it("clicou na 1ª ocorrência: avisa da série, sem falar de data", () => {
    const a = avisoDeSerie({ recorrencia: "SEMANAL", ocorrenciaClicada: em("2026-08-03T13:00:00Z"), baseInicio: em("2026-08-03T13:00:00Z") });
    expect(a?.titulo).toContain("altera a série inteira");
    expect(a?.detalhe).toBeNull();
  });

  it("clicou numa repetição posterior: diz QUAL data o formulário está mostrando", () => {
    const a = avisoDeSerie({ recorrencia: "SEMANAL", ocorrenciaClicada: em("2026-08-24T13:00:00Z"), baseInicio: em("2026-08-03T13:00:00Z") });
    expect(a?.detalhe).toBe("A data abaixo é a da 1ª repetição (03/08/2026), não a de 24/08/2026 em que você clicou.");
  });

  it("mesma data com horas diferentes NÃO é divergência de dia", () => {
    const a = avisoDeSerie({ recorrencia: "DIARIA", ocorrenciaClicada: em("2026-08-03T20:00:00Z"), baseInicio: em("2026-08-03T13:00:00Z") });
    expect(a?.detalhe).toBeNull();
  });

  it("sem a ocorrência clicada (outro caminho de abertura), ainda avisa da série", () => {
    const a = avisoDeSerie({ recorrencia: "MENSAL", baseInicio: em("2026-08-03T13:00:00Z") });
    expect(a?.titulo).toContain("altera a série inteira");
    expect(a?.detalhe).toBeNull();
  });
});
