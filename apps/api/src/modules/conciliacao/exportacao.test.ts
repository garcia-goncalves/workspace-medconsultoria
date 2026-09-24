import { describe, it, expect } from "vitest";
import { resumoPorConvenio } from "./exportacao.js";
import type { LinhaConciliada } from "./conciliacao-financeira.service.js";

function linha(o: Partial<LinhaConciliada>): LinhaConciliada {
  return {
    id: Math.random().toString(36).slice(2),
    numeroCirurgia: "1",
    atendimento: "10",
    dataCirurgia: "2026-03-10",
    competencia: "2026-03",
    pacienteNome: "PACIENTE",
    procedimento: "PROC",
    status: "EXECUTADA",
    statusBruto: "Executada",
    autorizacao: "AUTORIZADA",
    autorizacaoBruto: "Autorizado",
    categoriaConvenio: "CONVENIO",
    convenioBruto: "X",
    operadora: null,
    convenioParticular: false,
    profissionalBruto: "DR",
    profissional: null,
    codigo: null,
    cobrado: 1000,
    cobradoOrigem: "DE_PARA",
    recebido: 1000,
    recebidoOrigem: "REPASSE",
    repasseCompartilhado: false,
    dataPagamento: null,
    glosa: 0,
    statusConciliacao: "PAGO",
    atrasada: false,
    recurso: null,
    naoCobrar: false,
    observacao: null,
    ...o,
  };
}

/** As linhas depois do cabeçalho (o BOM do Excel fica na primeira, que é descartada). */
const corpo = (csv: string) => csv.trim().split("\r\n").slice(1);

describe("resumoPorConvenio — agrupa pela operadora LIGADA, como a tela", () => {
  it("dois textos do TASY ligados à mesma operadora saem numa linha só, com o nome dela", () => {
    const bradesco = { id: "op-b", nome: "Bradesco Saúde" };
    const csv = resumoPorConvenio([
      linha({ convenioBruto: "BRADESCO SAUDE", operadora: bradesco }),
      linha({ convenioBruto: "BRADESCO SAÚDE - TOP", operadora: bradesco, cobrado: 500, recebido: 350, glosa: 150 }),
    ]);
    expect(corpo(csv)).toEqual(['"Bradesco Saúde";2;1500,00;1350,00;150,00;0,00']);
  });

  it("sem ligação sai o texto bruto marcado '(a ligar)', juntando grafias que normalizam igual", () => {
    const csv = resumoPorConvenio([linha({ convenioBruto: "Cassi" }), linha({ convenioBruto: "CASSI" })]);
    expect(corpo(csv)).toEqual(['"Cassi (a ligar)";2;2000,00;2000,00;0,00;0,00']);
  });

  it("convênio marcado como particular no de-para sai como 'Particular'", () => {
    const csv = resumoPorConvenio([linha({ convenioBruto: "PARTICULAR", convenioParticular: true })]);
    expect(corpo(csv)).toEqual(['"Particular";1;1000,00;1000,00;0,00;0,00']);
  });
});
