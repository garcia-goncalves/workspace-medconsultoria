/**
 * Datas do lado do servidor ancoradas no fuso de Brasília (BRT, UTC−3; o Brasil não
 * usa horário de verão desde 2019). Campos "date-only" (vencimento, prazo) são gravados
 * em meia-noite UTC pelo `z.coerce.date()` sobre "AAAA-MM-DD". Para comparar "é hoje?",
 * "está vencido?", "é deste mês?" sem depender do fuso do SO do servidor de produção,
 * calculamos os limites como meia-noite UTC do dia/mês CORRENTE em Brasília.
 */
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** "Agora" em relógio de parede de Brasília (deslocado −3h), para extrair o dia/mês corrente. */
function agoraBRT(): Date {
  return new Date(Date.now() - BRT_OFFSET_MS);
}

/** Meia-noite UTC do dia de HOJE em Brasília. Casa com datas date-only (00:00Z). */
export function hojeBRT(): Date {
  const b = agoraBRT();
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
}

/** Meia-noite UTC do 1º dia do mês corrente em Brasília. */
export function inicioDoMesBRT(): Date {
  const b = agoraBRT();
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 1));
}

/** Meia-noite UTC do 1º dia do mês seguinte (fim exclusivo do mês corrente, BRT). */
export function inicioDoProximoMesBRT(): Date {
  const b = agoraBRT();
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 1));
}

/** Soma dias mantendo o instante em UTC (não sofre com fuso do SO). */
export function somarDiasUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}
