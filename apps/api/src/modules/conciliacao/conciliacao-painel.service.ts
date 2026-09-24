import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import { readFile } from "node:fs/promises";
import { caminhoAbsoluto } from "../../lib/storage.js";
import { chaveDoConvenio, chaveDoProfissional } from "./producao-consultas.js";

/**
 * CONCILIAÇÃO — o lado de LEITURA: o que a tela pergunta.
 *
 * ⚠️ Todo `select` aqui é explícito e **nenhum deles inclui as colunas de dado pessoal do
 * paciente**. Nunca devolva a linha inteira do Prisma daqui: `pacienteCpfCifrado` e companhia
 * viajariam para o navegador cifradas — inúteis para a tela e uma superfície de vazamento a mais.
 * Ver spec §5 e o teste que varre estes retornos.
 */

/** As colunas que a tela pode ver. É a lista fechada — crescer aqui é decisão de privacidade. */
const CAMPOS_VISIVEIS = {
  id: true,
  linha: true,
  dataAgenda: true,
  dataAtendimento: true,
  competencia: true,
  pacienteNome: true,
  tipoAtendimento: true,
  tipoAtendimentoBruto: true,
  convenioBruto: true,
  plano: true,
  profissionalBruto: true,
  operadora: { select: { id: true, nome: true } },
  profissional: { select: { id: true, nome: true } },
} as const;

const POR_PAGINA = 50;

/**
 * As chaves de convênio que este cliente ligou como PARTICULAR ("não é convênio").
 *
 * ⚠️ Particular ligado tem `operadoraId` NULO nas linhas — igual a convênio que ninguém ligou.
 * Ler "sem operadora" como "a ligar" faz a linha dizer "PARTICULAR (a ligar)" depois de ligada.
 * A régua é uma só, `convenioEhParticular`, e resumo, consultas e cirurgias leem por ela.
 */
export async function particularesDoCliente(clienteId: string): Promise<Set<string>> {
  const m = await prisma.mapeamentoConvenio.findMany({
    where: { clienteId, particular: true },
    select: { textoNormalizado: true },
  });
  return new Set(m.map((x) => x.textoNormalizado));
}

/** A linha foi ligada como particular? (Com operadora, nunca é.) */
export function convenioEhParticular(operadoraId: string | null, convenioBruto: string, particulares: Set<string>): boolean {
  return !operadoraId && particulares.has(chaveDoConvenio(convenioBruto));
}

/**
 * Lê do disco o arquivo enviado, conferindo que ele é DESTE cliente.
 *
 * A conferência de posse mora aqui, e não só na tela: um `arquivoId` vindo do navegador é dado do
 * usuário, e sem isto daria para importar a planilha de um cliente dentro de outro.
 */
export async function carregarArquivoDoCliente(clienteId: string, arquivoId: string): Promise<{ bytes: Buffer; nome: string }> {
  const arquivo = await prisma.arquivo.findFirst({
    where: { id: arquivoId, clienteId, deletedAt: null },
    select: { nome: true, caminho: true },
  });
  if (!arquivo) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Arquivo não encontrado para este cliente." });
  }
  try {
    return { bytes: await readFile(caminhoAbsoluto(arquivo.caminho)), nome: arquivo.nome };
  } catch {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "O arquivo foi enviado mas não está mais no servidor. Envie de novo.",
    });
  }
}

/** Os meses já importados deste cliente, do mais recente para o mais antigo. */
export async function competenciasImportadas(clienteId: string) {
  return prisma.producaoLote.findMany({
    // A origem é explícita: lote de cirurgia nunca é vigente, mas a lista de meses é das CONSULTAS
    // e não deve depender desse detalhe para não misturar os dois.
    where: { clienteId, origem: "CONSULTAS_NUVENS", competenciaVigente: { not: null } },
    select: {
      id: true,
      competencia: true,
      nomeArquivo: true,
      formato: true,
      linhasImportadas: true,
      linhasIgnoradas: true,
      createdAt: true,
      importadoPor: { select: { id: true, nome: true } },
    },
    orderBy: { competencia: "desc" },
  });
}

export interface FiltroProducao {
  clienteId: string;
  competencia?: string;
  operadoraId?: string;
  profissionalId?: string;
  tipoAtendimento?: "CONSULTA" | "CORTESIA" | "SEM_VINCULO_AGENDA" | "OUTRO";
  /** Busca por nome do paciente. Nunca por CPF: ele não é legível nem pesquisável por aqui. */
  busca?: string;
  pagina?: number;
}

