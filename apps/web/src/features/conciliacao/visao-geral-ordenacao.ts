import type { DirecaoOrdenacao, OrdenacaoAtual } from "../../components/ui/data-table-ordenacao";

/**
 * Colunas ordenáveis da Visão geral da Conciliação (`VisaoGeralConciliacao.tsx`).
 */
export type ChaveOrdenacaoVisaoGeral =
  | "cliente"
  | "cobrado"
  | "recebido"
  | "glosa"
  | "aReceber"
  | "aReceberAtrasado"
  | "glosaSemRecurso"
  | "honorarioALancar";

/**
 * Direção do PRIMEIRO clique em cada coluna. "Cliente" é texto — começa em A→Z, como qualquer
 * lista. As de dinheiro/problema começam DECRESCENTE: o primeiro clique em "Glosa" ou "A receber"
 * mostra quem deve mais / quem tem mais dinheiro parado primeiro — é a pergunta da manhã
 * ("onde está o dinheiro parado?"), e ninguém começa essa pergunta pelo menor valor.
 */
export const DIRECAO_INICIAL: Record<ChaveOrdenacaoVisaoGeral, DirecaoOrdenacao> = {
  cliente: "asc",
  cobrado: "desc",
  recebido: "desc",
  glosa: "desc",
  aReceber: "desc",
  aReceberAtrasado: "desc",
  glosaSemRecurso: "desc",
  honorarioALancar: "desc",
};

/**
 * Decide a PRÓXIMA ordenação ao clicar num cabeçalho: nenhuma (ordem do servidor —
 * `conciliacao-painel.service.ts`, glosa + atraso) → direção INICIAL da coluna → direção oposta →
 * nenhuma de novo. Clicar numa coluna DIFERENTE da ativa sempre recomeça na direção inicial DELA,
 * nunca herda a direção da coluna anterior.
 *
 * ⚠️ Diferente de `proximaOrdenacao` (`components/ui/data-table-ordenacao.ts`), que sempre começa
 * crescente para toda coluna: aqui cada coluna tem sua própria direção inicial (`DIRECAO_INICIAL`),
 * porque "maior problema primeiro" é o que se quer ao clicar em Glosa, não "do menor ao maior".
 */
export function proximaOrdenacaoVisaoGeral(
  atual: OrdenacaoAtual | null,
  chaveClicada: ChaveOrdenacaoVisaoGeral,
): OrdenacaoAtual | null {
  const inicial = DIRECAO_INICIAL[chaveClicada];
  if (!atual || atual.chave !== chaveClicada) return { chave: chaveClicada, direcao: inicial };
  if (atual.direcao === inicial) return { chave: chaveClicada, direcao: inicial === "asc" ? "desc" : "asc" };
  return null;
}
