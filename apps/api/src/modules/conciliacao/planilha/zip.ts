import { inflateRawSync } from "node:zlib";

/**
 * Leitor de ZIP mínimo, só o suficiente para abrir um `.xlsx` (que é um zip com XML dentro).
 *
 * Por que escrever isto em vez de usar uma biblioteca: o caminho óbvio era o `exceljs`, e ele
 * **não pode ser publicado neste projeto**. Ele é uma biblioteca de ler *e escrever*, e a metade
 * que escreve (`archiver`) arrasta um `minimatch` antigo com falha ALTA. Fechar isso exigiria um
 * override escopado por major, e o tradutor do artefato de produção recusa — com razão — porque o
 * npm não sabe escopar override por major do próprio pacote (ADR-116/117). Ou seja: com o
 * `exceljs`, ou a auditoria reprova ou o `build:deploy` quebra.
 *
 * Nós só **lemos**. Ler um zip é o cabeçalho central mais `inflateRaw`, que já vem no Node.
 * Zero dependência, zero superfície de ataque nova.
 */

/** Assinatura do fim do diretório central (EOCD). */
const FIM_DIRETORIO = 0x06054b50;
/** Assinatura de uma entrada do diretório central. */
const ENTRADA_DIRETORIO = 0x02014b50;
/** Marcador de "o valor não cabe em 32 bits" — indica ZIP64. */
const PRECISA_ZIP64 = 0xffffffff;

export class ErroDeZip extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeZip";
  }
}

/**
 * Abre o zip e devolve `caminho dentro do arquivo → conteúdo`.
 *
 * Um `.xlsx` tem poucas dezenas de entradas pequenas, então ler tudo de uma vez é mais simples e
 * mais rápido do que procurar entrada por entrada.
 */
export function lerZip(bytes: Buffer): Map<string, Buffer> {
  const eocd = acharFimDoDiretorio(bytes);
  const total = bytes.readUInt16LE(eocd + 10);
  const inicioDiretorio = bytes.readUInt32LE(eocd + 16);

  if (inicioDiretorio === PRECISA_ZIP64) {
    throw new ErroDeZip("Esta planilha usa ZIP64 (arquivo muito grande). Exporte um período menor.");
  }

  const arquivos = new Map<string, Buffer>();
  let p = inicioDiretorio;

  for (let i = 0; i < total; i++) {
    if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== ENTRADA_DIRETORIO) {
      throw new ErroDeZip("O arquivo está truncado ou não é uma planilha .xlsx válida.");
    }
    const metodo = bytes.readUInt16LE(p + 10);
    const tamanhoComprimido = bytes.readUInt32LE(p + 20);
    const tamanhoOriginal = bytes.readUInt32LE(p + 24);
    const tamNome = bytes.readUInt16LE(p + 28);
    const tamExtra = bytes.readUInt16LE(p + 30);
    const tamComentario = bytes.readUInt16LE(p + 32);
    const posLocal = bytes.readUInt32LE(p + 42);
    const nome = bytes.subarray(p + 46, p + 46 + tamNome).toString("utf8");

    if (posLocal !== PRECISA_ZIP64 && tamanhoComprimido !== PRECISA_ZIP64) {
      arquivos.set(nome, extrair(bytes, posLocal, metodo, tamanhoComprimido, tamanhoOriginal));
    }
    p += 46 + tamNome + tamExtra + tamComentario;
  }
  return arquivos;
}

/**
 * O cabeçalho LOCAL de cada arquivo repete nome e extra, e o campo "extra" costuma ter tamanho
 * DIFERENTE do que está no diretório central. Por isso os bytes têm de ser localizados pelo
 * cabeçalho local, e não somando o tamanho lido no diretório — erro clássico que faz o inflate
 * receber lixo e falhar sem explicação.
 */
function extrair(bytes: Buffer, posLocal: number, metodo: number, comprimido: number, original: number): Buffer {
  const tamNome = bytes.readUInt16LE(posLocal + 26);
  const tamExtra = bytes.readUInt16LE(posLocal + 28);
  const inicio = posLocal + 30 + tamNome + tamExtra;
  const dados = bytes.subarray(inicio, inicio + comprimido);

  if (metodo === 0) return Buffer.from(dados); // guardado sem compressão
  if (metodo !== 8) throw new ErroDeZip(`A planilha usa uma compressão que não sei ler (método ${metodo}).`);

  try {
    // "raw" porque dentro do zip o fluxo deflate vem sem o cabeçalho zlib.
    const saida = inflateRawSync(dados);
    if (original !== 0 && saida.length !== original) {
      throw new ErroDeZip("O conteúdo da planilha não confere com o tamanho declarado.");
    }
    return saida;
  } catch (e) {
    if (e instanceof ErroDeZip) throw e;
    throw new ErroDeZip("Não consegui descompactar a planilha — o arquivo parece danificado.");
  }
}

/**
 * O EOCD fica no fim, mas pode ter até 64 KB de comentário depois dele — por isso é busca de trás
 * para a frente, e não uma posição fixa.
 */
function acharFimDoDiretorio(bytes: Buffer): number {
  const minimo = Math.max(0, bytes.length - (22 + 0xffff));
  for (let i = bytes.length - 22; i >= minimo; i--) {
    if (bytes.readUInt32LE(i) === FIM_DIRETORIO) return i;
  }
  throw new ErroDeZip("Este arquivo não é uma planilha .xlsx válida (não achei o índice do zip).");
}
