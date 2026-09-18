import { localizarCabecalho, normalizarTexto, type Grade } from "./planilha/index.js";
import { competenciaDe, ErroDeLeitura, interpretarData, type ProblemaDeLinha } from "./producao-consultas.js";

/**
 * Traduz a grade crua do MAPA CIRÚRGICO do TASY para o domínio. Pura, como a das consultas.
 *
 * Colunas conforme o arquivo real (18/09/2026, cliente Sergio Almeida). Ver
 * `docs/superpowers/specs/2026-09-18-conciliacao-cirurgias-tasy-design.md`.
 *
 * ⚠️ `Prontuário`, `Cód Pessoa` e `Unid. Internação` **não são lidos de propósito** (spec §2.3):
 * o que não é lido não tem como ser gravado nem vazar.
 */

export type CategoriaConvenio = "PARTICULAR" | "CONVENIO" | "SUS" | "AUTOGESTAO" | "OUTRO";
export type StatusCirurgia = "EXECUTADA" | "RESERVADA" | "OUTRO";
export type AutorizacaoCirurgia = "AUTORIZADO" | "PARCIAL" | "PENDENTE" | "NAO_NECESSITA" | "OUTRO";

/** Sem estas não é o mapa cirúrgico — e importar seria inventar. */
export const COLUNAS_EXIGIDAS_CIRURGIA = [
  "Data",
  "Paciente",
  "Atendimento",
  "Nº Cirurgia",
  "Convênio",
  "Médico",
  "Procedimento",
  "Status",
] as const;

/** Tamanho das colunas `numeroCirurgia` e `atendimento` no banco. */
const TAMANHO_DA_CHAVE = 20;

export const COLUNAS_OPCIONAIS_CIRURGIA = [
  "Hora (UTC)",
  "Tipo Conv",
  "Anestesista",
  "Autorização",
  "Cód Aut",
  "OPME",
  "Tempo (min)",
] as const;

export interface LinhaCirurgia {
  /** Número da linha NO ARQUIVO (1-based). */
  linha: number;
  numeroCirurgia: string;
  /** Nulo é estado válido e conhecido: sem ele a cirurgia não casa com o repasse (spec §2.4). */
  atendimento: string | null;
  dataCirurgia: Date;
  inicioEm: Date | null;
  competencia: string;
  pacienteNome: string;
  procedimento: string;
  status: StatusCirurgia;
  statusBruto: string;
  autorizacao: AutorizacaoCirurgia;
  autorizacaoBruto: string;
  categoriaConvenio: CategoriaConvenio;
  tipoConvenioBruto: string | null;
  convenioBruto: string;
  profissionalBruto: string;
  anestesista: string | null;
  opme: boolean | null;
  tempoMinutos: number | null;
}

export interface LeituraDasCirurgias {
  cabecalhoNaLinha: number;
  linhas: LinhaCirurgia[];
  ignoradas: ProblemaDeLinha[];
  colunasAusentes: string[];
  /** Primeira e última data de cirurgia do arquivo — o período que ele cobre. */
  periodo: { inicio: Date; fim: Date } | null;
}

