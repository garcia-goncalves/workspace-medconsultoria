import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { CreateContaInput, UpdateContaInput, ListContasInput, Carteira, Recorrencia } from "@app/shared";
import { hojeBRT, somarDiasUTC, inicioDoMesBRT, inicioDoProximoMesBRT } from "../../lib/datas.js";

/** Contexto do usuário logado (para escopar a carteira PESSOAL). */
export type Ctx = { userId: string; role: string };

const clean = (v?: string | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** Converte o Decimal do Prisma para number (a API trabalha em reais). */
const mapConta = <T extends { valor: { toNumber(): number } }>(c: T) => ({
  ...c,
  valor: c.valor.toNumber(),
});

/**
 * Próxima ocorrência de uma série recorrente. Tudo em UTC (as datas são gravadas em
 * meia-noite UTC). No MENSAL, fixa o dia de origem e CLAMPA ao último dia do mês alvo —
 * assim 31/01 vira 28/02 (ou 29 em bissexto), sem "vazar" para março nem pular meses.
 */
function proximo(data: Date, r: Recorrencia): Date {
  const d = new Date(data);
  if (r === "DIARIA") return somarDiasUTC(d, 1);
  if (r === "SEMANAL") return somarDiasUTC(d, 7);
  if (r === "MENSAL") {
    const dia = d.getUTCDate();
    const ano = d.getUTCFullYear();
    const mes = d.getUTCMonth() + 1;
    // Último dia do mês alvo: dia 0 do mês seguinte.
    const ultimoDiaAlvo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ano, mes, Math.min(dia, ultimoDiaAlvo), 0, 0, 0));
  }
  return d;
}

/**
 * Filtro de carteira: EMPRESA (compartilhada), PESSOAL (só do dono logado) ou TUDO
 * (empresa + a pessoal do próprio usuário). NUNCA expõe a carteira pessoal de outro.
 */
function whereCarteira(carteira: Carteira, ctx: Ctx) {
  if (carteira === "PESSOAL") return { escopo: "PESSOAL" as const, donoId: ctx.userId };
  if (carteira === "TUDO")
    return { OR: [{ escopo: "EMPRESA" as const }, { escopo: "PESSOAL" as const, donoId: ctx.userId }] };
  return { escopo: "EMPRESA" as const };
}

/** Busca a conta garantindo posse: a pessoal só pode ser tocada pelo próprio dono. */
async function contaComPosse(id: string, ctx: Ctx) {
  const conta = await prisma.conta.findFirst({ where: { id, deletedAt: null } });
  if (!conta) throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada" });
  if (conta.escopo === "PESSOAL" && conta.donoId !== ctx.userId)
    throw new TRPCError({ code: "FORBIDDEN", message: "Esta é uma conta pessoal de outra pessoa." });
  return conta;
}

// ── CRUD ─────────────────────────────────────────────────
export async function listContas(input: ListContasInput, ctx: Ctx) {
  const contas = await prisma.conta.findMany({
    where: {
      deletedAt: null,
      ...whereCarteira(input.carteira, ctx),
      ...(input.tipo ? { tipo: input.tipo } : {}),
      ...(input.status === "PENDENTES" ? { pago: false } : input.status === "PAGAS" ? { pago: true } : {}),
    },
    orderBy: [{ pago: "asc" }, { vencimento: "asc" }],
    include: {
      categoria: { select: { nome: true, cor: true } },
      cliente: { select: { nome: true } },
    },
  });
  return contas.map(mapConta);
}

export async function createConta(input: CreateContaInput, ctx: Ctx) {
  const escopo = input.escopo ?? "EMPRESA";
  const recorrencia = input.recorrencia ?? "NENHUMA";
  const conta = await prisma.conta.create({
    data: {
      tipo: input.tipo,
      escopo,
      donoId: escopo === "PESSOAL" ? ctx.userId : null,
      descricao: input.descricao.trim(),
      valor: input.valor,
      vencimento: input.vencimento,
      categoriaId: clean(input.categoriaId),
      clienteId: clean(input.clienteId),
      recorrencia,
      recorrenciaAte: input.recorrenciaAte ?? null,
      observacoes: clean(input.observacoes),
    },
  });
  // A 1ª conta da série é a âncora (recorrenteId = ela mesma).
  if (recorrencia !== "NENHUMA") {
    await prisma.conta.update({ where: { id: conta.id }, data: { recorrenteId: conta.id } });
    conta.recorrenteId = conta.id;
  }
  return mapConta(conta);
}

