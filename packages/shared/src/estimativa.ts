/**
 * A ESTIMATIVA DO NEGÓCIO NO FUNIL — qual pergunta faz sentido para estes serviços.
 *
 * O funil sempre exigiu "Registrar o valor estimado da oportunidade" como passo obrigatório da
 * Qualificação. Só que o **Faturamento de contas médicas não tem valor fixo**: a Med ganha um
 * percentual sobre o que a clínica fatura. O passo travava a etapa pedindo um número que não
 * existe, e quem digitava um valor qualquer para destravar sujava o relatório.
 *
 * A regra aqui não cita "Faturamento" em lugar nenhum — ela lê o PREÇO dos serviços escolhidos.
 * Hoje isso só alcança o Faturamento (é o único serviço 100% percentual), e continua correta se
 * amanhã a Thaís criar outro. Casar por NOME é a fragilidade que já existe no credenciamento;
 * não vale repeti-la.
 *
 * O credenciamento fica FORA da conta, pelo mesmo motivo que já o tira do provisionamento da
 * conversão (ADR-104/108): o honorário dele só nasce quando a operadora aprova. Duas regras sobre
 * o mesmo dinheiro têm de concordar — daí `ehServicoDeCredenciamento` morar aqui, no pacote
 * compartilhado, e não em cada lado.
 *
 * Função pura (sem I/O, sem Prisma) porque a MESMA resposta é necessária nos dois lados: o
 * servidor decide o passo obrigatório, e a tela decide qual campo mostrar. Duas implementações
 * discordariam no primeiro caso de borda.
 */

/** O serviço de credenciamento, identificado pelo nome do catálogo. */
export const NOME_SERVICO_CREDENCIAMENTO = "Credenciamento médico e odontológico";

/** Este serviço é o credenciamento? (honorário só no sucesso — fora de toda estimativa) */
export function ehServicoDeCredenciamento(nome: string | null | undefined): boolean {
  return !!nome && nome.trim().toLowerCase() === NOME_SERVICO_CREDENCIAMENTO.toLowerCase();
}

/** Um serviço do lead, só com o que decide a estimativa. */
export interface ServicoParaEstimativa {
  nome: string | null;
  valor: number | null;
  percentual: number | null;
}

/**
 * `VALOR_FIXO` — a pergunta é "quanto você espera fechar?" (o comportamento de sempre).
 * `PERCENTUAL` — a pergunta é "quanto o cliente fatura por mês?", e o valor sai da conta.
 */
export type ModoEstimativa = "VALOR_FIXO" | "PERCENTUAL";

export interface EstimativaDoLead {
  modo: ModoEstimativa;
  /** Soma dos percentuais dos serviços percentuais (ex.: 5 = 5%). Zero no modo VALOR_FIXO. */
  percentualTotal: number;
  /** Faturamento × percentual, com 2 casas. `null` quando não dá para calcular ainda. */
  valorEstimadoCalculado: number | null;
}

/** Título do passo automático em cada modo — o servidor grava, a tela lê. */
export const TITULO_PASSO_VALOR = "Registrar o valor estimado da oportunidade";
export const TITULO_PASSO_FATURAMENTO = "Registrar o faturamento mensal estimado do cliente";

/** Arredonda para centavos sem o erro clássico de ponto flutuante. */
function emCentavos(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Decide a pergunta e, no modo percentual, calcula o valor do negócio.
 *
 * Ordem das guardas, e o porquê de cada uma:
 *  - **qualquer serviço com valor fixo → VALOR_FIXO.** No caso misturado (Faturamento + Gestão
 *    Operacional) há dinheiro fixo em jogo, e a estimativa segue sendo a pergunta certa. Deixar
 *    o modo percentual vencer aqui esconderia o valor fixo do relatório.
 *  - **nenhum fixo, mas há percentual → PERCENTUAL.** É o caso do Faturamento sozinho.
 *  - **nada com preço (nenhum serviço escolhido, ou só credenciamento) → VALOR_FIXO.** Mantém o
 *    comportamento de hoje: o passo continua pedindo a estimativa, e a conversão já sabe não
 *    provisionar credenciamento.
 */
export function planejarEstimativaDoLead(
  servicos: ServicoParaEstimativa[],
  faturamentoMensal: number | null | undefined,
): EstimativaDoLead {
  let temFixo = false;
  let percentualTotal = 0;

  for (const s of servicos) {
    if (ehServicoDeCredenciamento(s.nome)) continue;
    if (s.valor != null && s.valor > 0) temFixo = true;
    if (s.percentual != null && s.percentual > 0) percentualTotal += s.percentual;
  }

  if (temFixo || percentualTotal <= 0) {
    return { modo: "VALOR_FIXO", percentualTotal: 0, valorEstimadoCalculado: null };
  }

  const base = faturamentoMensal ?? 0;
  return {
    modo: "PERCENTUAL",
    percentualTotal: emCentavos(percentualTotal),
    valorEstimadoCalculado: base > 0 ? emCentavos((base * percentualTotal) / 100) : null,
  };
}

/** O título que o passo automático da Qualificação deve ter, dado o modo. */
export function tituloDoPassoDeEstimativa(modo: ModoEstimativa): string {
  return modo === "PERCENTUAL" ? TITULO_PASSO_FATURAMENTO : TITULO_PASSO_VALOR;
}
