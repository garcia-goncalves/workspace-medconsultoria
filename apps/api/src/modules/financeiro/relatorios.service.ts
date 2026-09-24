import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { Carteira, FiltroContasInput } from "@app/shared";
import { hojeBRT } from "../../lib/datas.js";
import { whereCarteira, whereDoFiltro, type Ctx } from "./contas.service.js";
import {
  inicioDoMes,
  mesDaData,
  mesesAPartir,
  mesesAte,
  montarInadimplencia,
  montarProjecao,
  montarRelatorioMensal,
  planilhaDoContador,
  projetarSerie,
  type BaseDaSerie,
  type ItemProjecao,
} from "./relatorios.js";

/**
 * O FINANCEIRO QUE RESPONDE PERGUNTAS — a busca no banco. As contas moram em `relatorios.ts`.
 *
 * ⚠️ Toda consulta aqui passa por `whereCarteira`: é ela que garante que a carteira PESSOAL de
 * outra pessoa não entra em relatório, projeção, inadimplência nem planilha. Rota nova deste
 * arquivo que montar o próprio `where` sem ela reabre o buraco.
 */

/** Mês corrente (BRT) como "AAAA-MM". `hojeBRT` já é meia-noite UTC do dia de Brasília. */
const mesCorrente = () => mesDaData(hojeBRT());

// ── Relatório mês a mês ──────────────────────────────────
export async function relatorioMensal(carteira: Carteira, meses: number, ctx: Ctx) {
  const lista = mesesAte(mesCorrente(), meses);
  const inicio = inicioDoMes(lista[0]!);
  const base = { deletedAt: null, ...whereCarteira(carteira, ctx) };

  const [pagas, vencidas] = await Promise.all([
    // Margem de propósito: `inicio` é meia-noite UTC e o mês é de Brasília (3h depois). O que
    // cair antes da janela é descartado pela régua pura (`mesDoPagamento`), não aqui.
    prisma.conta.findMany({
      where: {
        ...base,
        pago: true,
        AND: [{ OR: [{ pagoEm: { gte: inicio } }, { pagoEm: null, vencimento: { gte: inicio } }] }],
      },
      select: { tipo: true, valor: true, pagoEm: true, vencimento: true },
    }),
    prisma.conta.findMany({
      where: { ...base, tipo: "RECEBER", pago: false, vencimento: { gte: inicio, lt: hojeBRT() } },
      select: { tipo: true, valor: true, vencimento: true },
    }),
  ]);

  return {
    meses: montarRelatorioMensal(
      lista,
      pagas.map((c) => ({ ...c, valor: c.valor.toNumber() })),
      vencidas.map((c) => ({ ...c, valor: c.valor.toNumber() })),
    ),
  };
}

// ── Projeção de caixa ────────────────────────────────────
/**
 * Saldo projetado dos próximos meses (o corrente conta como o 1º, só do dia de hoje em diante):
 * contas EM ABERTO a receber − a pagar com vencimento no mês, MAIS as parcelas que as séries
 * recorrentes ainda vão gerar (projetadas, sem gravar). O que já venceu e não foi pago sai à
 * parte: somá-lo ao mês corrente faria "setembro" carregar a dívida de março.
 */
