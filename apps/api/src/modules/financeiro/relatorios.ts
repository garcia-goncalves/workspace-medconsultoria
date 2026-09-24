import type { Recorrencia } from "@app/shared";
import { proximo } from "./contas.service.js";
import { dataBRT } from "../../lib/datas.js";
import { celulaReais, celulaTexto, montarCsv } from "../../lib/planilha-csv.js";

/**
 * O FINANCEIRO QUE RESPONDE PERGUNTAS — as contas, puras (sem banco).
 *
 * Quem busca é `relatorios.service.ts`; aqui só se decide em que mês cada real cai, o que a
 * recorrência ainda vai gerar e quem está devendo. Separado para ser testável sem MySQL, porque
 * é justamente aqui que mora o que dá número errado em silêncio (fuso, centavo, série).
 */

const DIA_MS = 24 * 60 * 60 * 1000;
/** Brasília é UTC−3 o ano todo (sem horário de verão desde 2019) — a mesma régua de `datas.ts`. */
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

// ── Centavos ─────────────────────────────────────────────
/**
 * Soma em CENTAVOS inteiros. Somar `number` de reais acumula o erro binário (dez parcelas de
 * R$ 0,10 davam R$ 0,9999999999999999 — o motivo da ADR-118); somar inteiros não erra nunca.
 */
export const emCentavos = (reais: number) => Math.round(reais * 100);
export const emReaisDeCentavos = (centavos: number) => centavos / 100;

// ── Meses ────────────────────────────────────────────────
/** "AAAA-MM" de uma data DATE-ONLY (vencimento): gravada em meia-noite UTC, lê-se em UTC. */
export function mesDaData(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/**
 * "AAAA-MM" de um INSTANTE (pagoEm) no relógio de Brasília.
 *
 * ⚠️ Não é o mesmo que `mesDaData`: `pagoEm` é o instante do clique, e quem marca uma conta
 * como paga às 22h de 31/08 em Brasília grava 01:00 de 01/09 em UTC. Lido em UTC, o dinheiro
 * de agosto cairia em setembro — e o fechamento do mês não bateria com o extrato do banco.
 */
export function mesBRTDoInstante(d: Date): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 7);
}

/** Primeiro dia (meia-noite UTC) do mês "AAAA-MM", deslocado `delta` meses. */
export function inicioDoMes(mes: string, delta = 0): Date {
  const [ano, m] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(ano, m - 1 + delta, 1));
}

/** Os `n` meses que terminam em `ultimo`, do mais antigo ao mais novo. */
export function mesesAte(ultimo: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => mesDaData(inicioDoMes(ultimo, i - (n - 1))));
}

/** Os `n` meses a partir de `primeiro` (inclusive). */
export function mesesAPartir(primeiro: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => mesDaData(inicioDoMes(primeiro, i)));
}

// ── Relatório mês a mês (regime de caixa) ────────────────
export type ContaPaga = { tipo: "PAGAR" | "RECEBER"; valor: number; pagoEm: Date | null; vencimento: Date };
export type ContaAberta = { tipo: "PAGAR" | "RECEBER"; valor: number; vencimento: Date };

export type LinhaDoMes = {
  mes: string;
  recebido: number;
  pago: number;
  resultado: number;
  /** Do que venceu NESTE mês para receber, quanto continua sem entrar hoje. */
  vencidoAReceber: number;
  qtdVencidoAReceber: number;
};

/**
 * Em que mês o dinheiro de uma conta paga ENTROU ou SAIU.
 *
 * ⚠️ REGIME DE CAIXA: vale o mês do pagamento, não o do vencimento. O aluguel de agosto pago em
 * 03/09 é saída de setembro — é assim que o extrato do banco mostra, e é o que o contador confere.
 * Conta paga sem `pagoEm` (não deveria existir: `marcarPaga` sempre grava) cai no mês do
 * vencimento, o melhor palpite, em vez de sumir do relatório.
 */
export function mesDoPagamento(c: Pick<ContaPaga, "pagoEm" | "vencimento">): string {
  return c.pagoEm ? mesBRTDoInstante(c.pagoEm) : mesDaData(c.vencimento);
}

/**
 * Monta as linhas do relatório, uma por mês pedido — inclusive os meses sem movimento, que
 * aparecem ZERADOS em vez de sumir: um buraco na tabela se lê como "o sistema perdeu o mês".
 *
 * O "a receber vencido" de cada mês é por SAFRA: das contas a receber que venceram naquele mês,
 * quanto ainda está em aberto hoje. Responde "de que mês é o dinheiro que não entrou?", que é a
 * pergunta de quem vai cobrar — um saldo acumulado repetiria o mesmo real em vários meses.
 */
