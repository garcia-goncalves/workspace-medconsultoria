/**
 * Leitor de CSV escrito à mão — sem dependência.
 *
 * Não é "split por vírgula". O que sai de sistema hospitalar brasileiro tem, todo dia: separador
 * `;` (o Excel em português usa ponto e vírgula, porque a vírgula é o decimal), acentuação em
 * latin-1, campo entre aspas com o separador dentro, e quebra de linha dentro do campo. Cada um
 * desses casos, ignorado, desloca uma coluna inteira **sem erro nenhum** — o pior tipo de defeito
 * num importador, porque o número aparece na tela e está errado.
 */

export const SEPARADORES = [";", ",", "\t", "|"] as const;
export type Separador = (typeof SEPARADORES)[number];

/**
 * Bytes → texto, adivinhando a codificação.
 *
 * Ordem: BOM manda (é declaração explícita); sem BOM, tenta UTF-8 e **confere**; se o resultado
 * tem U+FFFD (o losango de interrogação), então não era UTF-8 e cai para latin-1 — que é o que o
 * Excel brasileiro gera quando salva "CSV (separado por vírgulas)". Decodificar errado transforma
 * "CIRURGIÃO" em "CIRURGI�O" e o de-para de convênio deixa de casar.
 */
export function decodificarTexto(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString("utf8");
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16 big-endian: o Node só decodifica little-endian, então invertemos os pares de bytes.
    // `swap16` exige comprimento par — um arquivo truncado no meio de um caractere não pode
    // derrubar a importação inteira.
    const corpo = Buffer.from(bytes.subarray(2));
    if (corpo.length % 2 === 0) {
      corpo.swap16();
      return corpo.toString("utf16le");
    }
  }
  const comoUtf8 = bytes.toString("utf8");
  return comoUtf8.includes("�") ? bytes.toString("latin1") : comoUtf8;
}

/**
 * Descobre o separador contando candidatos **fora de aspas** na primeira linha com conteúdo.
 *
 * Contar fora de aspas importa: um cabeçalho `"Paciente, nome";"CPF"` tem mais vírgulas que ponto
 * e vírgulas, e a vírgula venceria se contássemos cru. Empate vai para `;`, que é o do Excel
 * em português — o caso mais provável aqui.
 */
export function detectarSeparador(texto: string): Separador {
  const contagem = new Map<Separador, number>(SEPARADORES.map((s) => [s, 0]));
  let emAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (c === '"') {
      // `""` dentro de aspas é uma aspa escapada, não o fim do campo.
      if (emAspas && texto[i + 1] === '"') {
        i++;
        continue;
      }
      emAspas = !emAspas;
      continue;
    }
    if (emAspas) continue;
    if (c === "\n") {
      // Fim da primeira linha com conteúdo: se já contamos algo, decidimos aqui.
      if ([...contagem.values()].some((n) => n > 0)) break;
      continue;
    }
    const sep = SEPARADORES.find((s) => s === c);
    if (sep) contagem.set(sep, contagem.get(sep)! + 1);
  }
  let melhor: Separador = ";";
  let melhorN = 0;
  for (const sep of SEPARADORES) {
    const n = contagem.get(sep)!;
    if (n > melhorN) {
      melhor = sep;
      melhorN = n;
    }
  }
  return melhor;
}

/**
 * Texto → linhas de células. Segue o RFC 4180 no que importa: aspas abrem campo, `""` é uma aspa
 * literal, e separador/quebra de linha dentro de aspas são conteúdo, não estrutura.
 */
export function lerCsv(texto: string, separador?: Separador): string[][] {
  const sep = separador ?? detectarSeparador(texto);
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let emAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;

    if (emAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          emAspas = false;
        }
      } else {
        // Inclusive `\r`, `\n` e o separador: dentro de aspas, tudo é conteúdo.
        campo += c;
      }
      continue;
    }

    if (c === '"' && campo === "") {
      emAspas = true;
    } else if (c === sep) {
      linha.push(campo.trim());
      campo = "";
    } else if (c === "\n") {
      linha.push(campo.trim());
      linhas.push(linha);
      linha = [];
      campo = "";
    } else if (c !== "\r") {
      // `\r` fora de aspas é só o par do CRLF do Windows — nunca é conteúdo.
      campo += c;
    }
  }
  linha.push(campo.trim());
  linhas.push(linha);

  return semLinhasVaziasNoFim(linhas);
}

/**
 * Tira as linhas em branco do FIM (todo arquivo termina com uma quebra, o que gera uma linha
 * fantasma). Linha vazia no MEIO fica: em relatório ela costuma separar blocos, e apagá-la
 * desalinharia o número da linha que a tela usa para apontar erro.
 */
function semLinhasVaziasNoFim(linhas: string[][]): string[][] {
  let fim = linhas.length;
  while (fim > 0 && linhas[fim - 1]!.every((c) => c === "")) fim--;
  return linhas.slice(0, fim);
}
