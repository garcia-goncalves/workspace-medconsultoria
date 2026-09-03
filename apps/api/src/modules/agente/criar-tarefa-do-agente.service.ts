import { Prisma, prisma } from "@app/db";
import { montarTarefa, avisarDelegacao } from "../tarefas/tarefas.service.js";
import {
  abrirResolucao,
  emitirAprovacao,
  hashDosArgumentos,
  selarResolucao,
  type ArgumentosDaTarefa,
  type ReferenciaResolvida,
  type TipoDeReferencia,
} from "./aprovacao.js";

/**
 * `POST /api/agent/v1/tasks/preview` e `POST /api/agent/v1/tasks` — a ESCRITA da Fase 2
 * (ADR-150, ticket CORA-003).
 *
 * ⚠️ **SÃO DOIS ENDPOINTS E NÃO PODEM VIRAR UM.** Se a Cora montasse a prévia do lado dela e
 * depois mandasse a escrita, seriam **dois artefatos diferentes** — o que a Thaís leu e o que
 * foi gravado — e entre um e outro cabe qualquer coisa. Aqui quem monta a prévia é o mesmo
 * código que grava, e o `approvalToken` amarra os dois pelo hash dos argumentos.
 *
 * ⚠️ **A PRÉVIA É LEITURA PURA.** Nenhuma escrita, nenhum efeito colateral, nenhuma cota
 * consumida — ela é refeita a cada desambiguação, e cobrar por isso empurraria a Cora a
 * adivinhar em vez de perguntar.
 *
 * ⚠️ **O SERVIDOR NUNCA ESCOLHE O MELHOR PALPITE.** Dois candidatos → `approvalToken: null` e
 * `ambiguidades[]`. Homônimo é onde isso machuca: a tarefa vai para o médico errado e ninguém
 * descobre até o prazo vencer. Vale inclusive quando um dos candidatos casa **exatamente** com
 * o texto: "Clínica Silva" e "Clínica Silva e Souza" são duas clínicas, e preferir a exata
 * continua sendo escolher por alguém.
 */

/** A capacidade. Entra no escopo da chave de idempotência — ver `AgentIdempotency.ferramenta`. */
export const FERRAMENTA = "tasks.create";

/** Validade declarada da chave de idempotência. Depois disso, repetir cria tarefa nova. */
export const HORAS_DA_CHAVE = 24;

const TITULO_MINIMO = 3;
/** A coluna é `VARCHAR(191)`; o teto fica abaixo dela para o banco nunca ser a régua. */
const TITULO_MAXIMO = 180;
const TEXTO_MINIMO_DE_BUSCA = 2;
/** Quantos candidatos a prévia mostra numa ambiguidade. O total real vai junto. */
const MAXIMO_DE_CANDIDATOS = 8;
const MAXIMO_DE_RESPONSAVEIS = 10;

const PRIORIDADES = ["BAIXA", "NORMAL", "ALTA"] as const;
type Prioridade = (typeof PRIORIDADES)[number];

/** Guarda de tipo. `includes` sobre `readonly string[]` não estreita nada sozinho. */
function ehPrioridade(v: unknown): v is Prioridade {
  return typeof v === "string" && (PRIORIDADES as readonly string[]).includes(v);
}

// ─────────────────────────────────────────────────────────────
// 1. A ENTRADA DA PRÉVIA
// ─────────────────────────────────────────────────────────────

/**
 * Uma referência que a Cora manda: ou o TEXTO que a Thaís falou, ou o ID que ela escolheu
 * depois de uma desambiguação. **Exatamente um dos dois** — os dois juntos, ou nenhum, é
 * entrada inválida, porque "qual deles vale?" é decisão que não pode ser nossa.
 */
export interface ReferenciaPedida {
  id?: unknown;
  texto?: unknown;
}

export interface EntradaDaPrevia {
  titulo?: unknown;
  prioridade?: unknown;
  prazo?: unknown;
  cliente?: unknown;
  projeto?: unknown;
  responsaveis?: unknown;
  previousResolutionHash?: unknown;
}

export type CampoDaEntrada =
  | "titulo"
  | "prioridade"
  | "prazo"
  | "cliente"
  | "projeto"
  | "responsaveis"
  | "previousResolutionHash";

export interface PedidoValidado {
  titulo: string;
  prioridade: Prioridade;
  prazo: Date | null;
  cliente: { id: string } | { texto: string } | null;
  projeto: { id: string } | { texto: string } | null;
  responsaveis: ({ id: string } | { texto: string })[];
  resolucaoAnterior: ReferenciaResolvida[] | null;
}

