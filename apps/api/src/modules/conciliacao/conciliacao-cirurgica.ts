/**
 * CONCILIAÇÃO — Fase 2b: a regra do dinheiro de cada cirurgia. Pura: sem banco, sem Prisma.
 *
 * Spec: `docs/superpowers/specs/2026-09-18-conciliacao-fase-2b-design.md`.
 *
 * ⚠️ O status é CALCULADO, nunca gravado. Gravado, ele envelhece no dia em que alguém corrige um
 * valor — e a tela passaria a dizer "pago" de uma cirurgia que o número ao lado mostra glosada.
 * Toda conta é feita em CENTAVOS inteiros: `0.1 + 0.2` não é `0.3`, e um centavo de ruído de
 * ponto flutuante viraria "glosa parcial" na frente do médico.
 */

export type StatusConciliacao =
  /** O TASY não diz que ela aconteceu (reservada, cancelada…). Fora de toda conta de dinheiro. */
  | "NAO_REALIZADA"
  /** Marcada à mão: particular pago direto, cortesia, acordo. Fora da conta. */
  | "NAO_COBRAR"
  /** Sem número de atendimento, o repasse não tem como casar. */
  | "SEM_ATENDIMENTO"
  /** Não se sabe quanto cobrar — falta o de-para do procedimento. */
  | "SEM_VALOR"
  | "A_RECEBER"
  | "PAGO"
  | "GLOSA_PARCIAL"
  | "GLOSA_TOTAL"
  | "PAGO_A_MAIS"
  /** Entrou dinheiro, mas sem referência não dá para dizer se foi o certo. */
  | "RECEBIDO_SEM_VALOR";

export interface EntradaConciliacao {
  statusTasy: "EXECUTADA" | "RESERVADA" | "OUTRO";
  naoCobrar: boolean;
  atendimento: string | null;
  cobrado: number | null;
  recebido: number | null;
}

const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;

export function statusDaConciliacao(e: EntradaConciliacao): StatusConciliacao {
  if (e.statusTasy !== "EXECUTADA") return "NAO_REALIZADA";
  if (e.naoCobrar) return "NAO_COBRAR";

  if (e.recebido === null) {
    if (!e.atendimento) return "SEM_ATENDIMENTO";
    if (e.cobrado === null) return "SEM_VALOR";
    return "A_RECEBER";
  }

  if (e.cobrado === null) return "RECEBIDO_SEM_VALOR";
  const diferenca = centavos(e.cobrado) - centavos(e.recebido);
  if (diferenca === 0) return "PAGO";
  if (diferenca < 0) return "PAGO_A_MAIS";
  if (centavos(e.recebido) === 0) return "GLOSA_TOTAL";
  return "GLOSA_PARCIAL";
}

/** Cobrado − recebido, nunca negativa. Nula enquanto não houve recebimento ou falta referência. */
export function glosaDe(cobrado: number | null, recebido: number | null): number | null {
  if (cobrado === null || recebido === null) return null;
  return reais(Math.max(centavos(cobrado) - centavos(recebido), 0));
}

/**
 * O repasse paga por ATENDIMENTO, e um atendimento pode ter mais de uma cirurgia (3 casos no
 * arquivo real). O valor é repartido proporcionalmente ao cobrado de cada uma, e a sobra de
 * arredondamento vai para a última — a soma bate no centavo com o que o repasse pagou.
 *
 * Se alguma não tem valor de referência, proporção não existe: tudo vai para a primeira e as
 * outras ficam FORA do mapa (recebido desconhecido, não zero). Repartir "igualmente" inventaria um
 * número que ninguém disse — e zero fabricaria uma glosa total que não existiu.
 */
export function repartirRecebido(cirurgias: { id: string; cobrado: number | null }[], total: number): Map<string, number> {
  const saida = new Map<string, number>();
  if (cirurgias.length === 0) return saida;
  const totalC = centavos(total);

  const semReferencia = cirurgias.some((c) => c.cobrado === null || centavos(c.cobrado) <= 0);
  if (cirurgias.length === 1 || semReferencia) {
    saida.set(cirurgias[0]!.id, reais(totalC));
    return saida;
  }

  const base = cirurgias.reduce((s, c) => s + centavos(c.cobrado!), 0);
  let distribuido = 0;
  cirurgias.forEach((c, i) => {
    const parte = i === cirurgias.length - 1 ? totalC - distribuido : Math.round((totalC * centavos(c.cobrado!)) / base);
    distribuido += parte;
    saida.set(c.id, reais(parte));
  });
  return saida;
}
