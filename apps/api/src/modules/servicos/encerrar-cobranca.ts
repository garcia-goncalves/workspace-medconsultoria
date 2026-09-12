/**
 * O QUE ACONTECE COM O DINHEIRO QUANDO UM SERVIÇO É CANCELADO.
 *
 * Decisão do dono (28/08/2026), com todas as letras: cancelar um serviço **encerra a
 * mensalidade** — e com esta nuance, que é dele:
 *
 *  - as parcelas **já vencidas continuam de pé** (o serviço foi prestado naquele mês e o
 *    dinheiro é devido);
 *  - **param as futuras**.
 *
 * Até aqui não parava nada: a série recorrente seguia materializando parcela todo mês, e a Med
 * continuava emitindo cobrança de um serviço que já não presta, até alguém notar e apagar à mão.
 *
 * ⚠️ **A régua é PURA porque ela vive em dois lugares.** A tela promete na confirmação
 * ("2 parcelas futuras serão encerradas; as vencidas continuam") e o servidor executa. Duas
 * cópias divergiriam, e a confirmação passaria a mentir sobre dinheiro — que é exatamente
 * como se instala desconfiança num sistema (o modo de falha da ADR-133).
 */

export interface ParcelaDaCobranca {
  id: string;
  vencimento: Date;
  pago: boolean;
  /** Em reais — o `Decimal` do Prisma para no servidor (ADR-118). */
  valor: number;
  recorrencia: string;
  recorrenteId: string | null;
}

export interface PlanoDeEncerramento {
  /** Âncoras das séries a fechar — é a âncora que a materialização consulta. */
  series: string[];
  /** Parcelas futuras ainda em aberto que deixam de existir. */
  encerrar: string[];
  /** O que FICA de pé: já pago ou já vencido. É o que a tela promete. */
  mantidas: string[];
  /** Soma do que deixa de ser cobrado — o número da confirmação. */
  valorEncerrado: number;
}

/**
 * `hoje` é a meia-noite de hoje em BRT (mesma referência de `hojeBRT()`), e a comparação é
 * **estritamente maior**: a parcela que vence HOJE não é futuro, é a deste mês — e este mês
 * já foi trabalhado.
 */
export function planejarEncerramentoDaCobranca(
  parcelas: ParcelaDaCobranca[],
  hoje: Date,
): PlanoDeEncerramento {
  const series = new Set<string>();
  const encerrar: string[] = [];
  const mantidas: string[] = [];
  let valorEncerrado = 0;

  for (const p of parcelas) {
    // Cobrança avulsa não é mensalidade: não há nada a encerrar, e mexer nela seria apagar
    // uma cobrança de uma vez só por um serviço que já foi entregue.
    if (p.recorrencia === "NENHUMA") continue;
    series.add(p.recorrenteId ?? p.id);
    if (!p.pago && p.vencimento > hoje) {
      encerrar.push(p.id);
      valorEncerrado += p.valor;
    } else {
      mantidas.push(p.id);
    }
  }

  return { series: [...series], encerrar, mantidas, valorEncerrado };
}
