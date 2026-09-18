import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import { hashBytes } from "../../lib/hash.js";
import { ErroDePlanilha, lerGrade, type Formato } from "./planilha/index.js";
import { carregarDePara, exigirModuloLigado } from "./conciliacao.service.js";
import { somarPorOperadora, somarPorProfissional, type SomaOperadora, type SomaProfissional } from "./conciliacao-painel.service.js";
import { chaveDoConvenio, chaveDoProfissional, competenciaDe, ErroDeLeitura, type ProblemaDeLinha } from "./producao-consultas.js";
import {
  interpretarMapaCirurgico,
  type AutorizacaoCirurgia,
  type CategoriaConvenio,
  type LinhaCirurgia,
  type StatusCirurgia,
} from "./producao-cirurgias.js";

/**
 * CONCILIAÇÃO — Fase 2a: o mapa cirúrgico do TASY.
 *
 * Spec: `docs/superpowers/specs/2026-09-18-conciliacao-cirurgias-tasy-design.md`.
 *
 * A diferença que manda em tudo daqui: a identidade é o **número da cirurgia**, não o mês. O TASY
 * exporta períodos que se sobrepõem, então importar ACRESCENTA as novas e ATUALIZA as que já
 * existem — nunca duplica e nunca pergunta "substituir o mês?".
 */

const LINHAS_NA_PREVIA = 20;
const POR_PAGINA = 50;

/** Uma cirurgia como a tela pode vê-la. Lista fechada — crescer aqui é decisão de privacidade. */
export interface CirurgiaVisivel {
  linha: number;
  numeroCirurgia: string;
  atendimento: string | null;
  dataCirurgia: string;
  pacienteNome: string;
  procedimento: string;
  status: StatusCirurgia;
  autorizacao: AutorizacaoCirurgia;
  convenioBruto: string;
  profissionalBruto: string;
}

export interface PreviaCirurgias {
  formato: Formato;
  cabecalhoNaLinha: number;
  periodo: { inicio: string; fim: string } | null;
  totalLinhas: number;
  /** Quantas ainda não existem no sistema, e quantas vão só ser atualizadas. */
  novas: number;
  jaExistentes: number;
  semAtendimento: number;
  naoExecutadas: number;
  ignoradas: ProblemaDeLinha[];
  colunasAusentes: string[];
  amostra: CirurgiaVisivel[];
  conveniosNovos: string[];
  profissionaisNovos: string[];
  jaImportado: { em: Date } | null;
}

export interface ResultadoCirurgias {
  loteId: string;
  periodo: { inicio: string; fim: string };
  linhasLidas: number;
  novas: number;
  atualizadas: number;
  linhasIgnoradas: number;
  semAtendimento: number;
  conveniosNovos: string[];
  profissionaisNovos: string[];
  profissionaisLigadosAutomaticamente: number;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

async function lerEInterpretar(bytes: Buffer) {
  try {
    const grade = await lerGrade(bytes);
    return { grade, leitura: interpretarMapaCirurgico(grade) };
  } catch (e) {
    if (e instanceof ErroDePlanilha || e instanceof ErroDeLeitura) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    }
    throw e;
  }
}

function paraVisivel(l: LinhaCirurgia): CirurgiaVisivel {
  return {
    linha: l.linha,
    numeroCirurgia: l.numeroCirurgia,
    atendimento: l.atendimento,
    dataCirurgia: dia(l.dataCirurgia),
    pacienteNome: l.pacienteNome,
    procedimento: l.procedimento,
    status: l.status,
    autorizacao: l.autorizacao,
    convenioBruto: l.convenioBruto,
    profissionalBruto: l.profissionalBruto,
  };
}

/**
 * O que é novo no de-para, e quais médicos casam sozinhos pelo nome. Mesmo raciocínio da Fase 1,
 * com a chave NORMALIZADA — `Sul América` e `SUL AMERICA` são um convênio só.
 */
