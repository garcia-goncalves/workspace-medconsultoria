import { localizarCabecalho, normalizarTexto, type Grade } from "./planilha/index.js";

/**
 * Traduz a grade crua do relatório de produção de consultas para o domínio.
 *
 * Função PURA de propósito: não toca banco e não cifra nada. Quem cifra é o serviço, com a chave
 * do paciente — assim este arquivo se testa inteiro sem MySQL e sem `PACIENTE_CRYPTO_KEY`, e o
 * CPF que sai daqui está em claro por um instante só, dentro do processo, até o serviço guardá-lo.
 *
 * Colunas conforme o arquivo real (print de 11/09/2026). Ver spec §4.
 */

/** Espelha o enum `TipoAtendimento` do Prisma. Local para o módulo não depender de `@app/db`. */
export type TipoAtendimento = "CONSULTA" | "CORTESIA" | "SEM_VINCULO_AGENDA" | "OUTRO";

/**
 * Sem estas cinco não há relatório de produção — se faltar uma, o arquivo é outro documento e
 * importar seria inventar. As demais são bem-vindas mas não obrigatórias (ver `COLUNAS_OPCIONAIS`).
 */
export const COLUNAS_EXIGIDAS = ["Data do atendimento", "Paciente", "Tipo de atendimento", "Plano de convênio", "Profissional"] as const;

/**
 * Faltando qualquer uma destas, a importação segue e a tela avisa o que não veio. `Data da agenda`
 * é opcional porque o próprio arquivo a deixa vazia; as três de dado pessoal, porque um dia o
 * cliente pode simplesmente parar de exportá-las — e isso não deve travar o mês.
 */
export const COLUNAS_OPCIONAIS = ["Data da agenda", "CPF do paciente", "Telefone do Paciente", "E-mail"] as const;

export interface LinhaProducao {
  /** Número da linha NO ARQUIVO (1-based) — é o que a tela mostra para a pessoa conferir. */
  linha: number;
  dataAgenda: Date | null;
  dataAtendimento: Date;
  /** `AAAA-MM` derivada do atendimento. */
  competencia: string;
  pacienteNome: string;
  /** Em claro — o serviço cifra. Ver o cabeçalho deste arquivo. */
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  tipoAtendimento: TipoAtendimento;
  tipoAtendimentoBruto: string;
  convenioBruto: string;
  profissionalBruto: string;
}

export interface ProblemaDeLinha {
  linha: number;
  motivo: string;
}

export interface LeituraDaProducao {
  /** 1-based, como a pessoa vê na planilha. */
  cabecalhoNaLinha: number;
  linhas: LinhaProducao[];
  /** Linhas que não viraram produção, com o porquê em português. */
  ignoradas: ProblemaDeLinha[];
  /** Colunas opcionais que o arquivo não trouxe — a tela avisa, mas não impede. */
  colunasAusentes: string[];
  /** Competências encontradas nos atendimentos (normalmente uma só). */
  competencias: string[];
}

export class ErroDeLeitura extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeLeitura";
  }
}

