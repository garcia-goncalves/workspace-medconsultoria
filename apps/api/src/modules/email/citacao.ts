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
 * Citação da mensagem original, para ir dentro da resposta.
 *
 * O corpo original é HIGIENIZADO aqui mesmo. Citar o HTML cru de um terceiro reintroduziria o
 * XSS que as três camadas do Bloco 1 barram — e, pior, mandaria o conteúdo hostil para fora com
 * a nossa assinatura.
 */
export function montarCitacao(original: {
  deNome: string | null;
  deEmail: string;
  dataEm: Date;
  corpoHtml: string | null;
  corpoTexto: string | null;
}): string {
  const quem = original.deNome
    ? `${escapar(original.deNome)} &lt;${escapar(original.deEmail)}&gt;`
    : escapar(original.deEmail);
  const cabecalho = `Em ${dataCitacao(original.dataEm)}, ${quem} escreveu:`;

  let corpo: string;
  if (original.corpoHtml) {
    corpo = sanitizarEmailHtml(original.corpoHtml).html;
  } else if (original.corpoTexto) {
    corpo = original.corpoTexto
      .split("\n")
      .map((l) => escapar(l))
      .join("<br>");
  } else {
    // Mensagem sem corpo nenhum: citação vazia seria só um traço solto na resposta.
    return "";
  }

  return [
    `<p>${cabecalho}</p>`,
    `<blockquote style="margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #ccc">`,
    corpo,
    `</blockquote>`,
  ].join("\n");
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
