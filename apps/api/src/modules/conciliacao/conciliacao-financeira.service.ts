import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import { emReais, emReaisOu } from "../../lib/dinheiro.js";
import { normalizarTexto } from "./planilha/index.js";
import { glosaDe, repartirRecebido, statusDaConciliacao, type StatusConciliacao } from "./conciliacao-cirurgica.js";

/**
 * CONCILIAÇÃO — Fase 2b: o dinheiro de cada cirurgia, calculado na LEITURA.
 *
 * Spec: `docs/superpowers/specs/2026-09-18-conciliacao-fase-2b-design.md`.
 *
 * Nada aqui é gravado de volta: cobrado = o digitado, senão o do de-para do procedimento;
 * recebido = o digitado, senão a parte desta cirurgia no repasse do atendimento. Assim corrigir um
 * preço ou importar um repasse vale na hora, para todas as cirurgias, sem retroação a lembrar.
 *
 * ⚠️ `Decimal` nunca sai daqui: toda coluna de dinheiro passa por `emReais` (ADR-118).
 */

const dia = (d: Date) => d.toISOString().slice(0, 10);
const somar = (a: number, b: number) => Math.round((a + b) * 100) / 100;

/** A chave do de-para de procedimento: o texto normalizado, como convênio e profissional. */
export const chaveDoProcedimento = (bruto: string) => normalizarTexto(bruto);

export interface LinhaConciliada {
  id: string;
  numeroCirurgia: string;
  atendimento: string | null;
  dataCirurgia: string;
  competencia: string;
  pacienteNome: string;
  procedimento: string;
  status: "EXECUTADA" | "RESERVADA" | "OUTRO";
  statusBruto: string;
  autorizacao: string;
  autorizacaoBruto: string;
  categoriaConvenio: string;
  convenioBruto: string;
  operadora: { id: string; nome: string } | null;
  profissionalBruto: string;
  profissional: { id: string; nome: string } | null;
  codigo: string | null;
  cobrado: number | null;
  /** De onde veio o cobrado — a tela mostra, para ninguém confundir preço de tabela com digitado. */
  cobradoOrigem: "MANUAL" | "DE_PARA" | null;
  recebido: number | null;
  recebidoOrigem: "MANUAL" | "REPASSE" | null;
  /** O repasse deste atendimento foi dividido com outra cirurgia. */
  repasseCompartilhado: boolean;
  dataPagamento: string | null;
  glosa: number | null;
  statusConciliacao: StatusConciliacao;
  naoCobrar: boolean;
  observacao: string | null;
}

export interface TotaisConciliacao {
  cirurgias: number;
  cobrado: number;
  recebido: number;
  glosa: number;
  /** Cobrado das que estão A_RECEBER — o que ainda deve entrar. */
  aReceber: number;
  porStatus: Partial<Record<StatusConciliacao, number>>;
}

export interface RecebidoSemProducao {
  /** Repasse cujo atendimento não tem cirurgia nenhuma (ou vem sem atendimento: incremento, acordo). */
  total: number;
  linhas: number;
  /**
   * Repasse de atendimento QUE TEM cirurgia, mas sem cirurgia para recebê-lo: todas com valor
   * digitado (sobrou além do digitado), marcadas "não cobrar", ou não realizadas no TASY.
   */
  naoAtribuido: number;
}

/**
 * Monta a conciliação INTEIRA de um cliente. Um cliente tem centenas a poucos milhares de
 * cirurgias por ano: caber em memória é o que permite filtrar por status (que é calculado) e
 * somar os totais do filtro, não só da página.
 */
