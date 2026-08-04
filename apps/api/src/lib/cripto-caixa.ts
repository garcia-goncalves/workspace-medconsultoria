import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

/** Versão do formato guardado. Trocar de esquema no futuro = novo prefixo, sem migration. */
const VERSAO = "v1";

function chave(): Buffer {
  const b64 = config.EMAIL_CRYPTO_KEY;
  if (!b64) {
    throw new Error("EMAIL_CRYPTO_KEY não configurada — o e-mail dentro da aplicação está desligado.");
  }
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) {
    throw new Error("EMAIL_CRYPTO_KEY inválida: são necessários 32 bytes em base64.");
  }
  return k;
}

/** Cifra a senha da caixa. Formato: `v1:<iv>:<tag>:<cifrado>`, tudo em base64. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const cifrado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [VERSAO, iv.toString("base64"), c.getAuthTag().toString("base64"), cifrado.toString("base64")].join(":");
}

/** Decifra. Lança se a chave estiver errada OU se o conteúdo tiver sido adulterado (GCM). */
export function decifrar(guardado: string): string {
  const [versao, ivB64, tagB64, cifradoB64] = guardado.split(":");
  if (versao !== VERSAO || !ivB64 || !tagB64 || !cifradoB64) {
    throw new Error("Formato de segredo desconhecido — a caixa precisa ser reconectada.");
  }
  const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  try {
    return Buffer.concat([d.update(Buffer.from(cifradoB64, "base64")), d.final()]).toString("utf8");
  } catch {
    // Chave trocada (rotação da EMAIL_CRYPTO_KEY) ou conteúdo adulterado. O erro do Node aqui
    // é "Unsupported state or unable to authenticate data" — inútil para quem está na tela e,
    // pior, chegava lá como 500 com stack. A única saída é reconectar a caixa: dizer isso.
    throw new Error("A senha guardada desta caixa não pôde ser aberta — a caixa precisa ser reconectada.");
  }
}