export type ValidacaoDoPedido =
  | { ok: true; valor: PedidoValidado }
  | { ok: false; campo: CampoDaEntrada; detalhe: string };

function lerReferencia(
  bruto: unknown,
  campo: CampoDaEntrada,
): { ok: true; valor: { id: string } | { texto: string } | null } | { ok: false; detalhe: string } {
  if (bruto === undefined || bruto === null) return { ok: true, valor: null };
  if (typeof bruto !== "object" || Array.isArray(bruto)) {
    return { ok: false, detalhe: "informe um objeto com `id` ou `texto`, ou omita o campo" };
  }
  const r = bruto as ReferenciaPedida;
  const temId = r.id !== undefined && r.id !== null;
  const temTexto = r.texto !== undefined && r.texto !== null;
  // ⚠️ Os dois juntos não é "o id ganha": é um pedido que quer duas coisas diferentes, e
  // escolher por quem chama é exatamente o palpite que este endpoint existe para não dar.
  if (temId === temTexto) {
    return { ok: false, detalhe: `informe exatamente um entre \`id\` e \`texto\` em \`${campo}\`` };
  }
  if (temId) {
    if (typeof r.id !== "string" || !r.id.trim()) return { ok: false, detalhe: "`id` vazio" };
    return { ok: true, valor: { id: r.id.trim() } };
  }
  if (typeof r.texto !== "string") return { ok: false, detalhe: "`texto` precisa ser texto" };
  const texto = r.texto.trim();
  if (texto.length < TEXTO_MINIMO_DE_BUSCA) {
    return { ok: false, detalhe: `\`texto\` precisa ter ao menos ${TEXTO_MINIMO_DE_BUSCA} caracteres` };
  }
  return { ok: true, valor: { texto } };
}