export function interpretarMapaCirurgico(grade: Grade): LeituraDasCirurgias {
  const cabecalho = localizarCabecalho(grade.linhas, COLUNAS_EXIGIDAS_CIRURGIA, { opcionais: COLUNAS_OPCIONAIS_CIRURGIA });
  if (!cabecalho) {
    throw new ErroDeLeitura(
      "Não reconheci este arquivo como o mapa cirúrgico do TASY. " + `Ele precisa ter as colunas: ${COLUNAS_EXIGIDAS_CIRURGIA.join(", ")}.`,
    );
  }

  const coluna = (nome: string, celulas: string[]): string => {
    const i = cabecalho.colunas.get(nome);
    return i === undefined ? "" : (celulas[i] ?? "").trim();
  };

  const linhas: LinhaCirurgia[] = [];
  const ignoradas: ProblemaDeLinha[] = [];
  const vistas = new Map<string, number>();
  let inicio: Date | null = null;
  let fim: Date | null = null;

  for (let i = cabecalho.indice + 1; i < grade.linhas.length; i++) {
    const celulas = grade.linhas[i]!;
    const numeroDaLinha = i + 1;
    if (celulas.every((c) => c.trim() === "")) continue;

    const numeroCirurgia = coluna("Nº Cirurgia", celulas);
    const dataBruta = coluna("Data", celulas);
    const pacienteNome = coluna("Paciente", celulas);

    // Rodapé de total: sem número, sem data e sem paciente. Não é erro.
    if (!numeroCirurgia && !dataBruta && !pacienteNome) continue;

    if (!numeroCirurgia) {
      ignoradas.push({ linha: numeroDaLinha, motivo: "Sem número da cirurgia." });
      continue;
    }
    // As duas colunas são chave (VARCHAR 20). Valor maior não é número do TASY — e gravá-lo
    // derrubaria a importação inteira sem dizer a linha.
    const atendimentoBruto = coluna("Atendimento", celulas);
    if (numeroCirurgia.length > TAMANHO_DA_CHAVE || atendimentoBruto.length > TAMANHO_DA_CHAVE) {
      ignoradas.push({ linha: numeroDaLinha, motivo: "Número da cirurgia ou do atendimento longo demais — não parece vir do TASY." });
      continue;
    }
    const dataCirurgia = interpretarData(dataBruta);
    if (!dataCirurgia) {
      ignoradas.push({ linha: numeroDaLinha, motivo: dataBruta ? `Data não reconhecida: "${dataBruta}".` : "Sem data da cirurgia." });
      continue;
    }
    if (!pacienteNome) {
      ignoradas.push({ linha: numeroDaLinha, motivo: "Sem nome do paciente." });
      continue;
    }
    // A mesma cirurgia duas vezes no arquivo gravaria uma por cima da outra sem ninguém saber qual
    // venceu. A primeira fica; a repetição é reportada.
    const anterior = vistas.get(numeroCirurgia);
    if (anterior !== undefined) {
      ignoradas.push({ linha: numeroDaLinha, motivo: `Cirurgia ${numeroCirurgia} repetida (já lida na linha ${anterior}).` });
      continue;
    }
    vistas.set(numeroCirurgia, numeroDaLinha);

    if (!inicio || dataCirurgia < inicio) inicio = dataCirurgia;
    if (!fim || dataCirurgia > fim) fim = dataCirurgia;

    const statusBruto = coluna("Status", celulas);
    const autorizacaoBruto = coluna("Autorização", celulas);
    const tipoConvenioBruto = vazioViraNulo(coluna("Tipo Conv", celulas));

    linhas.push({
      linha: numeroDaLinha,
      numeroCirurgia,
      atendimento: vazioViraNulo(atendimentoBruto),
      dataCirurgia,
      inicioEm: interpretarInstante(coluna("Hora (UTC)", celulas)),
      competencia: competenciaDe(dataCirurgia),
      pacienteNome,
      procedimento: coluna("Procedimento", celulas),
      status: interpretarStatus(statusBruto),
      statusBruto,
      autorizacao: interpretarAutorizacao(coluna("Cód Aut", celulas), autorizacaoBruto),
      autorizacaoBruto,
      categoriaConvenio: interpretarCategoria(tipoConvenioBruto),
      tipoConvenioBruto,
      convenioBruto: coluna("Convênio", celulas),
      profissionalBruto: coluna("Médico", celulas),
      anestesista: vazioViraNulo(coluna("Anestesista", celulas)),
      opme: interpretarOpme(coluna("OPME", celulas)),
      tempoMinutos: interpretarMinutos(coluna("Tempo (min)", celulas)),
    });
  }

  return {
    cabecalhoNaLinha: cabecalho.indice + 1,
    linhas,
    ignoradas,
    colunasAusentes: COLUNAS_OPCIONAIS_CIRURGIA.filter((c) => !cabecalho.colunas.has(c)),
    periodo: inicio && fim ? { inicio, fim } : null,
  };
}

function vazioViraNulo(s: string): string | null {
  return s.trim() === "" ? null : s.trim();
}

/** `2025-09-18T10:00:00Z`. Só aceita instante com fuso explícito — sem ele, a hora é ambígua. */
export function interpretarInstante(texto: string): Date | null {
  const s = texto.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function interpretarStatus(bruto: string): StatusCirurgia {
  const t = normalizarTexto(bruto);
  if (t.startsWith("executad")) return "EXECUTADA";
  if (t.startsWith("reservad")) return "RESERVADA";
  return "OUTRO";
}

/**
 * O código é a fonte: o texto varia com o idioma e a versão do TASY. O texto só decide quando o
 * código não veio ou é desconhecido.
 */
export function interpretarAutorizacao(codigo: string, texto: string): AutorizacaoCirurgia {
  const c = codigo.trim().toUpperCase();
  if (c === "A") return "AUTORIZADO";
  if (c === "PZ") return "PARCIAL";
  if (c === "PA") return "PENDENTE";
  if (c === "NN") return "NAO_NECESSITA";

  const t = normalizarTexto(texto);
  if (t.startsWith("parcialmente")) return "PARCIAL";
  if (t.startsWith("pendente")) return "PENDENTE";
  if (t.startsWith("nao necessita")) return "NAO_NECESSITA";
  if (t.startsWith("autorizad")) return "AUTORIZADO";
  return "OUTRO";
}

/** Códigos do TASY, conferidos contra os convênios reais de cada um (spec §2.6). */
export function interpretarCategoria(codigo: string | null): CategoriaConvenio {
  switch ((codigo ?? "").trim()) {
    case "1":
      return "PARTICULAR";
    case "2":
      return "CONVENIO";
    case "3":
      return "SUS";
    case "6":
      return "AUTOGESTAO";
    default:
      return "OUTRO";
  }
}

export function interpretarOpme(bruto: string): boolean | null {
  const t = normalizarTexto(bruto);
  if (t === "com opme") return true;
  if (t === "sem opme") return false;
  return null;
}

export function interpretarMinutos(bruto: string): number | null {
  const s = bruto.trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  return Number(s);
}
