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
  extra: {
    valor?: number | null;
    valorRecorrencia?: string | null;
    percentual?: number | null;
    ehCredenciamento?: boolean;
  } = {},
) => ({
  nome,
  valor: extra.valor ?? null,
  valorRecorrencia: extra.valorRecorrencia ?? null,
  percentual: extra.percentual ?? null,
  // O default segue o nome só para os casos ANTIGOS deste arquivo continuarem legíveis; os
  // casos que provam a regra nova passam a marca explicitamente, nos dois sentidos.
  ehCredenciamento: extra.ehCredenciamento ?? nome === CREDENCIAMENTO,
});

const CREDENCIAMENTO = "Credenciamento médico e odontológico";

describe("provisão financeira da conversão do lead", () => {
  // ⚠️ QUEM DIZ QUE UM SERVIÇO É O CREDENCIAMENTO É A MARCA `ehCredenciamento`, NUNCA O NOME.
  // Enquanto a comparação era por nome, corrigir um typo em Ajustes → Serviços religava a
  // cobrança antecipada: a conversão do lead passava a gerar conta a receber, e a aprovação da
  // operadora gerava a SEGUNDA pelo mesmo honorário. Os dois casos abaixo são as duas metades
  // dessa porta: o nome mudado não pode desligar a regra, e o nome copiado não pode ligá-la.
  it("renomear o serviço NÃO religa a cobrança — a marca é que manda", () => {
    const p = planejarProvisaoDaConversao(
      [servico("Credenciamento junto às operadoras", { valor: 2500, ehCredenciamento: true })],
      25000,
    );
    expect(p.temCredenciamento).toBe(true);
    expect(p.avulso).toBe(0);
    expect(p.usarEstimativa).toBe(false);
  });

  it("serviço comum que TENHA o nome do credenciamento não vira credenciamento", () => {
    const p = planejarProvisaoDaConversao(
      [servico(CREDENCIAMENTO, { valor: 500, valorRecorrencia: "NENHUMA", ehCredenciamento: false })],
      25000,
    );
    expect(p.temCredenciamento).toBe(false);
    expect(p.avulso).toBe(500);
  });

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

  /**
   * F1 da descoberta de 28/08 — o achado que custava dinheiro errado.
   *
   * A ADR-125 tornou o `Lead.valorEstimado` DERIVADO no serviço percentual: ele passou a ser
   * faturamento × percentual, calculado pelo sistema. O comentário aqui em cima jurava que a
   * cobrança por % "é registrada em texto, nunca como valor fixo" — e o teste que provava isso
   * passava a estimativa como ZERO, que é o único número com que ele passaria.
   *
   * Com a estimativa preenchida (que é o normal desde a ADR-125), o lead de Faturamento caía no
   * fallback e virava uma conta a receber AVULSA, de valor fixo, no ato da conversão: um número
   * que só valia para o faturamento daquele mês, cobrado uma vez só, sem nada dizendo de onde
   * veio. A régua agora é a MESMA do funil (`planejarEstimativaDoLead`) — estimativa derivada de
   * percentual não vira conta.
   */
  it("lead SÓ de Faturamento não vira conta fixa, mesmo com a estimativa derivada preenchida", () => {
    // 5% de R$ 120.000 = R$ 6.000 — é este número que virava "Contrato — Clínica X", avulso.
    const p = planejarProvisaoDaConversao([servico("Faturamento", { percentual: 5 })], 6000);
    expect(p.usarEstimativa).toBe(false);
    expect(p.avulso).toBe(0);
    expect(p.mensal).toBe(0);
    expect(p.percentuais).toEqual(["5% do faturamento (Faturamento)"]);
  });

  it("percentual + serviço sem preço também não vira conta fixa — a estimativa segue derivada", () => {
    const p = planejarProvisaoDaConversao(
      [servico("Faturamento", { percentual: 5 }), servico("Gestão de redes sociais")],
      6000,
    );
    expect(p.usarEstimativa).toBe(false);
  });

  it("MISTURADO (percentual + valor fixo) continua provisionando o fixo, como sempre", () => {
    // Aqui há dinheiro fixo em jogo: some o valor fixo e o % vai para a observação. É a mesma
    // escolha da ADR-125 no funil — deixar o modo percentual vencer esconderia o fixo.
    const p = planejarProvisaoDaConversao(
      [servico("Faturamento", { percentual: 5 }), servico("Gestão Operacional", { valor: 3500, valorRecorrencia: "MENSAL" })],
      9500,
    );
    expect(p.mensal).toBe(3500);
    expect(p.percentuais).toEqual(["5% do faturamento (Faturamento)"]);
    expect(p.usarEstimativa).toBe(false);
  });

  it("credenciamento + Faturamento: nada a provisionar hoje, e os dois motivos ficam registrados", () => {
    const p = planejarProvisaoDaConversao(
      [servico(CREDENCIAMENTO), servico("Faturamento", { percentual: 5 })],
      6000,
    );
    expect(p.usarEstimativa).toBe(false);
    expect(p.temCredenciamento).toBe(true);
    expect(p.percentuais.length).toBe(1);
  });

  // A tolerância a caixa e espaço no NOME era necessária enquanto o nome decidia a regra. Ela
  // não sumiu: mudou de lugar, para o backfill da migração `20260829203721` (`LOWER(TRIM(...))`),
  // que é onde a comparação por nome acontece uma vez só, na vida do banco. Aqui, o que importa
  // é que o nome — em qualquer grafia — não decide mais nada.
  it("nome com caixa e espaço diferentes não decide nada: quem manda é a marca", () => {
    const semMarca = planejarProvisaoDaConversao(
      [servico("  credenciamento MÉDICO e odontológico ", { valor: 900, ehCredenciamento: false })],
      5000,
    );
    expect(semMarca.temCredenciamento).toBe(false);
    expect(semMarca.avulso).toBe(900);

    const comMarca = planejarProvisaoDaConversao(
      [servico("  credenciamento MÉDICO e odontológico ", { valor: 900, ehCredenciamento: true })],
      5000,
    );
    expect(comMarca.temCredenciamento).toBe(true);
    expect(comMarca.avulso).toBe(0);
  });
});