export async function listarProducao(filtro: FiltroProducao) {
  const pagina = Math.max(1, filtro.pagina ?? 1);
  const where = {
    clienteId: filtro.clienteId,
    ...(filtro.competencia ? { competencia: filtro.competencia } : {}),
    ...(filtro.operadoraId ? { operadoraId: filtro.operadoraId } : {}),
    ...(filtro.profissionalId ? { profissionalId: filtro.profissionalId } : {}),
    ...(filtro.tipoAtendimento ? { tipoAtendimento: filtro.tipoAtendimento } : {}),
    ...(filtro.busca ? { pacienteNome: { contains: filtro.busca } } : {}),
  };

  const [linhas, total, particulares] = await Promise.all([
    prisma.producaoConsulta.findMany({
      where,
      select: CAMPOS_VISIVEIS,
      orderBy: [{ dataAtendimento: "desc" }, { linha: "asc" }],
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
    }),
    prisma.producaoConsulta.count({ where }),
    particularesDoCliente(filtro.clienteId),
  ]);

  return {
    linhas: linhas.map((l) => ({
      ...l,
      convenioParticular: convenioEhParticular(l.operadora?.id ?? null, l.convenioBruto, particulares),
      // Data como texto de 10 caracteres: deixa explícito que é DIA, sem hora e sem fuso — a
      // mesma disciplina do leitor de planilha e do banco (`@db.Date`).
      dataAgenda: l.dataAgenda ? l.dataAgenda.toISOString().slice(0, 10) : null,
      dataAtendimento: l.dataAtendimento.toISOString().slice(0, 10),
    })),
    total,
    pagina,
    porPagina: POR_PAGINA,
  };
}

/** Exportado porque o tipo do `AppRouter` atravessa para o front e precisa nomeá-lo. */
export interface SomaOperadora {
  operadoraId: string | null;
  rotulo: string;
  particular: boolean;
  atendimentos: number;
  pendente: boolean;
}

export interface SomaProfissional {
  profissionalId: string | null;
  rotulo: string;
  atendimentos: number;
  pendente: boolean;
}

type TipoAtendimento = "CONSULTA" | "CORTESIA" | "SEM_VINCULO_AGENDA" | "OUTRO";

/** As quatro partes, que SOMAM o total do mês — nenhum atendimento em duas, nenhum fora. */
export interface SeparacaoDoMes {
  /** Consulta de convênio: é a que pode virar recebimento. */
  convenio: number;
  /** Consulta cujo convênio foi ligado como particular. */
  particular: number;
  cortesia: number;
  semVinculo: number;
}

/**
 * Em qual parte do mês cai UM atendimento. A ordem importa e é a regra: o TIPO fala primeiro —
 * uma cortesia de paciente particular é cortesia, não particular —, senão o mesmo atendimento
 * sairia de duas partes e a conta não fecharia com o arquivo.
 *
 * ⚠️ "Sem vínculo com a agenda" fica FORA do que gera recebimento por decisão desta tela, não por
 * regra da operadora: é atendimento real, mas sem agendamento o relatório não diz se foi faturado.
 * Se a clínica cobra esses do convênio, é aqui (e só aqui) que muda.
 */
export function parteDoAtendimento(tipo: TipoAtendimento, particular: boolean): keyof SeparacaoDoMes {
  if (tipo === "CORTESIA") return "cortesia";
  if (tipo === "SEM_VINCULO_AGENDA") return "semVinculo";
  return particular ? "particular" : "convenio";
}

/**
 * O resumo do mês: quantos atendimentos por operadora, por profissional e por tipo.
 *
 * O total é repartido em convênio · particular · cortesia · sem vínculo (`separacao`), e a lista
 * por operadora conta **só consulta** (convênio + particular, que aparece marcado) — somar ali a
 * cortesia e o sem vínculo inflaria a expectativa de receita, que é justamente o número que este
 * módulo existe para acertar. O que fica de fora da lista aparece ao lado dela, para a conta
 * fechar com o arquivo.
 */
