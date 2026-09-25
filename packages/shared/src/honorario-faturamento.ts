/**
 * O HONORÁRIO DO FATURAMENTO — a conta que ninguém fazia (Onda 2).
 *
 * O serviço de Faturamento da MedConsultoria é cobrado SÓ por percentual mensal (ADR-125/127/145),
 * e o percentual incide sobre o que a clínica **RECEBE** dos convênios — é o que o contrato diz:
 * _"o recebimento do Repasse será sempre feito após o crédito na conta da Clínica"_. Por isso a
 * base é o relatório de REPASSE que a Conciliação importa (`RepasseLinha`), e o mês de referência
 * é o **mês do crédito** (a data de pagamento do repasse), nunca o mês do atendimento — entre um e
 * outro há ~3,5 meses de defasagem, e cobrar pelo atendimento seria cobrar dinheiro que a clínica
 * ainda não viu.
 *
 * Tudo aqui é PURO, sem banco, e usado pelo servidor (que decide) e pela tela (que rotula). A
 * conta é em CENTAVOS INTEIROS: `Float` erra centavo (ADR-118), e a multiplicação base × percentual
 * é feita em `BigInt`, porque R$ 99 milhões em centavos × 10.000 passa do inteiro seguro do JS.
 */

/** `AAAA-MM`. O mesmo formato de `competencia` da Conciliação. */
export const MES_AAAA_MM = /^\d{4}-(0[1-9]|1[0-2])$/;

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] as const;

