import { resolve, sep, extname, isAbsolute } from "node:path";
import { mkdir, unlink, writeFile, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { config, isProd } from "../config.js";

/** Raiz absoluta onde os arquivos são gravados (UPLOADS_DIR, relativo ao cwd ou absoluto). */
export const BASE = resolve(process.cwd(), config.UPLOADS_DIR);

/** Tipos aceitos no upload (allowlist) — PDF, imagens, Word e Excel. */
export const MIMETYPES_ACEITOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** Tamanho máximo por arquivo (20 MB). */
export const TAMANHO_MAX = 20 * 1024 * 1024;

/** Só imagens são aceitas como avatar/foto de perfil. */
export const MIMETYPES_IMAGEM = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Tamanho máximo do avatar (5 MB). */
export const AVATAR_MAX = 5 * 1024 * 1024;

/** Cria a pasta base no boot (idempotente). */
export async function garantirPastaBase(): Promise<void> {
  await mkdir(BASE, { recursive: true });
}

/**
 * Valida a pasta de uploads no BOOT e **impede inicialização insegura em produção**. Ver #4.
 *  - Em produção, `UPLOADS_DIR` DEVE ser um caminho ABSOLUTO (uma pasta persistente FORA do
 *    diretório do deploy — que é sobrescrito pelo rsync). Caminho relativo em prod = erro.
 *  - Testa escrita+leitura+remoção de um arquivo temporário (permissões reais do diretório).
 *  - Em produção, qualquer falha LANÇA (o processo não sobe). Em dev, apenas registra aviso.
 * Retorna um relatório (usado também pelo preflight).
 */
export async function validarPastaUploads(): Promise<{ ok: boolean; base: string; absoluto: boolean; escrita: boolean; detalhe?: string }> {
  const absoluto = isAbsolute(config.UPLOADS_DIR);
  const relatorio = { ok: false, base: BASE, absoluto, escrita: false, detalhe: undefined as string | undefined };

  if (isProd && !absoluto) {
    relatorio.detalhe =
      `Em produção, UPLOADS_DIR deve ser um caminho ABSOLUTO e persistente (fora do diretório do deploy). ` +
      `Valor atual (relativo): "${config.UPLOADS_DIR}". Ajuste no .env do servidor.`;
    if (isProd) throw new Error("[uploads] " + relatorio.detalhe);
    return relatorio;
  }

  try {
    await mkdir(BASE, { recursive: true });
    const teste = resolve(BASE, `.rwtest-${randomUUID()}`);
    await writeFile(teste, "ok");
    const lido = await readFile(teste, "utf8");
    await unlink(teste);
    relatorio.escrita = lido === "ok";
    relatorio.ok = relatorio.escrita && (!isProd || absoluto);
    if (!relatorio.escrita) relatorio.detalhe = "Escrita/leitura de teste falhou (conteúdo divergente).";
  } catch (e) {
    relatorio.detalhe = `Sem permissão de escrita em "${BASE}": ${(e as Error).message}`;
    if (isProd) throw new Error("[uploads] " + relatorio.detalhe);
  }
  return relatorio;
}

/** Resolve um caminho relativo (do banco) para absoluto, barrando path traversal. */
export function caminhoAbsoluto(rel: string): string {
  const abs = resolve(BASE, rel);
  if (abs !== BASE && !abs.startsWith(BASE + sep)) {
    throw new Error("Caminho de arquivo inválido.");
  }
  return abs;
}

/**
 * Grava um stream de upload no disco sob `clientes/{clienteId}/{uuid}{ext}` e devolve
 * o caminho RELATIVO (para guardar no banco) + o tamanho em bytes. O nome de exibição
 * (original) fica no banco; o nome em disco é um UUID (sem risco de colisão/traversal).
 */
export async function salvarArquivo(
  clienteId: string,
  nomeOriginal: string,
  stream: Readable,
): Promise<{ caminho: string; tamanho: number }> {
  const ext = extname(nomeOriginal)
    .slice(0, 12)
    .replace(/[^.\w]/g, "");
  const rel = `clientes/${clienteId}/${randomUUID()}${ext}`;
  const abs = caminhoAbsoluto(rel);
  await mkdir(resolve(abs, ".."), { recursive: true });

  let tamanho = 0;
  stream.on("data", (chunk: Buffer) => {
    tamanho += chunk.length;
  });
  try {
    await pipeline(stream, createWriteStream(abs));
  } catch (e) {
    // Origem que morre no meio (rede caindo, teto de tamanho estourado) deixaria o pedaço já
    // escrito no disco para sempre — invisível para a app e contando espaço. Some com ele e
    // relança: quem chamou decide o que dizer a quem clicou.
    await unlink(abs).catch(() => {});
    throw e;
  }
  return { caminho: rel, tamanho };
}

/** Grava o avatar de um usuário sob `avatars/{userId}/{uuid}{ext}` e devolve o caminho relativo. */
export async function salvarAvatar(userId: string, nomeOriginal: string, stream: Readable): Promise<{ caminho: string; tamanho: number }> {
  const ext =
    extname(nomeOriginal)
      .slice(0, 12)
      .replace(/[^.\w]/g, "") || ".png";
  const rel = `avatars/${userId}/${randomUUID()}${ext}`;
  const abs = caminhoAbsoluto(rel);
  await mkdir(resolve(abs, ".."), { recursive: true });
  let tamanho = 0;
  stream.on("data", (chunk: Buffer) => {
    tamanho += chunk.length;
  });
  await pipeline(stream, createWriteStream(abs));
  return { caminho: rel, tamanho };
}

/** Remove o arquivo físico (best-effort — não lança se já não existe). */
export async function removerArquivo(rel: string): Promise<void> {
  try {
    await unlink(caminhoAbsoluto(rel));
  } catch {
    /* arquivo já removido — ok */
  }
}
