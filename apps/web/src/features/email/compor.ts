import { z } from "zod";
import { escapeHtml } from "../../lib/escape-html";

/**
 * Separa o texto em ITENS por vírgula/ponto-e-vírgula, ignorando os que estão dentro de aspas
 * (`"Garcia, Thaís" <t@x.com>`, o formato que o Outlook copia) ou dentro de `< >`. As aspas somem
 * no caminho: o nome é descartado de todo jeito, quem interessa é o endereço.
 */
function separarItens(valor: string): string[] {
  const itens: string[] = [];
  let atual = "";
  let emAspas = false;
  let emAngulo = false;
  for (const ch of valor) {
    if (ch === '"') {
      emAspas = !emAspas;
      continue;
    }
    if (!emAspas && ch === "<") emAngulo = true;
    else if (!emAspas && ch === ">") emAngulo = false;
    if ((ch === "," || ch === ";") && !emAspas && !emAngulo) {
      itens.push(atual);
      atual = "";
      continue;
    }
    atual += ch;
  }
  itens.push(atual);
  return itens;
}

/**
 * Quebra o texto digitado num campo Para/Cc/Cco em endereços — aceita vírgula, ponto-e-vírgula
 * ou espaço como separador (o jeito mais natural de colar vários e-mails de uma vez).
 *
 * Aceita TAMBÉM o formato com nome, `Nome <alguem@x.com>`, que é o que sai de um Ctrl+C em
 * qualquer outro cliente de e-mail: quebrar por espaço transformava isso em dois "endereços"
 * inválidos e o envio morria em "Endereço de e-mail inválido: Nome". Quando um item tem `< >`,
 * só o que está DENTRO conta e o nome é descartado — o nome de exibição do destinatário não é
 * nossa responsabilidade (o servidor manda só o endereço).
 */
export function dividirEmails(valor: string): string[] {
  return separarItens(valor)
    .flatMap((item) => {
      // Sem `< >` no item: cada pedaço separado por espaço é um endereço, como sempre foi.
      if (!/<[^<>]*>/.test(item)) return item.split(/\s+/);
      // Com `< >`: o que está DENTRO dos ângulos entra, e o que sobrou fora deles entra também
      // se parecer endereço (tiver um `@` com texto dos dois lados) — é o que impede
      // "cliente@x.com Fulano <fulano@y.com>" de virar só o segundo. Nada some em silêncio:
      // só o nome de exibição, que nunca foi destinatário, fica de fora. A ORDEM é a da
      // digitação porque a troca acontece no lugar, antes de separar.
      return item
        .replace(/<([^<>]*)>/g, " $1 ")
        .split(/\s+/)
        .filter((token) => /[^\s@]+@[^\s@]+/.test(token));
    })
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Tamanho de arquivo para gente: "832 KB", "1,4 MB". Só para mostrar na tela. */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
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
