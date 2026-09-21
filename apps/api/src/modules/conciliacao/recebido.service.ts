import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import { hashBytes } from "../../lib/hash.js";
import { ErroDePlanilha, lerGrade, type Formato } from "./planilha/index.js";
import { carregarDePara, exigirModuloLigado } from "./conciliacao.service.js";
import { chaveDoConvenio, competenciaDe, ErroDeLeitura, type ProblemaDeLinha } from "./producao-consultas.js";
import { dicaDeRota, type TipoDeRelatorio } from "./planilha/qual-relatorio.js";
import { montarConciliacao } from "./conciliacao-financeira.service.js";
import {
  interpretarPlanilhaConciliacao,
  interpretarRepasse,
  type LeituraDaPlanilha,
  type LeituraDoRepasse,
  type LinhaPlanilha,
} from "./recebido.js";

/**
 * CONCILIAÇÃO — Fase 2b: gravar o RECEBIDO (repasse do TASY e planilha preenchida).
 *
 * Mesmo desenho das outras importações: prévia que não grava, gravação numa transação, e o
 * arquivo original guardado no acervo do cliente (quem chama passa o `arquivoId`).
 */

const soma = (valores: number[]) => Math.round(valores.reduce((s, v) => s + v * 100, 0)) / 100;

/**
 * ⚠️ `tipo` diz qual dos DOIS importadores deste arquivo está chamando — é o que permite a recusa
 * apontar a porta certa em vez de só acusar o arquivo. Um `ler` genérico para os dois não tem como
 * saber, e mandar a pessoa de volta para onde ela já está seria pior que calar.
 */
