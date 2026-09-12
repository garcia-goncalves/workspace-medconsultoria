import { describe, it, expect } from "vitest";
import { percentilBuckets, BUCKET_BOUNDS } from "./percentil.js";

/**
 * A aba SISTEMA → Desempenho mostrava, lado a lado, números que não podem ser verdade juntos.
 * Medido no localhost em 28/08/2026:
 *
 *     ENDPOINT     CHAMADAS  MÉDIA  P95     MÁX
 *     agenda.list  9         33ms   256ms   184ms
 *     cards.move   6         51ms   256ms   195ms
 *
 * **O percentil 95 não pode passar do máximo observado** — por definição, é um valor da própria
 * amostra. A causa é o histograma: `percentilBuckets` devolve o LIMITE SUPERIOR do balde
 * (…, 128, 256, 512…), então qualquer chamada de 129 a 256 ms vira "256 ms". Daí a coluna P95 só
 * mostrar potências de 2 e ultrapassar o máximo real.
 *
 * ⚠️ O histograma FICA: trocá-lo por lista de amostras faria o monitor guardar toda chamada em
 * memória, num processo que já serve API + SPA + tempo real. O que muda é o teto — e é o teto que
 * torna o número honesto, porque a aproximação passa a errar só para MENOS, nunca para mais.
 */
describe("percentil por histograma", () => {
  it("NUNCA passa do máximo observado — era o número impossível do painel", () => {
    // 9 chamadas, a mais lenta de 184 ms: todas caem no balde de teto 256.
    const buckets = balde([184, 33, 20, 12, 40, 51, 18, 9, 60]);
    const p95 = percentilBuckets(buckets, 9, 95, 184);
    expect(p95).toBeLessThanOrEqual(184);
  });

  it("com uma amostra só, p95 é aquela amostra — não o teto do balde", () => {
    expect(percentilBuckets(balde([105]), 1, 95, 105)).toBe(105);
  });

  it("continua aproximando por cima dentro do balde, que é a natureza do histograma", () => {
    // 19 chamadas de 10 ms e uma de 500 ms: o p95 é a 19ª mais lenta, ou seja, uma das rápidas.
    // O teto do balde arredonda 10 → 16, e o máximo (500) não interfere. É a aproximação normal
    // do histograma — o que o teto do máximo corrige é o caso INVERSO, poucas amostras no balde
    // alto (o primeiro caso deste arquivo).
    const amostras = [...Array(19).fill(10), 500];
    expect(percentilBuckets(balde(amostras), 20, 95, 500)).toBe(16);
  });

  it("sem chamada nenhuma, devolve zero", () => {
    expect(percentilBuckets(new Array(BUCKET_BOUNDS.length).fill(0), 0, 95, 0)).toBe(0);
  });
});

/** Monta o histograma do mesmo jeito que o `recordCall` faz. */
function balde(amostras: number[]): number[] {
  const b = new Array(BUCKET_BOUNDS.length).fill(0);
  for (const ms of amostras) {
    let i = BUCKET_BOUNDS.findIndex((limite) => ms <= limite);
    if (i < 0) i = BUCKET_BOUNDS.length - 1;
    b[i]++;
  }
  return b;
}
