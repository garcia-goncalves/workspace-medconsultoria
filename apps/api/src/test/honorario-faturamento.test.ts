/**
 * O HONORÁRIO DO FATURAMENTO — a regra pura (Onda 2).
 *
 * O que estes testes guardam, e não pode regredir:
 *  - a base é o RECEBIDO no mês do CRÉDITO, inclusive o recebido sem produção e os estornos;
 *  - linha sem data de pagamento não entra em mês nenhum, mas é contada à parte;
 *  - a conta é em centavos, com arredondamento meio-para-cima, sem erro de float;
 *  - a contratação vale se esteve ativa em algum dia do mês;
 *  - o que já foi lançado fala mais alto que qualquer outra situação.
 */
import { describe, it, expect } from "vitest";
import {
  basesPorMes,
  calcularHonorarioCentavos,
  contratacaoValeNoMes,
  mesEncerrado,
  rotuloDoMes,
  situacaoDoHonorario,
  vencimentoPadrao,
} from "@app/shared";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("basesPorMes", () => {
  it("soma por mês do CRÉDITO, não do atendimento", () => {
    const { meses } = basesPorMes([
      { valor: 1000, dataPagamento: d("2026-05-03") },
      { valor: 250.5, dataPagamento: d("2026-05-31") },
      { valor: 99.99, dataPagamento: d("2026-06-01") },
    ]);
    expect(meses.get("2026-05")).toEqual({ baseCentavos: 125050, linhas: 2 });
    expect(meses.get("2026-06")).toEqual({ baseCentavos: 9999, linhas: 1 });
  });

  it("estorno entra com sinal — desfaz o crédito", () => {
    const { meses } = basesPorMes([
      { valor: 500, dataPagamento: d("2026-05-10") },
      { valor: -120.25, dataPagamento: d("2026-05-12") },
    ]);
    expect(meses.get("2026-05")?.baseCentavos).toBe(37975);
  });

  it("sem data de pagamento não entra em mês nenhum, e é contado à parte", () => {
    const r = basesPorMes([
      { valor: 700, dataPagamento: null },
      { valor: 300, dataPagamento: d("2026-05-10") },
    ]);
    expect(r.meses.size).toBe(1);
    expect(r.semData).toEqual({ linhas: 1, totalCentavos: 70000 });
  });

  it("dez vezes R$ 0,10 dá R$ 1,00 exato (o defeito do Float)", () => {
    const linhas = Array.from({ length: 10 }, () => ({ valor: 0.1, dataPagamento: d("2026-05-10") }));
    expect(basesPorMes(linhas).meses.get("2026-05")?.baseCentavos).toBe(100);
  });
});

describe("calcularHonorarioCentavos", () => {
  it("base × percentual, com o percentual da contratação", () => {
    expect(calcularHonorarioCentavos(10_000_00, 3.5)).toBe(350_00); // 3,5% de R$ 10.000
  });

  it("arredonda meio para cima", () => {
    // 3,5% de R$ 0,15 = 0,525 centavo... em centavos: 15 × 350 / 10000 = 0,525 → 1
    expect(calcularHonorarioCentavos(15, 3.5)).toBe(1);
    // 3,5% de R$ 0,14 = 0,49 centavo → 0
    expect(calcularHonorarioCentavos(14, 3.5)).toBe(0);
    // 5% de R$ 123,45 = R$ 6,1725 → R$ 6,17
    expect(calcularHonorarioCentavos(12345, 5)).toBe(617);
  });

  it("valores grandes não perdem precisão", () => {
    // R$ 99.999.999,99 × 12,34% = R$ 12.339.999,998766 → R$ 12.340.000,00
    expect(calcularHonorarioCentavos(9_999_999_999, 12.34)).toBe(1_234_000_000);
  });

  it("base zero ou negativa não gera honorário", () => {
    expect(calcularHonorarioCentavos(0, 5)).toBe(0);
    expect(calcularHonorarioCentavos(-5000, 5)).toBe(0);
  });
});

