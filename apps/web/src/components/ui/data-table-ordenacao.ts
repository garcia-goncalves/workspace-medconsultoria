/**
 * Lógica pura de ordenação da `DataTable` — sem React, sem DOM. Separada do componente para
 * poder ser testada direto (a regra de negócio é "qual linha vem antes de qual", não "como
 * desenhar a seta").
 */

export type DirecaoOrdenacao = "asc" | "desc";

export type OrdenacaoAtual = { chave: string; direcao: DirecaoOrdenacao };

/**
 * Compara dois valores de ordenação. `null` é tratado como AUSÊNCIA de dado, não como "o menor
 * valor" — por isso fica sempre por último aqui. A inversão de sinal para ordem decrescente é
 * feita por `ordenarPor`, não aqui, senão o nulo "decrescente" voltaria para o topo.
 */
export function compararValores(a: string | number | Date | null, b: string | number | Date | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  // Texto: pt-BR (acento/maiúscula não importam) + numérico ("Item 2" antes de "Item 10").
  return String(a).localeCompare(String(b), "pt-BR", { sensitivity: "base", numeric: true });
}

/** Ordena uma CÓPIA da lista pelo valor extraído de cada item. Nunca muta `itens`. */
export function ordenarPor<T>(
  itens: readonly T[],
  valorDe: (item: T) => string | number | Date | null,
  direcao: DirecaoOrdenacao,
): T[] {
  return [...itens].sort((x, y) => {
    const a = valorDe(x);
    const b = valorDe(y);
    const cmp = compararValores(a, b);
    // Nulo fica sempre no fim, em QUALQUER direção — invertendo o sinal também para ele, a ordem
    // decrescente o traria para o topo, e "sem dado" não é "o maior dado".
    if (a == null || b == null) return cmp;
    return direcao === "asc" ? cmp : -cmp;
  });
}

/**
 * Decide a PRÓXIMA ordenação ao clicar num cabeçalho de coluna: nenhuma → crescente →
 * decrescente → nenhuma de novo. Clicar numa coluna DIFERENTE da ativa sempre recomeça em
 * crescente — senão a decrescente "vazaria" de uma coluna para a outra.
 */
export function proximaOrdenacao(atual: OrdenacaoAtual | null, chaveClicada: string): OrdenacaoAtual | null {
  if (!atual || atual.chave !== chaveClicada) return { chave: chaveClicada, direcao: "asc" };
  if (atual.direcao === "asc") return { chave: chaveClicada, direcao: "desc" };
  return null;
}