export function montarRelatorioMensal(meses: string[], pagas: ContaPaga[], vencidasAbertas: ContaAberta[]): LinhaDoMes[] {
  const acc = new Map(meses.map((m) => [m, { recebido: 0, pago: 0, vencido: 0, qtd: 0 }]));
  for (const c of pagas) {
    const linha = acc.get(mesDoPagamento(c));
    if (!linha) continue; // fora da janela pedida
    if (c.tipo === "RECEBER") linha.recebido += emCentavos(c.valor);
    else linha.pago += emCentavos(c.valor);
  }
  for (const c of vencidasAbertas) {
    if (c.tipo !== "RECEBER") continue;
    const linha = acc.get(mesDaData(c.vencimento));
    if (!linha) continue;
    linha.vencido += emCentavos(c.valor);
    linha.qtd++;
  }
  return meses.map((mes) => {
    const l = acc.get(mes)!;
    return {
      mes,
      recebido: emReaisDeCentavos(l.recebido),
      pago: emReaisDeCentavos(l.pago),
      resultado: emReaisDeCentavos(l.recebido - l.pago),
      vencidoAReceber: emReaisDeCentavos(l.vencido),
      qtdVencidoAReceber: l.qtd,
    };
  });
}

// ── Projeção de caixa ────────────────────────────────────
/** A ocorrência viva mais recente de uma série — é dela que a recorrência continua. */
export type BaseDaSerie = {
  serie: string;
  tipo: "PAGAR" | "RECEBER";
  valor: number;
  vencimento: Date;
  recorrencia: Recorrencia;
  recorrenciaAte: Date | null;
};

/** Limite de laço: série diária com a última parcela esquecida há anos não trava o servidor. */
const MAX_PASSOS_DA_SERIE = 3000;

/**
 * As datas que a série AINDA VAI GERAR dentro de `[desde, ate)`, sem gravar nada.
 *
 * A materialização só cria a próxima parcela quando a atual é paga (`gerarProximaOcorrencia`),
 * então o aluguel de novembro NÃO EXISTE no banco em setembro — e uma projeção que somasse só as
 * linhas existentes diria que novembro não tem aluguel. Aqui a série é seguida com a MESMA
 * função `proximo` da geração (mesma âncora de dia 31 → 28/02 → 31/03), para a data projetada
 * ser exatamente a que vai nascer.
 *
 * ⚠️ `ocupadas` são as datas que a série já tem no banco, INCLUSIVE as excluídas: uma parcela
 * excluída à mão é exceção da série (C10) e a geração pula aquela data — a projeção também.
 *
 * ⚠️ Datas ANTERIORES a `desde` (hoje) não entram, mesmo que ainda não existam: são parcelas que
 * a série deixou de gerar porque a anterior não foi paga. Projetá-las como "vencidas" inventaria
 * dívida que ninguém lançou; o vencido real vem das linhas que existem.
 */
export function projetarSerie(base: BaseDaSerie, ancora: number, ocupadas: Set<number>, desde: Date, ate: Date): Date[] {
  if (base.recorrencia === "NENHUMA") return [];
  const datas: Date[] = [];
  let d = proximo(base.vencimento, base.recorrencia, ancora);
  for (let passo = 0; passo < MAX_PASSOS_DA_SERIE && d < ate; passo++) {
    if (base.recorrenciaAte && d > base.recorrenciaAte) break;
    if (!ocupadas.has(d.getTime()) && d >= desde) datas.push(d);
    d = proximo(d, base.recorrencia, ancora);
  }
  return datas;
}

export type MesProjetado = {
  mes: string;
  receber: number;
  pagar: number;
  saldo: number;
  /** Quanto do receber/pagar vem de parcela de recorrência que ainda não existe (projetada). */
  receberProjetado: number;
  pagarProjetado: number;
};

export type ItemProjecao = { tipo: "PAGAR" | "RECEBER"; valor: number; vencimento: Date; projetado: boolean };

export function montarProjecao(meses: string[], itens: ItemProjecao[]): MesProjetado[] {
  const acc = new Map(meses.map((m) => [m, { receber: 0, pagar: 0, rp: 0, pp: 0 }]));
  for (const i of itens) {
    const l = acc.get(mesDaData(i.vencimento));
    if (!l) continue;
    const c = emCentavos(i.valor);
    if (i.tipo === "RECEBER") {
      l.receber += c;
      if (i.projetado) l.rp += c;
    } else {
      l.pagar += c;
      if (i.projetado) l.pp += c;
    }
  }
  return meses.map((mes) => {
    const l = acc.get(mes)!;
    return {
      mes,
      receber: emReaisDeCentavos(l.receber),
      pagar: emReaisDeCentavos(l.pagar),
      saldo: emReaisDeCentavos(l.receber - l.pagar),
      receberProjetado: emReaisDeCentavos(l.rp),
      pagarProjetado: emReaisDeCentavos(l.pp),
    };
  });
}

