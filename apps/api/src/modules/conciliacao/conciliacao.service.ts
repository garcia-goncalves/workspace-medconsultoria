import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import { isConciliacaoEnabled } from "../../config.js";
import { hashBytes } from "../../lib/hash.js";
import { apelidoCpf, cifrarDadoPaciente } from "../../lib/cripto-paciente.js";
import { ErroDePlanilha, lerGrade, normalizarTexto, type Formato } from "./planilha/index.js";
import {
  chaveDoConvenio,
  chaveDoProfissional,
  ErroDeLeitura,
  interpretarProducaoConsultas,
  type LinhaProducao,
  type ProblemaDeLinha,
} from "./producao-consultas.js";

/**
 * CONCILIAÇÃO — Fase 1: pôr a produção de consultas dentro do sistema.
 *
 * Spec: `docs/superpowers/specs/2026-09-11-conciliacao-producao-design.md`.
 *
 * ⚠️ **Nada que sai daqui carrega CPF, telefone ou e-mail do paciente.** Os tipos de retorno
 * simplesmente não têm esses campos — não é filtro, é ausência. O dado entra cifrado no banco e
 * fica lá (spec §5). Há um teste que varre o retorno atrás dessas chaves: regressão ali é
 * vazamento, não defeito de tela.
 */

/** Quantas linhas a pré-visualização mostra. O suficiente para conferir, longe de virar despejo. */
const LINHAS_NA_PREVIA = 20;

/** Uma linha como a tela pode vê-la. Repare no que NÃO existe aqui. */
export interface LinhaVisivel {
  linha: number;
  dataAgenda: string | null;
  dataAtendimento: string;
  competencia: string;
  pacienteNome: string;
  tipoAtendimento: string;
  tipoAtendimentoBruto: string;
  convenioBruto: string;
  profissionalBruto: string;
}

export interface PreviaImportacao {
  formato: Formato;
  cabecalhoNaLinha: number;
  /** A competência com mais atendimentos — o que a tela sugere no seletor. */
  competenciaSugerida: string | null;
  /** Todas as competências vistas, com quantas linhas cada uma. */
  porCompetencia: { competencia: string; linhas: number }[];
  totalLinhas: number;
  ignoradas: ProblemaDeLinha[];
  colunasAusentes: string[];
  amostra: LinhaVisivel[];
  /** Textos de convênio que ainda não têm de-para. */
  conveniosNovos: string[];
  /** Nomes de profissional sem de-para e sem casamento automático. */
  profissionaisNovos: string[];
  /** Preenchido quando ESTE arquivo (mesmo hash) já entrou. */
  jaImportado: { competencia: string; em: Date } | null;
}

export interface ResultadoImportacao {
  loteId: string;
  competencia: string;
  linhasLidas: number;
  linhasImportadas: number;
  linhasIgnoradas: number;
  /** Linhas de OUTROS meses que estavam no arquivo e não entraram. */
  foraDaCompetencia: { competencia: string; linhas: number }[];
  substituiuLoteId: string | null;
  conveniosNovos: string[];
  profissionaisNovos: string[];
  profissionaisLigadosAutomaticamente: number;
}

export function exigirModuloLigado(): void {
  if (isConciliacaoEnabled) return;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "O módulo de Conciliação está desligado: falta a PACIENTE_CRYPTO_KEY no .env do servidor. " +
      "Sem ela, o dado do paciente entraria no banco sem cifra — e isso não é permitido.",
  });
}

/** Lê e interpreta, traduzindo as duas falhas conhecidas para recado de tela. */
async function lerEInterpretar(bytes: Buffer) {
  try {
    const grade = await lerGrade(bytes);
    return { grade, leitura: interpretarProducaoConsultas(grade) };
  } catch (e) {
    if (e instanceof ErroDePlanilha || e instanceof ErroDeLeitura) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    }
    throw e;
  }
}

function paraVisivel(l: LinhaProducao): LinhaVisivel {
  return {
    linha: l.linha,
    dataAgenda: l.dataAgenda ? l.dataAgenda.toISOString().slice(0, 10) : null,
    dataAtendimento: l.dataAtendimento.toISOString().slice(0, 10),
    competencia: l.competencia,
    pacienteNome: l.pacienteNome,
    tipoAtendimento: l.tipoAtendimento,
    tipoAtendimentoBruto: l.tipoAtendimentoBruto,
    convenioBruto: l.convenioBruto,
    profissionalBruto: l.profissionalBruto,
  };
}

