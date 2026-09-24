import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import { hashBytes } from "../../lib/hash.js";
import { ErroDePlanilha, lerGrade, normalizarTexto, type Formato } from "./planilha/index.js";
import { dicaDeRota } from "./planilha/qual-relatorio.js";
import type { StatusConciliacao } from "./conciliacao-cirurgica.js";
import {
  montarConciliacao,
  totalizar,
  type LinhaConciliada,
  type RecebidoSemProducao,
  type TotaisConciliacao,
} from "./conciliacao-financeira.service.js";
import { carregarDePara, exigirModuloLigado } from "./conciliacao.service.js";
import {
  somarPorOperadora,
  somarPorProfissional,
  type SomaOperadora,
  type SomaProfissional,
} from "./conciliacao-painel.service.js";
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
  /** Já gravadas por um arquivo de período mais novo — ficam como estão. */
  mantidas: number;
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
  mantidas: number;
  linhasIgnoradas: number;
  semAtendimento: number;
  conveniosNovos: string[];
  profissionaisNovos: string[];
  profissionaisLigadosAutomaticamente: number;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

async function lerEInterpretar(bytes: Buffer) {
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
    return { grade, leitura: interpretarMapaCirurgico(grade) };
  } catch (e) {
    if (e instanceof ErroDeLeitura) {
      const dica = dicaDeRota(grade, "cirurgias");
      throw new TRPCError({ code: "BAD_REQUEST", message: dica ? `${e.message} ${dica}` : e.message });
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

/**
 * Separa o arquivo em três grupos: cirurgias **novas**, as que serão **atualizadas**, e as que
 * ficam como estão (**mantidas**) porque quem as gravou foi um arquivo de período MAIS NOVO.
 *
 * ⚠️ Sem esta terceira categoria, importar o export de maio depois do de junho faria a cirurgia
 * voltar a "reservada" e perder o número do atendimento — e reimportar junho seria recusado pela
 * trava do mesmo arquivo. O arquivo mais recente vale; o mais velho só acrescenta.
 */
async function classificar(clienteId: string, linhas: LinhaCirurgia[], fimDoArquivo: Date | null) {
  const existentes = await prisma.producaoCirurgia.findMany({
    where: { clienteId, numeroCirurgia: { in: linhas.map((l) => l.numeroCirurgia) } },
    select: { numeroCirurgia: true, lote: { select: { periodoFim: true } } },
  });
  const fimDeQuemGravou = new Map(existentes.map((e) => [e.numeroCirurgia, e.lote.periodoFim]));

  const novas: LinhaCirurgia[] = [];
  const atualizar: LinhaCirurgia[] = [];
  const mantidas: LinhaCirurgia[] = [];
  for (const l of linhas) {
    if (!fimDeQuemGravou.has(l.numeroCirurgia)) novas.push(l);
    else {
      const fim = fimDeQuemGravou.get(l.numeroCirurgia);
      if (fim && fimDoArquivo && fim > fimDoArquivo) mantidas.push(l);
      else atualizar.push(l);
    }
  }
  return { novas, atualizar, mantidas };
}

/** O número que a tela e o resumo chamam de "sem atendimento": só conta o que foi executado. */
const semAtendimentoExecutadas = (linhas: LinhaCirurgia[]) => linhas.filter((l) => l.status === "EXECUTADA" && !l.atendimento).length;

export async function previsualizarCirurgias(entrada: { clienteId: string; bytes: Buffer }): Promise<PreviaCirurgias> {
  exigirModuloLigado();
  const { grade, leitura } = await lerEInterpretar(entrada.bytes);
  const [dePara, grupos, lote] = await Promise.all([
    carregarDePara(entrada.clienteId),
    classificar(entrada.clienteId, leitura.linhas, leitura.periodo?.fim ?? null),
    prisma.producaoLote.findFirst({
      where: { clienteId: entrada.clienteId, origem: "CIRURGIAS_TASY", hashArquivo: hashBytes(entrada.bytes), status: "IMPORTADO" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const { conveniosNovos, profissionaisNovos } = levantarDePara(leitura.linhas, dePara);

  return {
    formato: grade.formato,
    cabecalhoNaLinha: leitura.cabecalhoNaLinha,
    periodo: leitura.periodo ? { inicio: dia(leitura.periodo.inicio), fim: dia(leitura.periodo.fim) } : null,
    totalLinhas: leitura.linhas.length,
    novas: grupos.novas.length,
    jaExistentes: grupos.atualizar.length,
    mantidas: grupos.mantidas.length,
    semAtendimento: semAtendimentoExecutadas(leitura.linhas),
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

  const [dePara, { novas, atualizar, mantidas }] = await Promise.all([
    carregarDePara(entrada.clienteId),
    classificar(entrada.clienteId, leitura.linhas, periodo.fim),
  ]);
  const { aLigar, conveniosNovos, profissionaisNovos } = levantarDePara(leitura.linhas, dePara);

  const resolvido = (l: LinhaCirurgia) => {
    const conv = dePara.porConvenio.get(chaveDoConvenio(l.convenioBruto));
    const chaveProf = chaveDoProfissional(l.profissionalBruto);
    const prof = dePara.porProfissional.get(chaveProf)?.profissionalId ?? aLigar.get(chaveProf)?.profissionalId ?? null;
    return { operadoraId: conv?.operadoraId ?? null, plano: conv?.plano ?? null, profissionalId: prof };
  };

  // Texto livre cortado no tamanho da coluna: um valor longo demais derrubaria a importação
  // INTEIRA com erro do banco, sem dizer qual linha. (Número e atendimento o leitor já barra.)
  const t = (s: string) => s.slice(0, 191);
  const tn = (s: string | null) => (s === null ? null : t(s));
  const campos = (l: LinhaCirurgia, loteId: string) => ({
    loteId,
    competencia: l.competencia,
    linha: l.linha,
    atendimento: l.atendimento,
    dataCirurgia: l.dataCirurgia,
    inicioEm: l.inicioEm,
    pacienteNome: t(l.pacienteNome),
    procedimento: l.procedimento.slice(0, 255),
    status: l.status,
    statusBruto: t(l.statusBruto),
    autorizacao: l.autorizacao,
    autorizacaoBruto: t(l.autorizacaoBruto),
    categoriaConvenio: l.categoriaConvenio,
    tipoConvenioBruto: tn(l.tipoConvenioBruto),
    convenioBruto: t(l.convenioBruto),
    profissionalBruto: t(l.profissionalBruto),
    anestesista: tn(l.anestesista),
    opme: l.opme,
    tempoMinutos: l.tempoMinutos,
    ...resolvido(l),
  });

  // Tudo ou nada: um período pela metade parece completo na tela.
  const loteId = await prisma
    .$transaction(
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
          const { atendimento, ...resto } = campos(l, lote.id);
          await tx.producaoCirurgia.update({
            where: { clienteId_numeroCirurgia: { clienteId: entrada.clienteId, numeroCirurgia: l.numeroCirurgia } },
            // Número de atendimento já conhecido nunca volta a nulo: é a chave do repasse, e perdê-lo
            // tiraria a cirurgia da conciliação sem ninguém perceber.
            data: atendimento ? { ...resto, atendimento } : resto,
          });
        }
        return lote.id;
      },
      { timeout: 120_000, maxWait: 15_000 },
    )
    .catch((e: unknown) => {
      // Duas importações ao mesmo tempo: o índice único segura a duplicata, mas o erro cru do banco
      // viraria "erro interno". Quem chegou depois recebe o recado e tenta de novo.
      if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Outra importação deste cliente terminou ao mesmo tempo. Nada foi gravado — confira a lista e envie de novo.",
        });
      }
      throw e;
    });

  return {
    loteId,
    periodo: { inicio: dia(periodo.inicio), fim: dia(periodo.fim) },
    linhasLidas: leitura.linhas.length + leitura.ignoradas.length,
    novas: novas.length,
    atualizadas: atualizar.length,
    mantidas: mantidas.length,
    linhasIgnoradas: leitura.ignoradas.length,
    semAtendimento: semAtendimentoExecutadas(leitura.linhas),
    conveniosNovos,
    profissionaisNovos,
    profissionaisLigadosAutomaticamente: aLigar.size,
  };
}

// ─── Leitura para a tela ────────────────────────────────────────────────────────────────────────

/** Filtro pelo que a conciliação diz — o status é calculado, então o filtro é feito em memória. */
export type SituacaoCirurgia = "SEM_ATENDIMENTO" | "AUTORIZACAO_PENDENTE" | "NAO_EXECUTADA";

export interface FiltroCirurgias {
  clienteId: string;
  competencia?: string;
  operadoraId?: string;
  profissionalId?: string;
  situacao?: SituacaoCirurgia;
  statusConciliacao?: StatusConciliacao;
  /** Só o que já passou da defasagem normal de pagamento — a pergunta "o que travou?". */
  soAtrasadas?: boolean;
  /**
   * O recorte do recurso de glosa (Fase 2c):
   * `SEM_RECURSO` é o dinheiro perdido por OMISSÃO — glosado e ninguém recorreu.
   * `ABERTO` é o que está em disputa; `SEM_RESPOSTA`, o que passou do prazo e precisa de telefonema.
   */
  recurso?: "SEM_RECURSO" | "ABERTO" | "SEM_RESPOSTA" | "RESPONDIDO";
  busca?: string;
  pagina?: number;
}

function passaNoFiltro(l: LinhaConciliada, f: FiltroCirurgias): boolean {
  if (f.competencia && l.competencia !== f.competencia) return false;
  if (f.operadoraId && l.operadora?.id !== f.operadoraId) return false;
  if (f.profissionalId && l.profissional?.id !== f.profissionalId) return false;
  if (f.situacao === "SEM_ATENDIMENTO" && l.atendimento) return false;
  if (f.situacao === "AUTORIZACAO_PENDENTE" && l.autorizacao !== "PENDENTE") return false;
  if (f.situacao === "NAO_EXECUTADA" && l.status === "EXECUTADA") return false;
  if (f.statusConciliacao && l.statusConciliacao !== f.statusConciliacao) return false;
  if (f.soAtrasadas && !l.atrasada) return false;
  if (f.recurso) {
    // ⚠️ "Sem recurso" só faz sentido sobre o que FOI glosado: uma cirurgia paga também não tem
    // recurso, e listá-la aqui afogaria a pergunta ("de qual glosa ninguém cuidou?") em ruído.
    const glosada = l.statusConciliacao === "GLOSA_PARCIAL" || l.statusConciliacao === "GLOSA_TOTAL";
    if (f.recurso === "SEM_RECURSO" && (!glosada || l.recurso)) return false;
    if (f.recurso === "ABERTO" && l.recurso?.status !== "ABERTO") return false;
    if (f.recurso === "SEM_RESPOSTA" && !l.recurso?.semResposta) return false;
    if (f.recurso === "RESPONDIDO" && (!l.recurso || l.recurso.status === "ABERTO")) return false;
  }
  if (f.busca && !normalizarTexto(l.pacienteNome).includes(normalizarTexto(f.busca))) return false;
  return true;
}

/**
 * A lista da tela, já conciliada: cada cirurgia com cobrado, recebido, glosa e status. Os totais
 * são do FILTRO inteiro, não da página — "quanto glosou a Unimed em maio" é uma soma, não 50 linhas.
 */
export async function listarCirurgias(filtro: FiltroCirurgias) {
  const pagina = Math.max(1, filtro.pagina ?? 1);
  const { linhas } = await montarConciliacao(filtro.clienteId);
  const filtradas = linhas.filter((l) => passaNoFiltro(l, filtro));
  return {
    // `convenioParticular` já vem de `montarConciliacao`, pela mesma régua do resumo e das consultas.
    linhas: filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA),
    total: filtradas.length,
    pagina,
    porPagina: POR_PAGINA,
    totais: totalizar(filtradas),
  };
}

/** Tudo o que o filtro alcança, sem paginar — é o que a exportação leva. */
export async function linhasParaExportar(filtro: Omit<FiltroCirurgias, "pagina">) {
  const { linhas } = await montarConciliacao(filtro.clienteId);
  return linhas.filter((l) => passaNoFiltro(l, filtro));
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
  /** Cobrado, recebido, glosa e a receber do período — Fase 2b. */
  dinheiro: TotaisConciliacao;
  /** Repasse que entrou e não casa com cirurgia nenhuma (do cliente todo, não do mês). */
  recebidoSemProducao: RecebidoSemProducao;
}

/** O resumo do período (ou de um mês): as contagens e, desde a Fase 2b, o dinheiro. */
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
  const conciliacao = await montarConciliacao(clienteId);

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
    dinheiro: totalizar(conciliacao.linhas.filter((l) => !competencia || l.competencia === competencia)),
    recebidoSemProducao: conciliacao.semProducao,
  };
}