/** Aceita só ISO 8601 de verdade. `Date` aceitaria "amanhã" como `Invalid Date` calado. */
const FORMA_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function validarPedido(cru: EntradaDaPrevia, segredo: string): ValidacaoDoPedido {
  if (typeof cru.titulo !== "string") {
    return { ok: false, campo: "titulo", detalhe: "obrigatório, em texto" };
  }
  const titulo = cru.titulo.trim();
  if (titulo.length < TITULO_MINIMO || titulo.length > TITULO_MAXIMO) {
    return {
      ok: false,
      campo: "titulo",
      detalhe: `entre ${TITULO_MINIMO} e ${TITULO_MAXIMO} caracteres`,
    };
  }

  const prioridade =
    cru.prioridade === undefined || cru.prioridade === null ? "NORMAL" : cru.prioridade;
  if (!ehPrioridade(prioridade)) {
    return { ok: false, campo: "prioridade", detalhe: `use ${PRIORIDADES.join(", ")}` };
  }

  let prazo: Date | null = null;
  if (cru.prazo !== undefined && cru.prazo !== null) {
    if (typeof cru.prazo !== "string" || !FORMA_ISO.test(cru.prazo)) {
      return {
        ok: false,
        campo: "prazo",
        detalhe: "use ISO 8601 com fuso (ex.: 2026-09-10T15:00:00-03:00)",
      };
    }
    const d = new Date(cru.prazo);
    if (Number.isNaN(d.getTime())) return { ok: false, campo: "prazo", detalhe: "data inexistente" };
    prazo = d;
  }

  const cli = lerReferencia(cru.cliente, "cliente");
  if (!cli.ok) return { ok: false, campo: "cliente", detalhe: cli.detalhe };
  const proj = lerReferencia(cru.projeto, "projeto");
  if (!proj.ok) return { ok: false, campo: "projeto", detalhe: proj.detalhe };

  const responsaveis: ({ id: string } | { texto: string })[] = [];
  if (cru.responsaveis !== undefined && cru.responsaveis !== null) {
    if (!Array.isArray(cru.responsaveis)) {
      return { ok: false, campo: "responsaveis", detalhe: "use uma lista" };
    }
    if (cru.responsaveis.length > MAXIMO_DE_RESPONSAVEIS) {
      return { ok: false, campo: "responsaveis", detalhe: `no máximo ${MAXIMO_DE_RESPONSAVEIS}` };
    }
    for (const item of cru.responsaveis) {
      const r = lerReferencia(item, "responsaveis");
      if (!r.ok) return { ok: false, campo: "responsaveis", detalhe: r.detalhe };
      if (r.valor === null) return { ok: false, campo: "responsaveis", detalhe: "item vazio na lista" };
      responsaveis.push(r.valor);
    }
  }

  let resolucaoAnterior: ReferenciaResolvida[] | null = null;
  if (cru.previousResolutionHash !== undefined && cru.previousResolutionHash !== null) {
    if (typeof cru.previousResolutionHash !== "string") {
      return {
        ok: false,
        campo: "previousResolutionHash",
        detalhe: "use o valor exato de uma prévia anterior",
      };
    }
    // ⚠️ Valor que não emitimos é ERRO, não "sem comparação". Aceitar em silêncio faria a Cora
    // ler "nada mudou" quando na verdade nós não conseguimos comparar coisa nenhuma.
    resolucaoAnterior = abrirResolucao(cru.previousResolutionHash, segredo);
    if (!resolucaoAnterior) {
      return { ok: false, campo: "previousResolutionHash", detalhe: "valor não reconhecido" };
    }
  }

  return {
    ok: true,
    valor: {
      titulo,
      prioridade,
      prazo,
      cliente: cli.valor,
      projeto: proj.valor,
      responsaveis,
      resolucaoAnterior,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 2. A RESOLUÇÃO DAS REFERÊNCIAS
// ─────────────────────────────────────────────────────────────

export type MotivoNaoResolvido = "NAO_INFORMADO" | "NAO_ENCONTRADO" | "AMBIGUO";

/**
 * Como uma referência aparece na prévia.
 *
 * ⚠️ **Ausência aparece, nunca some.** Omissão vira "eu não vi", e depois "eu não aprovei
 * isso" — por isso `encontrado: false` com `motivo` em vez de o campo sumir do JSON.
 */
export interface ReferenciaNaPrevia {
  id: string | null;
  rotulo: string | null;
  encontrado: boolean;
  motivo: MotivoNaoResolvido | null;
  origem: "ID" | "TEXTO" | "PADRAO" | null;
}

export interface Candidato {
  id: string;
  rotulo: string;
  /** Um fato que DISTINGUE este candidato dos outros — sem ele a escolha é impossível. */
  distincao: string;
}

export interface Ambiguidade {
  campo: string;
  texto: string;
  candidatos: Candidato[];
  /** Quantos existem de verdade. `candidatos` mostra no máximo oito. */
  total: number;
}

const NAO_INFORMADA: ReferenciaNaPrevia = {
  id: null,
  rotulo: null,
  encontrado: false,
  motivo: "NAO_INFORMADO",
  origem: null,
};

const SITUACAO_EM_PORTUGUES: Record<string, string> = {
  PROSPECT: "prospect",
  EM_NEGOCIACAO: "em negociação",
  ATIVO: "cliente ativo",
  INATIVO: "cliente inativo",
  PERDIDO: "perdido",
};

function distinguirCliente(c: {
  cnpj: string | null;
  email: string | null;
  situacaoComercial: string;
}): string {
  const partes = [
    c.cnpj ? `CNPJ ${c.cnpj}` : "sem CNPJ cadastrado",
    SITUACAO_EM_PORTUGUES[c.situacaoComercial] ?? c.situacaoComercial.toLowerCase(),
  ];
  if (c.email) partes.push(c.email);
  return partes.join(" · ");
}

interface Achado {
  id: string;
  rotulo: string;
  distincao: string;
}

async function buscarClientes(texto: string): Promise<{ achados: Achado[]; total: number }> {
  const where = { deletedAt: null, nome: { contains: texto } };
  const [linhas, total] = await Promise.all([
    prisma.cliente.findMany({
      where,
      orderBy: { nome: "asc" },
      take: MAXIMO_DE_CANDIDATOS,
      select: { id: true, nome: true, cnpj: true, email: true, situacaoComercial: true },
    }),
    prisma.cliente.count({ where }),
  ]);
  return {
    achados: linhas.map((c) => ({ id: c.id, rotulo: c.nome, distincao: distinguirCliente(c) })),
    total,
  };
}

/**
 * ⚠️ **Quem pode ser responsável é a EQUIPE**, com o mesmo recorte da autenticação do agente:
 * conta ativa, não excluída, sem acesso revogado e papel interno. Conta de Portal (`CLIENTE`)
 * não recebe tarefa interna — seria delegar trabalho da casa a quem é de fora.
 */
const EQUIPE_ATIVA = {
  ativo: true,
  deletedAt: null,
  acessoRevogadoEm: null,
  role: { not: "CLIENTE" },
} as const;

async function buscarPessoas(texto: string): Promise<{ achados: Achado[]; total: number }> {
  const where = { ...EQUIPE_ATIVA, nome: { contains: texto } };
  const [linhas, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { nome: "asc" },
      take: MAXIMO_DE_CANDIDATOS,
      select: { id: true, nome: true, email: true, role: true },
    }),
    prisma.user.count({ where }),
  ]);
  return {
    achados: linhas.map((u) => ({ id: u.id, rotulo: u.nome, distincao: `${u.role} · ${u.email}` })),
    total,
  };
}