export async function montarConciliacao(clienteId: string): Promise<{ linhas: LinhaConciliada[]; semProducao: RecebidoSemProducao }> {
  const [cirurgias, mapeamentos, repasses] = await Promise.all([
    prisma.producaoCirurgia.findMany({
      where: { clienteId },
      select: {
        id: true,
        numeroCirurgia: true,
        atendimento: true,
        dataCirurgia: true,
        competencia: true,
        pacienteNome: true,
        procedimento: true,
        status: true,
        statusBruto: true,
        autorizacao: true,
        autorizacaoBruto: true,
        categoriaConvenio: true,
        convenioBruto: true,
        operadoraId: true,
        profissionalBruto: true,
        codigoProcedimento: true,
        valorCobrado: true,
        valorRecebido: true,
        dataPagamento: true,
        naoCobrar: true,
        observacao: true,
        operadora: { select: { id: true, nome: true } },
        profissional: { select: { id: true, nome: true } },
      },
      orderBy: [{ dataCirurgia: "desc" }, { numeroCirurgia: "desc" }],
    }),
    prisma.mapeamentoProcedimento.findMany({
      where: { clienteId },
      select: { textoNormalizado: true, operadoraId: true, codigo: true, valor: true },
    }),
    prisma.repasseLinha.groupBy({
      by: ["atendimento"],
      where: { clienteId },
      _sum: { valor: true },
      _max: { dataPagamento: true },
    }),
  ]);

  // De-para: a operadora da cirurgia primeiro, o padrão (operadora nula) depois — CAMPO A CAMPO.
  // Um código cadastrado só para a Unimed não pode esconder o valor padrão do procedimento.
  const dePara = new Map<string, { codigo: string | null; valor: number | null }>();
  for (const m of mapeamentos) {
    dePara.set(`${m.textoNormalizado}|${m.operadoraId ?? ""}`, { codigo: m.codigo, valor: emReais(m.valor) });
  }
  const buscarDePara = (procedimento: string, operadoraId: string | null) => {
    const chave = chaveDoProcedimento(procedimento);
    const daOperadora = operadoraId ? dePara.get(`${chave}|${operadoraId}`) : undefined;
    const padrao = dePara.get(`${chave}|`);
    return {
      codigo: daOperadora?.codigo ?? padrao?.codigo ?? null,
      valor: daOperadora?.valor ?? padrao?.valor ?? null,
    };
  };

  // Repasse por atendimento. O que não tem atendimento, ou não casa com cirurgia nenhuma, é
  // recebido sem produção — dinheiro que entrou e precisa aparecer em algum lugar.
  const atendimentosComCirurgia = new Set(cirurgias.map((c) => c.atendimento).filter((a): a is string => !!a));
  const repassePorAtend = new Map<string, { total: number; ultimaData: Date | null }>();
  const semProducao: RecebidoSemProducao = { total: 0, linhas: 0, naoAtribuido: 0 };
  for (const r of repasses) {
    const total = emReaisOu(r._sum.valor, 0);
    if (r.atendimento && atendimentosComCirurgia.has(r.atendimento)) {
      repassePorAtend.set(r.atendimento, { total, ultimaData: r._max.dataPagamento });
    } else {
      semProducao.total = somar(semProducao.total, total);
    }
  }
  if (semProducao.total !== 0) {
    semProducao.linhas = await prisma.repasseLinha.count({
      where: { clienteId, OR: [{ atendimento: null }, { atendimento: { notIn: [...atendimentosComCirurgia] } }] },
    });
  }

  // Primeira passada: cobrado de cada uma (precisa estar pronto para repartir o repasse).
  const base = cirurgias.map((c) => {
    const manual = emReais(c.valorCobrado);
    const dp = buscarDePara(c.procedimento, c.operadoraId);
    const cobrado = manual ?? dp.valor;
    return {
      c,
      codigo: c.codigoProcedimento ?? dp.codigo,
      cobrado,
      cobradoOrigem: manual !== null ? ("MANUAL" as const) : cobrado !== null ? ("DE_PARA" as const) : null,
    };
  });

  // Repartição por atendimento, entre as cirurgias REALIZADAS e cobráveis dele.
  // ⚠️ O recebido DIGITADO de uma delas é ABATIDO do repasse antes de repartir o resto — sem isso,
  // digitar 600 numa cirurgia jogaria o repasse inteiro na outra e o dinheiro contaria duas vezes.
  // O que sobra sem ninguém para receber (todas digitadas, "não cobrar", ou não realizadas) é
  // repasse NÃO ATRIBUÍDO: aparece na tela, nunca some.
  const parteDoRepasse = new Map<string, number>();
  const compartilhado = new Set<string>();
  const cobraveis = new Map<string, typeof base>();
  for (const b of base) {
    if (!b.c.atendimento || b.c.status !== "EXECUTADA" || b.c.naoCobrar) continue;
    const lista = cobraveis.get(b.c.atendimento) ?? [];
    lista.push(b);
    cobraveis.set(b.c.atendimento, lista);
  }
  for (const [atend, rep] of repassePorAtend) {
    const lista = cobraveis.get(atend) ?? [];
    const digitado = lista.reduce((s, b) => somar(s, emReais(b.c.valorRecebido) ?? 0), 0);
    const automaticas = lista
      .filter((b) => b.c.valorRecebido === null)
      .sort((a, b) => a.c.numeroCirurgia.localeCompare(b.c.numeroCirurgia));
    const resto = Math.max(somar(rep.total, -digitado), 0);
    if (automaticas.length === 0) {
      semProducao.naoAtribuido = somar(semProducao.naoAtribuido, resto);
      continue;
    }
    const partes = repartirRecebido(
      automaticas.map((b) => ({ id: b.c.id, cobrado: b.cobrado })),
      resto,
    );
    for (const [id, v] of partes) parteDoRepasse.set(id, v);
    if (lista.length > 1) lista.forEach((b) => compartilhado.add(b.c.id));
  }

  const linhas: LinhaConciliada[] = base.map(({ c, codigo, cobrado, cobradoOrigem }) => {
    const manual = emReais(c.valorRecebido);
    const doRepasse = parteDoRepasse.get(c.id);
    const recebido = manual ?? doRepasse ?? null;
    const rep = c.atendimento ? repassePorAtend.get(c.atendimento) : undefined;
    const dataPagamento = c.dataPagamento ?? (doRepasse !== undefined ? (rep?.ultimaData ?? null) : null);
    return {
      id: c.id,
      numeroCirurgia: c.numeroCirurgia,
      atendimento: c.atendimento,
      dataCirurgia: dia(c.dataCirurgia),
      competencia: c.competencia,
      pacienteNome: c.pacienteNome,
      procedimento: c.procedimento,
      status: c.status,
      statusBruto: c.statusBruto,
      autorizacao: c.autorizacao,
      autorizacaoBruto: c.autorizacaoBruto,
      categoriaConvenio: c.categoriaConvenio,
      convenioBruto: c.convenioBruto,
      operadora: c.operadora,
      profissionalBruto: c.profissionalBruto,
      profissional: c.profissional,
      codigo,
      cobrado,
      cobradoOrigem,
      recebido,
      recebidoOrigem: manual !== null ? "MANUAL" : doRepasse !== undefined ? "REPASSE" : null,
      repasseCompartilhado: compartilhado.has(c.id),
      dataPagamento: dataPagamento ? dia(dataPagamento) : null,
      glosa: glosaDe(cobrado, recebido),
      statusConciliacao: statusDaConciliacao({
        statusTasy: c.status,
        naoCobrar: c.naoCobrar,
        atendimento: c.atendimento,
        cobrado,
        recebido,
      }),
      naoCobrar: c.naoCobrar,
      observacao: c.observacao,
    };
  });

  return { linhas, semProducao };
}