export async function updateConta(input: UpdateContaInput, ctx: Ctx) {
  const { id, ...rest } = input;
  await contaComPosse(id, ctx);

  const data: Record<string, unknown> = {};
  if (rest.tipo !== undefined) data.tipo = rest.tipo;
  if (rest.descricao !== undefined) data.descricao = rest.descricao.trim();
  if (rest.valor !== undefined) data.valor = rest.valor;
  if (rest.vencimento !== undefined) data.vencimento = rest.vencimento;
  if (rest.categoriaId !== undefined) data.categoriaId = clean(rest.categoriaId);
  if (rest.clienteId !== undefined) data.clienteId = clean(rest.clienteId);
  if (rest.recorrencia !== undefined) data.recorrencia = rest.recorrencia;
  if (rest.recorrenciaAte !== undefined) data.recorrenciaAte = rest.recorrenciaAte ?? null;
  if (rest.observacoes !== undefined) data.observacoes = clean(rest.observacoes);
  // Escopo não é editável aqui (mover carteira mudaria posse/privacidade) — mantém o original.

  const conta = await prisma.conta.update({ where: { id }, data });
  return mapConta(conta);
}

export async function removeConta(id: string, ctx: Ctx) {
  await contaComPosse(id, ctx);
  await prisma.conta.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

export async function marcarPaga(id: string, pago: boolean, ctx: Ctx) {
  const atual = await contaComPosse(id, ctx);
  const conta = await prisma.conta.update({
    where: { id },
    data: { pago, pagoEm: pago ? new Date() : null },
  });
  // Só na TRANSIÇÃO pendente→paga: cria a próxima ocorrência (evita duplicar em duplo-clique/retry).
  if (pago && !atual.pago && conta.recorrencia !== "NENHUMA") await gerarProximaOcorrencia(conta);
  // Na volta paga→pendente: remove a sucessora antecipada, se ainda estiver pendente.
  if (!pago && atual.pago && conta.recorrencia !== "NENHUMA") await reverterSucessora(conta);
  return mapConta(conta);
}

/** Desfaz a materialização: soft-delete da próxima ocorrência gerada (se ainda pendente). */
async function reverterSucessora(conta: ContaSerie): Promise<void> {
  const serie = conta.recorrenteId ?? conta.id;
  const prox = proximo(conta.vencimento, conta.recorrencia);
  await prisma.conta.updateMany({
    where: { deletedAt: null, pago: false, vencimento: prox, recorrenteId: serie },
    data: { deletedAt: new Date() },
  });
}

// ── Recorrência (materialização, sem cron) ───────────────
type ContaSerie = {
  id: string;
  tipo: "PAGAR" | "RECEBER";
  escopo: "EMPRESA" | "PESSOAL";
  donoId: string | null;
  descricao: string;
  valor: unknown;
  vencimento: Date;
  categoriaId: string | null;
  clienteId: string | null;
  observacoes: string | null;
  recorrencia: Recorrencia;
  recorrenciaAte: Date | null;
  recorrenteId: string | null;
};

/** Cria a próxima ocorrência de uma conta recorrente (com dedup por série+vencimento). */
async function gerarProximaOcorrencia(conta: ContaSerie): Promise<boolean> {
  if (conta.recorrencia === "NENHUMA") return false;
  const serie = conta.recorrenteId ?? conta.id;
  const prox = proximo(conta.vencimento, conta.recorrencia);
  if (conta.recorrenciaAte && prox > conta.recorrenciaAte) return false;
  const existe = await prisma.conta.findFirst({
    where: { deletedAt: null, vencimento: prox, OR: [{ id: serie }, { recorrenteId: serie }] },
    select: { id: true },
  });
  if (existe) return false;
  await prisma.conta.create({
    data: {
      tipo: conta.tipo,
      escopo: conta.escopo,
      donoId: conta.donoId,
      descricao: conta.descricao,
      valor: conta.valor as never,
      vencimento: prox,
      categoriaId: conta.categoriaId,
      clienteId: conta.clienteId,
      observacoes: conta.observacoes,
      recorrencia: conta.recorrencia,
      recorrenciaAte: conta.recorrenciaAte,
      recorrenteId: serie,
    },
  });
  return true;
}

/**
 * Rede de segurança do scan: para cada série recorrente cuja ÚLTIMA ocorrência já foi
 * quitada mas não tem sucessora, cria a próxima. Só materializa a partir da última QUITADA
 * (não empilha pendentes). Roda no loop de lembretes.
 */
export async function garantirProximasRecorrencias() {
  const recorrentes = (await prisma.conta.findMany({
    where: { deletedAt: null, recorrencia: { not: "NENHUMA" } },
    select: {
      id: true, tipo: true, escopo: true, donoId: true, descricao: true, valor: true,
      vencimento: true, categoriaId: true, clienteId: true, observacoes: true, recorrencia: true,
      recorrenciaAte: true, recorrenteId: true, pago: true,
    },
  })) as (ContaSerie & { pago: boolean })[];

  const ultimaPorSerie = new Map<string, ContaSerie & { pago: boolean }>();
  for (const c of recorrentes) {
    const serie = c.recorrenteId ?? c.id;
    const atual = ultimaPorSerie.get(serie);
    if (!atual || c.vencimento > atual.vencimento) ultimaPorSerie.set(serie, c);
  }

  let criadas = 0;
  for (const ultima of ultimaPorSerie.values()) {
    if (!ultima.pago) continue; // ainda tem uma pendente aberta — não cria mais
    if (await gerarProximaOcorrencia(ultima)) criadas++;
  }
  return { criadas };
}

// ── Resumo (KPIs por carteira) ───────────────────────────
export async function resumo(carteira: Carteira, ctx: Ctx) {
  const base = { deletedAt: null, ...whereCarteira(carteira, ctx) };
  const hoje = hojeBRT();
  const em7 = somarDiasUTC(hoje, 7);
  const mesInicio = inicioDoMesBRT();
  const mesFim = inicioDoProximoMesBRT();

  const soma = async (where: Record<string, unknown>) =>
    (await prisma.conta.aggregate({ _sum: { valor: true }, where: { ...base, ...where } }))._sum.valor?.toNumber() ?? 0;
  const cont = (where: Record<string, unknown>) => prisma.conta.count({ where: { ...base, ...where } });

  const [
    aReceberPendente, aPagarPendente, recebidoMes, pagoMes,
    vencReceberSoma, vencPagarSoma, vencReceberN, vencPagarN,
    aVencer7ReceberSoma, aVencer7PagarSoma, aVencer7ReceberN, aVencer7PagarN,
  ] = await Promise.all([
    soma({ tipo: "RECEBER", pago: false }),
    soma({ tipo: "PAGAR", pago: false }),
    soma({ tipo: "RECEBER", pago: true, pagoEm: { gte: mesInicio, lt: mesFim } }),
    soma({ tipo: "PAGAR", pago: true, pagoEm: { gte: mesInicio, lt: mesFim } }),
    soma({ tipo: "RECEBER", pago: false, vencimento: { lt: hoje } }),
    soma({ tipo: "PAGAR", pago: false, vencimento: { lt: hoje } }),
    cont({ tipo: "RECEBER", pago: false, vencimento: { lt: hoje } }),
    cont({ tipo: "PAGAR", pago: false, vencimento: { lt: hoje } }),
    soma({ tipo: "RECEBER", pago: false, vencimento: { gte: hoje, lt: em7 } }),
    soma({ tipo: "PAGAR", pago: false, vencimento: { gte: hoje, lt: em7 } }),
    cont({ tipo: "RECEBER", pago: false, vencimento: { gte: hoje, lt: em7 } }),
    cont({ tipo: "PAGAR", pago: false, vencimento: { gte: hoje, lt: em7 } }),
  ]);

  return {
    aReceberPendente,
    aPagarPendente,
    saldoPrevisto: aReceberPendente - aPagarPendente,
    recebidoMes,
    pagoMes,
    resultadoMes: recebidoMes - pagoMes,
    vencidasReceber: { total: vencReceberSoma, count: vencReceberN },
    vencidasPagar: { total: vencPagarSoma, count: vencPagarN },
    aVencer7Receber: { total: aVencer7ReceberSoma, count: aVencer7ReceberN },
    aVencer7Pagar: { total: aVencer7PagarSoma, count: aVencer7PagarN },
  };
}

/** Distribuição de despesas/receitas do mês por categoria ("para onde vai o dinheiro"). */
export async function porCategoria(carteira: Carteira, ctx: Ctx) {
  const mesInicio = inicioDoMesBRT();
  const mesFim = inicioDoProximoMesBRT();

  const contas = await prisma.conta.findMany({
    where: { deletedAt: null, ...whereCarteira(carteira, ctx), vencimento: { gte: mesInicio, lt: mesFim } },
    select: { tipo: true, valor: true, categoria: { select: { nome: true, cor: true } } },
  });
  const agrupar = (tipo: "PAGAR" | "RECEBER") => {
    const mapa = new Map<string, { nome: string; cor: string | null; total: number }>();
    for (const c of contas.filter((x) => x.tipo === tipo)) {
      const nome = c.categoria?.nome ?? "Sem categoria";
      const cor = c.categoria?.cor ?? null;
      const item = mapa.get(nome) ?? { nome, cor, total: 0 };
      item.total += c.valor.toNumber();
      mapa.set(nome, item);
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total);
  };
  return { despesas: agrupar("PAGAR"), receitas: agrupar("RECEBER") };
}

// ── Agenda financeira ("Precisa de você") ────────────────
export async function agendaFinanceira(carteira: Carteira, ctx: Ctx) {
  const hoje = hojeBRT();
  const amanha = somarDiasUTC(hoje, 1);
  const em7 = somarDiasUTC(hoje, 8); // fim de "esta semana" (hoje + 7 dias, exclusivo)

  const pendentes = await prisma.conta.findMany({
    where: { deletedAt: null, pago: false, ...whereCarteira(carteira, ctx) },
    orderBy: { vencimento: "asc" },
    include: {
      categoria: { select: { nome: true, cor: true } },
      cliente: { select: { nome: true } },
    },
  });
  const itens = pendentes.map(mapConta);
  return {
    vencidas: itens.filter((c) => c.vencimento < hoje),
    hoje: itens.filter((c) => c.vencimento >= hoje && c.vencimento < amanha),
    semana: itens.filter((c) => c.vencimento >= amanha && c.vencimento < em7),
    depois: itens.filter((c) => c.vencimento >= em7),
  };
}
