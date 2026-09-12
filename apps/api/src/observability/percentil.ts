/**
 * Percentil de latência a partir de um histograma de baldes exponenciais.
 *
 * Mora aqui, e não dentro do `monitor.ts`, porque o monitor instala um `PerformanceObserver` de
 * GC assim que é importado — carregá-lo num teste de unidade só para exercer uma conta de
 * percentil seria ligar a observabilidade do processo inteiro.
 */
export const BUCKET_BOUNDS = [
  1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, Infinity,
];

/**
 * Percentil aproximado: devolve o limite superior do balde em que o alvo cai, **nunca acima do
 * máximo realmente observado**.
 *
 * O teto pelo `maxMs` é o que impede o número impossível que a aba Desempenho mostrava — P95 de
 * 256 ms ao lado de um máximo de 184 ms. Sem ele, a aproximação erra para MAIS e contradiz a
 * coluna vizinha; com ele, erra só para menos, que é o lado seguro de um número usado para
 * decidir o que otimizar.
 */
export function percentilBuckets(
  buckets: number[],
  count: number,
  p: number,
  maxMs: number,
): number {
  if (count === 0) return 0;
  const alvo = Math.ceil((p / 100) * count);
  let acc = 0;
  for (let i = 0; i < buckets.length; i++) {
    acc += buckets[i] ?? 0;
    if (acc >= alvo) {
      const bound = BUCKET_BOUNDS[i] ?? 0;
      const teto = bound === Infinity ? (BUCKET_BOUNDS[i - 1] ?? 0) : bound;
      return Math.min(teto, Math.round(maxMs));
    }
  }
  return 0;
}