/** Status que ficam FORA de toda soma de dinheiro. */
const FORA_DA_CONTA: StatusConciliacao[] = ["NAO_REALIZADA", "NAO_COBRAR"];

export function totalizar(linhas: LinhaConciliada[]): TotaisConciliacao {
  const t: TotaisConciliacao = { cirurgias: linhas.length, cobrado: 0, recebido: 0, glosa: 0, aReceber: 0, porStatus: {} };
  for (const l of linhas) {
    t.porStatus[l.statusConciliacao] = (t.porStatus[l.statusConciliacao] ?? 0) + 1;
    if (FORA_DA_CONTA.includes(l.statusConciliacao)) continue;
    if (l.cobrado !== null) t.cobrado = somar(t.cobrado, l.cobrado);
    if (l.recebido !== null) t.recebido = somar(t.recebido, l.recebido);
    if (l.glosa !== null) t.glosa = somar(t.glosa, l.glosa);
    if (l.statusConciliacao === "A_RECEBER" && l.cobrado !== null) t.aReceber = somar(t.aReceber, l.cobrado);
  }
  return t;
}

// ─── Edição de uma cirurgia ─────────────────────────────────────────────────────────────────────

export interface EdicaoCirurgia {
  codigoProcedimento?: string | null;
  valorCobrado?: number | null;
  valorRecebido?: number | null;
  /** `AAAA-MM-DD`. */
  dataPagamento?: string | null;
  naoCobrar?: boolean;
  observacao?: string | null;
}

