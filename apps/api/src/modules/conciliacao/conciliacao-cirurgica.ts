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

/** O nome de cada status em português — um lugar só, lido pela tela, pela planilha e pelos erros. */
export const ROTULO_STATUS: Record<StatusConciliacao, string> = {
  NAO_REALIZADA: "Não realizada",
  NAO_COBRAR: "Não cobrar",
  SEM_ATENDIMENTO: "Sem atendimento",
  SEM_VALOR: "Sem valor de referência",
  A_RECEBER: "A receber",
  PAGO: "Pago",
  GLOSA_PARCIAL: "Glosa parcial",
  GLOSA_TOTAL: "Glosa total",
  PAGO_A_MAIS: "Pago a mais",
  RECEBIDO_SEM_VALOR: "Recebido sem referência",
};

// ─── O tempo, que é o que separa "a receber" de "travado" ──────────────────────────────────────

/**
 * ⚠️ A DEFASAGEM NORMAL ENTRE A CIRURGIA E O PAGAMENTO, EM DIAS.
 *
 * Medida nas amostras reais do cliente: cerca de **três meses e meio**. É o número que separa o
 * que está apenas *esperando* do que está *travado* — sem ele, uma cirurgia de um ano atrás e uma
 * do mês passado dizem exatamente a mesma coisa na tela ("a receber"), e a pergunta da manhã
 * ("o que travou?") não tem resposta.
 *
 * Constante, e não campo em Ajustes, de propósito: é uma característica do ciclo das operadoras,
 * não uma preferência da casa, e ninguém pediu para ajustá-la. Virar campo é uma migração no dia
 * em que alguém quiser — e aí o número já estará escrito aqui, medido, para ser o padrão.
 */
export const DIAS_ATE_O_PAGAMENTO_ESPERADO = 105;

/**
 * Esta cirurgia já passou do prazo em que o dinheiro deveria ter entrado?
 *
 * ⚠️ Só vale para o que de fato está esperando dinheiro: `A_RECEBER`, `SEM_VALOR` (nem se sabe
 * quanto cobrar) e `SEM_ATENDIMENTO` (não há como casar o repasse). O que já foi pago, o que não
 * se cobra e o que não aconteceu **nunca** estão atrasados — marcar isso encheria a tela de
 * alarme onde não há nada a fazer, e alarme que toca sempre ninguém lê.
 *
 * `hoje` entra como parâmetro para a função ser pura e testável: com `new Date()` por dentro, o
 * teste do limite dependeria do dia em que rodasse.
 */
export function estaAtrasada(status: StatusConciliacao, dataCirurgia: Date, hoje: Date): boolean {
  if (status !== "A_RECEBER" && status !== "SEM_VALOR" && status !== "SEM_ATENDIMENTO") return false;
  return diasEntre(dataCirurgia, hoje) > DIAS_ATE_O_PAGAMENTO_ESPERADO;
}

/**
 * ⚠️ REGRA PROVISÓRIA — A CONFIRMAR COM A THAÍS. Isolada aqui de propósito: trocar a regra é
 * mexer SÓ nesta função (e no teste dela); quem monta a conciliação apenas a consulta.
 *
 * A glosa total por AUSÊNCIA: a operadora não manda linha dizendo "não paguei", ela simplesmente
 * não põe o atendimento no repasse. Sem esta regra, a cirurgia glosada inteira ficava "a receber"
 * para sempre — e o filtro "Glosa total" mostrava zero enquanto o dinheiro sumia.
 *
 * É glosa total quando TUDO isto vale:
 * - o status calculado é `A_RECEBER` (executada, cobrável, com atendimento, com valor, sem
 *   recebido — nem digitado nem do repasse; o digitado à mão sempre tem precedência);
 * - o atendimento NÃO aparece no repasse do cliente (se aparece e a parte desta cirurgia ficou
 *   desconhecida, é "não sei", não "não pagaram");
 * - já passou da defasagem normal (`estaAtrasada`);
 * - e o repasse já PAGOU outras cirurgias da MESMA competência. ⚠️ É isto que separa "glosou" de
 *   "o mês ainda não chegou": se o repasse não pagou nada daquele mês, a culpa pode ser o arquivo
 *   que ninguém importou — e aí a tela deve dizer "passou do prazo", não inventar uma glosa.
 *
 * ⚠️ Nada disto é gravado: é leitura, recalculada a cada montagem. Chegando o repasse depois, a
 * cirurgia volta a ser paga sozinha.
 */
export function ehGlosaTotalPorAusencia(e: {
  status: StatusConciliacao;
  atendimentoNoRepasse: boolean;
  atrasada: boolean;
  repassePagouOutrasDoMes: boolean;
}): boolean {
  return e.status === "A_RECEBER" && !e.atendimentoNoRepasse && e.atrasada && e.repassePagouOutrasDoMes;
}

/** Dias inteiros entre duas datas. Um lugar só, para os dois relógios contarem igual. */
export function diasEntre(de: Date, ate: Date): number {
  return Math.floor((ate.getTime() - de.getTime()) / 86_400_000);
}

/**
 * ⚠️ O PRAZO DE RESPOSTA DE UM RECURSO DE GLOSA, EM DIAS.
 *
 * É outro relógio, e conta da ABERTURA do recurso, não da cirurgia. Recurso protocolado e sem
 * resposta é dinheiro que se perde por decurso de prazo, **em silêncio** — e é o único jeito de a
 * tela dizer "isto aqui precisa de telefonema".
 *
 * Constante pelo mesmo motivo de `DIAS_ATE_O_PAGAMENTO_ESPERADO`: é característica do ciclo das
 * operadoras, não preferência da casa. Vira campo no dia em que alguém pedir.
 */
export const DIAS_ATE_A_RESPOSTA_DO_RECURSO = 30;

/** Só se recorre do que foi glosado — e é o servidor que precisa recusar, não só a tela. */
export function podeRecorrer(status: StatusConciliacao): boolean {
  return status === "GLOSA_PARCIAL" || status === "GLOSA_TOTAL";
}
