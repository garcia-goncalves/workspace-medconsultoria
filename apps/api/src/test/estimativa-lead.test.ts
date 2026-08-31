/**
 * A regra que decide QUAL pergunta o funil faz na Qualificação (ADR-125).
 *
 * O caso que originou: o serviço de Faturamento de contas médicas não tem valor fixo — a Med
 * ganha um percentual sobre o que a clínica fatura. O passo obrigatório "Registrar o valor
 * estimado da oportunidade" travava a etapa pedindo um número que não existe.
 *
 * O que estes testes guardam, e não pode regredir:
 *  - a regra NÃO casa por nome de serviço (nenhum "Faturamento" no código da regra);
 *  - o caso MISTURADO continua pedindo valor fixo — esconder o valor fixo sujaria o relatório;
 *  - o credenciamento fica fora da conta, igual ao provisionamento da conversão (ADR-104/108).
 */
import { describe, it, expect } from "vitest";
import {
  NOME_SERVICO_CREDENCIAMENTO,
  TITULO_PASSO_FATURAMENTO,
  TITULO_PASSO_VALOR,
  planejarEstimativaDoLead,
  tituloDoPassoDeEstimativa,
} from "@app/shared";

const FATURAMENTO = { nome: "Faturamento", valor: null, percentual: 5, ehCredenciamento: false };
const GESTAO = { nome: "Gestão Operacional", valor: 3500, percentual: null, ehCredenciamento: false };
// A marca, não o nome — é ela que tira o credenciamento da estimativa (ver `ehServicoDeCredenciamento`).
const CREDENCIAMENTO = { nome: NOME_SERVICO_CREDENCIAMENTO, valor: 1500, percentual: null, ehCredenciamento: true };

describe("planejarEstimativaDoLead", () => {
  it("só Faturamento → pergunta o faturamento mensal, não o valor", () => {
    const r = planejarEstimativaDoLead([FATURAMENTO], 200000);
    expect(r.modo).toBe("PERCENTUAL");
    expect(r.percentualTotal).toBe(5);
    expect(r.valorEstimadoCalculado).toBe(10000);
  });

  it("só Faturamento, sem a base ainda → modo percentual, mas nada a calcular", () => {
    const r = planejarEstimativaDoLead([FATURAMENTO], null);
    expect(r.modo).toBe("PERCENTUAL");
    expect(r.valorEstimadoCalculado).toBeNull();
  });

  it("MISTURADO (Faturamento + Gestão) → continua pedindo o valor estimado", () => {
    const r = planejarEstimativaDoLead([FATURAMENTO, GESTAO], 200000);
    expect(r.modo).toBe("VALOR_FIXO");
    expect(r.valorEstimadoCalculado).toBeNull();
  });

  it("nenhum serviço escolhido → comportamento de hoje (valor estimado)", () => {
    expect(planejarEstimativaDoLead([], 200000).modo).toBe("VALOR_FIXO");
  });

  it("SÓ credenciamento → valor estimado; o honorário dele nasce na aprovação", () => {
    expect(planejarEstimativaDoLead([CREDENCIAMENTO], null).modo).toBe("VALOR_FIXO");
  });

  it("Faturamento + credenciamento → percentual: o credenciamento não conta como valor fixo", () => {
    const r = planejarEstimativaDoLead([FATURAMENTO, CREDENCIAMENTO], 100000);
    expect(r.modo).toBe("PERCENTUAL");
    expect(r.valorEstimadoCalculado).toBe(5000);
  });

  it("percentual zerado não vira modo percentual", () => {
    const r = planejarEstimativaDoLead([{ nome: "X", valor: null, percentual: 0, ehCredenciamento: false }], 200000);
    expect(r.modo).toBe("VALOR_FIXO");
  });

  it("soma os percentuais quando há mais de um serviço percentual", () => {
    const r = planejarEstimativaDoLead(
      [FATURAMENTO, { nome: "Outro percentual", valor: null, percentual: 2.5, ehCredenciamento: false }],
      100000,
    );
    expect(r.percentualTotal).toBe(7.5);
    expect(r.valorEstimadoCalculado).toBe(7500);
  });

  it("arredonda em centavos, sem o erro de ponto flutuante", () => {
    const r = planejarEstimativaDoLead([{ nome: "F", valor: null, percentual: 3.33, ehCredenciamento: false }], 1234.56);
    expect(r.valorEstimadoCalculado).toBe(41.11);
  });

  it("a regra não casa por nome: serviço percentual de qualquer nome funciona igual", () => {
    const r = planejarEstimativaDoLead([{ nome: "Serviço inventado amanhã", valor: null, percentual: 8, ehCredenciamento: false }], 50000);
    expect(r.modo).toBe("PERCENTUAL");
    expect(r.valorEstimadoCalculado).toBe(4000);
  });
});

describe("tituloDoPassoDeEstimativa", () => {
  it("troca a pergunta do passo conforme o modo", () => {
    expect(tituloDoPassoDeEstimativa("PERCENTUAL")).toBe(TITULO_PASSO_FATURAMENTO);
    expect(tituloDoPassoDeEstimativa("VALOR_FIXO")).toBe(TITULO_PASSO_VALOR);
  });
});