export async function editarCirurgia(clienteId: string, id: string, e: EdicaoCirurgia) {
  // Posse no próprio WHERE: um id vindo da tela nunca edita a cirurgia de outro cliente.
  const { count } = await prisma.producaoCirurgia.updateMany({
    where: { id, clienteId },
    data: {
      ...(e.codigoProcedimento !== undefined ? { codigoProcedimento: e.codigoProcedimento?.trim() || null } : {}),
      ...(e.valorCobrado !== undefined ? { valorCobrado: e.valorCobrado } : {}),
      ...(e.valorRecebido !== undefined ? { valorRecebido: e.valorRecebido } : {}),
      ...(e.dataPagamento !== undefined ? { dataPagamento: e.dataPagamento ? new Date(`${e.dataPagamento}T00:00:00Z`) : null } : {}),
      ...(e.naoCobrar !== undefined ? { naoCobrar: e.naoCobrar } : {}),
      ...(e.observacao !== undefined ? { observacao: e.observacao?.trim() || null } : {}),
    },
  });
  if (count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Cirurgia não encontrada neste cliente." });
  return { ok: true };
}

// ─── De-para de procedimento ────────────────────────────────────────────────────────────────────

export async function listarProcedimentos(clienteId: string) {
  const [grupos, mapeamentos] = await Promise.all([
    prisma.producaoCirurgia.groupBy({ by: ["procedimento"], where: { clienteId }, _count: { _all: true } }),
    prisma.mapeamentoProcedimento.findMany({
      where: { clienteId },
      select: {
        id: true,
        textoNormalizado: true,
        operadoraId: true,
        codigo: true,
        valor: true,
        operadora: { select: { nome: true } },
      },
    }),
  ]);

  // Textos que normalizam igual são UM procedimento (mesma lição do convênio: `Cassi` × `CASSI`).
  const porChave = new Map<string, { procedimento: string; cirurgias: number }>();
  for (const g of grupos) {
    const chave = chaveDoProcedimento(g.procedimento);
    const atual = porChave.get(chave);
    if (atual) atual.cirurgias += g._count._all;
    else porChave.set(chave, { procedimento: g.procedimento, cirurgias: g._count._all });
  }

  return [...porChave.entries()]
    .map(([chave, p]) => {
      const deste = mapeamentos.filter((m) => m.textoNormalizado === chave);
      const padrao = deste.find((m) => m.operadoraId === null);
      return {
        procedimento: p.procedimento,
        cirurgias: p.cirurgias,
        padrao: padrao ? { codigo: padrao.codigo, valor: emReais(padrao.valor) } : null,
        porOperadora: deste
          .filter((m) => m.operadoraId !== null)
          .map((m) => ({
            operadoraId: m.operadoraId!,
            operadora: m.operadora?.nome ?? "",
            codigo: m.codigo,
            valor: emReais(m.valor),
          })),
      };
    })
    .sort((a, b) => b.cirurgias - a.cirurgias);
}

export async function salvarProcedimento(e: {
  clienteId: string;
  textoBruto: string;
  operadoraId: string | null;
  codigo: string | null;
  valor: number | null;
}) {
  const textoNormalizado = chaveDoProcedimento(e.textoBruto);
  if (!textoNormalizado) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o procedimento." });
  if (e.operadoraId) {
    const existe = await prisma.operadora.findUnique({ where: { id: e.operadoraId }, select: { id: true } });
    if (!existe) throw new TRPCError({ code: "NOT_FOUND", message: "Operadora não encontrada." });
  }
  const codigo = e.codigo?.trim() || null;

  // findFirst em vez de upsert: com operadora nula, o índice único do MySQL não impede duas
  // linhas "padrão" — quem impede é procurar antes de criar.
  const atual = await prisma.mapeamentoProcedimento.findFirst({
    where: { clienteId: e.clienteId, textoNormalizado, operadoraId: e.operadoraId },
    select: { id: true },
  });
  if (codigo === null && e.valor === null) {
    if (atual) await prisma.mapeamentoProcedimento.delete({ where: { id: atual.id } });
    return { ok: true, removido: !!atual };
  }
  const dados = { textoBruto: e.textoBruto.slice(0, 255), codigo, valor: e.valor };
  if (atual) await prisma.mapeamentoProcedimento.update({ where: { id: atual.id }, data: dados });
  else
    await prisma.mapeamentoProcedimento.create({
      data: { clienteId: e.clienteId, textoNormalizado, operadoraId: e.operadoraId, ...dados },
    });
  return { ok: true, removido: false };
}

// ─── Visão geral: todos os clientes ─────────────────────────────────────────────────────────────

export interface LinhaDaVisaoGeral {
  clienteId: string;
  nome: string;
  consultas: number;
  cirurgias: number;
  executadas: number;
  cobrado: number;
  recebido: number;
  glosa: number;
  aReceber: number;
  recebidoSemProducao: number;
  semValor: number;
  semAtendimento: number;
  /** Cirurgias com convênio ou médico ainda sem de-para. */
  pendenciasDePara: number;
  ultimaImportacao: { em: Date; origem: string } | null;
}

/**
 * ⚠️ `soDestes` é OBRIGATÓRIO de propósito — sem valor padrão. Com ` = null` (todos), o dia em que
 * um segundo chamador esquecesse o argumento devolveria a base inteira, sem erro, sem log e sem
 * CI vermelha. Exigir o parâmetro faz o COMPILADOR cobrar a decisão de quem escrever a próxima
 * chamada, que é a mesma lição da ADR-144.
 */
export async function visaoGeral(soDestes: { responsavelId: string } | null) {
  const clientes = await prisma.cliente.findMany({
    // ⚠️ `soDestes` vem do papel de quem pediu (`filtroDeClientesVisiveis`), NUNCA do pedido:
    // funcionário vê os clientes dele, ADMIN+ vê todos. Sem isto, esta tela — que existe para
    // dar a visão do conjunto — seria o caminho mais curto para contornar a trava por cliente.
    where: { deletedAt: null, producaoLotes: { some: {} }, ...(soDestes ?? {}) },
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });

  // UM cliente por vez: cada um já abre ~8 consultas em paralelo, e o pool é de 13 conexões
  // (esgotamento já visto em produção). Somar N clientes em paralelo derrubaria o pool.
  const saida: LinhaDaVisaoGeral[] = [];
  for (const cl of clientes) {
    const [{ linhas, semProducao }, consultas, ultima, convPend, profPend] = await Promise.all([
      montarConciliacao(cl.id),
      prisma.producaoConsulta.count({ where: { clienteId: cl.id } }),
      prisma.producaoLote.findFirst({
        where: { clienteId: cl.id, status: "IMPORTADO" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, origem: true },
      }),
      prisma.producaoCirurgia.count({ where: { clienteId: cl.id, operadoraId: null } }),
      prisma.producaoCirurgia.count({ where: { clienteId: cl.id, profissionalId: null } }),
    ]);
    const t = totalizar(linhas);
    saida.push({
      clienteId: cl.id,
      nome: cl.nome,
      consultas,
      cirurgias: linhas.length,
      executadas: linhas.filter((l) => l.status === "EXECUTADA").length,
      cobrado: t.cobrado,
      recebido: t.recebido,
      glosa: t.glosa,
      aReceber: t.aReceber,
      recebidoSemProducao: somar(semProducao.total, semProducao.naoAtribuido),
      semValor: t.porStatus.SEM_VALOR ?? 0,
      semAtendimento: t.porStatus.SEM_ATENDIMENTO ?? 0,
      /** Cirurgias com convênio ou médico ainda sem de-para. */
      pendenciasDePara: convPend + profPend,
      ultimaImportacao: ultima ? { em: ultima.createdAt, origem: ultima.origem } : null,
    });
  }
  /**
   * ⚠️ O TOTAL SAI DAQUI, não do navegador.
   *
   * Era somado na tela, e é o único número de dinheiro da feature que não vinha do servidor —
   * justamente o cabeçalho que responde "onde está o dinheiro parado". No dia em que esta lista
   * ganhasse paginação ou um teto, o cabeçalho viraria uma soma PARCIAL apresentada como total,
   * sem sinal nenhum. Somando aqui, ele acompanha o que a consulta de fato devolveu.
   */
  const total = (k: "cobrado" | "recebido" | "glosa" | "aReceber") => saida.reduce((s, l) => somar(s, l[k]), 0);
  return {
    clientes: saida,
    totais: { cobrado: total("cobrado"), recebido: total("recebido"), glosa: total("glosa"), aReceber: total("aReceber") },
  };
}