async function buscarProjetos(texto: string): Promise<{ achados: Achado[]; total: number }> {
  const where = { deletedAt: null, nome: { contains: texto } };
  const [linhas, total] = await Promise.all([
    prisma.projeto.findMany({
      where,
      orderBy: { nome: "asc" },
      take: MAXIMO_DE_CANDIDATOS,
      select: { id: true, nome: true, status: true, cliente: { select: { nome: true } } },
    }),
    prisma.projeto.count({ where }),
  ]);
  return {
    achados: linhas.map((p) => ({
      id: p.id,
      rotulo: p.nome,
      distincao: `${p.cliente.nome} · ${p.status.toLowerCase()}`,
    })),
    total,
  };
}

/** Confere um id escolhido numa desambiguação. `null` = não existe (ou não pode mais). */
async function conferirCliente(id: string): Promise<Achado | null> {
  const c = await prisma.cliente.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, nome: true, cnpj: true, email: true, situacaoComercial: true },
  });
  return c ? { id: c.id, rotulo: c.nome, distincao: distinguirCliente(c) } : null;
}

async function conferirPessoa(id: string): Promise<Achado | null> {
  const u = await prisma.user.findFirst({
    where: { id, ...EQUIPE_ATIVA },
    select: { id: true, nome: true, email: true, role: true },
  });
  return u ? { id: u.id, rotulo: u.nome, distincao: `${u.role} · ${u.email}` } : null;
}

async function conferirProjeto(id: string): Promise<Achado | null> {
  const p = await prisma.projeto.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, nome: true, status: true, cliente: { select: { nome: true } } },
  });
  return p
    ? { id: p.id, rotulo: p.nome, distincao: `${p.cliente.nome} · ${p.status.toLowerCase()}` }
    : null;
}

type Buscador = (texto: string) => Promise<{ achados: Achado[]; total: number }>;
type Conferidor = (id: string) => Promise<Achado | null>;

async function resolverUma(
  pedida: { id: string } | { texto: string } | null,
  campo: string,
  buscar: Buscador,
  conferir: Conferidor,
  ambiguidades: Ambiguidade[],
): Promise<ReferenciaNaPrevia> {
  if (!pedida) return { ...NAO_INFORMADA };
  if ("id" in pedida) {
    const achado = await conferir(pedida.id);
    if (!achado) {
      return { id: null, rotulo: null, encontrado: false, motivo: "NAO_ENCONTRADO", origem: "ID" };
    }
    return { id: achado.id, rotulo: achado.rotulo, encontrado: true, motivo: null, origem: "ID" };
  }
  const { achados, total } = await buscar(pedida.texto);
  if (total === 0) {
    return { id: null, rotulo: null, encontrado: false, motivo: "NAO_ENCONTRADO", origem: "TEXTO" };
  }
  if (total > 1) {
    ambiguidades.push({ campo, texto: pedida.texto, candidatos: achados, total });
    return { id: null, rotulo: null, encontrado: false, motivo: "AMBIGUO", origem: "TEXTO" };
  }
  const unico = achados[0]!;
  return { id: unico.id, rotulo: unico.rotulo, encontrado: true, motivo: null, origem: "TEXTO" };
}

export interface Previa {
  titulo: string;
  prioridade: Prioridade;
  /** ⚠️ Ausência de prazo é VISÍVEL, não some da estrutura. */
  prazo: { presente: boolean; valor: string | null; rotulo: string };
  cliente: ReferenciaNaPrevia;
  projeto: ReferenciaNaPrevia;
  responsaveis: ReferenciaNaPrevia[];
}

export interface Mudanca {
  campo: TipoDeReferencia;
  de: { id: string; rotulo: string } | null;
  para: { id: string; rotulo: string } | null;
}

export interface RespostaDaPrevia {
  previa: Previa;
  ambiguidades: Ambiguidade[];
  approvalToken: string | null;
  approvalExpiresAt: string | null;
  resolutionHash: string;
  mudou: Mudanca[] | null;
}

/**
 * Compara duas resoluções e diz **o que saiu e o que entrou**.
 *
 * ⚠️ **A comparação fica com quem é dono do dado, de propósito.** Do lado da Cora ela viraria
 * "adivinhar o que o Workspace quis dizer", e no dia em que acrescentássemos um campo à
 * resolução o diff dela ficaria desatualizado **sem quebrar nada** — o pior tipo de defeito.
 */
