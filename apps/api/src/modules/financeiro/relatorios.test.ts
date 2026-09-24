import { describe, it, expect } from "vitest";
import {
  mesBRTDoInstante,
  mesDaData,
  mesDoPagamento,
  mesesAPartir,
  mesesAte,
  montarInadimplencia,
  montarProjecao,
  montarRelatorioMensal,
  planilhaDoContador,
  projetarSerie,
  type BaseDaSerie,
  type ContaParaExportar,
} from "./relatorios.js";

const utc = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));

describe("meses", () => {
  it("vencimento (date-only) é lido em UTC", () => {
    expect(mesDaData(utc(2026, 8, 31))).toBe("2026-08");
  });

  it("⚠️ pagamento às 22h de 31/08 em Brasília é AGOSTO, mesmo gravado em 01/09 UTC", () => {
    const instante = new Date("2026-09-01T01:00:00.000Z");
    expect(mesBRTDoInstante(instante)).toBe("2026-08");
    expect(mesDoPagamento({ pagoEm: instante, vencimento: utc(2026, 9, 10) })).toBe("2026-08");
  });

  it("paga sem pagoEm cai no mês do vencimento em vez de sumir", () => {
    expect(mesDoPagamento({ pagoEm: null, vencimento: utc(2026, 7, 5) })).toBe("2026-07");
  });

  it("janelas atravessam a virada do ano", () => {
    expect(mesesAte("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(mesesAPartir("2026-11", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("relatório mês a mês (regime de caixa)", () => {
  it("soma pelo mês do PAGAMENTO, zera os meses sem movimento e não erra centavo", () => {
    const pagas = [
      // Vence em agosto, pago em setembro → setembro.
      { tipo: "PAGAR" as const, valor: 1000, vencimento: utc(2026, 8, 30), pagoEm: new Date("2026-09-03T15:00:00Z") },
      ...Array.from({ length: 10 }, () => ({
        tipo: "RECEBER" as const,
        valor: 0.1,
        vencimento: utc(2026, 9, 1),
        pagoEm: new Date("2026-09-02T15:00:00Z"),
      })),
      // Fora da janela: ignorado.
      { tipo: "RECEBER" as const, valor: 999, vencimento: utc(2025, 1, 1), pagoEm: new Date("2025-01-02T15:00:00Z") },
    ];
    const vencidas = [
      { tipo: "RECEBER" as const, valor: 300, vencimento: utc(2026, 7, 10) },
      { tipo: "RECEBER" as const, valor: 200, vencimento: utc(2026, 7, 20) },
      { tipo: "PAGAR" as const, valor: 50, vencimento: utc(2026, 7, 20) }, // a pagar não entra
    ];
    const r = montarRelatorioMensal(["2026-07", "2026-08", "2026-09"], pagas, vencidas);
    expect(r).toEqual([
      { mes: "2026-07", recebido: 0, pago: 0, resultado: 0, vencidoAReceber: 500, qtdVencidoAReceber: 2 },
      { mes: "2026-08", recebido: 0, pago: 0, resultado: 0, vencidoAReceber: 0, qtdVencidoAReceber: 0 },
      { mes: "2026-09", recebido: 1, pago: 1000, resultado: -999, vencidoAReceber: 0, qtdVencidoAReceber: 0 },
    ]);
  });
});

describe("projeção de série recorrente", () => {
  const base = (over: Partial<BaseDaSerie> = {}): BaseDaSerie => ({
    serie: "s1",
    tipo: "PAGAR",
    valor: 900,
    vencimento: utc(2026, 9, 10),
    recorrencia: "MENSAL",
    recorrenciaAte: null,
    ...over,
  });

  it("projeta os meses seguintes que ainda não existem", () => {
    const datas = projetarSerie(base(), 10, new Set(), utc(2026, 9, 24), utc(2027, 1, 1));
    expect(datas.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
  });

  it("⚠️ pula a data que a pessoa excluiu (exceção da série) e respeita o fim da série", () => {
    const ocupadas = new Set([utc(2026, 11, 10).getTime()]);
    const datas = projetarSerie(base({ recorrenciaAte: utc(2026, 12, 1) }), 10, ocupadas, utc(2026, 9, 24), utc(2027, 3, 1));
    expect(datas.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-10-10"]);
  });

  it("mantém a âncora do dia 31 (fevereiro vira 28, março volta a 31)", () => {
    const datas = projetarSerie(
      base({ vencimento: utc(2027, 1, 31) }),
      31,
      new Set(),
      utc(2027, 1, 1),
      utc(2027, 4, 1),
    );
    expect(datas.map((d) => d.toISOString().slice(0, 10))).toEqual(["2027-02-28", "2027-03-31"]);
  });

  it("não inventa parcela no passado (a série parada numa conta vencida)", () => {
    const datas = projetarSerie(base({ vencimento: utc(2026, 3, 10) }), 10, new Set(), utc(2026, 9, 24), utc(2026, 11, 1));
    expect(datas.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-10-10"]);
  });

  it("monta os meses separando o que é projetado", () => {
    const r = montarProjecao(
      ["2026-09", "2026-10"],
      [
        { tipo: "RECEBER", valor: 1000, vencimento: utc(2026, 9, 30), projetado: false },
        { tipo: "PAGAR", valor: 900, vencimento: utc(2026, 10, 10), projetado: true },
        { tipo: "RECEBER", valor: 5, vencimento: utc(2027, 1, 1), projetado: false }, // fora
      ],
    );
    expect(r).toEqual([
      { mes: "2026-09", receber: 1000, pagar: 0, saldo: 1000, receberProjetado: 0, pagarProjetado: 0 },
      { mes: "2026-10", receber: 0, pagar: 900, saldo: -900, receberProjetado: 0, pagarProjetado: 900 },
    ]);
  });
});

describe("inadimplência por cliente", () => {
  it("agrupa, ordena pelo valor e mede o atraso da mais antiga; sem cliente não some", () => {
    const hoje = utc(2026, 9, 24);
    const r = montarInadimplencia(
      [
        { clienteId: "a", clienteNome: "Clínica A", valor: 100, vencimento: utc(2026, 9, 14) },
        { clienteId: "b", clienteNome: "Clínica B", valor: 500, vencimento: utc(2026, 8, 25) },
        { clienteId: "a", clienteNome: "Clínica A", valor: 50, vencimento: utc(2026, 7, 26) },
        { clienteId: null, clienteNome: null, valor: 10, vencimento: utc(2026, 9, 1) },
      ],
      hoje,
    );
    expect(r.map((i) => [i.clienteNome, i.total, i.quantidade, i.diasEmAtraso])).toEqual([
      ["Clínica B", 500, 1, 30],
      ["Clínica A", 150, 2, 60],
      ["Sem cliente vinculado", 10, 1, 23],
    ]);
  });
});

describe("planilha do contador", () => {
  const conta = (over: Partial<ContaParaExportar> = {}): ContaParaExportar => ({
    tipo: "RECEBER",
    escopo: "EMPRESA",
    descricao: "Honorário",
    valor: 1234.5,
    vencimento: utc(2026, 9, 10),
    pago: false,
    pagoEm: null,
    categoria: { nome: "Honorários" },
    cliente: { nome: "Clínica X" },
    ...over,
  });

  it("tem BOM, cabeçalho em português, dinheiro com vírgula e status legível", () => {
    const csv = planilhaDoContador(
      [conta(), conta({ tipo: "PAGAR", pago: true, pagoEm: new Date("2026-09-01T01:00:00Z"), categoria: null, cliente: null })],
      utc(2026, 9, 24),
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const linhas = csv.slice(1).trim().split("\r\n");
    expect(linhas[0]).toBe(
      '"Vencimento";"Pagamento";"Descrição";"Cliente/Fornecedor";"Categoria";"Carteira";"Tipo";"Valor (R$)";"Status"',
    );
    expect(linhas[1]).toBe('"10/09/2026";"";"Honorário";"Clínica X";"Honorários";"Empresa";"A receber";1234,50;"Vencida"');
    // Pago às 22h de 31/08 em Brasília → a data do pagamento é 31/08.
    expect(linhas[2]).toBe('"10/09/2026";"31/08/2026";"Honorário";"";"Sem categoria";"Empresa";"A pagar";1234,50;"Paga"');
  });

  it("⚠️ não deixa célula virar fórmula no Excel (descrição e nome do cliente)", () => {
    const csv = planilhaDoContador(
      [conta({ descricao: '=HYPERLINK("http://x")', cliente: { nome: "+55 11 9999" } }), conta({ descricao: "@SOMA(A1)" })],
      utc(2026, 9, 1),
    );
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(`"'+55 11 9999"`);
    expect(csv).toContain(`"'@SOMA(A1)"`);
    expect(csv).not.toMatch(/;"=/);
  });
});