export async function resumoDaCompetencia(clienteId: string, competencia: string) {
  const [porConvenioETipo, porProfissional, mapeamentos] = await Promise.all([
    prisma.producaoConsulta.groupBy({
      by: ["operadoraId", "convenioBruto", "tipoAtendimento"],
      where: { clienteId, competencia },
      _count: { _all: true },
    }),
    prisma.producaoConsulta.groupBy({
      by: ["profissionalId", "profissionalBruto"],
      where: { clienteId, competencia },
      _count: { _all: true },
    }),
    prisma.mapeamentoConvenio.findMany({
      where: { clienteId },
      select: { textoNormalizado: true, particular: true },
    }),
  ]);

  const particulares = new Set(mapeamentos.filter((m) => m.particular).map((m) => m.textoNormalizado));
  const separacao: SeparacaoDoMes = { convenio: 0, particular: 0, cortesia: 0, semVinculo: 0 };
  const porTipo: Record<TipoAtendimento, number> = { CONSULTA: 0, CORTESIA: 0, SEM_VINCULO_AGENDA: 0, OUTRO: 0 };
  const grupos = porConvenioETipo.map((g) => ({
    operadoraId: g.operadoraId,
    convenioBruto: g.convenioBruto,
    n: g._count._all,
    parte: parteDoAtendimento(g.tipoAtendimento, convenioEhParticular(g.operadoraId, g.convenioBruto, particulares)),
  }));
  for (const [i, g] of grupos.entries()) {
    separacao[g.parte] += g.n;
    porTipo[porConvenioETipo[i]!.tipoAtendimento] += g.n;
  }

  const [somaPorOperadora, todasAsOperadoras, somaPorProfissional] = await Promise.all([
    somarPorOperadora(
      grupos.filter((g) => g.parte === "convenio" || g.parte === "particular"),
      mapeamentos,
    ),
    // O filtro de operadora da tabela alcança o mês INTEIRO: uma operadora só com cortesias
    // continua filtrável, mesmo sem aparecer na lista do que gera recebimento.
    somarPorOperadora(grupos, mapeamentos),
    somarPorProfissional(
      porProfissional.map((g) => ({ profissionalId: g.profissionalId, profissionalBruto: g.profissionalBruto, n: g._count._all })),
    ),
  ]);

  return {
    competencia,
    total: separacao.convenio + separacao.particular + separacao.cortesia + separacao.semVinculo,
    /** O que pode virar recebimento de convênio (= `separacao.convenio`). */
    faturavel: separacao.convenio,
    separacao,
    porTipo,
    porOperadora: somaPorOperadora,
    operadorasDoMes: todasAsOperadoras
      .filter((o): o is SomaOperadora & { operadoraId: string } => !!o.operadoraId)
      .map((o) => ({ operadoraId: o.operadoraId, rotulo: o.rotulo })),
    porProfissional: somaPorProfissional,
  };
}

/**
 * Agrupa por OPERADORA, não pelo texto: é a leitura "quanto de Porto Seguro", somando os planos
 * Básico e Especial I numa linha só. Sem de-para, cada texto cru vira a própria linha, marcada
 * como pendente — a tela mostra que aquele número ainda não está fechado.
 *
 * Compartilhado por consultas e cirurgias: as duas usam o MESMO de-para, então somam igual.
 */
export async function somarPorOperadora(
  grupos: { operadoraId: string | null; convenioBruto: string; n: number }[],
  mapeamentos: { textoNormalizado: string; particular: boolean }[],
): Promise<SomaOperadora[]> {
  const ids = [...new Set(grupos.map((g) => g.operadoraId).filter((x): x is string => !!x))];
  const operadoras = await prisma.operadora.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } });
  const nomeOperadora = new Map(operadoras.map((o) => [o.id, o.nome]));
  const particulares = new Set(mapeamentos.filter((m) => m.particular).map((m) => m.textoNormalizado));

  const soma = new Map<string, SomaOperadora>();
  for (const g of grupos) {
    const particular = convenioEhParticular(g.operadoraId, g.convenioBruto, particulares);
    const chave = g.operadoraId ?? (particular ? "__particular__" : `bruto:${chaveDoConvenio(g.convenioBruto)}`);
    const atual = soma.get(chave);
    if (atual) {
      atual.atendimentos += g.n;
      continue;
    }
    const rotulo = g.operadoraId ? (nomeOperadora.get(g.operadoraId) ?? g.convenioBruto) : particular ? "Particular" : g.convenioBruto;
    soma.set(chave, { operadoraId: g.operadoraId, rotulo, particular, atendimentos: g.n, pendente: !g.operadoraId && !particular });
  }
  return [...soma.values()].sort((a, b) => b.atendimentos - a.atendimentos);
}