export function compararResolucoes(
  antes: readonly ReferenciaResolvida[],
  depois: readonly ReferenciaResolvida[],
): Mudanca[] {
  const chave = (r: ReferenciaResolvida) => `${r.tipo}:${r.id}`;
  const mapaAntes = new Map(antes.map((r) => [chave(r), r]));
  const mapaDepois = new Map(depois.map((r) => [chave(r), r]));
  const mudancas: Mudanca[] = [];
  for (const [k, a] of mapaAntes) {
    const d = mapaDepois.get(k);
    if (!d) mudancas.push({ campo: a.tipo, de: { id: a.id, rotulo: a.rotulo }, para: null });
    else if (d.rotulo !== a.rotulo) {
      mudancas.push({
        campo: a.tipo,
        de: { id: a.id, rotulo: a.rotulo },
        para: { id: d.id, rotulo: d.rotulo },
      });
    }
  }
  for (const [k, d] of mapaDepois) {
    if (!mapaAntes.has(k)) {
      mudancas.push({ campo: d.tipo, de: null, para: { id: d.id, rotulo: d.rotulo } });
    }
  }
  return mudancas.sort((a, b) => (a.campo === b.campo ? 0 : a.campo.localeCompare(b.campo)));
}

/** As referências resolvidas viram a lista canônica que entra no selo e no token. */
function referenciasDaPrevia(p: Previa): ReferenciaResolvida[] {
  const refs: ReferenciaResolvida[] = [];
  if (p.cliente.encontrado && p.cliente.id && p.cliente.rotulo) {
    refs.push({ tipo: "cliente", id: p.cliente.id, rotulo: p.cliente.rotulo });
  }
  if (p.projeto.encontrado && p.projeto.id && p.projeto.rotulo) {
    refs.push({ tipo: "projeto", id: p.projeto.id, rotulo: p.projeto.rotulo });
  }
  for (const r of p.responsaveis) {
    if (r.encontrado && r.id && r.rotulo) {
      refs.push({ tipo: "responsavel", id: r.id, rotulo: r.rotulo });
    }
  }
  return refs;
}

export function argumentosDaPrevia(p: Previa): ArgumentosDaTarefa {
  return {
    titulo: p.titulo,
    prioridade: p.prioridade,
    prazo: p.prazo.valor,
    clienteId: p.cliente.encontrado ? p.cliente.id : null,
    projetoId: p.projeto.encontrado ? p.projeto.id : null,
    responsavelIds: p.responsaveis.filter((r) => r.encontrado && r.id).map((r) => r.id!),
  };
}

/**
 * Monta a prévia.
 *
 * ⚠️ **REFERÊNCIA PEDIDA QUE NÃO RESOLVE TAMBÉM ZERA O `approvalToken`, e não só a ambígua.** Se
 * a Thaís disse "tarefa para a Clínica Mooca" e a clínica não existe, criar a tarefa **sem
 * cliente** seria gravar calado uma coisa diferente da que ela pediu — e ela só descobriria
 * procurando a tarefa na ficha errada. Campo **não informado** é outra história: aí não há nada
 * a perder, e a prévia segue com token.
 */
export async function montarPrevia(
  pedido: PedidoValidado,
  ctx: { requesterUserId: string; clientId: string },
  segredo: string,
  agora: Date = new Date(),
): Promise<RespostaDaPrevia> {
  const ambiguidades: Ambiguidade[] = [];

  const cliente = await resolverUma(
    pedido.cliente,
    "cliente",
    buscarClientes,
    conferirCliente,
    ambiguidades,
  );
  const projeto = await resolverUma(
    pedido.projeto,
    "projeto",
    buscarProjetos,
    conferirProjeto,
    ambiguidades,
  );

  const responsaveis: ReferenciaNaPrevia[] = [];
  for (let i = 0; i < pedido.responsaveis.length; i++) {
    responsaveis.push(
      await resolverUma(
        pedido.responsaveis[i]!,
        `responsaveis[${i}]`,
        buscarPessoas,
        conferirPessoa,
        ambiguidades,
      ),
    );
  }
  // Lista vazia = a própria pessoa delegada, exatamente como no lado humano ("vazio = só eu").
  // ⚠️ Aparece na prévia com `origem: "PADRAO"` — o padrão tem de ser LIDO antes de aprovado.
  if (responsaveis.length === 0) {
    const eu = await conferirPessoa(ctx.requesterUserId);
    responsaveis.push(
      eu
        ? { id: eu.id, rotulo: eu.rotulo, encontrado: true, motivo: null, origem: "PADRAO" }
        : { id: null, rotulo: null, encontrado: false, motivo: "NAO_ENCONTRADO", origem: "PADRAO" },
    );
  }

  const previa: Previa = {
    titulo: pedido.titulo,
    prioridade: pedido.prioridade,
    prazo: pedido.prazo
      ? { presente: true, valor: pedido.prazo.toISOString(), rotulo: pedido.prazo.toISOString() }
      : { presente: false, valor: null, rotulo: "sem prazo" },
    cliente,
    projeto,
    responsaveis,
  };

  const refs = referenciasDaPrevia(previa);
  const resolutionHash = selarResolucao(refs, segredo);

  const faltouAlgoPedido =
    (pedido.cliente !== null && !cliente.encontrado) ||
    (pedido.projeto !== null && !projeto.encontrado) ||
    responsaveis.some((r) => !r.encontrado);

  const podeAprovar = ambiguidades.length === 0 && !faltouAlgoPedido;
  const aprovacao = podeAprovar
    ? emitirAprovacao(
        {
          requesterUserId: ctx.requesterUserId,
          clientId: ctx.clientId,
          argumentos: argumentosDaPrevia(previa),
          referencias: refs,
        },
        segredo,
        agora,
      )
    : null;

  return {
    previa,
    ambiguidades,
    approvalToken: aprovacao?.token ?? null,
    approvalExpiresAt: aprovacao?.expiraEm.toISOString() ?? null,
    resolutionHash,
    mudou: pedido.resolucaoAnterior ? compararResolucoes(pedido.resolucaoAnterior, refs) : null,
  };
}

