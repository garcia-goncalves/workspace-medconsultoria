import { dividirEstimativaDoLead, type DivisaoDaEstimativa } from "@app/shared";

/**
 * F13 — O CARD E O PAINEL DO LEAD MOSTRAVAM UM PERCENTUAL COMO SE FOSSE PAGAMENTO ÚNICO.
 *
 * Para um lead 100% percentual (Faturamento), `valorEstimado` é MENSAL — mas as duas telas
 * imprimiam `formatBRL(valorEstimado)` puro, e a Thaís lia "R$ 6.000,00" como fechamento do
 * mês, superestimando o funil. A régua de "isto é mensal ou avulso" já existe em
 * `dividirEstimativaDoLead` (`@app/shared`, F8) — aqui só reaproveitamos.
 *
 * `leads.detalhe` (usado pelo painel) não devolve preço de serviço, só `{id, nome}` — por isso
 * `estimativaDoLeadComPreco` cruza com o catálogo (`servicos.ativos`, já carregado por outras
 * telas do lead) antes de chamar a régua central. O card já recebe `estimativa` pronta do
 * servidor (`leads.list`) e não precisa deste cruzamento.
 */

export interface ServicoDoLead {
  id: string;
  nome: string;
}

export interface PrecoDoServicoNoCatalogo {
  id: string;
  valor: number | null;
  valorRecorrencia: string | null;
  percentual: number | null;
  /**
   * A marca do credenciamento — ver `ehServicoDeCredenciamento` em `@app/shared`.
   * OBRIGATÓRIA de propósito: opcional com `?? false` é o padrão silencioso que a assinatura da
   * régua veio impedir — se o catálogo parar de selecionar o campo, o compilador precisa
   * reclamar, em vez de o credenciamento voltar a contar como receita prevista do funil.
   */
  ehCredenciamento: boolean;
}

/**
 * Junta os serviços do lead (só id/nome, o que `leads.detalhe` devolve) com o preço do
 * catálogo, para reusar a régua central de mensal×avulso. Serviço sem correspondência no
 * catálogo (ex.: desativado depois) fica sem preço — cai no mesmo tratamento de "sem preço de
 * serviço nenhum" que a régua já dá, nunca quebra.
 */
export function estimativaDoLeadComPreco(
  servicosDoLead: ServicoDoLead[],
  catalogo: PrecoDoServicoNoCatalogo[],
  valorEstimado: number | null,
): DivisaoDaEstimativa {
  const porId = new Map(catalogo.map((s) => [s.id, s]));
  const servicos = servicosDoLead.map((s) => {
    const preco = porId.get(s.id);
    return {
      nome: s.nome,
      valor: preco?.valor ?? null,
      valorRecorrencia: preco?.valorRecorrencia ?? null,
      percentual: preco?.percentual ?? null,
      // A marca vem do catálogo (`servicos.ativos`); sem ela a régua trataria o credenciamento
      // como receita prevista do funil, que é justamente o que a ADR-104 proíbe.
      ehCredenciamento: preco?.ehCredenciamento === true,
    };
  });
  return dividirEstimativaDoLead(servicos, valorEstimado);
}

/**
 * "/mês" só quando o valor mostrado é PURAMENTE recorrente (percentual, ou fixo mensal).
 * Valor avulso não leva sufixo; valor misto (mensal + avulso) também não — dizer "/mês" ali
 * seria tão enganoso quanto o defeito original, porque só uma fração daquele número se repete.
 */
export function sufixoDeRecorrencia(estimativa: DivisaoDaEstimativa): string {
  return estimativa.mensal > 0 && estimativa.avulso === 0 ? "/mês" : "";
}