// ── Inadimplência por cliente ────────────────────────────
export type ContaVencida = {
  clienteId: string | null;
  clienteNome: string | null;
  valor: number;
  vencimento: Date;
};

export type Inadimplente = {
  clienteId: string | null;
  clienteNome: string;
  total: number;
  quantidade: number;
  maisAntiga: Date;
  diasEmAtraso: number;
};

/**
 * Agrupa as contas a receber vencidas por cliente, do maior valor para o menor — quem deve mais
 * é quem se liga primeiro. Empate no valor desempata pelo atraso mais antigo.
 *
 * Conta sem cliente vira UMA linha "Sem cliente vinculado" em vez de sumir: dinheiro que não
 * entrou não pode desaparecer da lista por não ter dono.
 */
export function montarInadimplencia(contas: ContaVencida[], hoje: Date): Inadimplente[] {
  const mapa = new Map<string, { clienteId: string | null; nome: string; centavos: number; qtd: number; maisAntiga: Date }>();
  for (const c of contas) {
    const chave = c.clienteId ?? "__sem_cliente__";
    const item = mapa.get(chave) ?? {
      clienteId: c.clienteId,
      nome: c.clienteId ? (c.clienteNome ?? "Cliente") : "Sem cliente vinculado",
      centavos: 0,
      qtd: 0,
      maisAntiga: c.vencimento,
    };
    item.centavos += emCentavos(c.valor);
    item.qtd++;
    if (c.vencimento < item.maisAntiga) item.maisAntiga = c.vencimento;
    mapa.set(chave, item);
  }
  return [...mapa.values()]
    .map((i) => ({
      clienteId: i.clienteId,
      clienteNome: i.nome,
      total: emReaisDeCentavos(i.centavos),
      quantidade: i.qtd,
      maisAntiga: i.maisAntiga,
      diasEmAtraso: Math.max(0, Math.round((hoje.getTime() - i.maisAntiga.getTime()) / DIA_MS)),
    }))
    .sort((a, b) => b.total - a.total || a.maisAntiga.getTime() - b.maisAntiga.getTime());
}

// ── Exportação para o contador ───────────────────────────
export type ContaParaExportar = {
  tipo: "PAGAR" | "RECEBER";
  escopo: "EMPRESA" | "PESSOAL";
  descricao: string;
  valor: number;
  vencimento: Date;
  pago: boolean;
  pagoEm: Date | null;
  categoria: { nome: string } | null;
  cliente: { nome: string } | null;
};

const dataBRDoDia = (d: Date) => {
  const iso = d.toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};

function statusDaConta(c: ContaParaExportar, hoje: Date): string {
  if (c.pago) return c.tipo === "RECEBER" ? "Recebida" : "Paga";
  return c.vencimento < hoje ? "Vencida" : "Em aberto";
}

/**
 * A planilha do contador: uma linha por conta, na ordem em que chegam (o serviço ordena).
 *
 * ⚠️ `Vencimento` é date-only (meia-noite UTC) e sai lido em UTC; `Pagamento` é o INSTANTE do
 * clique e sai no dia de Brasília (`dataBRT`). Trocar um pelo outro recua ou avança um dia.
 * O valor sai SEM sinal, com a coluna `Tipo` dizendo o lado — é como o contador lança.
 */
export function planilhaDoContador(contas: ContaParaExportar[], hoje: Date): string {
  const cab = [
    "Vencimento",
    "Pagamento",
    "Descrição",
    "Cliente/Fornecedor",
    "Categoria",
    "Carteira",
    "Tipo",
    "Valor (R$)",
    "Status",
  ].map(celulaTexto);
  const corpo = contas.map((c) => [
    celulaTexto(dataBRDoDia(c.vencimento)),
    celulaTexto(c.pago && c.pagoEm ? dataBRT(c.pagoEm) : ""),
    celulaTexto(c.descricao),
    celulaTexto(c.cliente?.nome ?? ""),
    celulaTexto(c.categoria?.nome ?? "Sem categoria"),
    celulaTexto(c.escopo === "PESSOAL" ? "Pessoal" : "Empresa"),
    celulaTexto(c.tipo === "RECEBER" ? "A receber" : "A pagar"),
    celulaReais(c.valor),
    celulaTexto(statusDaConta(c, hoje)),
  ]);
  return montarCsv([cab, ...corpo]);
}
