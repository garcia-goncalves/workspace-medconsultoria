import { createHash } from "node:crypto";

/** SHA-256 (hex) do conteúdo — prova de integridade de documentos assinados. */
export function hashConteudo(conteudo: string): string {
  return createHash("sha256").update(conteudo, "utf8").digest("hex");
}

/**
 * SHA-256 (hex) de bytes — a impressão digital de um arquivo enviado.
 *
 * Separado de `hashConteudo` porque planilha é binário: passá-la por `toString("utf8")` primeiro
 * destruiria bytes e dois arquivos diferentes poderiam gerar o mesmo hash. É por este número que
 * a Conciliação reconhece "esta planilha já foi importada".
 */
export function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
