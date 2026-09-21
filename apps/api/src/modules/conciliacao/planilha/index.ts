import { decodificarTexto, lerCsv } from "./csv.js";
import { lerTabelaHtml } from "./html.js";
import { lerXlsx } from "./xlsx.js";
import { ErroDeZip } from "./zip.js";
import { detectarFormato, MENSAGEM_VAZIO, MENSAGEM_XLS_ANTIGO, type Formato, type Grade } from "./formato.js";

export { detectarFormato, MENSAGEM_VAZIO, MENSAGEM_XLS_ANTIGO } from "./formato.js";
export type { Formato, Grade } from "./formato.js";

/** Erro de leitura com recado em português, para a tela mostrar sem tradução. */
export class ErroDePlanilha extends Error {
  constructor(
    mensagem: string,
    readonly formato: Formato,
  ) {
    super(mensagem);
    this.name = "ErroDePlanilha";
  }
}

/**
 * Lê CSV, XLSX ou tabela HTML e devolve **sempre a mesma coisa**: linhas de texto.
 *
 * A escolha de devolver tudo como texto é deliberada. Quem interpreta data, número e enum é a
 * camada de domínio, que sabe que `31/08/2026` é dia 31 e que "Cortesia" é um tipo de atendimento.
 * Se o leitor devolvesse `Date` e `number`, cada formato entregaria um tipo diferente para a mesma
 * coluna e o domínio teria três caminhos para testar em vez de um.
 *
 * O cabeçalho **não** é separado aqui: relatório costuma ter título e linhas em branco antes dele,
 * e quem sabe reconhecer a linha de cabeçalho é quem conhece os nomes das colunas. Ver
 * `localizarCabecalho`.
 */
export async function lerGrade(bytes: Buffer): Promise<Grade> {
  const formato = detectarFormato(bytes);

  switch (formato) {
    case "vazio":
      throw new ErroDePlanilha(MENSAGEM_VAZIO, formato);
    case "xls-antigo":
      throw new ErroDePlanilha(MENSAGEM_XLS_ANTIGO, formato);
    case "csv":
      return { formato, linhas: lerCsv(decodificarTexto(bytes)) };
    case "html":
      return { formato, linhas: exigirLinhas(lerTabelaHtml(decodificarTexto(bytes)), formato) };
    case "xlsx":
      return { formato, linhas: lerXlsxOuExplicar(bytes) };
  }
}

/**
 * Zero linha NÃO segue adiante calado.
 *
 * ⚠️ A grade vazia é o que sobra quando o LEITOR não entendeu o arquivo — e quem a recebe conclui
 * "este não é o relatório que eu esperava", jogando a culpa no arquivo de quem enviou. Aconteceu
 * de verdade com `.xlsx` de tag prefixada (ver `semPrefixoDeNamespace`): arquivo bom, mensagem
 * acusando a pessoa. Aqui o arquivo que não rendeu linha nenhuma diz isso, com essas palavras.
 */
function exigirLinhas(linhas: string[][], formato: Formato): string[][] {
  if (linhas.length > 0) return linhas;
  throw new ErroDePlanilha(
    "Abri este arquivo, mas não encontrei nenhuma linha de tabela dentro dele. Confira se é o relatório certo e envie de novo.",
    formato,
  );
}

/** Traduz a falha do leitor de zip/xlsx para um recado que a pessoa consegue agir em cima. */
function lerXlsxOuExplicar(bytes: Buffer): string[][] {
  try {
    return lerXlsx(bytes);
  } catch (e) {
    if (e instanceof ErroDeZip) throw new ErroDePlanilha(e.message, "xlsx");
    throw new ErroDePlanilha(
      "Não consegui abrir esta planilha. Ela pode estar protegida por senha ou ter sido " +
        "danificada no envio. Abra no Excel, salve de novo como .xlsx e tente outra vez.",
      "xlsx",
    );
  }
}

/** Igual sem caixa, sem acento e sem espaço sobrando — para casar nome de coluna. */
export function normalizarTexto(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Cabecalho {
  /** Índice da linha do cabeçalho dentro de `grade.linhas`. */
  indice: number;
  /** Nome da coluna procurada → índice da coluna na linha. */
  colunas: Map<string, number>;
}

/**
 * Acha a linha de cabeçalho e mapeia cada coluna procurada para a sua posição.
 *
 * Existe porque o relatório **não** começa no cabeçalho: pode ter título, período e linhas em
 * branco antes. Fixar "o cabeçalho é a linha 1" quebra na primeira exportação com título — e
 * quebra silenciosamente, importando o título como se fosse dado.
 *
 * O casamento é por texto normalizado e por prefixo, porque a mesma coluna aparece como
 * "E-mail" e "E-mail do paciente", ou "Telefone do Paciente" com caixa diferente a cada
 * exportação. Devolve `null` quando nenhuma linha contém todas as colunas exigidas.
 */
export function localizarCabecalho(
  linhas: string[][],
  exigidas: readonly string[],
  opcoes: { opcionais?: readonly string[]; limiteDeLinhas?: number } = {},
): Cabecalho | null {
  const { opcionais = [], limiteDeLinhas = 30 } = opcoes;
  const ate = Math.min(linhas.length, limiteDeLinhas);

  for (let i = 0; i < ate; i++) {
    const celulas = linhas[i]!.map(normalizarTexto);
    const colunas = new Map<string, number>();

    for (const nome of [...exigidas, ...opcionais]) {
      const pos = acharColuna(celulas, normalizarTexto(nome));
      if (pos !== -1) colunas.set(nome, pos);
    }
    // A linha só é o cabeçalho se traz TODAS as exigidas. As opcionais entram se estiverem lá —
    // um relatório sem a coluna "E-mail" continua importável, e a tela avisa o que faltou.
    if (exigidas.every((nome) => colunas.has(nome))) return { indice: i, colunas };
  }
  return null;
}

/**
 * Posição de uma coluna com casamento EXATO — sem a tolerância de prefixo do `localizarCabecalho`.
 *
 * ⚠️ Existe porque a tolerância de prefixo é BIDIRECIONAL (`c.startsWith(alvo) || alvo.startsWith(c)`),
 * então uma célula CURTA casa com um alvo LONGO: `Data` casa com `Data pagamento`, `Status` com
 * `Status conciliação`. Isso é desejável para achar a LINHA do cabeçalho (o arquivo do cliente
 * varia), e é desastroso para decidir se uma coluna específica existe — em 21/09/2026 fez o mapa
 * cirúrgico cru passar pela guarda do importador de planilha e gravar a DATA DA CIRURGIA como data
 * de pagamento, em silêncio.
 *
 * Use esta para colunas que o PRÓPRIO SISTEMA escreve, onde o nome é exato por construção.
 */
export function acharColunaExata(celulas: string[], nome: string): number {
  const alvo = normalizarTexto(nome);
  return celulas.findIndex((c) => normalizarTexto(c) === alvo);
}

function acharColuna(celulas: string[], alvo: string): number {
  const exata = celulas.indexOf(alvo);
  if (exata !== -1) return exata;
  // Só cai para prefixo quando não houve casamento exato em lugar nenhum da linha: "data" não
  // pode roubar a posição de "data do atendimento" só por vir antes.
  return celulas.findIndex((c) => c !== "" && (c.startsWith(alvo) || alvo.startsWith(c)));
}
