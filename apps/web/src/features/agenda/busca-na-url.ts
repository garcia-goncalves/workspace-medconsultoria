/**
 * O que chega em `/agenda` pela URL — hoje só usado pelo clique num compromisso achado na busca
 * global (`CommandPalette`): `data` é o dia em que a agenda abre e `abrir` é o id do evento a
 * abrir para edição assim que uma ocorrência dele aparecer na visão.
 *
 * ⚠️ A URL é TEXTO QUE QUALQUER UM EDITA. Leitor puro e defensivo: valor fora do formato vira
 * "sem preferência" (a agenda abre em hoje, como sempre) em vez de explodir.
 *
 * Sem dependência de componente de propósito: o roteador (carregado sempre) importa este arquivo,
 * e a página da Agenda continua num pedaço separado, carregado sob demanda.
 */

export interface BuscaAgenda {
  /** Instante (ISO) do dia a mostrar. */
  data?: string;
  /** Id do evento a abrir para edição. */
  abrir?: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z)?$/;

function conforme(v: unknown, re: RegExp): string | undefined {
  const t = typeof v === "string" ? v.trim() : undefined;
  return t && re.test(t) ? t : undefined;
}

/** Lê o `?…` da URL. Chave ausente ou inválida some — nunca vira erro. */
export function lerBuscaDaAgenda(bruto: Record<string, unknown>): BuscaAgenda {
  const data = conforme(bruto.data, DATA_ISO);
  const saida: BuscaAgenda = {
    data: data && !Number.isNaN(new Date(data).getTime()) ? data : undefined,
    abrir: conforme(bruto.abrir, ID),
  };
  return Object.fromEntries(Object.entries(saida).filter(([, v]) => v !== undefined)) as BuscaAgenda;
}