function contarPorCompetencia(linhas: LinhaProducao[]): { competencia: string; linhas: number }[] {
  const mapa = new Map<string, number>();
  for (const l of linhas) mapa.set(l.competencia, (mapa.get(l.competencia) ?? 0) + 1);
  return [...mapa.entries()]
    .map(([competencia, n]) => ({ competencia, linhas: n }))
    .sort((a, b) => b.linhas - a.linhas || a.competencia.localeCompare(b.competencia));
}

/** O de-para já existente do cliente, indexado pela chave normalizada. */
export async function carregarDePara(clienteId: string) {
  const [convenios, profissionais, cadastrados] = await Promise.all([
    prisma.mapeamentoConvenio.findMany({ where: { clienteId } }),
    prisma.mapeamentoProfissional.findMany({ where: { clienteId } }),
    prisma.profissional.findMany({ where: { clienteId, ativo: true }, select: { id: true, nome: true } }),
  ]);

  const porConvenio = new Map(convenios.map((m) => [m.textoNormalizado, m]));
  const porProfissional = new Map(profissionais.map((m) => [m.textoNormalizado, m]));

  // Índice para o casamento automático por nome. Nome repetido no cadastro vira `null`: casar
  // seria escolher no chute a quem atribuir a produção, e produção no médico errado é pior que
  // produção sem médico.
  const porNome = new Map<string, string | null>();
  for (const p of cadastrados) {
    const chave = chaveDoProfissional(p.nome);
    porNome.set(chave, porNome.has(chave) ? null : p.id);
  }

  return { porConvenio, porProfissional, porNome };
}

export async function previsualizarImportacao(entrada: { clienteId: string; bytes: Buffer }): Promise<PreviaImportacao> {
  exigirModuloLigado();
  const { grade, leitura } = await lerEInterpretar(entrada.bytes);
  const dePara = await carregarDePara(entrada.clienteId);

  // Indexados pela chave NORMALIZADA: `PORTO SEGURO - BÁSICO` e `porto seguro - básico` são o
  // mesmo convênio, e listá-los duas vezes faria a pessoa ligar o mesmo de-para duas vezes — que
  // é justamente o que esta tabela existe para evitar. O valor guardado é o 1º texto cru visto.
  const conveniosNovos = new Map<string, string>();
  const profissionaisNovos = new Map<string, string>();
  for (const l of leitura.linhas) {
    const chaveConv = chaveDoConvenio(l.convenioBruto);
    if (l.convenioBruto && !dePara.porConvenio.has(chaveConv) && !conveniosNovos.has(chaveConv)) {
      conveniosNovos.set(chaveConv, l.convenioBruto);
    }
    const chave = chaveDoProfissional(l.profissionalBruto);
    if (l.profissionalBruto && !dePara.porProfissional.has(chave) && !dePara.porNome.get(chave) && !profissionaisNovos.has(chave)) {
      profissionaisNovos.set(chave, l.profissionalBruto);
    }
  }

  const lote = await prisma.producaoLote.findFirst({
    where: { clienteId: entrada.clienteId, origem: "CONSULTAS_NUVENS", hashArquivo: hashBytes(entrada.bytes) },
    orderBy: { createdAt: "desc" },
    select: { competencia: true, createdAt: true },
  });

  const porCompetencia = contarPorCompetencia(leitura.linhas);

  return {
    formato: grade.formato,
    cabecalhoNaLinha: leitura.cabecalhoNaLinha,
    competenciaSugerida: porCompetencia[0]?.competencia ?? null,
    porCompetencia,
    totalLinhas: leitura.linhas.length,
    ignoradas: leitura.ignoradas,
    colunasAusentes: leitura.colunasAusentes,
    amostra: leitura.linhas.slice(0, LINHAS_NA_PREVIA).map(paraVisivel),
    conveniosNovos: [...conveniosNovos.values()].sort(),
    profissionaisNovos: [...profissionaisNovos.values()].sort(),
    jaImportado: lote ? { competencia: lote.competencia, em: lote.createdAt } : null,
  };
}

