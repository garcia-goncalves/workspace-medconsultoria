import { describe, expect, it } from "vitest";
import { estimativaDoLeadComPreco, sufixoDeRecorrencia } from "./estimativa-do-lead";

// F13 — o card e o painel do lead mostravam "R$ 6.000,00" para um negócio 100% percentual
// (Faturamento), que é MENSAL, como se fosse pagamento único. A régua de mensal×avulso já
// existe em @app/shared (`dividirEstimativaDoLead`) — aqui só cruzamos com o preço do
// catálogo, porque `leads.detalhe` não devolve valor/percentual do serviço.

describe("sufixoDeRecorrencia", () => {
  it("mostra /mês quando o valor é 100% mensal (percentual ou fixo recorrente)", () => {
    expect(sufixoDeRecorrencia({ mensal: 6000, avulso: 0 })).toBe("/mês");
  });

  it("NÃO mostra sufixo quando o valor é avulso (cobrança única)", () => {
    expect(sufixoDeRecorrencia({ mensal: 0, avulso: 1500 })).toBe("");
  });

  it("NÃO mostra sufixo quando o valor é misto (mensal + avulso) — ambíguo", () => {
    expect(sufixoDeRecorrencia({ mensal: 3500, avulso: 1500 })).toBe("");
  });

  it("NÃO mostra sufixo quando não há nada estimado ainda", () => {
    expect(sufixoDeRecorrencia({ mensal: 0, avulso: 0 })).toBe("");
  });
});

describe("estimativaDoLeadComPreco", () => {
  it("lê um serviço 100% percentual do catálogo (Faturamento) e classifica como mensal", () => {
    const catalogo = [
      { id: "s1", nome: "Faturamento de contas médicas", valor: null, valorRecorrencia: null, percentual: 5, ehCredenciamento: false },
    ];
    const r = estimativaDoLeadComPreco([{ id: "s1", nome: "Faturamento de contas médicas" }], catalogo, 6000);
    expect(r).toEqual({ mensal: 6000, avulso: 0 });
  });

  it("lê um serviço de valor fixo AVULSO do catálogo e classifica como avulso", () => {
    const catalogo = [
      { id: "s2", nome: "Onboarding", valor: 1500, valorRecorrencia: "AVULSO", percentual: null, ehCredenciamento: false },
    ];
    const r = estimativaDoLeadComPreco([{ id: "s2", nome: "Onboarding" }], catalogo, 1500);
    expect(r).toEqual({ mensal: 0, avulso: 1500 });
  });

  it("serviço não encontrado no catálogo (ex.: inativo) não quebra — fica sem preço", () => {
    const r = estimativaDoLeadComPreco([{ id: "sumiu", nome: "Removido" }], [], 800);
    expect(r).toEqual({ mensal: 0, avulso: 800 });
  });
});
