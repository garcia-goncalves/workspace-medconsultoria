import { describe, it, expect } from "vitest";
import { dividirEstimativaDoLead, NOME_SERVICO_CREDENCIAMENTO } from "@app/shared";

/**
 * F8 — O FUNIL SOMAVA MENSAL COM AVULSO NO MESMO TOTAL.
 *
 * "Total da coluna", no board de Vendas, e os números do Início somavam R$ 3.500/mês com
 * R$ 1.500 de cobrança única como se fossem a mesma coisa. Não é cobrança errada — é relatório
 * errado, que é pior de outro jeito: o número não significa nada e mesmo assim é usado para
 * decidir. R$ 5.000 de quê? Por mês? Uma vez?
 *
 * A régua fica aqui, pura e num lugar só, porque quem a aplica são DOIS lugares — o board
 * (`LeadsPipelinePage`) e o painel do Início (`dashboard.service`) — e duas cópias divergiriam,
 * que é o modo de falha da ADR-133.
 *
 * ⚠️ Quem decide o que é mensal é o **PREÇO**, nunca a categoria (ADR-125/126/138). O serviço
 * cobrado só por percentual é mensal por natureza: o `valorEstimado` dele é derivado do
 * faturamento (ADR-125) e vale por mês.
 */

const servico = (
  nome: string,
  p: { valor?: number | null; valorRecorrencia?: string | null; percentual?: number | null } = {},
) => ({
  nome,
  valor: p.valor ?? null,
  valorRecorrencia: p.valorRecorrencia ?? "AVULSO",
  percentual: p.percentual ?? null,
});

describe("F8 — o valor do funil sai separado: recorrente × avulso", () => {
  it("mensal e avulso não se somam", () => {
    const d = dividirEstimativaDoLead(
      [
        servico("Gestão operacional", { valor: 3500, valorRecorrencia: "MENSAL" }),
        servico("Site institucional", { valor: 1500, valorRecorrencia: "AVULSO" }),
      ],
      5000,
    );
    expect(d).toEqual({ mensal: 3500, avulso: 1500 });
  });

  it("serviço só percentual é MENSAL — o valor estimado dele é derivado do faturamento", () => {
    const d = dividirEstimativaDoLead([servico("Faturamento médico", { percentual: 5 })], 6000);
    expect(d).toEqual({ mensal: 6000, avulso: 0 });
  });

  it("sem preço de serviço, a estimativa digitada à mão conta como AVULSA", () => {
    // É o que a conversão do lead provisiona nesse caso: uma conta única (`recorrencia NENHUMA`).
    const d = dividirEstimativaDoLead([], 8000);
    expect(d).toEqual({ mensal: 0, avulso: 8000 });
  });

  it("o credenciamento fica fora dos dois — o honorário só nasce quando a operadora aprova", () => {
    const d = dividirEstimativaDoLead(
      [servico(NOME_SERVICO_CREDENCIAMENTO, { valor: 2500, valorRecorrencia: "AVULSO" })],
      2500,
    );
    expect(d, "credenciamento não é receita prevista do funil").toEqual({ mensal: 0, avulso: 0 });
  });

  it("lead sem serviço e sem estimativa vale zero nos dois", () => {
    expect(dividirEstimativaDoLead([], null)).toEqual({ mensal: 0, avulso: 0 });
    expect(dividirEstimativaDoLead([], 0)).toEqual({ mensal: 0, avulso: 0 });
  });

  it("havendo preço de serviço, a estimativa do funil não entra de novo (não dobra o número)", () => {
    const d = dividirEstimativaDoLead(
      [servico("Gestão", { valor: 1200, valorRecorrencia: "MENSAL" })],
      99999,
    );
    expect(d).toEqual({ mensal: 1200, avulso: 0 });
  });

  it("recorrência nula é tratada como avulsa, igual ao resto do sistema", () => {
    const d = dividirEstimativaDoLead([servico("Consultoria", { valor: 700, valorRecorrencia: null })], 700);
    expect(d).toEqual({ mensal: 0, avulso: 700 });
  });
});