export async function somarPorProfissional(
  grupos: { profissionalId: string | null; profissionalBruto: string; n: number }[],
): Promise<SomaProfissional[]> {
  const ids = [...new Set(grupos.map((g) => g.profissionalId).filter((x): x is string => !!x))];
  const cadastrados = await prisma.profissional.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } });
  const nomeProfissional = new Map(cadastrados.map((p) => [p.id, p.nome]));

  const soma = new Map<string, SomaProfissional>();
  for (const g of grupos) {
    const chave = g.profissionalId ?? `bruto:${chaveDoProfissional(g.profissionalBruto)}`;
    const atual = soma.get(chave);
    if (atual) {
      atual.atendimentos += g.n;
      continue;
    }
    soma.set(chave, {
      profissionalId: g.profissionalId,
      rotulo: g.profissionalId ? (nomeProfissional.get(g.profissionalId) ?? g.profissionalBruto) : g.profissionalBruto,
      atendimentos: g.n,
      pendente: !g.profissionalId,
    });
  }
  return [...soma.values()].sort((a, b) => b.atendimentos - a.atendimentos);
}

/**
 * O que está esperando alguém ligar. É esta lista que transforma "importei" em "posso confiar no
 * número": enquanto houver pendência, o resumo por operadora está incompleto — e a tela diz isso.
 */
export async function pendenciasDePara(clienteId: string) {
  // O de-para é um só para consultas e cirurgias — a pendência também. Ligar "Sul América" aqui
  // resolve as duas produções de uma vez.
  const [convConsulta, profConsulta, convCirurgia, profCirurgia, jaLigadoConv, jaLigadoProf] = await Promise.all([
    prisma.producaoConsulta.groupBy({
      by: ["convenioBruto"],
      where: { clienteId, operadoraId: null },
      _count: { _all: true },
    }),
    prisma.producaoConsulta.groupBy({
      by: ["profissionalBruto"],
      where: { clienteId, profissionalId: null },
      _count: { _all: true },
    }),
    prisma.producaoCirurgia.groupBy({
      by: ["convenioBruto"],
      where: { clienteId, operadoraId: null },
      _count: { _all: true },
    }),
    prisma.producaoCirurgia.groupBy({
      by: ["profissionalBruto"],
      where: { clienteId, profissionalId: null },
      _count: { _all: true },
    }),
    prisma.mapeamentoConvenio.findMany({ where: { clienteId }, select: { textoNormalizado: true } }),
    prisma.mapeamentoProfissional.findMany({ where: { clienteId }, select: { textoNormalizado: true } }),
  ]);
  const convenios = [...convConsulta, ...convCirurgia];
  const profissionais = [...profConsulta, ...profCirurgia];

  // Já mapeado como PARTICULAR também tem `operadoraId` nulo — e não é pendência. Por isso a
  // exclusão olha a existência do mapeamento, nunca a ausência de operadora.
  const conhecidosConv = new Set(jaLigadoConv.map((m) => m.textoNormalizado));
  const conhecidosProf = new Set(jaLigadoProf.map((m) => m.textoNormalizado));

  // Textos diferentes que normalizam igual viram UMA pendência só — senão a pessoa ligaria o
  // mesmo convênio duas vezes (`Cassi` e `CASSI`).
  const conv = new Map<string, { textoBruto: string; atendimentos: number }>();
  for (const g of convenios) {
    const chave = chaveDoConvenio(g.convenioBruto);
    if (conhecidosConv.has(chave)) continue;
    const atual = conv.get(chave);
    if (atual) atual.atendimentos += g._count._all;
    else conv.set(chave, { textoBruto: g.convenioBruto, atendimentos: g._count._all });
  }

  const prof = new Map<string, { textoBruto: string; atendimentos: number }>();
  for (const g of profissionais) {
    const chave = chaveDoProfissional(g.profissionalBruto);
    if (conhecidosProf.has(chave)) continue;
    const atual = prof.get(chave);
    if (atual) atual.atendimentos += g._count._all;
    else prof.set(chave, { textoBruto: g.profissionalBruto, atendimentos: g._count._all });
  }

  return {
    convenios: [...conv.values()].sort((a, b) => b.atendimentos - a.atendimentos),
    profissionais: [...prof.values()].sort((a, b) => b.atendimentos - a.atendimentos),
  };
}