function levantarDePara(linhas: LinhaCirurgia[], dePara: Awaited<ReturnType<typeof carregarDePara>>) {
  const aLigar = new Map<string, { textoBruto: string; profissionalId: string }>();
  const conveniosNovos = new Map<string, string>();
  const profissionaisNovos = new Map<string, string>();

  for (const l of linhas) {
    const chaveConv = chaveDoConvenio(l.convenioBruto);
    if (l.convenioBruto && !dePara.porConvenio.has(chaveConv) && !conveniosNovos.has(chaveConv)) {
      conveniosNovos.set(chaveConv, l.convenioBruto);
    }
    if (!l.profissionalBruto) continue;
    const chave = chaveDoProfissional(l.profissionalBruto);
    if (dePara.porProfissional.has(chave) || aLigar.has(chave) || profissionaisNovos.has(chave)) continue;
    const achado = dePara.porNome.get(chave);
    if (achado) aLigar.set(chave, { textoBruto: l.profissionalBruto, profissionalId: achado });
    else profissionaisNovos.set(chave, l.profissionalBruto);
  }
  return { aLigar, conveniosNovos: [...conveniosNovos.values()].sort(), profissionaisNovos: [...profissionaisNovos.values()].sort() };
}

async function numerosJaGravados(clienteId: string, linhas: LinhaCirurgia[]): Promise<Set<string>> {
  const existentes = await prisma.producaoCirurgia.findMany({
    where: { clienteId, numeroCirurgia: { in: linhas.map((l) => l.numeroCirurgia) } },
    select: { numeroCirurgia: true },
  });
  return new Set(existentes.map((e) => e.numeroCirurgia));
}