export async function importarProducao(entrada: {
  clienteId: string;
  competencia: string;
  bytes: Buffer;
  nomeArquivo: string;
  arquivoId?: string | null;
  usuarioId: string;
  /** Sem isto, encontrar um lote vigente no mês é CONFLITO — a tela pergunta antes. */
  substituir?: boolean;
}): Promise<ResultadoImportacao> {
  exigirModuloLigado();

  const hashArquivo = hashBytes(entrada.bytes);
  const { grade, leitura } = await lerEInterpretar(entrada.bytes);

  // 1) Este arquivo exato já entrou? Reimportar duplicaria o mês sem ninguém perceber.
  const mesmoArquivo = await prisma.producaoLote.findFirst({
    where: {
      clienteId: entrada.clienteId,
      origem: "CONSULTAS_NUVENS",
      hashArquivo,
      status: { in: ["IMPORTADO", "PROCESSANDO"] },
    },
    select: { competencia: true, createdAt: true },
  });
  if (mesmoArquivo) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        `Este arquivo já foi importado em ${mesmoArquivo.createdAt.toLocaleDateString("pt-BR")} ` +
        `(competência ${mesmoArquivo.competencia}). Nada foi alterado.`,
    });
  }

  // 2) Só entram as linhas do mês escolhido. As de outros meses são REPORTADAS, não descartadas
  //    em silêncio: importá-las aqui as duplicaria quando o mês delas chegasse.
  const doMes = leitura.linhas.filter((l) => l.competencia === entrada.competencia);
  const foraDaCompetencia = contarPorCompetencia(leitura.linhas.filter((l) => l.competencia !== entrada.competencia));

  if (doMes.length === 0) {
    const vistas = leitura.competencias.join(", ") || "nenhuma";
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Nenhum atendimento de ${entrada.competencia} neste arquivo. ` + `As competências encontradas foram: ${vistas}.`,
    });
  }

  // 3) Já existe lote vigente para este mês?
  const vigente = await prisma.producaoLote.findFirst({
    where: { clienteId: entrada.clienteId, origem: "CONSULTAS_NUVENS", competenciaVigente: entrada.competencia },
    select: { id: true, createdAt: true, linhasImportadas: true },
  });
  if (vigente && !entrada.substituir) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        `A competência ${entrada.competencia} já foi importada em ` +
        `${vigente.createdAt.toLocaleDateString("pt-BR")} (${vigente.linhasImportadas} atendimentos). ` +
        "Confirme a substituição para trocar pelo arquivo novo.",
    });
  }

  // 4) De-para, com casamento automático de profissional por nome.
  const dePara = await carregarDePara(entrada.clienteId);
  const aLigar = new Map<string, { textoBruto: string; profissionalId: string }>();
  // Ver o comentário em `previsualizarImportacao`: a chave é a normalizada, nunca o texto cru.
  const conveniosNovos = new Map<string, string>();
  const profissionaisNovos = new Map<string, string>();

  for (const l of doMes) {
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

  const resolvido = (l: LinhaProducao) => {
    const conv = dePara.porConvenio.get(chaveDoConvenio(l.convenioBruto));
    const chaveProf = chaveDoProfissional(l.profissionalBruto);
    const prof = dePara.porProfissional.get(chaveProf)?.profissionalId ?? aLigar.get(chaveProf)?.profissionalId ?? null;
    return { operadoraId: conv?.operadoraId ?? null, plano: conv?.plano ?? null, profissionalId: prof };
  };

  // 5) Tudo numa transação: ou o mês inteiro entra, ou nada muda. Um lote pela metade é pior que
  //    nenhum, porque parece completo na tela.
  const loteId = await prisma.$transaction(
    async (tx) => {
      if (vigente) {
        // Tirar o antigo de cena ANTES de criar o novo — é o índice único que exige isso, e é
        // ele que garante que nunca existam dois vigentes no mesmo mês.
        await tx.producaoLote.update({
          where: { id: vigente.id },
          data: { competenciaVigente: null, status: "SUBSTITUIDO", substituidoEm: new Date() },
        });
        // ⚠️ E as LINHAS dele têm de sair. Marcar o lote como substituído não apaga nada sozinho:
        // sem este delete, o mês passa a mostrar a produção velha SOMADA à nova, dobrando a
        // contagem — o defeito que este módulo inteiro existe para evitar. O lote fica (é o
        // histórico de quem importou o quê e quando); o dado, não.
        await tx.producaoConsulta.deleteMany({ where: { loteId: vigente.id } });
      }

      const lote = await tx.producaoLote.create({
        data: {
          clienteId: entrada.clienteId,
          competencia: entrada.competencia,
          competenciaVigente: entrada.competencia,
          origem: "CONSULTAS_NUVENS",
          arquivoId: entrada.arquivoId ?? null,
          nomeArquivo: entrada.nomeArquivo,
          formato: grade.formato,
          hashArquivo,
          status: "IMPORTADO",
          linhasLidas: leitura.linhas.length + leitura.ignoradas.length,
          linhasImportadas: doMes.length,
          linhasIgnoradas: leitura.ignoradas.length,
          importadoPorId: entrada.usuarioId,
        },
        select: { id: true },
      });

      if (vigente) {
        await tx.producaoLote.update({ where: { id: vigente.id }, data: { substituidoPorId: lote.id } });
      }

      for (const [chave, { textoBruto, profissionalId }] of aLigar) {
        await tx.mapeamentoProfissional.create({
          data: { clienteId: entrada.clienteId, textoBruto, textoNormalizado: chave, profissionalId },
        });
      }

      await tx.producaoConsulta.createMany({
        data: doMes.map((l) => {
          const { operadoraId, plano, profissionalId } = resolvido(l);
          return {
            loteId: lote.id,
            clienteId: entrada.clienteId,
            competencia: l.competencia,
            linha: l.linha,
            dataAgenda: l.dataAgenda,
            dataAtendimento: l.dataAtendimento,
            pacienteNome: l.pacienteNome,
            // É AQUI que o dado pessoal deixa de estar em claro, e é o único lugar.
            pacienteCpfCifrado: cifrarDadoPaciente(l.cpf),
            pacienteCpfApelido: apelidoCpf(l.cpf),
            pacienteTelefoneCifrado: cifrarDadoPaciente(l.telefone),
            pacienteEmailCifrado: cifrarDadoPaciente(l.email),
            tipoAtendimento: l.tipoAtendimento,
            tipoAtendimentoBruto: l.tipoAtendimentoBruto,
            convenioBruto: l.convenioBruto,
            operadoraId,
            plano,
            profissionalBruto: l.profissionalBruto,
            profissionalId,
          };
        }),
      });

      return lote.id;
    },
    // Um mês pode ter milhares de linhas; o padrão de 5 s do Prisma não cobre isso.
    { timeout: 120_000, maxWait: 15_000 },
  );

  return {
    loteId,
    competencia: entrada.competencia,
    linhasLidas: leitura.linhas.length + leitura.ignoradas.length,
    linhasImportadas: doMes.length,
    linhasIgnoradas: leitura.ignoradas.length,
    foraDaCompetencia,
    substituiuLoteId: vigente?.id ?? null,
    conveniosNovos: [...conveniosNovos.values()].sort(),
    profissionaisNovos: [...profissionaisNovos.values()].sort(),
    profissionaisLigadosAutomaticamente: aLigar.size,
  };
}

/**
 * Liga um texto de convênio a uma operadora — e **retroage** nas linhas já importadas.
 *
 * A retroação é o ponto: sem ela, ligar o convênio hoje só valeria para o mês que vem, e o
 * histórico ficaria para sempre sem operadora. Ver spec §6.4.
 */
export async function ligarConvenio(entrada: {
  clienteId: string;
  textoBruto: string;
  operadoraId: string | null;
  plano?: string | null;
  particular?: boolean;
}): Promise<{ linhasAtualizadas: number }> {
  const particular = entrada.particular ?? false;
  if (!particular && !entrada.operadoraId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha a operadora, ou marque como particular." });
  }

  const textoNormalizado = chaveDoConvenio(entrada.textoBruto);
  const dados = { operadoraId: particular ? null : entrada.operadoraId, plano: entrada.plano ?? null, particular };

  const { count } = await prisma.$transaction(async (tx) => {
    await tx.mapeamentoConvenio.upsert({
      where: { clienteId_textoNormalizado: { clienteId: entrada.clienteId, textoNormalizado } },
      create: { clienteId: entrada.clienteId, textoBruto: entrada.textoBruto, textoNormalizado, ...dados },
      update: { textoBruto: entrada.textoBruto, ...dados },
    });

    // O `convenioBruto` gravado é o texto CRU, que varia de caixa entre exportações — por isso a
    // retroação casa pela lista de textos crus que normalizam para a mesma chave, e não por
    // igualdade simples. Sem isto, `Cassi` seria atualizado e `CASSI` ficaria para trás.
    // O de-para é o mesmo para consultas e cirurgias, então a retroação alcança as duas.
    const distintos = { where: { clienteId: entrada.clienteId }, select: { convenioBruto: true }, distinct: ["convenioBruto" as const] };
    const deConsulta = await tx.producaoConsulta.findMany(distintos);
    const deCirurgia = await tx.producaoCirurgia.findMany(distintos);
    const equivalentes = [...new Set([...deConsulta, ...deCirurgia].map((d) => d.convenioBruto))].filter(
      (t) => normalizarTexto(t) === textoNormalizado,
    );

    if (equivalentes.length === 0) return { count: 0 };
    const where = { clienteId: entrada.clienteId, convenioBruto: { in: equivalentes } };
    const data = { operadoraId: dados.operadoraId, plano: dados.plano };
    // Em sequência: dentro da transação interativa, uma operação de cada vez na mesma conexão.
    const a = await tx.producaoConsulta.updateMany({ where, data });
    const b = await tx.producaoCirurgia.updateMany({ where, data });
    return { count: a.count + b.count };
  });

  return { linhasAtualizadas: count };
}

/** Liga um nome de profissional do relatório ao cadastro, retroagindo do mesmo jeito. */
export async function ligarProfissional(entrada: {
  clienteId: string;
  textoBruto: string;
  profissionalId: string;
}): Promise<{ linhasAtualizadas: number }> {
  const textoNormalizado = chaveDoProfissional(entrada.textoBruto);

  // Posse: o profissional tem de ser DESTE cliente. Sem isto, um id vindo da tela ligaria a
  // produção de um cliente ao médico de outro.
  const dono = await prisma.profissional.findFirst({
    where: { id: entrada.profissionalId, clienteId: entrada.clienteId },
    select: { id: true },
  });
  if (!dono) throw new TRPCError({ code: "NOT_FOUND", message: "Profissional não encontrado neste cliente." });

  const { count } = await prisma.$transaction(async (tx) => {
    await tx.mapeamentoProfissional.upsert({
      where: { clienteId_textoNormalizado: { clienteId: entrada.clienteId, textoNormalizado } },
      create: {
        clienteId: entrada.clienteId,
        textoBruto: entrada.textoBruto,
        textoNormalizado,
        profissionalId: entrada.profissionalId,
      },
      update: { textoBruto: entrada.textoBruto, profissionalId: entrada.profissionalId },
    });

    const distintos = {
      where: { clienteId: entrada.clienteId },
      select: { profissionalBruto: true },
      distinct: ["profissionalBruto" as const],
    };
    const deConsulta = await tx.producaoConsulta.findMany(distintos);
    const deCirurgia = await tx.producaoCirurgia.findMany(distintos);
    const equivalentes = [...new Set([...deConsulta, ...deCirurgia].map((d) => d.profissionalBruto))].filter(
      (t) => chaveDoProfissional(t) === textoNormalizado,
    );

    if (equivalentes.length === 0) return { count: 0 };
    const where = { clienteId: entrada.clienteId, profissionalBruto: { in: equivalentes } };
    const data = { profissionalId: entrada.profissionalId };
    // Em sequência: dentro da transação interativa, uma operação de cada vez na mesma conexão.
    const a = await tx.producaoConsulta.updateMany({ where, data });
    const b = await tx.producaoCirurgia.updateMany({ where, data });
    return { count: a.count + b.count };
  });

  return { linhasAtualizadas: count };
}
