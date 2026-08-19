/**
 * Dinheiro sai do banco como `Decimal` (ADR-118) e chega à tela como `number`.
 * Estas duas funções são a fronteira: nada de `Decimal` atravessa o tRPC.
 *
 * Por que Decimal no banco: `Float` é binário e não representa R$ 0,10 exatamente —
 * somar dez parcelas de R$ 0,10 dava R$ 0,9999999999999999. O `DECIMAL(12,2)` do MySQL
 * guarda centavo como centavo. A conversão para `number` acontece aqui, no serviço, e
 * é segura: R$ 99.999.999.999,99 ainda cabe com folga no inteiro seguro do JavaScript.
 */

/** Aceita o que o Prisma devolver (Decimal, number ou null) e responde em reais. */
export function emReais(v: { toNumber(): number } | number | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "number" ? v : v.toNumber();
}

/** Mesma conversão, para campo obrigatório (ou com padrão): nunca devolve null. */
export function emReaisOu(v: { toNumber(): number } | number | null | undefined, padrao = 0): number {
  return emReais(v) ?? padrao;
}
