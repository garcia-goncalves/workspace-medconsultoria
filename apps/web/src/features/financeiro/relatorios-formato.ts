/**
 * Formatação e pequenas contas da tela do Financeiro — puras, testadas, sem React.
 */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-09" → "set/2026". Texto fora do formato volta como veio (nunca "undefined/NaN"). */
export function rotuloDoMes(mes: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  const nome = m ? MESES[Number(m[2]) - 1] : undefined;
  return m && nome ? `${nome}/${m[1]}` : mes;
}

/** O dia anterior a "AAAA-MM-DD", em "AAAA-MM-DD" — conta feita em UTC, sem fuso do navegador. */
export function diaAnterior(diaIso: string): string {
  const d = new Date(`${diaIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function textoAtraso(dias: number): string {
  if (dias <= 0) return "vence hoje";
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

/** Largura (0–100) de uma barra proporcional. Máximo zero não divide por zero. */
export function larguraRelativa(valor: number, maximo: number): number {
  if (maximo <= 0 || valor <= 0) return 0;
  return Math.min(100, Math.round((valor / maximo) * 100));
}

/**
 * Texto do botão de exportar. Diz QUANTAS contas saem — a lição da Conciliação: sem o número,
 * quem esperava o período inteiro mandava ao contador um arquivo incompleto. Sem número enquanto
 * a contagem do recorte novo não chegou (a tela ainda mostraria a do recorte anterior).
 */
export function rotuloExportar(total: number | null): string {
  if (total === null) return "Exportar para o contador";
  return total === 1 ? "Exportar 1 conta" : `Exportar ${total} contas`;
}

/** Nome do arquivo baixado: diz a carteira, o período e se é só um recorte. */
export function nomeDoArquivo(o: { carteira: string; de?: string; ate?: string; recortado: boolean; hoje: string }): string {
  const periodo = o.de || o.ate ? `_${o.de ?? "inicio"}_a_${o.ate ?? "hoje"}` : "";
  return `financeiro_${o.carteira.toLowerCase()}${periodo}${o.recortado ? "_filtro" : ""}_${o.hoje}.csv`;
}
