import { lerZip, ErroDeZip } from "./zip.js";

/**
 * Leitor de `.xlsx` (OOXML) — só leitura, sem dependência. Ver o cabeçalho de `zip.ts` para por
 * que não usamos uma biblioteca pronta.
 *
 * Devolve tudo como TEXTO, do jeito que a pessoa veria na tela do Excel, porque é isso que o
 * resto do importador espera de qualquer formato (CSV, HTML ou XLSX entram pelo mesmo caminho).
 */

export function lerXlsx(bytes: Buffer): string[][] {
  const arquivos = lerZip(bytes);
  const textos = lerStringsCompartilhadas(arquivos.get("xl/sharedStrings.xml"));
  const estilosDeData = lerQuaisEstilosSaoData(arquivos.get("xl/styles.xml"));
  const base1904 = (arquivos.get("xl/workbook.xml")?.toString("utf8") ?? "").includes('date1904="1"');

  return lerLinhas(acharPrimeiraPlanilha(arquivos), textos, estilosDeData, base1904);
}

/**
 * A primeira aba do arquivo não é necessariamente `sheet1.xml`: a ordem está no `workbook.xml`,
 * que aponta por `r:id`, resolvido pelo `.rels`. Chutar `sheet1.xml` funciona quase sempre — e
 * quando não funciona, importa a aba errada em silêncio.
 */
