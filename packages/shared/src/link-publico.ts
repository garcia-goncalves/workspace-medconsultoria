/**
 * Validade dos links públicos de PROPOSTA e de ASSINATURA (ADR-141).
 *
 * O problema: `Assinatura.token` e `Documento.propostaToken` são texto claro no banco
 * e não expiravam nunca. Um link de um ano atrás, na caixa de um ex-sócio, abria o
 * documento inteiro sem login — e ainda permitia assinar.
 *
 * ⚠️ ZERO MIGRAÇÃO de propósito: a validade é DERIVADA de datas que já existem
 * (`Assinatura.criadoEm`, `Documento.propostaSolicitadaEm`). Pedir assinatura de novo
 * apaga e recria as linhas (assinaturas.service), então a data volta a ser de hoje —
 * reenviar o convite realmente renova o prazo, como a pessoa espera.
 */

/** Dias para ABRIR o link depois de emitido. */
export const DIAS_PARA_ABRIR = 30;
/** Dias a MAIS, contados da resposta, só para o signatário reler o que assinou. */
export const DIAS_APOS_RESPOSTA = 90;

const UM_DIA = 24 * 60 * 60 * 1000;

export type SituacaoDoLinkPublico =
  | { valido: true; expiraEm: Date | null }
  | { valido: false; expirouEm: Date; motivo: "SEM_RESPOSTA" | "APOS_RESPOSTA" };

/**
 * Diz se o link ainda abre. A borda erra a favor de quem vai assinar: no instante
 * exato do limite ele AINDA vale.
 */
export function situacaoDoLinkPublico(input: {
  emitidoEm: Date | null | undefined;
  respondidoEm: Date | null | undefined;
  agora: Date;
}): SituacaoDoLinkPublico {
  const { emitidoEm, respondidoEm, agora } = input;

  // Respondido: a janela passa a contar da resposta — é o direito de reler o que assinou.
  if (respondidoEm) {
    const limite = new Date(respondidoEm.getTime() + DIAS_APOS_RESPOSTA * UM_DIA);
    return agora.getTime() <= limite.getTime()
      ? { valido: true, expiraEm: limite }
      : { valido: false, expirouEm: limite, motivo: "APOS_RESPOSTA" };
  }

  // Sem data de emissão não dá para datar o link. Trancar aqui deixaria o cliente sem
  // saída por uma falta nossa de registro — então vale, e a decisão fica escrita.
  if (!emitidoEm) return { valido: true, expiraEm: null };

  const limite = new Date(emitidoEm.getTime() + DIAS_PARA_ABRIR * UM_DIA);
  return agora.getTime() <= limite.getTime()
    ? { valido: true, expiraEm: limite }
    : { valido: false, expirouEm: limite, motivo: "SEM_RESPOSTA" };
}

/** A frase que o visitante lê. Expirado NÃO é inválido — e a diferença importa para ele. */
export function mensagemDeLinkExpirado(s: SituacaoDoLinkPublico): string {
  if (s.valido) return "";
  const dia = s.expirouEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return s.motivo === "APOS_RESPOSTA"
    ? `Este link expirou em ${dia}. Ele fica disponível por ${DIAS_APOS_RESPOSTA} dias depois da resposta, para consulta. Peça uma cópia à equipe da MedConsultoria.`
    : `Este link expirou em ${dia}. Ele vale por ${DIAS_PARA_ABRIR} dias a partir do envio. Peça um novo link à equipe da MedConsultoria.`;
}
