import { describe, it, expect } from "vitest";
import { planejarProvisaoDaConversao } from "../modules/servicos/credenciamento.service.js";

/**
 * O que a CONVERSÃO DO LEAD pode provisionar no Financeiro.
 *
 * A regra dura vem da spec §3.3 e da ADR-104: no credenciamento o honorário é **no
 * sucesso** — a conta a receber nasce quando a operadora APROVA, nunca no aceite, nem ao
 * contratar o serviço, nem na conversão do lead.
 *
 * O laço da soma já pulava o credenciamento, mas o FALLBACK da estimativa do funil não
 * sabia disso: lead cujo único serviço era credenciamento caía no `else` e virava uma
 * conta "Contrato — <cliente>" no ato da conversão. Reproduzido na tela em 17/08/2026
 * (Clínica Vida Plena, só credenciamento, R$ 250,00 a receber sem operadora nenhuma ter
 * dito nada) — e depois cobrado DE NOVO quando a operadora aprovasse.
 */

const servico = (
  nome: string,
  extra: { valor?: number | null; valorRecorrencia?: string | null; percentual?: number | null } = {},
) => ({
  nome,
  valor: extra.valor ?? null,
  valorRecorrencia: extra.valorRecorrencia ?? null,
  percentual: extra.percentual ?? null,
});

const CREDENCIAMENTO = "Credenciamento médico e odontológico";

describe("provisão financeira da conversão do lead", () => {
  it("lead SÓ de credenciamento não provisiona nada, mesmo com estimativa no funil", () => {
    const p = planejarProvisaoDaConversao([servico(CREDENCIAMENTO)], 25000);
    expect(p.avulso).toBe(0);
    expect(p.mensal).toBe(0);
    expect(p.usarEstimativa).toBe(false);
    expect(p.temCredenciamento).toBe(true);
  });

  it("nem quando o serviço de credenciamento tem preço de catálogo", () => {
    // Preço no catálogo é referência para a proposta, não autorização para cobrar hoje.
    const p = planejarProvisaoDaConversao([servico(CREDENCIAMENTO, { valor: 2500 })], 25000);
    expect(p.avulso).toBe(0);
    expect(p.usarEstimativa).toBe(false);
  });

  it("lead sem serviço nenhum continua provisionando pela estimativa do funil", () => {
    const p = planejarProvisaoDaConversao([], 8000);
    expect(p.usarEstimativa).toBe(true);
    expect(p.temCredenciamento).toBe(false);
  });

  it("serviço comum sem preço cai na estimativa do funil, como antes", () => {
    const p = planejarProvisaoDaConversao([servico("Gestão de redes sociais")], 8000);
    expect(p.usarEstimativa).toBe(true);
  });

  it("soma avulso e mensal separados e ignora o credenciamento na soma", () => {
    const p = planejarProvisaoDaConversao(
      [
        servico("Desenvolvimento de site", { valor: 12000, valorRecorrencia: "NENHUMA" }),
        servico("Gestão de redes sociais", { valor: 3000, valorRecorrencia: "MENSAL" }),
        servico(CREDENCIAMENTO, { valor: 2500, valorRecorrencia: "NENHUMA" }),
      ],
      99000,
    );
    expect(p.avulso).toBe(12000);
    expect(p.mensal).toBe(3000);
    expect(p.usarEstimativa).toBe(false);
    expect(p.temCredenciamento).toBe(true);
  });

  it("estimativa zerada ou ausente não vira conta", () => {
    expect(planejarProvisaoDaConversao([], 0).usarEstimativa).toBe(false);
    expect(planejarProvisaoDaConversao([], null).usarEstimativa).toBe(false);
  });

  it("cobrança por % do faturamento é registrada em texto, nunca como valor fixo", () => {
    const p = planejarProvisaoDaConversao([servico("Faturamento", { percentual: 5 })], 0);
    expect(p.percentuais).toEqual(["5% do faturamento (Faturamento)"]);
    expect(p.avulso).toBe(0);
  });

  it("compara o nome do serviço sem se importar com caixa e espaço", () => {
    const p = planejarProvisaoDaConversao([servico("  credenciamento MÉDICO e odontológico ")], 5000);
    expect(p.usarEstimativa).toBe(false);
  });
});
