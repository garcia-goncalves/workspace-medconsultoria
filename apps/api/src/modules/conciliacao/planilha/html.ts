/**
 * Extrai a tabela de um "Excel" que na verdade é HTML.
 *
 * Isto não é exotismo: o "exportar para Excel" de sistema hospitalar legado grava uma `<table>`
 * e chama o arquivo de `.xls`. O Excel abre (ele aceita), a pessoa jura que mandou uma planilha,
 * e o leitor de `.xlsx` reclama de arquivo corrompido sobre um arquivo íntegro.
 *
 * Não confundir com `lib/sanitizar-html.ts`: aquele devolve HTML seguro para EXIBIR; este joga a
 * marcação fora e devolve a ESTRUTURA (linhas × células) como texto.
 *
 * Varredura por índice, sem expressão regular de propósito: o conteúdo vem de arquivo enviado por
 * terceiro, e regex sobre HTML arbitrário é como se escreve uma ReDoS sem perceber. Aqui cada
 * caractere é visitado no máximo uma vez. Nada deste HTML é executado ou renderizado.
 */

/** Acha todas as linhas de todas as tabelas do documento, em ordem de aparição. */
export function lerTabelaHtml(html: string): string[][] {
  const linhas: string[][] = [];
  let i = 0;
  while (i < html.length) {
    const abreTr = acharTag(html, "tr", i);
    if (!abreTr) break;
    const fechaTr = acharFechamento(html, "tr", abreTr.fim);
    const conteudo = html.slice(abreTr.fim, fechaTr === -1 ? html.length : fechaTr);
    const celulas = lerCelulas(conteudo);
    // `<tr>` sem `<td>`/`<th>` nenhum é ruído de layout, não linha de dados.
    if (celulas.length > 0) linhas.push(celulas);
    i = fechaTr === -1 ? html.length : fechaTr + 1;
  }
  return linhas;
}

function lerCelulas(linhaHtml: string): string[] {
  const celulas: string[] = [];
  let i = 0;
  while (i < linhaHtml.length) {
    const abre = acharTag(linhaHtml, ["td", "th"], i);
    if (!abre) break;
    const fecha = acharFechamento(linhaHtml, abre.nome, abre.fim);
    const bruto = linhaHtml.slice(abre.fim, fecha === -1 ? linhaHtml.length : fecha);
    celulas.push(textoLimpo(bruto));
    i = fecha === -1 ? linhaHtml.length : fecha + 1;
  }
  return celulas;
}

interface Tag {
  nome: string;
  /** Índice logo após o `>` da tag de abertura. */
  fim: number;
}

/** Acha a próxima tag de abertura com um dos nomes dados, a partir de `de`. */
function acharTag(html: string, nomes: string | string[], de: number): Tag | null {
  const alvos = Array.isArray(nomes) ? nomes : [nomes];
  for (let i = de; i < html.length; i++) {
    if (html[i] !== "<") continue;
    for (const nome of alvos) {
      if (!casaNome(html, i + 1, nome)) continue;
      const fecha = html.indexOf(">", i);
      if (fecha === -1) return null;
      return { nome, fim: fecha + 1 };
    }
  }
  return null;
}

/** Índice do `<` do `</nome>` correspondente, ou -1. */
function acharFechamento(html: string, nome: string, de: number): number {
  for (let i = de; i < html.length; i++) {
    if (html[i] !== "<" || html[i + 1] !== "/") continue;
    if (casaNome(html, i + 2, nome)) return i;
  }
  return -1;
}

/**
 * O nome da tag bate na posição dada e termina de verdade ali — sem esta conferência,
 * `<table>` seria lido como a tag `t` e a varredura se perderia.
 */
function casaNome(html: string, pos: number, nome: string): boolean {
  if (html.slice(pos, pos + nome.length).toLowerCase() !== nome) return false;
  const depois = html[pos + nome.length];
  return (
    depois === undefined || depois === ">" || depois === "/" || depois === " " || depois === "\t" || depois === "\n" || depois === "\r"
  );
}

/**
 * Nomes das entidades HTML da faixa Latin-1, em ordem: cada uma vale o código 160 + posição.
 * Escrito assim, e não como mapa à mão, porque são 96 pares e digitá-los é convite a errar um.
 *
 * Esta faixa é justamente a que importa aqui: é dela que saem `&Aacute;`, `&ccedil;`, `&atilde;`
 * — ou seja, todo nome de paciente e todo convênio acentuado. Sem isso, `PORTO SEGURO -
 * B&Aacute;SICO` entraria no banco com a entidade crua e o de-para nunca casaria.
 */
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn " +
  "sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml " +
  "Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times " +
  "Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
  "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml " +
  "igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide " +
  "oslash ugrave uacute ucirc uuml yacute thorn yuml";

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  ...Object.fromEntries(LATIN1.split(" ").map((nome, i) => [nome, String.fromCodePoint(160 + i)])),
};

/**
 * As únicas em que aceitar caixa trocada é seguro. Para as acentuadas NÃO dá: `&Aacute;` é "Á" e
 * `&aacute;` é "á" — normalizar a caixa da busca trocaria a letra maiúscula pela minúscula no meio
 * de um nome próprio.
 */
const INSENSIVEIS_A_CAIXA = new Set(["amp", "lt", "gt", "quot", "apos", "nbsp"]);

/** Tira as tags de dentro da célula, resolve entidades e colapsa o espaço em branco. */
function textoLimpo(bruto: string): string {
  let saida = "";
  let dentroDeTag = false;
  for (let i = 0; i < bruto.length; i++) {
    const c = bruto[i]!;
    if (c === "<") {
      dentroDeTag = true;
      // `<br>` vira espaço, senão "linha1<br>linha2" grudaria em "linha1linha2".
      saida += " ";
      continue;
    }
    if (c === ">") {
      dentroDeTag = false;
      continue;
    }
    if (dentroDeTag) continue;
    if (c === "&") {
      const ponto = bruto.indexOf(";", i);
      // `&` solto (sem `;` perto) é literal — não sair caçando até o fim do arquivo.
      if (ponto !== -1 && ponto - i <= 10) {
        saida += resolverEntidade(bruto.slice(i + 1, ponto));
        i = ponto;
        continue;
      }
    }
    saida += c;
  }
  return saida.replace(/\s+/g, " ").trim();
}

function resolverEntidade(corpo: string): string {
  // Exato primeiro: entidade nomeada é sensível à caixa (`&Aacute;` = Á, `&aacute;` = á).
  const exata = ENTIDADES[corpo];
  if (exata !== undefined) return exata;
  const minuscula = corpo.toLowerCase();
  if (INSENSIVEIS_A_CAIXA.has(minuscula)) return ENTIDADES[minuscula]!;
  if (corpo[0] === "#") {
    const hex = corpo[1] === "x" || corpo[1] === "X";
    const n = Number.parseInt(hex ? corpo.slice(2) : corpo.slice(1), hex ? 16 : 10);
    if (Number.isFinite(n) && n > 0 && n <= 0x10ffff) return String.fromCodePoint(n);
  }
  // Entidade que não conhecemos volta como veio — perder o texto é pior que mostrá-lo cru.
  return `&${corpo};`;
}