async function ler<T>(
  bytes: Buffer,
  interpretar: (g: Awaited<ReturnType<typeof lerGrade>>) => T,
  tipo: TipoDeRelatorio,
): Promise<{ formato: Formato; leitura: T }> {
  // A grade é lida antes do try de baixo de propósito — ver o comentário gêmeo em
  // `conciliacao.service.ts`: sem ela, a recusa não sabe dizer de qual relatório o arquivo é.
  let grade;
  try {
    grade = await lerGrade(bytes);
  } catch (e) {
    if (e instanceof ErroDePlanilha) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
  try {
    return { formato: grade.formato, leitura: interpretar(grade) };
  } catch (e) {
    if (e instanceof ErroDeLeitura) {
      const dica = dicaDeRota(grade, tipo);
      throw new TRPCError({ code: "BAD_REQUEST", message: dica ? `${e.message} ${dica}` : e.message });
    }
    throw e;
  }
}

// ─── Repasse ────────────────────────────────────────────────────────────────────────────────────

export interface PreviaRepasse {
  formato: Formato;
  linhas: number;
  total: number;
  periodoPagamento: { inicio: string; fim: string } | null;
  /** Linhas cujo atendimento casa com uma cirurgia importada deste cliente. */
  casadas: { linhas: number; total: number };
  /** Incremento, acordo, ou atendimento que não está no mapa cirúrgico. Entra — e aparece à parte. */
  semProducao: { linhas: number; total: number };
  ignoradas: ProblemaDeLinha[];
  colunasAusentes: string[];
  /** Linhas JÁ gravadas com pagamento dentro deste período — importar sem substituir dobraria. */
  jaNoPeriodo: number;
  jaImportado: { em: Date } | null;
}

/** A "impressão digital" de uma linha de repasse: igual em tudo = o mesmo pagamento. */
const digital = (l: {
  atendimento: string | null;
  codigo: string | null;
  executor: string;
  dataItem: Date | null;
  dataPagamento: Date | null;
  valor: number;
  repasseNumero: string | null;
}) =>
  [l.atendimento, l.codigo, l.executor, l.dataItem?.getTime(), l.dataPagamento?.getTime(), Math.round(l.valor * 100), l.repasseNumero].join(
    "|",
  );

/**
 * As linhas JÁ gravadas que este arquivo repete — as que a substituição troca.
 *
 * ⚠️ Não é "tudo o que foi pago no período": o repasse pode vir exportado POR MÉDICO, e trocar o
 * período inteiro apagaria o recebido do outro médico. São duas regras, somadas:
 *   1. mesmo período de pagamento E mesmo executor (o relatório corrigido daquele médico);
 *   2. linha IDÊNTICA em qualquer data — inclusive sem data de pagamento, que a regra 1 não pega
 *      (um relatório reexportado sem a coluna de data dobraria o recebido inteiro).
 */
async function linhasRepetidas(clienteId: string, leitura: LeituraDoRepasse): Promise<string[]> {
  const executores = [...new Set(leitura.linhas.map((l) => l.executor))];
  const atendimentos = [...new Set(leitura.linhas.map((l) => l.atendimento).filter((a): a is string => !!a))];
  const periodo = leitura.periodoPagamento;
  const existentes = await prisma.repasseLinha.findMany({
    where: {
      clienteId,
      OR: [
        ...(periodo
          ? [
              {
                executor: { in: executores },
                dataPagamento: { gte: new Date(`${periodo.inicio}T00:00:00Z`), lte: new Date(`${periodo.fim}T00:00:00Z`) },
              },
            ]
          : []),
        { atendimento: { in: atendimentos } },
        { atendimento: null },
      ],
    },
    select: {
      id: true,
      atendimento: true,
      codigo: true,
      executor: true,
      dataItem: true,
      dataPagamento: true,
      valor: true,
      repasseNumero: true,
    },
  });
  const novas = new Set(leitura.linhas.map(digital));
  const inicio = periodo ? new Date(`${periodo.inicio}T00:00:00Z`) : null;
  const fim = periodo ? new Date(`${periodo.fim}T00:00:00Z`) : null;
  return existentes
    .filter((e) => {
      const noPeriodoDoMesmoMedico =
        inicio && fim && e.dataPagamento && e.dataPagamento >= inicio && e.dataPagamento <= fim && executores.includes(e.executor);
      return noPeriodoDoMesmoMedico || novas.has(digital({ ...e, valor: e.valor.toNumber() }));
    })
    .map((e) => e.id);
}

async function analisarRepasse(clienteId: string, leitura: LeituraDoRepasse, bytes: Buffer) {
  const atendimentos = [...new Set(leitura.linhas.map((l) => l.atendimento).filter((a): a is string => !!a))];
  const [comCirurgia, jaImportado, repetidas] = await Promise.all([
    prisma.producaoCirurgia.findMany({
      where: { clienteId, atendimento: { in: atendimentos } },
      select: { atendimento: true },
      distinct: ["atendimento"],
    }),
    prisma.producaoLote.findFirst({
      where: { clienteId, origem: "REPASSE_TASY", hashArquivo: hashBytes(bytes), status: "IMPORTADO" },
      select: { createdAt: true },
    }),
    linhasRepetidas(clienteId, leitura),
  ]);
  const casa = new Set(comCirurgia.map((c) => c.atendimento));
  const casadas = leitura.linhas.filter((l) => l.atendimento && casa.has(l.atendimento));
  const sem = leitura.linhas.filter((l) => !l.atendimento || !casa.has(l.atendimento));
  return {
    casadas: { linhas: casadas.length, total: soma(casadas.map((l) => l.valor)) },
    semProducao: { linhas: sem.length, total: soma(sem.map((l) => l.valor)) },
    jaImportado: jaImportado ? { em: jaImportado.createdAt } : null,
    jaNoPeriodo: repetidas.length,
    repetidas,
  };
}

export async function previsualizarRepasse(e: { clienteId: string; bytes: Buffer }): Promise<PreviaRepasse> {
  exigirModuloLigado();
  const { formato, leitura } = await ler(e.bytes, interpretarRepasse, "repasse");
  const { repetidas: _ids, ...a } = await analisarRepasse(e.clienteId, leitura, e.bytes);
  return {
    formato,
    linhas: leitura.linhas.length,
    total: soma(leitura.linhas.map((l) => l.valor)),
    periodoPagamento: leitura.periodoPagamento,
    ignoradas: leitura.ignoradas,
    colunasAusentes: leitura.colunasAusentes,
    ...a,
  };
}

export async function importarRepasse(e: {
  clienteId: string;
  bytes: Buffer;
  nomeArquivo: string;
  arquivoId?: string | null;
  usuarioId: string;
  substituir?: boolean;
}) {
  exigirModuloLigado();
  const hashArquivo = hashBytes(e.bytes);
  const { formato, leitura } = await ler(e.bytes, interpretarRepasse, "repasse");
  if (leitura.linhas.length === 0)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nenhuma linha de repasse aproveitável neste arquivo." });

  const a = await analisarRepasse(e.clienteId, leitura, e.bytes);
  if (a.jaImportado) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Este repasse já foi importado em ${a.jaImportado.em.toLocaleDateString("pt-BR")}. Nada foi alterado.`,
    });
  }
  // O mesmo pagamento em dois arquivos contaria duas vezes — e "recebeu o dobro" é o erro que
  // ninguém questiona. A tela pergunta antes; só com a confirmação o período é trocado.
  if (a.jaNoPeriodo > 0 && !e.substituir) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        `Já existem ${a.jaNoPeriodo} linha(s) de repasse deste arquivo gravadas — do mesmo período e médico(s), ou ` +
        `idênticas. Confirme a substituição para trocar pelas deste arquivo.`,
    });
  }

  const dePara = await carregarDePara(e.clienteId);
  const operadoraDe = (convenio: string) => dePara.porConvenio.get(chaveDoConvenio(convenio))?.operadoraId ?? null;
  const periodo = leitura.periodoPagamento;

  const loteId = await prisma.$transaction(
    async (tx) => {
      if (a.repetidas.length > 0) {
        // Só as linhas que este arquivo repete — nunca o período inteiro de outro médico.
        await tx.repasseLinha.deleteMany({ where: { clienteId: e.clienteId, id: { in: a.repetidas } } });
        // Lote que ficou sem linha nenhuma sai de cena, mas fica no histórico.
        await tx.producaoLote.updateMany({
          where: { clienteId: e.clienteId, origem: "REPASSE_TASY", status: "IMPORTADO", repasses: { none: {} } },
          data: { status: "SUBSTITUIDO", substituidoEm: new Date() },
        });
      }
      const fim = periodo ? new Date(`${periodo.fim}T00:00:00Z`) : new Date();
      const lote = await tx.producaoLote.create({
        data: {
          clienteId: e.clienteId,
          competencia: competenciaDe(fim),
          competenciaVigente: null,
          origem: "REPASSE_TASY",
          periodoInicio: periodo ? new Date(`${periodo.inicio}T00:00:00Z`) : null,
          periodoFim: periodo ? fim : null,
          arquivoId: e.arquivoId ?? null,
          nomeArquivo: e.nomeArquivo,
          formato,
          hashArquivo,
          status: "IMPORTADO",
          linhasLidas: leitura.linhas.length + leitura.ignoradas.length,
          linhasImportadas: leitura.linhas.length,
          linhasIgnoradas: leitura.ignoradas.length,
          importadoPorId: e.usuarioId,
        },
        select: { id: true },
      });
      await tx.repasseLinha.createMany({
        data: leitura.linhas.map((l) => ({
          loteId: lote.id,
          clienteId: e.clienteId,
          linha: l.linha,
          repasseNumero: l.repasseNumero,
          atendimento: l.atendimento,
          convenioBruto: l.convenioBruto,
          operadoraId: l.convenioBruto ? operadoraDe(l.convenioBruto) : null,
          executor: l.executor,
          codigo: l.codigo,
          descricao: l.descricao,
          dataItem: l.dataItem,
          dataPagamento: l.dataPagamento,
          valor: l.valor,
        })),
      });
      return lote.id;
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  return {
    loteId,
    linhas: leitura.linhas.length,
    total: soma(leitura.linhas.map((l) => l.valor)),
    casadas: a.casadas,
    semProducao: a.semProducao,
    substituidas: a.jaNoPeriodo,
    linhasIgnoradas: leitura.ignoradas.length,
  };
}

/** As linhas de repasse que não casaram com cirurgia — incrementos, acordos, atendimento de fora. */
export async function listarRecebidoSemProducao(clienteId: string) {
  const atends = await prisma.producaoCirurgia.findMany({
    where: { clienteId, atendimento: { not: null } },
    select: { atendimento: true },
    distinct: ["atendimento"],
  });
  const linhas = await prisma.repasseLinha.findMany({
    where: {
      clienteId,
      OR: [{ atendimento: null }, { atendimento: { notIn: atends.map((a) => a.atendimento!) } }],
    },
    select: {
      id: true,
      repasseNumero: true,
      atendimento: true,
      convenioBruto: true,
      executor: true,
      codigo: true,
      descricao: true,
      dataPagamento: true,
      valor: true,
    },
    orderBy: [{ dataPagamento: "desc" }, { linha: "asc" }],
    take: 200,
  });
  return linhas.map((l) => ({
    ...l,
    dataPagamento: l.dataPagamento ? l.dataPagamento.toISOString().slice(0, 10) : null,
    valor: l.valor.toNumber(),
  }));
}

// ─── Planilha de conciliação preenchida ─────────────────────────────────────────────────────────

export interface PreviaPlanilha {
  formato: Formato;
  /** Linhas com algo a gravar E cirurgia encontrada. */
  aplicaveis: number;
  /** Nº Cirurgia que não existe neste cliente — o arquivo pode ser de outro. */
  desconhecidas: string[];
  semAlteracao: number;
  ignoradas: ProblemaDeLinha[];
  comRecebido: number;
  comCobrado: number;
}

async function analisarPlanilha(clienteId: string, leitura: LeituraDaPlanilha) {
  const { linhas: atuais } = await montarConciliacao(clienteId);
  const porNumero = new Map(atuais.map((c) => [c.numeroCirurgia, c]));
  const igualDinheiro = (a: number | undefined, b: number | null) =>
    a !== undefined && b !== null && Math.round(a * 100) === Math.round(b * 100);

  // ⚠️ Só vale o que DIFERE do que o sistema já mostra. A planilha exportada traz o cobrado do
  // de-para e o recebido do repasse preenchidos; gravar tudo o que volta congelaria esses valores
  // como "digitados" — e aí corrigir o preço do pacote, ou importar um repasse novo, deixaria de
  // valer para essas cirurgias. Quem devolveu a planilha sem mexer não mudou nada.
  const aplicaveis: LinhaPlanilha[] = [];
  const desconhecidas: string[] = [];
  let semMudanca = 0;
  for (const l of leitura.linhas) {
    const atual = porNumero.get(l.numeroCirurgia);
    if (!atual) {
      desconhecidas.push(l.numeroCirurgia);
      continue;
    }
    const m: LinhaPlanilha = { linha: l.linha, numeroCirurgia: l.numeroCirurgia };
    if (l.codigoProcedimento !== undefined && l.codigoProcedimento !== atual.codigo) m.codigoProcedimento = l.codigoProcedimento;
    if (l.valorCobrado !== undefined && !igualDinheiro(l.valorCobrado, atual.cobrado)) m.valorCobrado = l.valorCobrado;
    if (l.valorRecebido !== undefined && !igualDinheiro(l.valorRecebido, atual.recebido)) m.valorRecebido = l.valorRecebido;
    if (l.dataPagamento !== undefined && l.dataPagamento.toISOString().slice(0, 10) !== atual.dataPagamento)
      m.dataPagamento = l.dataPagamento;
    if (l.naoCobrar && !atual.naoCobrar) m.naoCobrar = true;
    if (l.observacao !== undefined && l.observacao !== (atual.observacao ?? "")) m.observacao = l.observacao;
    if (Object.keys(m).length === 2) semMudanca++;
    else aplicaveis.push(m);
  }
  return { aplicaveis, desconhecidas, semMudanca };
}

export async function previsualizarPlanilha(e: { clienteId: string; bytes: Buffer }): Promise<PreviaPlanilha> {
  exigirModuloLigado();
  const { formato, leitura } = await ler(e.bytes, interpretarPlanilhaConciliacao, "planilha");
  const { aplicaveis, desconhecidas, semMudanca } = await analisarPlanilha(e.clienteId, leitura);
  return {
    formato,
    aplicaveis: aplicaveis.length,
    desconhecidas: desconhecidas.slice(0, 50),
    semAlteracao: leitura.semAlteracao + semMudanca,
    ignoradas: leitura.ignoradas,
    comRecebido: aplicaveis.filter((l) => l.valorRecebido !== undefined).length,
    comCobrado: aplicaveis.filter((l) => l.valorCobrado !== undefined).length,
  };
}

export async function importarPlanilha(e: {
  clienteId: string;
  bytes: Buffer;
  nomeArquivo: string;
  arquivoId?: string | null;
  usuarioId: string;
}) {
  exigirModuloLigado();
  const { formato, leitura } = await ler(e.bytes, interpretarPlanilhaConciliacao, "planilha");
  const { aplicaveis, desconhecidas } = await analisarPlanilha(e.clienteId, leitura);
  if (aplicaveis.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        desconhecidas.length > 0
          ? "Nenhuma cirurgia desta planilha existe neste cliente — confira se escolheu o cliente certo."
          : "A planilha não traz nada diferente do que o sistema já mostra — nada a gravar.",
    });
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.producaoLote.create({
        data: {
          clienteId: e.clienteId,
          competencia: competenciaDe(new Date()),
          competenciaVigente: null,
          origem: "PLANILHA_CONCILIACAO",
          arquivoId: e.arquivoId ?? null,
          nomeArquivo: e.nomeArquivo,
          formato,
          hashArquivo: hashBytes(e.bytes),
          status: "IMPORTADO",
          linhasLidas: leitura.linhas.length + leitura.semAlteracao + leitura.ignoradas.length,
          linhasImportadas: aplicaveis.length,
          linhasIgnoradas: leitura.ignoradas.length + desconhecidas.length,
          importadoPorId: e.usuarioId,
        },
      });
      // Só o que veio preenchido é gravado: célula vazia na planilha não apaga trabalho da tela.
      for (const l of aplicaveis) {
        await tx.producaoCirurgia.update({
          where: { clienteId_numeroCirurgia: { clienteId: e.clienteId, numeroCirurgia: l.numeroCirurgia } },
          data: {
            ...(l.codigoProcedimento !== undefined ? { codigoProcedimento: l.codigoProcedimento } : {}),
            ...(l.valorCobrado !== undefined ? { valorCobrado: l.valorCobrado } : {}),
            ...(l.valorRecebido !== undefined ? { valorRecebido: l.valorRecebido } : {}),
            ...(l.dataPagamento !== undefined ? { dataPagamento: l.dataPagamento } : {}),
            ...(l.naoCobrar ? { naoCobrar: true } : {}),
            ...(l.observacao !== undefined ? { observacao: l.observacao } : {}),
          },
        });
      }
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  return { atualizadas: aplicaveis.length, desconhecidas: desconhecidas.length, linhasIgnoradas: leitura.ignoradas.length };
}