export async function previsualizarCirurgias(entrada: { clienteId: string; bytes: Buffer }): Promise<PreviaCirurgias> {
  exigirModuloLigado();
  const { grade, leitura } = await lerEInterpretar(entrada.bytes);
  const [dePara, existentes, lote] = await Promise.all([
    carregarDePara(entrada.clienteId),
    numerosJaGravados(entrada.clienteId, leitura.linhas),
    prisma.producaoLote.findFirst({
      where: { clienteId: entrada.clienteId, origem: "CIRURGIAS_TASY", hashArquivo: hashBytes(entrada.bytes), status: "IMPORTADO" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const { conveniosNovos, profissionaisNovos } = levantarDePara(leitura.linhas, dePara);
  const jaExistentes = leitura.linhas.filter((l) => existentes.has(l.numeroCirurgia)).length;

  return {
    formato: grade.formato,
    cabecalhoNaLinha: leitura.cabecalhoNaLinha,
    periodo: leitura.periodo ? { inicio: dia(leitura.periodo.inicio), fim: dia(leitura.periodo.fim) } : null,
    totalLinhas: leitura.linhas.length,
    novas: leitura.linhas.length - jaExistentes,
    jaExistentes,
    semAtendimento: leitura.linhas.filter((l) => !l.atendimento).length,
    naoExecutadas: leitura.linhas.filter((l) => l.status !== "EXECUTADA").length,
    ignoradas: leitura.ignoradas,
    colunasAusentes: leitura.colunasAusentes,
    amostra: leitura.linhas.slice(0, LINHAS_NA_PREVIA).map(paraVisivel),
    conveniosNovos,
    profissionaisNovos,
    jaImportado: lote ? { em: lote.createdAt } : null,
  };
}

export async function importarCirurgias(entrada: {
  clienteId: string;
  bytes: Buffer;
  nomeArquivo: string;
  arquivoId?: string | null;
  usuarioId: string;
}): Promise<ResultadoCirurgias> {
  exigirModuloLigado();

  const hashArquivo = hashBytes(entrada.bytes);
  const { grade, leitura } = await lerEInterpretar(entrada.bytes);

  // O mesmo arquivo de novo não mudaria nada — mas criaria um lote a mais no histórico, e quem lê
  // o histórico concluiria que houve uma segunda importação de verdade.
  const mesmoArquivo = await prisma.producaoLote.findFirst({
    where: { clienteId: entrada.clienteId, origem: "CIRURGIAS_TASY", hashArquivo, status: { in: ["IMPORTADO", "PROCESSANDO"] } },
    select: { createdAt: true },
  });
  if (mesmoArquivo) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Este arquivo já foi importado em ${mesmoArquivo.createdAt.toLocaleDateString("pt-BR")}. Nada foi alterado.`,
    });
  }
  if (!leitura.periodo || leitura.linhas.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nenhuma cirurgia aproveitável neste arquivo." });
  }
  const periodo = leitura.periodo;

  const [dePara, existentes] = await Promise.all([carregarDePara(entrada.clienteId), numerosJaGravados(entrada.clienteId, leitura.linhas)]);
  const { aLigar, conveniosNovos, profissionaisNovos } = levantarDePara(leitura.linhas, dePara);

  const resolvido = (l: LinhaCirurgia) => {
    const conv = dePara.porConvenio.get(chaveDoConvenio(l.convenioBruto));
    const chaveProf = chaveDoProfissional(l.profissionalBruto);
    const prof = dePara.porProfissional.get(chaveProf)?.profissionalId ?? aLigar.get(chaveProf)?.profissionalId ?? null;
    return { operadoraId: conv?.operadoraId ?? null, plano: conv?.plano ?? null, profissionalId: prof };
  };

  const campos = (l: LinhaCirurgia, loteId: string) => ({
    loteId,
    competencia: l.competencia,
    linha: l.linha,
    atendimento: l.atendimento,
    dataCirurgia: l.dataCirurgia,
    inicioEm: l.inicioEm,
    pacienteNome: l.pacienteNome,
    procedimento: l.procedimento.slice(0, 255),
    status: l.status,
    statusBruto: l.statusBruto,
    autorizacao: l.autorizacao,
    autorizacaoBruto: l.autorizacaoBruto,
    categoriaConvenio: l.categoriaConvenio,
    tipoConvenioBruto: l.tipoConvenioBruto,
    convenioBruto: l.convenioBruto,
    profissionalBruto: l.profissionalBruto,
    anestesista: l.anestesista,
    opme: l.opme,
    tempoMinutos: l.tempoMinutos,
    ...resolvido(l),
  });

  const novas = leitura.linhas.filter((l) => !existentes.has(l.numeroCirurgia));
  const atualizar = leitura.linhas.filter((l) => existentes.has(l.numeroCirurgia));

  // Tudo ou nada: um período pela metade parece completo na tela.
  const loteId = await prisma.$transaction(
    async (tx) => {
      const lote = await tx.producaoLote.create({
        data: {
          clienteId: entrada.clienteId,
          competencia: competenciaDe(periodo.fim),
          // Nula de propósito: a trava "um lote vigente por mês" é das consultas (spec §2.2).
          competenciaVigente: null,
          origem: "CIRURGIAS_TASY",
          periodoInicio: periodo.inicio,
          periodoFim: periodo.fim,
          arquivoId: entrada.arquivoId ?? null,
          nomeArquivo: entrada.nomeArquivo,
          formato: grade.formato,
          hashArquivo,
          status: "IMPORTADO",
          linhasLidas: leitura.linhas.length + leitura.ignoradas.length,
          linhasImportadas: leitura.linhas.length,
          linhasIgnoradas: leitura.ignoradas.length,
          importadoPorId: entrada.usuarioId,
        },
        select: { id: true },
      });

      for (const [chave, { textoBruto, profissionalId }] of aLigar) {
        await tx.mapeamentoProfissional.create({
          data: { clienteId: entrada.clienteId, textoBruto, textoNormalizado: chave, profissionalId },
        });
      }

      if (novas.length > 0) {
        await tx.producaoCirurgia.createMany({
          data: novas.map((l) => ({ clienteId: entrada.clienteId, numeroCirurgia: l.numeroCirurgia, ...campos(l, lote.id) })),
        });
      }
      // A mesma cirurgia, vista de novo: o que o TASY diz HOJE vale (status, autorização, número
      // do atendimento que chegou depois). Uma a uma porque cada linha muda coisas diferentes.
      for (const l of atualizar) {
        await tx.producaoCirurgia.update({
          where: { clienteId_numeroCirurgia: { clienteId: entrada.clienteId, numeroCirurgia: l.numeroCirurgia } },
          data: campos(l, lote.id),
        });
      }
      return lote.id;
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  return {
    loteId,
    periodo: { inicio: dia(periodo.inicio), fim: dia(periodo.fim) },
    linhasLidas: leitura.linhas.length + leitura.ignoradas.length,
    novas: novas.length,
    atualizadas: atualizar.length,
    linhasIgnoradas: leitura.ignoradas.length,
    semAtendimento: leitura.linhas.filter((l) => !l.atendimento).length,
    conveniosNovos,
    profissionaisNovos,
    profissionaisLigadosAutomaticamente: aLigar.size,
  };
}

// ─── Leitura para a tela ────────────────────────────────────────────────────────────────────────

/** As colunas que a tela pode ver. Nada de prontuário — ele nem é gravado. */
const CAMPOS_VISIVEIS = {
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
  plano: true,
  profissionalBruto: true,
  anestesista: true,
  opme: true,
  tempoMinutos: true,
  operadora: { select: { id: true, nome: true } },
  profissional: { select: { id: true, nome: true } },
} as const;

export type SituacaoCirurgia = "SEM_ATENDIMENTO" | "AUTORIZACAO_PENDENTE" | "NAO_EXECUTADA";

export interface FiltroCirurgias {
  clienteId: string;
  competencia?: string;
  operadoraId?: string;
  profissionalId?: string;
  situacao?: SituacaoCirurgia;
  busca?: string;
  pagina?: number;
}

function whereDeSituacao(situacao?: SituacaoCirurgia) {
  if (situacao === "SEM_ATENDIMENTO") return { atendimento: null };
  if (situacao === "AUTORIZACAO_PENDENTE") return { autorizacao: "PENDENTE" as const };
  if (situacao === "NAO_EXECUTADA") return { status: { not: "EXECUTADA" as const } };
  return {};
}

export async function listarCirurgias(filtro: FiltroCirurgias) {
  const pagina = Math.max(1, filtro.pagina ?? 1);
  const where = {
    clienteId: filtro.clienteId,
    ...(filtro.competencia ? { competencia: filtro.competencia } : {}),
    ...(filtro.operadoraId ? { operadoraId: filtro.operadoraId } : {}),
    ...(filtro.profissionalId ? { profissionalId: filtro.profissionalId } : {}),
    ...whereDeSituacao(filtro.situacao),
    ...(filtro.busca ? { pacienteNome: { contains: filtro.busca } } : {}),
  };

  const [linhas, total] = await Promise.all([
    prisma.producaoCirurgia.findMany({
      where,
      select: CAMPOS_VISIVEIS,
      orderBy: [{ dataCirurgia: "desc" }, { numeroCirurgia: "desc" }],
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
    }),
    prisma.producaoCirurgia.count({ where }),
  ]);

  return {
    linhas: linhas.map((l) => ({ ...l, dataCirurgia: dia(l.dataCirurgia) })),
    total,
    pagina,
    porPagina: POR_PAGINA,
  };
}

/** Os meses que têm cirurgia, e a última importação — o que a tela mostra no topo. */
export async function mesesDasCirurgias(clienteId: string) {
  const [meses, ultimo] = await Promise.all([
    prisma.producaoCirurgia.groupBy({
      by: ["competencia"],
      where: { clienteId },
      _count: { _all: true },
      orderBy: { competencia: "desc" },
    }),
    prisma.producaoLote.findFirst({
      where: { clienteId, origem: "CIRURGIAS_TASY", status: "IMPORTADO" },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        nomeArquivo: true,
        periodoInicio: true,
        periodoFim: true,
        linhasImportadas: true,
        importadoPor: { select: { id: true, nome: true } },
      },
    }),
  ]);
  return {
    meses: meses.map((m) => ({ competencia: m.competencia, cirurgias: m._count._all })),
    ultimaImportacao: ultimo
      ? {
          em: ultimo.createdAt,
          nomeArquivo: ultimo.nomeArquivo,
          periodoInicio: ultimo.periodoInicio ? dia(ultimo.periodoInicio) : null,
          periodoFim: ultimo.periodoFim ? dia(ultimo.periodoFim) : null,
          linhas: ultimo.linhasImportadas,
          por: ultimo.importadoPor?.nome ?? null,
        }
      : null,
  };
}

export interface ResumoCirurgias {
  /** Só EXECUTADAS: reservada não é produção (spec §2.5). */
  executadas: number;
  naoExecutadas: number;
  semAtendimento: number;
  autorizacaoPendente: number;
  porCategoria: Record<CategoriaConvenio, number>;
  porOperadora: SomaOperadora[];
  porProfissional: SomaProfissional[];
  porProcedimento: { procedimento: string; cirurgias: number }[];
}

/** O resumo do período (ou de um mês). Contagens, não dinheiro — o valor depende dos pacotes. */
export async function resumoDasCirurgias(clienteId: string, competencia?: string): Promise<ResumoCirurgias> {
  const base = { clienteId, ...(competencia ? { competencia } : {}) };
  const executada = { ...base, status: "EXECUTADA" as const };

  const [
    executadas,
    naoExecutadas,
    semAtendimento,
    autorizacaoPendente,
    porCategoria,
    porOperadora,
    porProfissional,
    porProcedimento,
    mapeamentos,
  ] = await Promise.all([
    prisma.producaoCirurgia.count({ where: executada }),
    prisma.producaoCirurgia.count({ where: { ...base, status: { not: "EXECUTADA" } } }),
    prisma.producaoCirurgia.count({ where: { ...executada, atendimento: null } }),
    prisma.producaoCirurgia.count({ where: { ...executada, autorizacao: "PENDENTE" } }),
    prisma.producaoCirurgia.groupBy({ by: ["categoriaConvenio"], where: executada, _count: { _all: true } }),
    prisma.producaoCirurgia.groupBy({ by: ["operadoraId", "convenioBruto"], where: executada, _count: { _all: true } }),
    prisma.producaoCirurgia.groupBy({ by: ["profissionalId", "profissionalBruto"], where: executada, _count: { _all: true } }),
    prisma.producaoCirurgia.groupBy({
      by: ["procedimento"],
      where: executada,
      _count: { _all: true },
      orderBy: { _count: { procedimento: "desc" } },
      take: 8,
    }),
    prisma.mapeamentoConvenio.findMany({ where: { clienteId }, select: { textoNormalizado: true, particular: true } }),
  ]);

  const categorias: Record<CategoriaConvenio, number> = { SUS: 0, CONVENIO: 0, AUTOGESTAO: 0, PARTICULAR: 0, OUTRO: 0 };
  for (const c of porCategoria) categorias[c.categoriaConvenio] = c._count._all;

  const [somaOperadora, somaProfissional] = await Promise.all([
    somarPorOperadora(
      porOperadora.map((g) => ({ operadoraId: g.operadoraId, convenioBruto: g.convenioBruto, n: g._count._all })),
      mapeamentos,
    ),
    somarPorProfissional(
      porProfissional.map((g) => ({ profissionalId: g.profissionalId, profissionalBruto: g.profissionalBruto, n: g._count._all })),
    ),
  ]);

  return {
    executadas,
    naoExecutadas,
    semAtendimento,
    autorizacaoPendente,
    porCategoria: categorias,
    porOperadora: somaOperadora,
    porProfissional: somaProfissional,
    porProcedimento: porProcedimento.map((p) => ({ procedimento: p.procedimento, cirurgias: p._count._all })),
  };
}
