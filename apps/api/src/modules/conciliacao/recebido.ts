import { localizarCabecalho, normalizarTexto, type Grade } from "./planilha/index.js";
import { ErroDeLeitura, interpretarData, type ProblemaDeLinha } from "./producao-consultas.js";

/**
 * CONCILIAÇÃO — Fase 2b: os dois arquivos que trazem o RECEBIDO. Puros, como os da produção.
 *
 * 1. O repasse do TASY ("Repasses para Terceiros — Pagamentos Realizados"), pelas colunas
 *    registradas na spec da Fase 1 (§4b). Casa com a cirurgia pelo atendimento.
 * 2. A planilha de conciliação preenchida — o MODELO que a equipe preenche fora e devolve.
 *    Casa pelo Nº Cirurgia.
 */

const dia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Texto → reais. `null` = célula vazia (nada a dizer); `undefined` = havia algo, e não é número.
 * A diferença importa: vazio não apaga o que já está gravado; ilegível é reportado, nunca zero.
 */
export function interpretarValor(texto: string, opcoes: { numeroCru?: boolean } = {}): number | null | undefined {
  let s = texto.replace(/R\$/gi, "").replace(/\s/g, "");
  if (s === "" || s === "-") return null;
  // Estorno escrito como contador escreve: "(1.234,56)" ou "1.234,56-". Deixá-lo de fora como
  // ilegível inflaria o recebido pelo valor exato do estorno.
  let sinal = 1;
  const entreParenteses = /^\((.+)\)$/.exec(s);
  if (entreParenteses) {
    s = entreParenteses[1]!;
    sinal = -1;
  } else if (/^[^-].*-$/.test(s)) {
    s = s.slice(0, -1);
    sinal = -1;
  }
  // Célula NUMÉRICA do XLSX chega como o número cru ("250.125"): o ponto é sempre decimal. A
  // regra do milhar abaixo transformaria 250,125 em 250.125 — mil vezes o valor, em silêncio.
  if (opcoes.numeroCru && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) {
    return (sinal * Math.round(Number(s) * 100)) / 100;
  }
  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");
  if (temVirgula && temPonto) {
    // O último separador é o decimal: "1.234,56" (BR) ou "1,234.56" (US).
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (temVirgula) {
    s = s.replace(",", ".");
  } else if (temPonto && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.000" é mil, não um vírgula zero zero zero — planilha brasileira sem centavos.
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return (sinal * Math.round(Number(s) * 100)) / 100;
}

/** O apóstrofo que a exportação põe na frente de `= + - @` (anti-fórmula) não volta para o banco. */
const semProtecaoDeFormula = (s: string) => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);

// ─── 1. Repasse do TASY ─────────────────────────────────────────────────────────────────────────

export const COLUNAS_EXIGIDAS_REPASSE = ["Atend", "Vl Repasse"] as const;
export const COLUNAS_OPCIONAIS_REPASSE = [
  "Convênio",
  "Medico Executor",
  "Dt Item",
  "Código",
  "Descrição",
  "Data Pagamento",
  "Repasse",
] as const;

export interface LinhaRepasse {
  linha: number;
  repasseNumero: string | null;
  /** Nulo em incremento/acordo — linha válida, que vira "recebido sem produção". */
  atendimento: string | null;
  convenioBruto: string;
  executor: string;
  codigo: string | null;
  descricao: string | null;
  dataItem: Date | null;
  dataPagamento: Date | null;
  valor: number;
}

export interface LeituraDoRepasse {
  cabecalhoNaLinha: number;
  linhas: LinhaRepasse[];
  ignoradas: ProblemaDeLinha[];
  colunasAusentes: string[];
  periodoPagamento: { inicio: string; fim: string } | null;
}

/** Linha de total/rodapé do relatório — não é pagamento, é soma de pagamentos. */
const EH_TOTAL = /^(valor liquido|imposto retido|total)/;

export function interpretarRepasse(grade: Grade): LeituraDoRepasse {
  const cab = localizarCabecalho(grade.linhas, COLUNAS_EXIGIDAS_REPASSE, { opcionais: COLUNAS_OPCIONAIS_REPASSE });
  if (!cab) {
    throw new ErroDeLeitura(
      "Não reconheci este arquivo como o relatório de repasse do TASY. " +
        `Ele precisa ter as colunas: ${COLUNAS_EXIGIDAS_REPASSE.join(", ")}.`,
    );
  }
  const col = (nome: string, c: string[]) => {
    const i = cab.colunas.get(nome);
    return i === undefined ? "" : (c[i] ?? "").trim();
  };

  const linhas: LinhaRepasse[] = [];
  const ignoradas: ProblemaDeLinha[] = [];
  let repasseAtual: string | null = null;
  let inicio: Date | null = null;
  let fim: Date | null = null;

  for (let i = cab.indice + 1; i < grade.linhas.length; i++) {
    const c = grade.linhas[i]!;
    const numero = i + 1;
    const cheias = c.map((x) => x.trim()).filter(Boolean);
    if (cheias.length === 0) continue;

    // O relatório agrupa por "Repasse: 179978" numa linha própria — ela nomeia as seguintes.
    const grupo = /^repasse:?\s*(\d+)/i.exec(cheias[0]!);
    if (grupo) {
      repasseAtual = grupo[1]!;
      continue;
    }
    // Linha de total não é pagamento — mas é REPORTADA: uma descrição legítima que comece com
    // "Total…" não pode sumir sem ninguém ver.
    if (cheias.some((x) => EH_TOTAL.test(normalizarTexto(x)))) {
      ignoradas.push({ linha: numero, motivo: "Linha de total/rodapé do relatório — não é um pagamento." });
      continue;
    }

    const bruto = col("Vl Repasse", c);
    const valor = interpretarValor(bruto, { numeroCru: grade.formato === "xlsx" });
    if (valor === null) {
      ignoradas.push({ linha: numero, motivo: "Sem valor de repasse." });
      continue;
    }
    if (valor === undefined) {
      ignoradas.push({ linha: numero, motivo: `Valor de repasse não reconhecido: "${bruto}".` });
      continue;
    }

    const atend = col("Atend", c).replace(/\D/g, "");
    const codigo = col("Código", c);
    const dataPagamento = interpretarData(col("Data Pagamento", c));
    if (dataPagamento) {
      if (!inicio || dataPagamento < inicio) inicio = dataPagamento;
      if (!fim || dataPagamento > fim) fim = dataPagamento;
    }

    linhas.push({
      linha: numero,
      repasseNumero: col("Repasse", c) || repasseAtual,
      atendimento: atend && !/^0+$/.test(atend) ? atend.slice(0, 20) : null,
      convenioBruto: col("Convênio", c).slice(0, 191),
      executor: col("Medico Executor", c).slice(0, 191),
      codigo: codigo && !/^0+$/.test(codigo) ? codigo.slice(0, 40) : null,
      descricao: col("Descrição", c).slice(0, 255) || null,
      dataItem: interpretarData(col("Dt Item", c)),
      dataPagamento,
      valor,
    });
  }

  return {
    cabecalhoNaLinha: cab.indice + 1,
    linhas,
    ignoradas,
    colunasAusentes: COLUNAS_OPCIONAIS_REPASSE.filter((n) => !cab.colunas.has(n)),
    periodoPagamento: inicio && fim ? { inicio: dia(inicio), fim: dia(fim) } : null,
  };
}

// ─── 2. A planilha de conciliação preenchida ────────────────────────────────────────────────────

const COL_CODIGO = "Cód. Procedimento (De-Para)";
const COL_COBRADO = "Valor cobrado (R$)";
const COL_RECEBIDO = "Valor recebido (R$)";
const COL_PAGAMENTO = "Data pagamento";
const COL_STATUS = "Status conciliação";
const COL_OBS = "Observação";

export const COLUNAS_DA_PLANILHA = [COL_CODIGO, COL_COBRADO, COL_RECEBIDO, COL_PAGAMENTO, COL_STATUS, COL_OBS] as const;

/** O que a linha DIZ. `undefined` = célula vazia = não mexer no que está gravado. */
export interface LinhaPlanilha {
  linha: number;
  numeroCirurgia: string;
  codigoProcedimento?: string;
  valorCobrado?: number;
  valorRecebido?: number;
  dataPagamento?: Date;
  naoCobrar?: true;
  observacao?: string;
}

export interface LeituraDaPlanilha {
  linhas: LinhaPlanilha[];
  ignoradas: ProblemaDeLinha[];
  /** Linhas sem nada preenchido nas colunas de conciliação. */
  semAlteracao: number;
}

export function interpretarPlanilhaConciliacao(grade: Grade): LeituraDaPlanilha {
  const cab = localizarCabecalho(grade.linhas, ["Nº Cirurgia"], { opcionais: COLUNAS_DA_PLANILHA });
  // Sem nenhuma coluna de conciliação, é o mapa cirúrgico cru (que também tem "Nº Cirurgia") —
  // importá-lo aqui não mudaria nada e ainda diria "importado".
  if (!cab || !COLUNAS_DA_PLANILHA.some((n) => cab.colunas.has(n))) {
    throw new ErroDeLeitura(
      "Não reconheci este arquivo como a planilha de conciliação. Use a planilha exportada pelo " +
        `sistema — ela tem "Nº Cirurgia" e as colunas ${COLUNAS_DA_PLANILHA.join(", ")}.`,
    );
  }
  const col = (nome: string, c: string[]) => {
    const i = cab.colunas.get(nome);
    return i === undefined ? "" : (c[i] ?? "").trim();
  };

  const linhas: LinhaPlanilha[] = [];
  const ignoradas: ProblemaDeLinha[] = [];
  let semAlteracao = 0;

  for (let i = cab.indice + 1; i < grade.linhas.length; i++) {
    const c = grade.linhas[i]!;
    const numero = i + 1;
    if (c.every((x) => x.trim() === "")) continue;
    const numeroCirurgia = col("Nº Cirurgia", c);
    if (!numeroCirurgia) {
      ignoradas.push({ linha: numero, motivo: "Sem número da cirurgia." });
      continue;
    }

    const saida: LinhaPlanilha = { linha: numero, numeroCirurgia };
    const problemas: string[] = [];

    const codigo = semProtecaoDeFormula(col(COL_CODIGO, c));
    if (codigo) saida.codigoProcedimento = codigo.slice(0, 40);

    for (const [coluna, campo] of [
      [COL_COBRADO, "valorCobrado"],
      [COL_RECEBIDO, "valorRecebido"],
    ] as const) {
      const bruto = col(coluna, c);
      const v = interpretarValor(bruto, { numeroCru: grade.formato === "xlsx" });
      if (v === undefined) problemas.push(`${coluna} não reconhecido: "${bruto}"`);
      else if (v !== null) saida[campo] = v;
    }

    const pagamento = col(COL_PAGAMENTO, c);
    if (pagamento) {
      const d = interpretarData(pagamento);
      if (d) saida.dataPagamento = d;
      else problemas.push(`${COL_PAGAMENTO} não reconhecida: "${pagamento}"`);
    }

    if (normalizarTexto(col(COL_STATUS, c)).startsWith("nao cobr")) saida.naoCobrar = true;
    const obs = semProtecaoDeFormula(col(COL_OBS, c));
    if (obs) saida.observacao = obs.slice(0, 2000);

    if (problemas.length > 0) {
      ignoradas.push({ linha: numero, motivo: problemas.join("; ") + "." });
      continue;
    }
    if (Object.keys(saida).length === 2) {
      semAlteracao++;
      continue;
    }
    linhas.push(saida);
  }

  return { linhas, ignoradas, semAlteracao };
}