/**
 * Confere a FORMA dos argumentos que chegam na execução.
 *
 * ⚠️ **Isto não confere se eles são os aprovados — quem faz isso é o `argsHash`.** Serve só para
 * o hash ser calculado sobre valores do tipo certo: sem esta passagem, `responsavelIds: "abc"`
 * viraria um hash diferente e a Cora receberia "argumento alterado" quando o defeito real é
 * "campo com o tipo errado". Erro claro vale mais que erro parecido.
 */
export function validarArgumentos(
  cru: unknown,
): { ok: true; valor: ArgumentosDaTarefa } | { ok: false; detalhe: string } {
  if (typeof cru !== "object" || cru === null || Array.isArray(cru)) {
    return { ok: false, detalhe: "`task` precisa ser um objeto" };
  }
  const t = cru as Record<string, unknown>;
  if (typeof t.titulo !== "string" || !t.titulo.trim()) {
    return { ok: false, detalhe: "`task.titulo` obrigatório" };
  }
  if (!ehPrioridade(t.prioridade)) {
    return { ok: false, detalhe: `\`task.prioridade\` precisa ser ${PRIORIDADES.join(", ")}` };
  }
  const prioridade = t.prioridade;
  if (t.prazo !== null && t.prazo !== undefined) {
    if (typeof t.prazo !== "string" || Number.isNaN(new Date(t.prazo).getTime())) {
      return { ok: false, detalhe: "`task.prazo` precisa ser ISO 8601 ou null" };
    }
  }
  const idOuNulo = (v: unknown, campo: string) =>
    v === null || v === undefined || typeof v === "string" ? null : `\`task.${campo}\` precisa ser texto ou null`;
  const e1 = idOuNulo(t.clienteId, "clienteId");
  if (e1) return { ok: false, detalhe: e1 };
  const e2 = idOuNulo(t.projetoId, "projetoId");
  if (e2) return { ok: false, detalhe: e2 };
  if (!Array.isArray(t.responsavelIds) || t.responsavelIds.some((x) => typeof x !== "string")) {
    return { ok: false, detalhe: "`task.responsavelIds` precisa ser uma lista de textos" };
  }
  if (t.responsavelIds.length === 0) {
    return { ok: false, detalhe: "`task.responsavelIds` não pode ser vazio" };
  }
  return {
    ok: true,
    valor: {
      titulo: t.titulo,
      prioridade,
      prazo: typeof t.prazo === "string" ? t.prazo : null,
      clienteId: typeof t.clienteId === "string" ? t.clienteId : null,
      projetoId: typeof t.projetoId === "string" ? t.projetoId : null,
      responsavelIds: t.responsavelIds as string[],
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 3. A REVALIDAÇÃO NO INSTANTE DE EXECUTAR
// ─────────────────────────────────────────────────────────────

export type MotivoDaDivergencia = "NAO_ENCONTRADO" | "ROTULO_MUDOU" | "SEM_ACESSO";

export interface Divergencia {
  campo: TipoDeReferencia;
  aprovado: { id: string; rotulo: string };
  atual: { id: string; rotulo: string } | null;
  motivo: MotivoDaDivergencia;
}

/**
 * Resolve DE NOVO, pelos ids aprovados, e compara com os rótulos que a pessoa leu.
 *
 * ⚠️ **É esta função — e não o prazo do token — que protege a Thaís.** Um token de ontem executa
 * exatamente o que ela aprovou, porque está amarrado ao hash dos argumentos; o que muda em
 * quarenta minutos não é o pedido, é o **mundo**. O prazo de 15 minutos é higiene.
 */
export async function revalidar(aprovadas: readonly ReferenciaResolvida[]): Promise<Divergencia[]> {
  const divergencias: Divergencia[] = [];
  for (const ref of aprovadas) {
    const atual =
      ref.tipo === "cliente"
        ? await conferirCliente(ref.id)
        : ref.tipo === "projeto"
          ? await conferirProjeto(ref.id)
          : await conferirPessoa(ref.id);
    if (!atual) {
      // Pessoa some da busca da equipe por dois motivos diferentes, e a Cora precisa saber qual:
      // "não existe mais" e "perdeu o acesso" pedem frases diferentes para a Thaís ler.
      divergencias.push({
        campo: ref.tipo,
        aprovado: { id: ref.id, rotulo: ref.rotulo },
        atual: null,
        motivo: ref.tipo === "responsavel" ? "SEM_ACESSO" : "NAO_ENCONTRADO",
      });
      continue;
    }
    if (atual.rotulo !== ref.rotulo) {
      divergencias.push({
        campo: ref.tipo,
        aprovado: { id: ref.id, rotulo: ref.rotulo },
        atual: { id: atual.id, rotulo: atual.rotulo },
        motivo: "ROTULO_MUDOU",
      });
    }
  }
  return divergencias;
}

// ─────────────────────────────────────────────────────────────
// 4. A CRIAÇÃO, COM RESERVA ATÔMICA DA CHAVE
// ─────────────────────────────────────────────────────────────

export interface PedidoDeCriacao {
  clientId: string;
  requesterUserId: string;
  chave: string;
  jti: string;
  argumentos: ArgumentosDaTarefa;
}

export type ResultadoDaCriacao =
  | { situacao: "CRIADA"; tarefaId: string }
  | { situacao: "REPETIDA"; tarefaId: string }
  | { situacao: "CONFLITO_DE_CHAVE" }
  | { situacao: "APROVACAO_JA_USADA" }
  | { situacao: "RESERVA_INCOMPLETA" };

function ehViolacaoDeUnico(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Ponto de injeção para provar o **W16** — a queda ENTRE a reserva da chave e a criação da
 * tarefa.
 *
 * ⚠️ Existe porque esse cenário **não se prova de outro jeito**: qualquer falha "natural" que a
 * gente conseguisse forçar (cliente apagado, responsável desativado, projeto inexistente) é
 * pega antes, pela revalidação, e a execução nem chega à transação. Sem esta costura, o W16
 * seria descrito e não provado — e atomicidade é justamente o que não se prova lendo código.
 * O padrão é a criação de verdade; ninguém troca isto em produção.
 */
export interface DependenciasDaCriacao {
  criar: typeof montarTarefa;
}

const PADRAO: DependenciasDaCriacao = { criar: montarTarefa };

/**
 * Cria a tarefa reservando a chave de idempotência **na mesma transação**.
 *
 * ⚠️ **QUEM GARANTE A ATOMICIDADE É O ÍNDICE ÚNICO, NÃO O NÍVEL DE ISOLAMENTO.** Em
 * `REPEATABLE READ` (o padrão do MySQL e do MariaDB 10.6 de produção) duas conexões que leem
 * "essa chave já existe?" e depois inserem **passam as duas** — o clássico "confere e grava"
 * perdido. Só `SERIALIZABLE` ou um lock explícito impediriam, e os dois custam caro numa rota
 * chamada em laço por um programa, com pool de 13 conexões. Então: **`INSERT` primeiro**;
 * quando duas chamadas correm juntas, o InnoDB segura a segunda no índice até a primeira
 * terminar, e aí ela leva `P2002` — que é a resposta "alguém já tem", não um erro.
 *
 * ⚠️ **A ORDEM É RESERVA → TAREFA, dentro de UMA transação.** Se a tarefa nascesse antes, uma
 * queda no meio deixaria tarefa sem chave e repetir criaria a segunda. Se fossem duas
 * transações, uma queda entre elas deixaria chave sem tarefa e repetir **nunca mais** criaria.
 */
export async function criarTarefaDoAgente(
  pedido: PedidoDeCriacao,
  agora: Date = new Date(),
  deps: DependenciasDaCriacao = PADRAO,
  segundaTentativa = false,
): Promise<ResultadoDaCriacao> {
  const expiraEm = new Date(agora.getTime() + HORAS_DA_CHAVE * 60 * 60 * 1000);
  const argsHash = hashDosArgumentos(pedido.argumentos);
  const reserva = {
    clientId: pedido.clientId,
    userId: pedido.requesterUserId,
    ferramenta: FERRAMENTA,
    chave: pedido.chave,
  };

  let criada: { id: string; titulo: string; criadoPorId: string };
  try {
    criada = await prisma.$transaction(
      async (tx) => {
        const linha = await tx.agentIdempotency.create({
          data: { ...reserva, argsHash, jti: pedido.jti, expiraEm },
        });
        const tarefa = await deps.criar(tx, {
          titulo: pedido.argumentos.titulo,
          criadoPorId: pedido.requesterUserId,
          prazo: pedido.argumentos.prazo ? new Date(pedido.argumentos.prazo) : null,
          prioridade: pedido.argumentos.prioridade,
          clienteId: pedido.argumentos.clienteId,
          projetoId: pedido.argumentos.projetoId,
          responsavelIds: pedido.argumentos.responsavelIds,
        });
        await tx.agentIdempotency.update({ where: { id: linha.id }, data: { tarefaId: tarefa.id } });
        return { id: tarefa.id, titulo: tarefa.titulo, criadoPorId: tarefa.criadoPorId };
      },
      // Folga para a segunda chamada esperar a primeira no índice sem estourar por tempo.
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (!ehViolacaoDeUnico(e)) throw e;

    // ⚠️ **QUAL DOS DOIS ÍNDICES ESTOUROU SE DESCOBRE CONSULTANDO, não lendo o `meta` do erro.**
    // O nome que o driver devolve muda entre versões e entre MySQL e MariaDB; a consulta é
    // determinística e responde a mesma coisa em qualquer um.
    const porChave = await prisma.agentIdempotency.findUnique({
      where: { clientId_userId_ferramenta_chave: reserva },
    });
    if (porChave) {
      if (porChave.expiraEm <= agora) {
        // Chave vencida: o contrato promete 24 h, então ela não pode bloquear para sempre por o
        // expurgo ainda não ter passado. Apaga e tenta UMA vez — sem laço, que viraria disputa.
        if (segundaTentativa) return { situacao: "RESERVA_INCOMPLETA" };
        await prisma.agentIdempotency.delete({ where: { id: porChave.id } }).catch(() => {});
        return criarTarefaDoAgente(pedido, agora, deps, true);
      }
      if (porChave.argsHash !== argsHash) return { situacao: "CONFLITO_DE_CHAVE" };
      // ⚠️ `tarefaId` nulo aqui não deveria acontecer: a linha só fica visível depois do commit,
      // e o commit inclui o vínculo. Se acontecer, a resposta honesta é "tente de novo", nunca
      // criar uma segunda tarefa — que é o defeito que esta tabela inteira existe para impedir.
      if (!porChave.tarefaId) return { situacao: "RESERVA_INCOMPLETA" };
      return { situacao: "REPETIDA", tarefaId: porChave.tarefaId };
    }

    const porJti = await prisma.agentIdempotency.findUnique({ where: { jti: pedido.jti } });
    if (porJti) return { situacao: "APROVACAO_JA_USADA" };

    // Nenhum dos dois: corrida com o expurgo entre o erro e a consulta. Uma nova tentativa.
    if (segundaTentativa) return { situacao: "RESERVA_INCOMPLETA" };
    return criarTarefaDoAgente(pedido, agora, deps, true);
  }

  // ⚠️ **O aviso sai FORA da transação, e é best-effort.** Dentro dela, uma falha de notificação
  // desfaria a tarefa que já foi aprovada; e uma transação aberta enquanto se manda e-mail
  // segura conexão do pool, que aqui é 13.
  void avisarDelegacao(criada, pedido.argumentos.responsavelIds).catch(() => {});
  return { situacao: "CRIADA", tarefaId: criada.id };
}

/**
 * Apaga as reservas vencidas. Chamada pelo expurgo diário de retenção.
 *
 * ⚠️ **Tabela sem expurgo cresce para sempre** — foi assim que o `ActivityLog` virou achado na
 * ADR-148, e esta aqui recebe uma linha por tarefa criada pelo agente.
 */
export async function expurgarIdempotenciasVencidas(agora: Date = new Date()): Promise<number> {
  const res = await prisma.agentIdempotency.deleteMany({ where: { expiraEm: { lt: agora } } });
  return res.count;
}