function acharPrimeiraPlanilha(arquivos: Map<string, Buffer>): string {
  const workbook = arquivos.get("xl/workbook.xml")?.toString("utf8");
  const rels = arquivos.get("xl/_rels/workbook.xml.rels")?.toString("utf8");

  if (workbook && rels) {
    const primeira = acharAtributo(workbook, "<sheet ", "r:id");
    if (primeira) {
      const alvo = acharAlvoDoRel(rels, primeira);
      if (alvo) {
        const caminho = alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, "")}`;
        const conteudo = arquivos.get(caminho);
        if (conteudo) return conteudo.toString("utf8");
      }
    }
  }

  // Sem o mapa: a aba de menor número é o palpite menos ruim.
  const candidatas = [...arquivos.keys()].filter((k) => k.startsWith("xl/worksheets/sheet")).sort();
  const escolhida = candidatas[0] ? arquivos.get(candidatas[0]) : undefined;
  if (!escolhida) throw new ErroDeZip("A planilha não tem nenhuma aba com conteúdo.");
  return escolhida.toString("utf8");
}

function acharAlvoDoRel(rels: string, id: string): string | null {
  let i = 0;
  while (i < rels.length) {
    const abre = rels.indexOf("<Relationship", i);
    if (abre === -1) return null;
    const fecha = rels.indexOf(">", abre);
    if (fecha === -1) return null;
    const tag = rels.slice(abre, fecha);
    if (lerAtributo(tag, "Id") === id) return lerAtributo(tag, "Target");
    i = fecha + 1;
  }
  return null;
}

/**
 * `sharedStrings.xml` é a tabela de textos repetidos: a célula guarda o índice, não a palavra.
 * Ignorar isso faz a planilha inteira virar uma coluna de números.
 */
function lerStringsCompartilhadas(xml: Buffer | undefined): string[] {
  if (!xml) return [];
  const texto = xml.toString("utf8");
  const saida: string[] = [];
  let i = 0;
  while (i < texto.length) {
    const abre = texto.indexOf("<si", i);
    if (abre === -1) break;
    const fim = texto.indexOf("</si>", abre);
    saida.push(juntarTs(texto.slice(abre, fim === -1 ? texto.length : fim)));
    i = fim === -1 ? texto.length : fim + 5;
  }
  return saida;
}

/** Um `<si>` pode ter vários `<t>` (texto com formatação por trechos) — concatena todos. */
function juntarTs(bloco: string): string {
  let saida = "";
  let i = 0;
  while (i < bloco.length) {
    const abre = bloco.indexOf("<t", i);
    if (abre === -1) break;
    const fimTag = bloco.indexOf(">", abre);
    if (fimTag === -1) break;
    if (bloco[fimTag - 1] === "/") {
      // `<t/>` vazio não tem fechamento.
      i = fimTag + 1;
      continue;
    }
    const fecha = bloco.indexOf("</t>", fimTag);
    saida += desescaparXml(bloco.slice(fimTag + 1, fecha === -1 ? bloco.length : fecha));
    i = fecha === -1 ? bloco.length : fecha + 4;
  }
  return saida;
}

/** Formatos de data/hora embutidos do OOXML. */
const EMBUTIDOS_DE_DATA = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * Quais índices de estilo significam data.
 *
 * O Excel não marca a célula como "data": ela é um número, e o que a torna data é o FORMATO
 * apontado pelo estilo. Sem consultar isto, `31/08/2026` chega como `46265`.
 */
function lerQuaisEstilosSaoData(xml: Buffer | undefined): Set<number> {
  const eData = new Set<number>();
  if (!xml) return eData;
  const texto = xml.toString("utf8");

  const personalizadosDeData = new Set<number>();
  let i = 0;
  while (i < texto.length) {
    const abre = texto.indexOf("<numFmt ", i);
    if (abre === -1) break;
    const fecha = texto.indexOf(">", abre);
    if (fecha === -1) break;
    const tag = texto.slice(abre, fecha);
    const id = Number(lerAtributo(tag, "numFmtId"));
    if (Number.isFinite(id) && pareceFormatoDeData(lerAtributo(tag, "formatCode") ?? "")) {
      personalizadosDeData.add(id);
    }
    i = fecha + 1;
  }

  // `cellXfs` é a lista de estilos que as células referenciam pelo atributo `s`.
  const inicioXfs = texto.indexOf("<cellXfs");
  if (inicioXfs === -1) return eData;
  const fimXfs = texto.indexOf("</cellXfs>", inicioXfs);
  const bloco = texto.slice(inicioXfs, fimXfs === -1 ? texto.length : fimXfs);

  // O `s` da célula é a POSIÇÃO nesta lista, contada do zero. A abertura `<cellXfs ...>` não
  // entra na conta e nem atrapalha a busca: `"<cellXfs"` não contém a substring `"<xf"`.
  let indice = 0;
  let j = 0;
  while (j < bloco.length) {
    const abre = bloco.indexOf("<xf", j);
    if (abre === -1) break;
    const fecha = bloco.indexOf(">", abre);
    if (fecha === -1) break;
    const id = Number(lerAtributo(bloco.slice(abre, fecha), "numFmtId") ?? "0");
    if (EMBUTIDOS_DE_DATA.has(id) || personalizadosDeData.has(id)) eData.add(indice);
    indice++;
    j = fecha + 1;
  }
  return eData;
}

/** `dd/mm/yyyy` é data; `#,##0.00` não. Texto entre aspas dentro do formato não conta. */
function pareceFormatoDeData(codigo: string): boolean {
  let foraDeAspas = "";
  let emAspas = false;
  for (const c of codigo) {
    if (c === '"') {
      emAspas = !emAspas;
      continue;
    }
    if (!emAspas) foraDeAspas += c;
  }
  return /[ydhs]/i.test(foraDeAspas);
}

function lerLinhas(xml: string, textos: string[], estilosDeData: Set<number>, base1904: boolean): string[][] {
  const linhas: string[][] = [];
  let larguraMaxima = 0;
  let i = 0;

  while (i < xml.length) {
    const abre = xml.indexOf("<row", i);
    if (abre === -1) break;
    const fimTag = xml.indexOf(">", abre);
    if (fimTag === -1) break;
    const vazia = xml[fimTag - 1] === "/";
    const fecha = vazia ? fimTag : xml.indexOf("</row>", fimTag);
    const corpo = vazia ? "" : xml.slice(fimTag + 1, fecha === -1 ? xml.length : fecha);

    // Linha totalmente vazia não vem no XML. Preencher o buraco mantém o número da linha do
    // arquivo igual à posição daqui — é por ele que a tela aponta onde está o erro.
    const numero = Number(lerAtributo(xml.slice(abre, fimTag), "r") ?? "0");
    while (numero > 0 && linhas.length < numero - 1) linhas.push([]);

    const celulas = lerCelulas(corpo, textos, estilosDeData, base1904);
    larguraMaxima = Math.max(larguraMaxima, celulas.length);
    linhas.push(celulas);
    i = fecha === -1 ? xml.length : fecha + 6;
  }

  // Todas as linhas com a mesma largura: quem consome indexa por posição de coluna.
  for (const l of linhas) while (l.length < larguraMaxima) l.push("");
  return linhas;
}

function lerCelulas(corpo: string, textos: string[], estilosDeData: Set<number>, base1904: boolean): string[] {
  const celulas: string[] = [];
  let i = 0;

  while (i < corpo.length) {
    const abre = corpo.indexOf("<c", i);
    if (abre === -1) break;
    const fimTag = corpo.indexOf(">", abre);
    if (fimTag === -1) break;
    const tag = corpo.slice(abre, fimTag);
    const autoFechada = corpo[fimTag - 1] === "/";
    const fecha = autoFechada ? fimTag : corpo.indexOf("</c>", fimTag);
    const conteudo = autoFechada ? "" : corpo.slice(fimTag + 1, fecha === -1 ? corpo.length : fecha);

    // ⚠️ Célula vazia é OMITIDA do XML: uma linha com A, C e D traz três `<c>`, e sem olhar a
    // referência (`r="C5"`) o valor de C cairia na coluna B. É assim que uma planilha inteira sai
    // com as colunas deslocadas sem nenhum erro na tela.
    const ref = lerAtributo(tag, "r");
    const coluna = ref ? colunaDaReferencia(ref) : celulas.length;
    while (celulas.length < coluna) celulas.push("");

    celulas.push(valorDaCelula(tag, conteudo, textos, estilosDeData, base1904));
    i = fecha === -1 ? corpo.length : fecha + 4;
  }
  return celulas;
}

/** `BC12` → 54 (índice 0). As letras são base-26 sem zero. */
export function colunaDaReferencia(ref: string): number {
  let n = 0;
  for (const c of ref) {
    const codigo = c.charCodeAt(0);
    if (codigo >= 65 && codigo <= 90) n = n * 26 + (codigo - 64);
    else if (codigo >= 97 && codigo <= 122) n = n * 26 + (codigo - 96);
    else break;
  }
  return Math.max(0, n - 1);
}

function valorDaCelula(tag: string, conteudo: string, textos: string[], estilosDeData: Set<number>, base1904: boolean): string {
  const tipo = lerAtributo(tag, "t") ?? "n";

  if (tipo === "inlineStr") return juntarTs(conteudo);
  if (tipo === "s") return textos[Number(pegarTag(conteudo, "v"))] ?? "";
  if (tipo === "str" || tipo === "e") return desescaparXml(pegarTag(conteudo, "v") ?? "");
  if (tipo === "b") return pegarTag(conteudo, "v") === "1" ? "VERDADEIRO" : "FALSO";

  const bruto = pegarTag(conteudo, "v");
  if (bruto === null || bruto === "") return "";

  const estilo = Number(lerAtributo(tag, "s") ?? "-1");
  if (estilosDeData.has(estilo)) {
    const serial = Number(bruto);
    if (Number.isFinite(serial)) return serialParaTexto(serial, base1904);
  }
  return bruto;
}

/**
 * Número de série do Excel → `dd/mm/aaaa` (com hora quando houver).
 *
 * ⚠️ **Tudo em UTC, de propósito.** A conta parte de 1899-12-30 e o dia é lido com `getUTCDate`.
 * Em horário local, Brasília (UTC-3) desloca a data um dia para trás — sem erro nenhum na tela,
 * com o atendimento do dia 1º caindo no mês anterior e a competência inteira errada.
 *
 * O 30/12/1899 (e não 31/12) já embute o bug histórico do Excel, que trata 1900 como bissexto.
 * Vale para qualquer data a partir de 01/03/1900, que é toda data deste sistema.
 */
export function serialParaTexto(serial: number, base1904 = false): string {
  // O calendário 1904 do Excel para Mac conta a partir de outra origem.
  const ajustado = base1904 ? serial + 1462 : serial;
  const d = new Date(Math.round((ajustado - 25569) * 86400000));
  if (Number.isNaN(d.getTime())) return String(serial);

  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const data = `${dd}/${mm}/${d.getUTCFullYear()}`;
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  if (h === 0 && min === 0 && d.getUTCSeconds() === 0) return data;
  return `${data} ${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function pegarTag(xml: string, nome: string): string | null {
  const abre = xml.indexOf(`<${nome}`);
  if (abre === -1) return null;
  const fimTag = xml.indexOf(">", abre);
  if (fimTag === -1) return null;
  if (xml[fimTag - 1] === "/") return "";
  const fecha = xml.indexOf(`</${nome}>`, fimTag);
  return xml.slice(fimTag + 1, fecha === -1 ? xml.length : fecha);
}

function acharAtributo(xml: string, tagInicio: string, atributo: string): string | null {
  const abre = xml.indexOf(tagInicio);
  if (abre === -1) return null;
  const fecha = xml.indexOf(">", abre);
  if (fecha === -1) return null;
  return lerAtributo(xml.slice(abre, fecha), atributo);
}

function lerAtributo(tag: string, nome: string): string | null {
  const marca = `${nome}="`;
  const p = tag.indexOf(marca);
  if (p === -1) return null;
  const inicio = p + marca.length;
  const fim = tag.indexOf('"', inicio);
  return fim === -1 ? null : desescaparXml(tag.slice(inicio, fim));
}

function desescaparXml(s: string): string {
  if (!s.includes("&")) return s;
  return (
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
      // `&amp;` por último: senão `&amp;lt;` viraria `<` em vez de `&lt;`.
      .replace(/&amp;/g, "&")
  );
}
