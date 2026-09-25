/**
 * O ESTADO DA CONCILIAÇÃO NA URL — cliente, aba e filtros.
 *
 * Recarregar a página perdia o cliente escolhido (e com ele o mês e os filtros): quem confere
 * mês a mês recomeçava do zero, e mandar o link a um colega mostrava a visão geral em vez do que
 * se queria mostrar. Agora tudo o que responde "o que estou olhando?" mora no endereço.
 *
 * ⚠️ As duas abas têm filtros PRÓPRIOS, com chaves diferentes (as das cirurgias começam com
 * `cir`). Trocar de aba não pode apagar os filtros da outra — é a mesma regra do `manterMontado`
 * do `TabsContent` —, e com uma chave só (`mes`) mudar o mês numa aba mudaria na outra também.
 *
 * ⚠️ A URL é TEXTO QUE QUALQUER UM EDITA. Este leitor é puro e defensivo: valor fora do formato
 * vira "sem filtro" em vez de ir ao servidor e voltar erro na tela. Cliente que a pessoa não pode
 * ver passa pelo formato e é recusado depois, pela lista `conciliacao.clientes` (a tela cai no
 * seletor, sem chamar nada do cliente alheio).
 *
 * Fica sem dependência de componente de propósito: o roteador (carregado sempre) importa este
 * arquivo, e a página da Conciliação continua num pedaço separado, carregado sob demanda.
 */

/** `honorario` (Onda 2): o percentual do faturamento sobre o repasse — não tem filtro próprio. */
export const ABAS_CONCILIACAO = ["consultas", "cirurgias", "honorario"] as const;
export type AbaConciliacao = (typeof ABAS_CONCILIACAO)[number];

export const TIPOS_ATENDIMENTO = ["CONSULTA", "CORTESIA", "SEM_VINCULO_AGENDA", "OUTRO"] as const;
export const SITUACOES_CIRURGIA = ["SEM_ATENDIMENTO", "AUTORIZACAO_PENDENTE", "NAO_EXECUTADA"] as const;
export const RECURSOS_FILTRO = ["SEM_RECURSO", "ABERTO", "SEM_RESPOSTA", "RESPONDIDO"] as const;
/** Os mesmos de `STATUS_CONCILIACAO` (partes.tsx) — o teste reprova se divergirem. */
export const STATUS_FILTRO = [
  "GLOSA_PARCIAL",
  "GLOSA_TOTAL",
  "A_RECEBER",
  "SEM_VALOR",
  "SEM_ATENDIMENTO",
  "RECEBIDO_SEM_VALOR",
  "PAGO_A_MAIS",
  "PAGO",
  "NAO_COBRAR",
  "NAO_REALIZADA",
] as const;

export interface BuscaConciliacao {
  cliente?: string;
  aba?: AbaConciliacao;
  // Consultas
  mes?: string;
  tipo?: (typeof TIPOS_ATENDIMENTO)[number];
  operadora?: string;
  paciente?: string;
  // Cirurgias
  cirMes?: string;
  cirStatus?: (typeof STATUS_FILTRO)[number];
  cirSituacao?: (typeof SITUACOES_CIRURGIA)[number];
  cirOperadora?: string;
  cirRecurso?: (typeof RECURSOS_FILTRO)[number];
  cirPrazo?: "atrasadas";
  cirPaciente?: string;
}

/** O mesmo formato que o servidor exige (`competencia` em conciliacao.router.ts). */
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Id de cliente/operadora (cuid) ou a opção "Particular" (`__particular__`). */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

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
  // Mesmo teto do servidor (120). Cortar em vez de recusar: o que passa disso é colagem errada,
  // e perder a busca inteira seria pior do que perder a cauda dela.
  const t = texto(v)?.slice(0, 120);
  return t && t.trim() ? t : undefined;
}

/** Lê o `?…` da URL. Chave ausente ou inválida some — nunca vira erro. */
export function lerBuscaDaConciliacao(bruto: Record<string, unknown>): BuscaConciliacao {
  const saida: BuscaConciliacao = {
    cliente: conforme(bruto.cliente, ID),
    aba: umDe(bruto.aba, ABAS_CONCILIACAO),
    mes: conforme(bruto.mes, COMPETENCIA),
    tipo: umDe(bruto.tipo, TIPOS_ATENDIMENTO),
    operadora: conforme(bruto.operadora, ID),
    paciente: busca(bruto.paciente),
    cirMes: conforme(bruto.cirMes, COMPETENCIA),
    cirStatus: umDe(bruto.cirStatus, STATUS_FILTRO),
    cirSituacao: umDe(bruto.cirSituacao, SITUACOES_CIRURGIA),
    cirOperadora: conforme(bruto.cirOperadora, ID),
    cirRecurso: umDe(bruto.cirRecurso, RECURSOS_FILTRO),
    cirPrazo: umDe(bruto.cirPrazo, ["atrasadas"] as const),
    cirPaciente: busca(bruto.cirPaciente),
  };
  // Filtro sem cliente não significa nada — e deixaria lixo na URL da visão geral.
  if (!saida.cliente) return {};
  return limparBusca(saida);
}

/** Tira as chaves vazias: a URL mostra só o que está de fato filtrando. */
export function limparBusca(b: BuscaConciliacao): BuscaConciliacao {
  return Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== "")) as BuscaConciliacao;
}
