/**
 * Formatação de data/hora em pt-BR — ponto ÚNICO da aplicação.
 *
 * Todas as funções fixam o fuso `America/Sao_Paulo` (o app é operado no Brasil),
 * para que a hora exibida não dependa do fuso do navegador/servidor. Exceção:
 * `dataUTC`, para campos "date-only" armazenados como meia-noite UTC (vencimento,
 * prazo), onde converter para BRT recuaria o dia.
 */

const TZ = "America/Sao_Paulo";

const fmtDataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TZ });
const fmtData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
const fmtExtenso = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: TZ });
const fmtDiaSemana = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: TZ });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
// Campos "date-only" (meia-noite UTC): mostrar o dia como está, sem deslocar pelo fuso.
const fmtDataUTC = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

type DateInput = Date | string | number | null | undefined;

function toDate(d: DateInput): Date | null {
  if (d == null) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Data + hora curtas: "10/07/2026 14:39". Vazio se inválido. */
export function dataHora(d: DateInput): string {
  const dt = toDate(d);
  return dt ? fmtDataHora.format(dt) : "";
}

/** Data completa: "10/07/2026". */
export function data(d: DateInput): string {
  const dt = toDate(d);
  return dt ? fmtData.format(dt) : "";
}

/** Data por extenso: "10 de julho de 2026". Use onde o formato amigável fica melhor. */
export function dataExtenso(d: DateInput): string {
  const dt = toDate(d);
  return dt ? fmtExtenso.format(dt) : "";
}

/** Dia da semana + data por extenso: "sexta-feira, 10 de julho de 2026". */
export function diaSemana(d: DateInput): string {
  const dt = toDate(d);
  return dt ? fmtDiaSemana.format(dt) : "";
}

/** Só a hora: "14:39". */
export function hora(d: DateInput): string {
  const dt = toDate(d);
  return dt ? fmtHora.format(dt) : "";
}

/** Data de campos "date-only" (vencimento/prazo, meia-noite UTC): "10/07/2026". */
export function dataUTC(d: DateInput): string {
  const dt = toDate(d);
  return dt ? fmtDataUTC.format(dt) : "";
}

// Partes do dia em Brasília, para montar "AAAA-MM-DD" sem depender do fuso do navegador.
const fmtPartesDia = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });

/**
 * O dia de HOJE em Brasília como "AAAA-MM-DD" — o valor de um `<input type="date">`.
 *
 * ⚠️ Nunca `new Date().toISOString().slice(0, 10)`: isso é o dia em UTC, e depois das 21h de
 * Brasília (UTC−3) já é amanhã. O `agora` é parâmetro só para o teste poder fixar o relógio.
 */
export function hojeEmBrasiliaISO(agora: Date = new Date()): string {
  const partes = Object.fromEntries(fmtPartesDia.formatToParts(agora).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

/** Tempo relativo curto: "agora", "há 5 min", "há 3 h", "há 2 d"; acima de ~1 semana cai para a data. */
export function haQuanto(d: DateInput): string {
  const dt = toDate(d);
  if (!dt) return "";
  const seg = Math.floor((Date.now() - dt.getTime()) / 1000);
  if (seg < 45) return "agora";
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias < 7) return `há ${dias} d`;
  return data(dt);
}