describe("contratacaoValeNoMes", () => {
  const ativa = { status: "ATIVO", percentual: 5, contratadoEm: new Date("2026-05-20T15:00:00Z"), canceladoEm: null };

  it("contratada no meio do mês vale o mês inteiro", () => {
    expect(contratacaoValeNoMes(ativa, "2026-05")).toBe(true);
    expect(contratacaoValeNoMes(ativa, "2026-06")).toBe(true);
  });

  it("não vale antes de ser contratada", () => {
    expect(contratacaoValeNoMes(ativa, "2026-04")).toBe(false);
  });

  it("o mês é o de Brasília: contratar às 23h de 30/04 (02h UTC de 01/05) conta abril", () => {
    const c = { ...ativa, contratadoEm: new Date("2026-05-01T02:00:00Z") };
    expect(contratacaoValeNoMes(c, "2026-04")).toBe(true);
  });

  it("cancelada vale até o mês do cancelamento, e não depois", () => {
    const c = { status: "CANCELADO", percentual: 5, contratadoEm: new Date("2026-01-10T12:00:00Z"), canceladoEm: new Date("2026-05-05T12:00:00Z") };
    expect(contratacaoValeNoMes(c, "2026-05")).toBe(true);
    expect(contratacaoValeNoMes(c, "2026-06")).toBe(false);
  });

  it("CANCELADO sem data de cancelamento não vale em mês nenhum", () => {
    const c = { status: "CANCELADO", percentual: 5, contratadoEm: new Date("2026-01-10T12:00:00Z"), canceladoEm: null };
    expect(contratacaoValeNoMes(c, "2026-05")).toBe(false);
  });
});

describe("apoio", () => {
  it("mesEncerrado compara com o mês de hoje em Brasília", () => {
    expect(mesEncerrado("2026-08", d("2026-09-24"))).toBe(true);
    expect(mesEncerrado("2026-09", d("2026-09-24"))).toBe(false);
  });

  it("vencimento padrão = dia 10 do mês seguinte, inclusive na virada do ano", () => {
    expect(vencimentoPadrao("2026-05")).toBe("2026-06-10");
    expect(vencimentoPadrao("2026-12")).toBe("2027-01-10");
  });

  it("rótulo do mês", () => {
    expect(rotuloDoMes("2026-05")).toBe("mai/2026");
  });
});

describe("situacaoDoHonorario", () => {
  const base = { honorarioCentavos: 35000, encerrado: true, valeNoMes: true, percentualDefinido: true, lancamento: null };

  it("mês encerrado, calculável, nada lançado → a lançar", () => {
    expect(situacaoDoHonorario(base).situacao).toBe("A_LANCAR");
  });

  it("mês em curso não se lança — pode chegar mais repasse", () => {
    expect(situacaoDoHonorario({ ...base, encerrado: false }).situacao).toBe("MES_EM_CURSO");
  });

  it("sem percentual, fora do contrato, nada a cobrar", () => {
    expect(situacaoDoHonorario({ ...base, percentualDefinido: false, honorarioCentavos: null }).situacao).toBe("SEM_PERCENTUAL");
    expect(situacaoDoHonorario({ ...base, valeNoMes: false }).situacao).toBe("FORA_DO_CONTRATO");
    expect(situacaoDoHonorario({ ...base, honorarioCentavos: 0 }).situacao).toBe("NADA_A_COBRAR");
  });

  it("lançado e igual → lançado; mudou → divergente; pago → pago, com o aviso", () => {
    expect(situacaoDoHonorario({ ...base, lancamento: { valorCentavos: 35000, pago: false } })).toEqual({ situacao: "LANCADO", divergiu: false });
    expect(situacaoDoHonorario({ ...base, lancamento: { valorCentavos: 30000, pago: false } })).toEqual({ situacao: "DIVERGENTE", divergiu: true });
    expect(situacaoDoHonorario({ ...base, lancamento: { valorCentavos: 30000, pago: true } })).toEqual({ situacao: "PAGO", divergiu: true });
  });

  it("o que já foi lançado fala mais alto que contrato cancelado depois", () => {
    expect(situacaoDoHonorario({ ...base, valeNoMes: false, lancamento: { valorCentavos: 35000, pago: false } }).situacao).toBe("LANCADO");
  });
});
