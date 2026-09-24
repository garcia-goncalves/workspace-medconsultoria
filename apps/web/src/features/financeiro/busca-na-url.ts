/**
 * O ESTADO DO FINANCEIRO NA URL — carteira, aba, lado (a receber/a pagar), situação e filtros.
 *
 * O motivo é o mesmo da Conciliação: recarregar a página zerava o filtro, e o link "ver as contas
 * deste cliente" da lista de inadimplência precisa ABRIR a lista já filtrada. Tudo o que responde
 * "o que estou olhando?" mora no endereço.
 *
 * ⚠️ A URL é TEXTO QUE QUALQUER UM EDITA. Este leitor é puro e defensivo: valor fora do formato
 * vira "sem filtro" em vez de ir ao servidor e voltar erro na tela. A privacidade da carteira
 * PESSOAL não depende disto — é o servidor que só devolve a carteira do próprio dono.
 *
 * ⚠️ Os padrões (Empresa, A receber, Pendentes, página 1) NÃO vão para a URL: `/financeiro` limpo
 * continua sendo a tela de sempre, e os testes e2e que abrem `/financeiro` seguem valendo.
 *
 * Sem dependência de componente de propósito: o roteador (carregado sempre) importa este arquivo,
 * e a página do Financeiro continua num pedaço separado, carregado sob demanda.
 */

export const CARTEIRAS_URL = ["EMPRESA", "PESSOAL", "TUDO"] as const;
export const ABAS_FINANCEIRO = ["contas", "relatorios"] as const;
export const TIPOS_URL = ["RECEBER", "PAGAR"] as const;
export const STATUS_URL = ["PENDENTES", "PAGAS", "TODAS"] as const;

/** Mesmo valor de `SEM_CATEGORIA` do `@app/shared` — o teste reprova se divergirem. */
export const SEM_CATEGORIA_URL = "__sem__";

export interface BuscaFinanceiro {
  carteira?: (typeof CARTEIRAS_URL)[number];
  aba?: (typeof ABAS_FINANCEIRO)[number];
  tipo?: (typeof TIPOS_URL)[number];
  status?: (typeof STATUS_URL)[number];
  cliente?: string;
  categoria?: string;
  /** Vencimento de/até, "AAAA-MM-DD". */
  de?: string;
  ate?: string;
  busca?: string;
  pagina?: number;
}

/** Os padrões da tela — o que vale quando a chave não está na URL. */
export const PADRAO_FINANCEIRO = {
  carteira: "EMPRESA",
  aba: "contas",
  tipo: "RECEBER",
  status: "PENDENTES",
  pagina: 1,
} as const;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DIA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function texto(v: unknown): string | undefined {
  // O roteador tenta ler a URL como JSON: uma busca "2026" chega como número.
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" ? v : undefined;
}
function conforme(v: unknown, re: RegExp): string | undefined {
  const t = texto(v)?.trim();
  return t && re.test(t) ? t : undefined;
}
function umDe<T extends string>(v: unknown, opcoes: readonly T[]): T | undefined {
  const t = texto(v);
  return opcoes.includes(t as T) ? (t as T) : undefined;
}
function busca(v: unknown): string | undefined {
  // Mesmo teto do servidor (120). Cortar em vez de recusar: o que passa disso é colagem errada.
  const t = texto(v)?.slice(0, 120);
  return t && t.trim() ? t : undefined;
}
function pagina(v: unknown): number | undefined {
  const n = Number(texto(v));
  return Number.isInteger(n) && n > 1 && n <= 10_000 ? n : undefined;
}

/** Lê o `?…` da URL. Chave ausente, inválida ou igual ao padrão some — nunca vira erro. */
export function lerBuscaDoFinanceiro(bruto: Record<string, unknown>): BuscaFinanceiro {
  return limparBusca({
    carteira: umDe(bruto.carteira, CARTEIRAS_URL),
    aba: umDe(bruto.aba, ABAS_FINANCEIRO),
    tipo: umDe(bruto.tipo, TIPOS_URL),
    status: umDe(bruto.status, STATUS_URL),
    cliente: conforme(bruto.cliente, ID),
    categoria: conforme(bruto.categoria, ID),
    de: conforme(bruto.de, DIA),
    ate: conforme(bruto.ate, DIA),
    busca: busca(bruto.busca),
    pagina: pagina(bruto.pagina),
  });
}

/** Tira as chaves vazias e as iguais ao padrão: a URL mostra só o que está de fato filtrando. */
export function limparBusca(b: BuscaFinanceiro): BuscaFinanceiro {
  const padrao = PADRAO_FINANCEIRO as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(b).filter(([k, v]) => v !== undefined && v !== "" && v !== padrao[k]),
  ) as BuscaFinanceiro;
}

/** Há algum recorte além de carteira/aba/lado/situação? (é o que muda o texto do botão de exportar) */
export function temFiltroExtra(b: BuscaFinanceiro): boolean {
  return !!(b.cliente || b.categoria || b.de || b.ate || b.busca);
}