export function interpretarProducaoConsultas(grade: Grade): LeituraDaProducao {
  const cabecalho = localizarCabecalho(grade.linhas, COLUNAS_EXIGIDAS, { opcionais: COLUNAS_OPCIONAIS });
  if (!cabecalho) {
    throw new ErroDeLeitura(
      "Não reconheci este arquivo como o relatório de produção de consultas. " +
        `Ele precisa ter as colunas: ${COLUNAS_EXIGIDAS.join(", ")}.`,
    );
  }

  const coluna = (nome: string, celulas: string[]): string => {
    const i = cabecalho.colunas.get(nome);
    return i === undefined ? "" : (celulas[i] ?? "").trim();
  };

  const linhas: LinhaProducao[] = [];
  const ignoradas: ProblemaDeLinha[] = [];
  const competencias = new Set<string>();

  for (let i = cabecalho.indice + 1; i < grade.linhas.length; i++) {
    const celulas = grade.linhas[i]!;
    const numeroDaLinha = i + 1; // 1-based, como na planilha

    // Linha em branco no meio do relatório é separador de bloco, não erro — não polui a lista.
    if (celulas.every((c) => c.trim() === "")) continue;

    const pacienteNome = coluna("Paciente", celulas);
    const atendimentoBruto = coluna("Data do atendimento", celulas);

    // Rodapé do tipo "Total: 132 atendimentos" cai aqui: sem data e sem paciente. Não é erro.
    if (!pacienteNome && !atendimentoBruto) continue;

    const dataAtendimento = interpretarData(atendimentoBruto);
    if (!dataAtendimento) {
      ignoradas.push({
        linha: numeroDaLinha,
        motivo: atendimentoBruto ? `Data do atendimento não reconhecida: "${atendimentoBruto}".` : "Sem data do atendimento.",
      });
      continue;
    }
    if (!pacienteNome) {
      ignoradas.push({ linha: numeroDaLinha, motivo: "Sem nome do paciente." });
      continue;
    }

    const tipoBruto = coluna("Tipo de atendimento", celulas);
    const competencia = competenciaDe(dataAtendimento);
    competencias.add(competencia);

    linhas.push({
      linha: numeroDaLinha,
      dataAgenda: interpretarData(coluna("Data da agenda", celulas)),
      dataAtendimento,
      competencia,
      pacienteNome,
      cpf: vazioViraNulo(coluna("CPF do paciente", celulas)),
      telefone: vazioViraNulo(coluna("Telefone do Paciente", celulas)),
      email: vazioViraNulo(coluna("E-mail", celulas)),
      tipoAtendimento: interpretarTipo(tipoBruto),
      tipoAtendimentoBruto: tipoBruto,
      convenioBruto: coluna("Plano de convênio", celulas),
      profissionalBruto: coluna("Profissional", celulas),
    });
  }

  return {
    cabecalhoNaLinha: cabecalho.indice + 1,
    linhas,
    ignoradas,
    colunasAusentes: COLUNAS_OPCIONAIS.filter((c) => !cabecalho.colunas.has(c)),
    competencias: [...competencias].sort(),
  };
}

function vazioViraNulo(s: string): string | null {
  return s.trim() === "" ? null : s.trim();
}

/** `AAAA-MM` a partir de uma data em UTC. */
export function competenciaDe(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Texto → data, **sempre em UTC à meia-noite**.
 *
 * ⚠️ `new Date(2026, 7, 31)` seria meia-noite LOCAL, o que em Brasília é 03:00Z e, relido como
 * dia, pode escorregar. Por isso a construção é `Date.UTC`, explícita — a mesma disciplina do
 * leitor de planilha.
 *
 * Aceita `dd/mm/aaaa` (o do arquivo), `dd/mm/aa` e `aaaa-mm-dd`. Hora, se vier junto, é ignorada:
 * aqui é dia.
 */
export function interpretarData(texto: string): Date | null {
  const s = texto.trim();
  if (!s) return null;

  const soData = s.split(" ")[0]!;

  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(soData);
  if (br) {
    const dia = Number(br[1]);
    const mes = Number(br[2]);
    let ano = Number(br[3]);
    // Ano com 2 dígitos: 26 é 2026, não 1926. O relatório é sempre recente.
    if (br[3]!.length === 2) ano += 2000;
    return montarData(ano, mes, dia);
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(soData);
  if (iso) return montarData(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  return null;
}

/**
 * Monta a data e **confere que ela é real**: `31/02/2026` vira 03/03 no JavaScript, sem reclamar.
 * Aceitar isso poria um atendimento no mês errado — exatamente o que a competência não perdoa.
 */
function montarData(ano: number, mes: number, dia: number): Date | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 1900 || ano > 2200) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  const bate = d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
  return bate ? d : null;
}

/**
 * Os três valores do arquivo real. Qualquer outro vira `OUTRO` — e o texto original é guardado ao
 * lado, senão o dado se perde. Comparação sem acento e sem caixa, porque a exportação varia.
 */
export function interpretarTipo(bruto: string): TipoAtendimento {
  const t = normalizarTexto(bruto);
  if (t === "") return "OUTRO";
  if (t.startsWith("consulta")) return "CONSULTA";
  if (t.startsWith("cortesia")) return "CORTESIA";
  if (t.includes("sem vinculo")) return "SEM_VINCULO_AGENDA";
  return "OUTRO";
}

/**
 * Tira o pronome de tratamento do nome do profissional, para casar `DR. LEONARDO GIGLIO DRAGONE`
 * do relatório com `Leonardo Giglio Dragone` do cadastro. Devolve normalizado (sem caixa, sem
 * acento) — é a chave do de-para.
 */
export function chaveDoProfissional(bruto: string): string {
  return normalizarTexto(bruto).replace(/^(dra?|doutora?)\.?\s+/, "");
}

/** Chave do de-para de convênio: só o texto normalizado. Ver spec §6.4. */
export function chaveDoConvenio(bruto: string): string {
  return normalizarTexto(bruto);
}
