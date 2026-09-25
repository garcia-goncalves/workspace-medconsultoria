/**
 * Períodos prontos do Relatório de entregas (aba "Relatório" de Tarefas, ADMIN+). Puro e testável:
 * devolve os dias no formato do `<input type="date">` ("AAAA-MM-DD"), no calendário LOCAL de quem
 * está olhando — é o mês que a pessoa chama de "este mês".
 */
export type PresetPeriodo = "MES_ATUAL" | "MES_ANTERIOR" | "PERSONALIZADO";

const doisDigitos = (n: number) => String(n).padStart(2, "0");
export const diaLocal = (d: Date) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;

/** De/até (inclusivos) de um preset de mês. */
export function periodoDoPreset(preset: Exclude<PresetPeriodo, "PERSONALIZADO">, hoje: Date): { de: string; ate: string } {
  const deslocamento = preset === "MES_ANTERIOR" ? -1 : 0;
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth() + deslocamento, 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + deslocamento + 1, 0); // dia 0 = último do mês
  return { de: diaLocal(inicio), ate: diaLocal(fim) };
}
