/**
 * De que tipo é o arquivo que a pessoa subiu — decidido pelo **conteúdo**, nunca pela extensão.
 *
 * Por que não pela extensão: relatório de sistema hospitalar quase nunca é o que o nome diz.
 * O botão "exportar para Excel" de sistema legado costuma cuspir **uma tabela HTML** (ou um CSV)
 * com a extensão `.xls` trocada por cima. Confiar no nome faz o leitor de planilha engasgar num
 * arquivo que é texto puro, e a pessoa recebe "arquivo corrompido" sobre um arquivo perfeito.
 */

/** Uma tabela lida de qualquer formato: tudo texto, como um humano veria na tela. */
export interface Grade {
  formato: Formato;
  /** Todas as linhas, inclusive título e linhas em branco acima do cabeçalho. */
  linhas: string[][];
}

export type Formato =
  /** Texto separado por `;`, `,`, tab ou `|`. Inclui `.xls` que na verdade é CSV. */
  | "csv"
  /** OOXML de verdade (`.xlsx`) — um zip. */
  | "xlsx"
  /** Tabela HTML com nome de planilha. Muito comum em exportação de sistema legado. */
  | "html"
  /** `.xls` binário de verdade (BIFF/OLE2). Não lemos — ver `MENSAGEM_XLS_ANTIGO`. */
  | "xls-antigo"
  | "vazio";

/** Assinatura de arquivo zip — todo `.xlsx` começa assim (é um zip com XML dentro). */
const ASSINATURA_ZIP = [0x50, 0x4b, 0x03, 0x04];
/** Assinatura OLE2 (Compound File) — o `.xls` binário antigo do Excel 97-2003. */
const ASSINATURA_OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function comecaCom(bytes: Buffer, assinatura: number[]): boolean {
  if (bytes.length < assinatura.length) return false;
  return assinatura.every((b, i) => bytes[i] === b);
}

export function detectarFormato(bytes: Buffer): Formato {
  if (bytes.length === 0) return "vazio";
  if (comecaCom(bytes, ASSINATURA_ZIP)) return "xlsx";
  if (comecaCom(bytes, ASSINATURA_OLE2)) return "xls-antigo";

  // HTML: olhar só o começo basta e evita varrer um arquivo de 20 MB. A marca pode vir depois de
  // um BOM, de espaços ou de um `<?xml ...?>`/`<!DOCTYPE ...>`, por isso é `includes` numa janela
  // pequena, e não "começa com".
  const inicio = bytes.subarray(0, 1024).toString("latin1").toLowerCase();
  if (inicio.includes("<table") || inicio.includes("<html") || inicio.includes("<!doctype html")) {
    return "html";
  }
  return "csv";
}

/**
 * O `.xls` binário exigiria a SheetJS, e a versão publicada no npm está parada em duas falhas
 * conhecidas (poluição de protótipo e ReDoS) — entrar com ela reprovaria o portão de auditoria
 * da CI. Em vez de instalar dependência insegura para um caso que talvez nem apareça, o arquivo
 * é recusado com a saída pronta. Se aparecer de verdade, é decisão nova e consciente.
 */
export const MENSAGEM_XLS_ANTIGO =
  "Este arquivo é um .xls antigo (Excel 97-2003), que o sistema não lê. " +
  "Abra no Excel e use Arquivo → Salvar como → Pasta de Trabalho do Excel (.xlsx) ou CSV, " +
  "e envie o arquivo novo.";

export const MENSAGEM_VAZIO = "O arquivo está vazio — nada foi enviado.";
