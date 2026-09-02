/**
 * RECARREGAR A LISTA DEPOIS DE UM ENVIO — duas vezes, de propósito.
 *
 * O defeito que esta função existe para impedir (ADR-143): anexar um arquivo logo depois de
 * abrir a tela deixava o arquivo **fora da lista até recarregar a página**, sem sinal de erro.
 *
 * A causa é a soma de duas coisas nossas. A tela carrega tudo num lote único de tRPC
 * (`httpBatchLink`), e o upload termina ~120 ms depois de esse lote começar. Pedir
 * `invalidate()` — ou mesmo um `refetch()` único — a uma consulta **em andamento** faz o
 * React Query REAPROVEITAR a busca que já está no ar: ele aceita a resposta ANTERIOR ao envio,
 * e nenhuma requisição nova chega a sair. Medido no trace do Playwright: depois do upload não
 * havia leitura nenhuma da lista.
 *
 * ⚠️ **As duas passadas não são redundância.** A primeira espera o que já estava no ar; a
 * segunda é a que de fato sai e traz o arquivo novo. Tirar uma devolve o defeito.
 *
 * ⚠️ E não adianta `invalidate(..., { cancelRefetch: true })` (o `invalidate` do tRPC recebe as
 * opções na **terceira** posição) nem abortar por consulta: o link de lote não aborta uma
 * consulta isolada.
 *
 * Mora aqui, e não copiado em cada tela, porque cinco cópias desta regra divergem no primeiro
 * ajuste — e a divergência aparece como "sumiu o arquivo" em uma tela só.
 */

/** O mínimo que uma consulta do React Query precisa expor para ser recarregada aqui. */
export interface ConsultaRecarregavel {
  refetch: () => Promise<unknown>;
}

/**
 * Recarrega as consultas passadas, duas vezes cada, sem travar quem chamou.
 *
 * Falha de rede não derruba o fluxo: o envio já deu certo no servidor, e a tela se corrige na
 * próxima leitura. Por isso cada passada engole o erro.
 */
export function recarregarAposEnvio(...consultas: ConsultaRecarregavel[]): void {
  void (async () => {
    // Passada 1: absorve as buscas que já estavam no ar quando o envio terminou.
    for (const q of consultas) await q.refetch().catch(() => {});
    // Passada 2: esta é a que sai de verdade e traz o que acabou de ser enviado.
    for (const q of consultas) await q.refetch().catch(() => {});
  })();
}
