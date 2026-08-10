import { describe, expect, it } from "vitest";
import {
  NUMERO_PROPOSTA_INICIAL,
  formatarNumeroProposta,
  motivoDaTransicaoRecusada,
  proximaTentativa,
  totalDaGrade,
  transicaoCredenciamentoPermitida,
  valorPorExtenso,
  type CelulaGrade,
} from "@app/shared";

/**
 * As regras PURAS da grade médico × operadora (spec §5.4, §6.3, §6.4). Aqui não há banco:
 * são as decisões que precisam dar a mesma resposta na tela, no servidor e no documento.
 */

describe("grade médico × operadora — o total", () => {
  const celula = (profissionalId: string, operadoraId: string, valor: number): CelulaGrade => ({
    profissionalId,
    operadoraId,
    valor,
  });

  it("soma o valor de cada cruzamento marcado", () => {
    const total = totalDaGrade([
      celula("med-1", "omint", 1500),
      celula("med-1", "careplus", 1200),
      celula("med-2", "omint", 1500),
    ]);
    expect(total).toBe(4200);
  });

  it("com células VAZIAS no meio, soma só o que está marcado", () => {
    // Dois médicos × três operadoras = 6 cruzamentos possíveis; só 3 foram marcados.
    // O buraco no meio da grade é escolha da Thaís, não erro de preenchimento.
    const total = totalDaGrade([
      celula("med-1", "omint", 1000),
      celula("med-2", "amil", 800),
      celula("med-2", "careplus", 700),
    ]);
    expect(total).toBe(2500);
  });

  it("grade vazia vale zero — e não quebra", () => {
    expect(totalDaGrade([])).toBe(0);
  });

  it("célula com valor zero entra na grade mas não soma", () => {
    // Zero é uma escolha legítima (cortesia/bonificação): a linha existe e é acompanhada,
    // só não cobra. Diferente de não ter a célula.
    expect(totalDaGrade([celula("med-1", "omint", 0), celula("med-1", "amil", 900)])).toBe(900);
  });
});

describe("andamento do credenciamento — o que pode virar o quê", () => {
  it("segue o caminho normal: a protocolar → protocolado → em análise → aprovado", () => {
    expect(transicaoCredenciamentoPermitida("A_PROTOCOLAR", "PROTOCOLADO")).toBe(true);
    expect(transicaoCredenciamentoPermitida("PROTOCOLADO", "EM_ANALISE")).toBe(true);
    expect(transicaoCredenciamentoPermitida("EM_ANALISE", "APROVADO")).toBe(true);
  });

  it("aceita pular a análise: operadora que aprova direto do protocolo é comum", () => {
    expect(transicaoCredenciamentoPermitida("PROTOCOLADO", "APROVADO")).toBe(true);
    expect(transicaoCredenciamentoPermitida("PROTOCOLADO", "NEGADO")).toBe(true);
  });

  it("não deixa voltar no tempo — protocolado não volta a 'a protocolar'", () => {
    expect(transicaoCredenciamentoPermitida("PROTOCOLADO", "A_PROTOCOLAR")).toBe(false);
    expect(transicaoCredenciamentoPermitida("APROVADO", "EM_ANALISE")).toBe(false);
  });

  it("NEGADO é o fim daquela tentativa: não vira aprovado por edição", () => {
    // §3.4: uma tentativa e negativa encerram o cruzamento. Voltar a tentar é linha NOVA,
    // com o acordo registrado — não é apagar a negativa.
    expect(transicaoCredenciamentoPermitida("NEGADO", "APROVADO")).toBe(false);
    expect(transicaoCredenciamentoPermitida("NEGADO", "EM_ANALISE")).toBe(false);
  });

  it("ENCERRADO é definitivo", () => {
    expect(transicaoCredenciamentoPermitida("ENCERRADO", "PROTOCOLADO")).toBe(false);
    expect(transicaoCredenciamentoPermitida("ENCERRADO", "APROVADO")).toBe(false);
  });

  it("desistir é sempre permitido enquanto está em curso", () => {
    expect(transicaoCredenciamentoPermitida("A_PROTOCOLAR", "ENCERRADO")).toBe(true);
    expect(transicaoCredenciamentoPermitida("EM_ANALISE", "ENCERRADO")).toBe(true);
  });

  it("aprovado pode ser encerrado (contrato desfeito depois), mas nunca negado", () => {
    expect(transicaoCredenciamentoPermitida("APROVADO", "ENCERRADO")).toBe(true);
    expect(transicaoCredenciamentoPermitida("APROVADO", "NEGADO")).toBe(false);
  });

  it("recusar a transição explica o porquê em português, para a tela mostrar", () => {
    const motivo = motivoDaTransicaoRecusada("NEGADO", "APROVADO");
    expect(motivo).toBeTruthy();
    expect(motivo).toMatch(/negad/i);
    expect(motivoDaTransicaoRecusada("A_PROTOCOLAR", "PROTOCOLADO")).toBeNull();
  });
});

describe("nova tentativa (§3.4)", () => {
  it("só quem foi negado ou encerrado rende uma tentativa nova", () => {
    expect(proximaTentativa("NEGADO", 1)).toBe(2);
    expect(proximaTentativa("ENCERRADO", 1)).toBe(2);
    expect(proximaTentativa("NEGADO", 2)).toBe(3);
  });

  it("credenciamento em curso ou aprovado NÃO rende tentativa nova", () => {
    // Abrir a 2ª enquanto a 1ª corre criaria duas cobranças pelo mesmo cruzamento.
    expect(proximaTentativa("EM_ANALISE", 1)).toBeNull();
    expect(proximaTentativa("APROVADO", 1)).toBeNull();
    expect(proximaTentativa("A_PROTOCOLAR", 1)).toBeNull();
  });
});

describe("numeração da proposta (§5.5)", () => {
  it("continua a contagem manual da Thaís: ela parou em 224, a próxima é a 225", () => {
    expect(NUMERO_PROPOSTA_INICIAL).toBe(225);
  });

  it("exibe com quatro dígitos, como no papel dela", () => {
    expect(formatarNumeroProposta(225)).toBe("0225");
    expect(formatarNumeroProposta(34)).toBe("0034");
    expect(formatarNumeroProposta(1234)).toBe("1234");
  });

  it("acima de quatro dígitos não corta o número", () => {
    expect(formatarNumeroProposta(12345)).toBe("12345");
  });
});

describe("valor por extenso (usado no documento)", () => {
  it("escreve o valor como o documento da Thaís escreve", () => {
    expect(valorPorExtenso(1500)).toBe("mil e quinhentos reais");
    expect(valorPorExtenso(4200)).toBe("quatro mil e duzentos reais");
  });

  it("zero e nulo não viram texto", () => {
    expect(valorPorExtenso(0)).toBe("");
    expect(valorPorExtenso(null)).toBe("");
  });
});