/** `"2026-05"` → `"mai/2026"` — o rótulo que vai na descrição da conta e na tela. */
export function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${MESES_CURTOS[Number(m) - 1] ?? m}/${ano}`;
}

/** Reais (com até 2 casas, como sai do `Decimal(12,2)`) → centavos inteiros. */
export function emCentavos(reais: number): number {
  return Math.round(reais * 100);
}

/** O mês (`AAAA-MM`) de uma data "date-only" gravada em meia-noite UTC (`@db.Date`). */
export function mesDaData(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Uma linha de repasse, só com o que decide a base. */
export interface LinhaDeRepasseParaBase {
  /** Reais. Pode ser NEGATIVO — estorno escrito como contador escreve (ver `interpretarValor`). */
  valor: number;
  dataPagamento: Date | null;
}

/**
 * A base de cada mês: soma de TODO repasse com crédito naquele mês.
 *
 * ⚠️ **Entra o "recebido sem produção"** — incremento, acordo, atendimento que não está no mapa
 * cirúrgico. Para a conciliação por cirurgia ele não tem dono; para o honorário, dinheiro recebido
 * é dinheiro recebido, e o percentual incide sobre ele do mesmo jeito.
 * ⚠️ **Estorno entra com sinal** — ele desfaz um crédito, e ignorá-lo cobraria honorário sobre
 * dinheiro que voltou para o convênio.
 * ⚠️ **Linha sem data de pagamento NÃO entra em mês nenhum** — não há como saber quando o crédito
 * caiu. Ela é CONTADA à parte (`semData`) para a tela avisar, em vez de sumir calada.
 */
export function basesPorMes(linhas: LinhaDeRepasseParaBase[]): {
  meses: Map<string, { baseCentavos: number; linhas: number }>;
  semData: { linhas: number; totalCentavos: number };
} {
  const meses = new Map<string, { baseCentavos: number; linhas: number }>();
  const semData = { linhas: 0, totalCentavos: 0 };
  for (const l of linhas) {
    const c = emCentavos(l.valor);
    if (!l.dataPagamento) {
      semData.linhas++;
      semData.totalCentavos += c;
      continue;
    }
    const mes = mesDaData(l.dataPagamento);
    const atual = meses.get(mes) ?? { baseCentavos: 0, linhas: 0 };
    atual.baseCentavos += c;
    atual.linhas++;
    meses.set(mes, atual);
  }
  return { meses, semData };
}

/**
 * Honorário = base × percentual, em centavos, arredondado MEIO PARA CIMA (o arredondamento que um
 * contador faria à mão). `percentual` em pontos percentuais com até 2 casas (3,5 = 3,5%).
 *
 * Base zero ou negativa (mês só de estorno) dá ZERO: não se cobra honorário negativo — um estorno
 * de mês já cobrado é assunto de ajuste manual no Financeiro, não de uma conta a pagar ao cliente.
 */
export function calcularHonorarioCentavos(baseCentavos: number, percentual: number): number {
  if (baseCentavos <= 0 || percentual <= 0) return 0;
  const pCentesimos = BigInt(Math.round(percentual * 100)); // 3,5% → 350
  const produto = BigInt(baseCentavos) * pCentesimos; // centavos × centésimos de ponto
  return Number((produto + 5000n) / 10000n);
}

/** Uma contratação do serviço de faturamento, só com o que decide se ela vale num mês. */
export interface ContratacaoParaHonorario {
  status: string; // ATIVO | CANCELADO
  percentual: number | null;
  contratadoEm: Date;
  canceladoEm: Date | null;
}

/** Brasília é UTC−3 o ano todo (sem horário de verão desde 2019). */
const BRT_MS = 3 * 60 * 60 * 1000;

/** Primeiro instante do mês em Brasília, e o do mês seguinte (fim exclusivo). */
export function limitesDoMesBRT(mes: string): { inicio: Date; fimExclusivo: Date } {
  const [ano, m] = mes.split("-").map(Number) as [number, number];
  return {
    inicio: new Date(Date.UTC(ano, m - 1, 1) + BRT_MS),
    fimExclusivo: new Date(Date.UTC(ano, m, 1) + BRT_MS),
  };
}

/**
 * A contratação vale neste mês?
 *
 * Critério: **estava ativa em ALGUM dia do mês** — contratada antes do fim do mês e não cancelada
 * antes do começo dele. Quem contratou no dia 20 paga o mês do crédito inteiro, e quem cancelou no
 * dia 5 também: o repasse daquele mês é fruto de trabalho feito ANTES (a defasagem é de meses), e
 * pró-rata por dia de contrato não corresponde a nada que a Med tenha feito ou deixado de fazer.
 *
 * ⚠️ `CANCELADO` sem `canceladoEm` (linha antiga, anterior à coluna) não vale em mês nenhum: não há
 * como saber quando parou, e cobrar às cegas é pior que pedir o lançamento à mão.
 * ⚠️ Reativar um serviço cancelado zera `canceladoEm` e mantém `contratadoEm` — o intervalo em que
 * ele esteve cancelado não fica registrado em lugar nenhum. É limitação do dado, não desta regra;
 * a Thaís confere na tela antes de lançar.
 */
export function contratacaoValeNoMes(c: ContratacaoParaHonorario, mes: string): boolean {
  const { inicio, fimExclusivo } = limitesDoMesBRT(mes);
  if (c.contratadoEm >= fimExclusivo) return false;
  if (c.status === "ATIVO") return true;
  return !!c.canceladoEm && c.canceladoEm >= inicio;
}

/** O mês já terminou? `hoje` = meia-noite UTC do dia corrente em Brasília (`hojeBRT()`). */
export function mesEncerrado(mes: string, hoje: Date): boolean {
  return mes < mesDaData(hoje);
}

/** O vencimento sugerido: dia 10 do mês seguinte ao do crédito, `AAAA-MM-DD`. Editável na tela. */
export function vencimentoPadrao(mes: string): string {
  const [ano, m] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(ano, m, 10)).toISOString().slice(0, 10);
}

export type SituacaoDoHonorario =
  /** Mês encerrado, honorário calculável, nada lançado (ou a conta lançada foi excluída). */
  | "A_LANCAR"
  /** Lançado, conta em aberto, valor de hoje igual ao lançado. */
  | "LANCADO"
  /** Lançado, conta em aberto, e o repasse (ou o percentual) mudou depois. */
  | "DIVERGENTE"
  /** A conta lançada já foi paga. A divergência, se houver, vira só aviso. */
  | "PAGO"
  /** O mês ainda não terminou — pode chegar mais repasse. */
  | "MES_EM_CURSO"
  /** A contratação existe, mas sem percentual ("a combinar"). */
  | "SEM_PERCENTUAL"
  /** O serviço não estava contratado neste mês. */
  | "FORA_DO_CONTRATO"
  /** Base zero ou negativa — nada a cobrar. */
  | "NADA_A_COBRAR";

export interface EntradaDaSituacao {
  /** Honorário de hoje, em centavos; `null` quando não há percentual aplicável. */
  honorarioCentavos: number | null;
  encerrado: boolean;
  valeNoMes: boolean;
  percentualDefinido: boolean;
  /** O lançamento VIVO — com a conta existindo e não excluída. Conta excluída = `null` aqui. */
  lancamento: { valorCentavos: number; pago: boolean } | null;
}

/**
 * A situação de um mês. A ordem das perguntas importa: o que JÁ FOI LANÇADO fala primeiro — um mês
 * lançado continua lançado mesmo que o contrato tenha sido cancelado depois ou o percentual zerado.
 *
 * ⚠️ Conta excluída no Financeiro chega aqui como `lancamento: null` e o mês VOLTA a "a lançar".
 * Quem apaga a conta está dizendo "esta cobrança não vale"; manter o mês como "lançado" tornaria o
 * honorário impossível de relançar pela tela. Se a intenção era não cobrar aquele mês, o lembrete
 * não insiste (é um aviso por mês, uma vez só).
 */
export function situacaoDoHonorario(e: EntradaDaSituacao): { situacao: SituacaoDoHonorario; divergiu: boolean } {
  if (e.lancamento) {
    const divergiu = e.honorarioCentavos !== null && e.honorarioCentavos !== e.lancamento.valorCentavos;
    if (e.lancamento.pago) return { situacao: "PAGO", divergiu };
    return { situacao: divergiu ? "DIVERGENTE" : "LANCADO", divergiu };
  }
  if (!e.valeNoMes) return { situacao: "FORA_DO_CONTRATO", divergiu: false };
  if (!e.percentualDefinido) return { situacao: "SEM_PERCENTUAL", divergiu: false };
  if (!e.encerrado) return { situacao: "MES_EM_CURSO", divergiu: false };
  if (!e.honorarioCentavos || e.honorarioCentavos <= 0) return { situacao: "NADA_A_COBRAR", divergiu: false };
  return { situacao: "A_LANCAR", divergiu: false };
}
