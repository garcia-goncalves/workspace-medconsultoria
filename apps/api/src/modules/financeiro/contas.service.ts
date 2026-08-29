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
 * meia-noite UTC). No MENSAL, usa o dia da ÂNCORA da série e CLAMPA ao último dia do mês
 * alvo — assim 31/01 vira 28/02 (ou 29 em bissexto), sem "vazar" para março nem pular meses.
 *
 * `diaAncora` é o dia do vencimento da PRIMEIRA conta da série. Sem ele, o clamp partiria da
 * ocorrência anterior e a série degradaria de vez: 31/01 → 28/02 → 28/03 → 28/04… Com ele,
 * fevereiro é só uma exceção pontual e a série volta ao dia 31 em março.
 */
export function proximo(data: Date, r: Recorrencia, diaAncora?: number): Date {
  const d = new Date(data);
  if (r === "DIARIA") return somarDiasUTC(d, 1);
  if (r === "SEMANAL") return somarDiasUTC(d, 7);
  if (r === "MENSAL") {
    const dia = diaAncora ?? d.getUTCDate();
    const ano = d.getUTCFullYear();
    const mes = d.getUTCMonth() + 1;
    // Último dia do mês alvo: dia 0 do mês seguinte.
    const ultimoDiaAlvo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ano, mes, Math.min(dia, ultimoDiaAlvo), 0, 0, 0));
  }
  return d;
}

/**
 * Dia do mês que ancora a série: o vencimento da conta ORIGEM (a 1ª). Uma conta sem
 * `recorrenteId` é ela própria a origem. Se a origem sumiu, cai no dia da própria conta.
 */
async function diaAncoraDaSerie(conta: ContaSerie): Promise<number> {
  if (!conta.recorrenteId) return conta.vencimento.getUTCDate();
  const origem = await prisma.conta.findUnique({
    where: { id: conta.recorrenteId },
    select: { vencimento: true },
  });
  return (origem?.vencimento ?? conta.vencimento).getUTCDate();
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

  try {
    const conta = await prisma.conta.update({ where: { id }, data });
    return mapConta(conta);
  } catch (e) {
    // P2002 = índice único. Aqui só pode ser (recorrenteId, vencimento): puxaram a parcela
    // para uma data que já é de outra da MESMA série. A irmã pode estar excluída (soft-delete)
    // e portanto invisível na tela — daí a mensagem citar isso, senão o erro fica sem sentido.
    if (ehConflitoDeVencimento(e)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Já existe uma parcela desta série com este vencimento — inclusive se ela foi excluída. Escolha outra data.",
      });
    }
    throw e;
  }
}

/** Violação do índice único (recorrenteId, vencimento). */
function ehConflitoDeVencimento(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002" &&
    JSON.stringify((e as { meta?: unknown }).meta ?? "").includes("vencimento")
  );
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

/**
 * Desfaz a materialização: APAGA a próxima ocorrência gerada (se ainda pendente).
 *
 * ⚠️ **É apagar de verdade, e isso é o que dá UM significado só a `deletedAt` numa série.**
 * Antes esta reversão fazia soft-delete e a geração ressuscitava o que encontrasse apagado —
 * então "excluída" queria dizer duas coisas ao mesmo tempo: "o sistema desfez" e "a pessoa
 * excluiu". A varredura noturna não sabia distinguir e **ressuscitava a parcela que alguém tinha
 * excluído à mão** (C10). Hoje, numa série, `deletedAt` só pode ter sido posto por gente.
 *
 * Apagar aqui é seguro e é o que a operação significa: a linha foi criada pelo próprio sistema
 * segundos antes, ao marcar a conta como paga; nunca foi paga; e desmarcar o pagamento é desfazer
 * essa criação, não registrar uma exclusão. A guarda `pago: false` impede que uma parcela já
 * quitada seja alcançada, e `recorrenteId` garante que a âncora da série nunca é atingida.
 */
async function reverterSucessora(conta: ContaSerie): Promise<void> {
  const serie = conta.recorrenteId ?? conta.id;
  // Mesma âncora usada para GERAR — senão o vencimento calculado aqui não bate com o da
  // sucessora e a reversão não acha a linha para apagar.
  const prox = proximo(conta.vencimento, conta.recorrencia, await diaAncoraDaSerie(conta));
  await prisma.conta.deleteMany({
    where: { deletedAt: null, pago: false, vencimento: prox, recorrenteId: serie },
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

/**
 * Quantas ocorrências excluídas em sequência a geração pula antes de desistir. Existe só para
 * fechar o laço: uma série cujas próximas três dezenas de datas foram todas excluídas à mão não
 * é uma série que alguém queira materializar.
 */
const MAX_OCORRENCIAS_PULADAS = 36;

/**
 * Cria a próxima ocorrência de uma conta recorrente (com dedup por série+vencimento).
 *
 * ⚠️ **PARCELA EXCLUÍDA É UMA EXCEÇÃO DA SÉRIE, não uma linha para ressuscitar (C10).** A
 * exclusão de conta é lógica, e a materialização ressuscitava o que achasse apagado na data —
 * o que desfazia, na varredura da madrugada, a exclusão que a pessoa tinha feito na véspera.
 * Como a reversão do pagamento agora apaga a sucessora de verdade (ver `reverterSucessora`),
 * `deletedAt` numa série significa uma coisa só: alguém excluiu esta ocorrência de propósito.
 *
 * O que se faz com ela é **pular aquela data e seguir para a seguinte** — excluir a parcela de
 * maio salta maio, não mata a série nem apaga o mês que vem. A linha excluída fica onde está:
 * ela é o registro da exceção, e é ela que segura a data no índice único `(recorrenteId,
 * vencimento)` para que ninguém recrie a parcela por outro caminho.
 */
async function gerarProximaOcorrencia(conta: ContaSerie): Promise<boolean> {
  if (conta.recorrencia === "NENHUMA") return false;
  const serie = conta.recorrenteId ?? conta.id;
  const ancora = await diaAncoraDaSerie(conta);
  let prox = proximo(conta.vencimento, conta.recorrencia, ancora);

  for (let pulos = 0; pulos <= MAX_OCORRENCIAS_PULADAS; pulos++) {
    if (conta.recorrenciaAte && prox > conta.recorrenciaAte) return false;
    // Procura INCLUSIVE as apagadas: o índice único `(recorrenteId, vencimento)` alcança a
    // tabela inteira, então uma data já ocupada por uma linha excluída não pode ser recriada.
    const existente = await prisma.conta.findFirst({
      where: { vencimento: prox, OR: [{ id: serie }, { recorrenteId: serie }] },
      select: { id: true, deletedAt: true },
    });
    if (!existente) {
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
    if (!existente.deletedAt) return false; // a ocorrência já existe e está viva: nada a fazer.
    prox = proximo(prox, conta.recorrencia, ancora); // excluída de propósito: pula para a seguinte.
  }
  return false;
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
