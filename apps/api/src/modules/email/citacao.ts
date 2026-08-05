import { sanitizarEmailHtml } from "../../lib/sanitizar-html.js";

/** Data no formato pt-BR do cabeçalho de citação. O fuso da empresa é o de São Paulo. */
function dataCitacao(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function normalizar(e: string): string {
  return e.trim().toLowerCase();
}

function escapar(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Citação da mensagem original, para ir dentro da resposta. Duas versões, porque o mesmo HTML
 * serve a dois lugares com regras diferentes:
 *
 *  - `preview`: para a TELA, enquanto a pessoa ainda está escrevendo — imagem remota SEMPRE
 *    bloqueada (`data-src-bloqueada`), senão o pixel de rastreio do e-mail original dispararia
 *    sozinho ao abrir "Responder"/"Encaminhar". O `iframe sandbox=""` que mostra o preview NÃO
 *    bloqueia imagem sozinho — quem impede o pixel aqui é este bloqueio.
 *  - `envio`: para o E-MAIL QUE SAI — restaura a imagem remota SÓ quando `restaurarImagensNoEnvio`
 *    é `true` (achado 1 da revisão de segurança da fase 2A). A razão de depender do modo:
 *
 *      - RESPOSTA: quem recebe a citação de volta é a MESMA pessoa que mandou o e-mail original.
 *        Se há um pixel de rastreio nele, é dela — ela não descobre nada que já não soubesse ao
 *        mandar. Por isso a resposta pode restaurar a imagem (logo, assinatura com figura),
 *        senão a pessoa veria a própria citação com a imagem quebrada.
 *      - ENCAMINHAMENTO: quem recebe é um TERCEIRO (o cliente) que nunca escolheu abrir aquele
 *        e-mail. Restaurar a imagem repassaria o pixel de rastreio a ele — com o NOSSO domínio
 *        no remetente, o que dá credibilidade ao golpe seguinte. Por isso encaminhar usa a MESMA
 *        versão bloqueada do preview.
 *
 *    Isto NÃO reabre a sanitização em nenhum dos dois casos: script, iframe e handler `on*`
 *    continuam removidos sempre — é só o `src` da imagem que muda conforme `restaurarImagensNoEnvio`.
 *
 * NOTA HONESTA (achada na revisão de segurança deste mesmo achado 1): `EmailMensagem.corpoHtml`
 * só é gravado por `abrirMensagem` (`leitura.service.ts`), que SEMPRE sanitiza com imagem
 * bloqueada antes de salvar — então, no fluxo real de hoje, `original.corpoHtml` NUNCA chega aqui
 * com um `src` de imagem remota "vivo" (já é `data-src-bloqueada`), e `restaurarImagensNoEnvio:
 * true` não tem o que restaurar. Mesmo assim o contrato fica explícito nos dois modos, de
 * propósito: é o que garante o comportamento CORRETO se `corpoHtml` algum dia passar a chegar
 * cru por outro caminho — e é a razão de a decisão morar AQUI, não em quem grava o corpo. NÃO
 * "conserte" a imagem quebrada da citação de resposta copiando o replace
 * `data-src-bloqueada` → `src` (usado em `http/email-corpo.ts` para a TELA) para dentro deste
 * fluxo — isso reabriria o vazamento para o encaminhamento também, já que os dois partem do
 * mesmo `corpoHtml` já bloqueado.
 *
 * O corpo original é HIGIENIZADO aqui mesmo, nas duas versões. Citar o HTML cru de um terceiro
 * reintroduziria o XSS que as três camadas do Bloco 1 barram — e, pior, mandaria o conteúdo
 * hostil para fora com a nossa assinatura.
 */
export function montarCitacao(
  original: {
    deNome: string | null;
    deEmail: string;
    dataEm: Date;
    corpoHtml: string | null;
    corpoTexto: string | null;
  },
  opcoes: { restaurarImagensNoEnvio: boolean },
): { preview: string; envio: string } {
  const quem = original.deNome
    ? `${escapar(original.deNome)} &lt;${escapar(original.deEmail)}&gt;`
    : escapar(original.deEmail);
  const cabecalho = `Em ${dataCitacao(original.dataEm)}, ${quem} escreveu:`;

  const montar = (corpo: string): string =>
    [
      `<p>${cabecalho}</p>`,
      `<blockquote style="margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #ccc">`,
      corpo,
      `</blockquote>`,
    ].join("\n");

  if (original.corpoHtml) {
    const preview = sanitizarEmailHtml(original.corpoHtml).html;
    const envio = sanitizarEmailHtml(original.corpoHtml, {
      bloquearImagensRemotas: !opcoes.restaurarImagensNoEnvio,
    }).html;
    return { preview: montar(preview), envio: montar(envio) };
  }
  if (original.corpoTexto) {
    // Texto puro não tem imagem — não há o que restaurar; as duas versões saem iguais.
    const corpo = original.corpoTexto
      .split("\n")
      .map((l) => escapar(l))
      .join("<br>");
    const html = montar(corpo);
    return { preview: html, envio: html };
  }
  // Mensagem sem corpo nenhum: citação vazia seria só um traço solto na resposta.
  return { preview: "", envio: "" };
}

/**
 * Quem recebe a resposta. "Responder" vai só a quem escreveu; "responder a todos" mantém os
 * demais — tirando SEMPRE o endereço da própria caixa, senão a pessoa se copia em tudo.
 */
export function destinatariosResposta(args: {
  deEmail: string;
  para: string[];
  cc: string[];
  meuEndereco: string;
  aTodos: boolean;
}): { para: string[]; cc: string[] } {
  const eu = normalizar(args.meuEndereco);
  const semMim = (lista: string[]) => lista.filter((e) => normalizar(e) !== eu);
  const unico = (lista: string[]) => {
    const vistos = new Set<string>();
    return lista.filter((e) => {
      const k = normalizar(e);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  };

  if (!args.aTodos) return { para: [args.deEmail], cc: [] };
  return {
    para: unico(semMim([args.deEmail, ...args.para])),
    cc: unico(semMim(args.cc)),
  };
}

function comPrefixo(assunto: string | null, prefixo: string, jaTem: RegExp): string {
  const base = assunto?.trim() || "(sem assunto)";
  return jaTem.test(base) ? base : `${prefixo} ${base}`;
}

export function assuntoResposta(assunto: string | null): string {
  return comPrefixo(assunto, "Re:", /^re:/i);
}

export function assuntoEncaminhar(assunto: string | null): string {
  return comPrefixo(assunto, "Enc:", /^(enc|fwd|fw):/i);
}