export async function projecaoCaixa(carteira: Carteira, meses: number, ctx: Ctx) {
  const hoje = hojeBRT();
  const lista = mesesAPartir(mesCorrente(), meses);
  const fim = inicioDoMes(lista[lista.length - 1]!, 1);
  const base = { deletedAt: null, ...whereCarteira(carteira, ctx) };

  const [abertas, vencidas, recorrentes] = await Promise.all([
    prisma.conta.findMany({
      where: { ...base, pago: false, vencimento: { gte: hoje, lt: fim } },
      select: { tipo: true, valor: true, vencimento: true },
    }),
    prisma.conta.groupBy({
      by: ["tipo"],
      where: { ...base, pago: false, vencimento: { lt: hoje } },
      _sum: { valor: true },
      _count: { _all: true },
    }),
    prisma.conta.findMany({
      where: { ...base, recorrencia: { not: "NENHUMA" } },
      select: {
        id: true, tipo: true, valor: true, vencimento: true, recorrencia: true,
        recorrenciaAte: true, recorrenteId: true,
      },
    }),
  ]);

  // A ocorrência VIVA mais recente de cada série — a mesma escolha da varredura
  // (`garantirProximasRecorrencias`): é dela que a série continua.
  const ultimaPorSerie = new Map<string, BaseDaSerie>();
  for (const c of recorrentes) {
    const serie = c.recorrenteId ?? c.id;
    const atual = ultimaPorSerie.get(serie);
    if (!atual || c.vencimento > atual.vencimento) {
      ultimaPorSerie.set(serie, {
        serie,
        tipo: c.tipo,
        valor: c.valor.toNumber(),
        vencimento: c.vencimento,
        recorrencia: c.recorrencia,
        recorrenciaAte: c.recorrenciaAte,
      });
    }
  }

  // Todas as datas já ocupadas de cada série, INCLUSIVE as excluídas (exceções da série, C10),
  // e a âncora do dia (o vencimento da 1ª conta) — as mesmas regras da geração.
  const series = [...ultimaPorSerie.keys()];
  const linhasDasSeries = series.length
    ? await prisma.conta.findMany({
        where: { OR: [{ id: { in: series } }, { recorrenteId: { in: series } }] },
        select: { id: true, recorrenteId: true, vencimento: true },
      })
    : [];
  const ocupadas = new Map<string, Set<number>>();
  const ancoras = new Map<string, number>();
  for (const l of linhasDasSeries) {
    const serie = l.recorrenteId ?? l.id;
    if (!ocupadas.has(serie)) ocupadas.set(serie, new Set());
    ocupadas.get(serie)!.add(l.vencimento.getTime());
    if (l.id === serie) ancoras.set(serie, l.vencimento.getUTCDate());
  }

  const itens: ItemProjecao[] = abertas.map((c) => ({ ...c, valor: c.valor.toNumber(), projetado: false }));
  for (const b of ultimaPorSerie.values()) {
    const ancora = ancoras.get(b.serie) ?? b.vencimento.getUTCDate();
    for (const d of projetarSerie(b, ancora, ocupadas.get(b.serie) ?? new Set(), hoje, fim)) {
      itens.push({ tipo: b.tipo, valor: b.valor, vencimento: d, projetado: true });
    }
  }

  const doTipo = (t: "RECEBER" | "PAGAR") => vencidas.find((v) => v.tipo === t);
  return {
    meses: montarProjecao(lista, itens),
    vencido: {
      receber: doTipo("RECEBER")?._sum.valor?.toNumber() ?? 0,
      qtdReceber: doTipo("RECEBER")?._count._all ?? 0,
      pagar: doTipo("PAGAR")?._sum.valor?.toNumber() ?? 0,
      qtdPagar: doTipo("PAGAR")?._count._all ?? 0,
    },
  };
}

// ── Inadimplência por cliente ────────────────────────────
export async function inadimplencia(carteira: Carteira, ctx: Ctx) {
  const hoje = hojeBRT();
  const contas = await prisma.conta.findMany({
    where: { deletedAt: null, ...whereCarteira(carteira, ctx), tipo: "RECEBER", pago: false, vencimento: { lt: hoje } },
    select: { clienteId: true, valor: true, vencimento: true, cliente: { select: { nome: true } } },
  });
  return montarInadimplencia(
    contas.map((c) => ({
      clienteId: c.clienteId,
      clienteNome: c.cliente?.nome ?? null,
      valor: c.valor.toNumber(),
      vencimento: c.vencimento,
    })),
    hoje,
  );
}

// ── Exportação para o contador ───────────────────────────
/**
 * Teto de linhas por arquivo. Uma planilha de 10 mil contas já é anos de movimento; acima disso
 * o pedido quase certamente esqueceu o filtro de período, e montar tudo em memória num processo
 * que serve API, site e tempo real juntos não vale o risco.
 */
export const MAX_LINHAS_EXPORTACAO = 10_000;

export async function exportarContas(input: FiltroContasInput, ctx: Ctx) {
  const where = whereDoFiltro(input, ctx);
  const total = await prisma.conta.count({ where });
  if (total > MAX_LINHAS_EXPORTACAO) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `São ${total} contas neste recorte — o limite por planilha é ${MAX_LINHAS_EXPORTACAO}. Escolha um período menor.`,
    });
  }
  const contas = await prisma.conta.findMany({
    where,
    // Ordem de livro-caixa: pelo vencimento. O `id` desempata para dois arquivos do mesmo recorte
    // saírem idênticos.
    orderBy: [{ vencimento: "asc" }, { id: "asc" }],
    select: {
      tipo: true, escopo: true, descricao: true, valor: true, vencimento: true, pago: true, pagoEm: true,
      categoria: { select: { nome: true } },
      cliente: { select: { nome: true } },
    },
  });
  return {
    linhas: contas.length,
    csv: planilhaDoContador(
      contas.map((c) => ({ ...c, valor: c.valor.toNumber() })),
      hojeBRT(),
    ),
  };
}
