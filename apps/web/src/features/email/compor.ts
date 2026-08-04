import { z } from "zod";
import { escapeHtml } from "../../lib/escape-html";

/**
 * Quebra o texto digitado num campo Para/Cc/Cco em endereços — aceita vírgula, ponto-e-vírgula
 * ou espaço como separador (o jeito mais natural de colar vários e-mails de uma vez).
 */
export function dividirEmails(valor: string): string[] {
  return valor
    .split(/[,;\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

const emailSchema = z.string().email();

/** Mesma regra de validade de e-mail do schema do servidor (`enviarEmailSchema`). */
export function emailValido(valor: string): boolean {
  return emailSchema.safeParse(valor).success;
}

/**
 * Texto puro digitado no Textarea vira HTML seguro: escapa ANTES de trocar quebra de linha por
 * `<br>`. A ordem importa — escapar depois de já ter `<br>` no meio destruiria a tag.
 *
 * Sem este escape, `<script>` ou `<img onerror=...>` digitado na caixa viraria HTML de verdade
 * no e-mail que sai (o servidor confia no `corpoHtml` que a tela manda — ele não escapa nada).
 */
export function textoParaHtml(texto: string): string {
  return escapeHtml(texto).replace(/\r\n|\r|\n/g, "<br>");
}

/**
 * Corpo final mandado para `email.enviar`: o texto digitado (escapado) seguido da citação —
 * que já chega como HTML PRONTO do servidor (`prepararResposta`/`prepararEncaminhamento`) e por
 * isso NUNCA é reescapada aqui, só concatenada.
 */
export function montarCorpoEnvio(corpoDigitado: string, citacaoHtml: string): string {
  const digitadoHtml = textoParaHtml(corpoDigitado);
  if (digitadoHtml && citacaoHtml) return `${digitadoHtml}<br><br>${citacaoHtml}`;
  return digitadoHtml || citacaoHtml;
}

/**
 * Decide se há conteúdo de verdade para justificar gravar um rascunho no servidor. Sem isto,
 * abrir "Escrever" e desistir sem digitar nada criaria um rascunho em branco na pasta Rascunhos
 * da pessoa, para sempre (ninguém apaga rascunho vazio manualmente).
 *
 * `corpo` é o texto DIGITADO (não o corpo final com citação): a citação sozinha, sem nada
 * digitado por cima, ainda conta como conteúdo — é o caso normal de abrir "Responder"/"Encaminhar"
 * e fechar sem comentar nada, que também merece salvar.
 */
export function temConteudoParaRascunho(input: {
  para: string;
  cc: string;
  cco: string;
  assunto: string;
  corpo: string;
  citacao: string;
}): boolean {
  return (
    input.para.trim() !== "" ||
    input.cc.trim() !== "" ||
    input.cco.trim() !== "" ||
    input.assunto.trim() !== "" ||
    input.corpo.trim() !== "" ||
    input.citacao.trim() !== ""
  );
}
