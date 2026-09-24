/**
 * O que chega em `/tarefas` pela URL — hoje só usado pelo clique num aviso de tarefa no
 * sininho (`NotificationBell`): `aba` escolhe a visão certa (Comigo/Deleguei) e `abrir` é o
 * id da tarefa a abrir para edição assim que ela aparecer na lista.
 *
 * ⚠️ A URL é TEXTO QUE QUALQUER UM EDITA. Este leitor é puro e defensivo: valor fora do
 * formato vira "sem preferência" (a página cai no padrão de sempre) em vez de explodir.
 *
 * Fica sem dependência de componente de propósito: o roteador (carregado sempre) importa
 * este arquivo, e a página de Tarefas continua num pedaço separado, carregado sob demanda.
 */

export const ABAS_TAREFAS = ["COMIGO", "DELEGUEI", "EQUIPE"] as const;
export type AbaTarefas = (typeof ABAS_TAREFAS)[number];

export interface BuscaTarefas {
  aba?: AbaTarefas;
  /** Id da tarefa a abrir para edição, vindo do clique num aviso do sininho. */
  abrir?: string;
}

/** Id de tarefa (cuid). */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function texto(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function umDe<T extends string>(v: unknown, opcoes: readonly T[]): T | undefined {
  const t = texto(v);
  return opcoes.includes(t as T) ? (t as T) : undefined;
}
function conforme(v: unknown, re: RegExp): string | undefined {
  const t = texto(v)?.trim();
  return t && re.test(t) ? t : undefined;
}

/** Lê o `?…` da URL. Chave ausente ou inválida some — nunca vira erro. */
export function lerBuscaDeTarefas(bruto: Record<string, unknown>): BuscaTarefas {
  const saida: BuscaTarefas = {
    aba: umDe(bruto.aba, ABAS_TAREFAS),
    abrir: conforme(bruto.abrir, ID),
  };
  return Object.fromEntries(Object.entries(saida).filter(([, v]) => v !== undefined)) as BuscaTarefas;
}
