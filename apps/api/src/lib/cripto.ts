import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * Primitivo de cifra da aplicação — AES-256-GCM, uma implementação só.
 *
 * Nasceu extraído de `cripto-caixa.ts` (senha da caixa de e-mail) quando a Conciliação passou a
 * precisar cifrar CPF/telefone/e-mail de paciente. Duplicar 40 linhas de criptografia é como se
 * ganha uma cópia que não recebe a correção da outra — então o algoritmo mora aqui e cada domínio
 * traz a SUA chave. O formato guardado e as mensagens do e-mail não mudaram: `cripto-caixa.ts`
 * continua sendo a porta daquele domínio.
 *
 * Cada domínio tem chave própria de propósito: rotacionar a chave do e-mail não pode tornar
 * ilegível o dado de paciente, e vice-versa.
 */

/** Versão do formato guardado. Trocar de esquema no futuro = novo prefixo, sem migration. */
const VERSAO = "v1";

/**
 * Lê uma chave de 32 bytes em base64 vinda da env. `nomeEnv` entra na mensagem porque um erro
 * dizendo só "chave inválida" não diz qual das duas chaves consertar.
 */
export function lerChave(b64: string | undefined, nomeEnv: string, seFaltar: string): Buffer {
  if (!b64) throw new Error(seFaltar);
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) {
    throw new Error(`${nomeEnv} inválida: são necessários 32 bytes em base64.`);
  }
  return k;
}

/** `true` quando a env traz uma chave utilizável — para o módulo se desligar sem derrubar a app. */
export function chaveValida(b64: string | undefined): boolean {
  if (!b64) return false;
  try {
    return Buffer.from(b64, "base64").length === 32;
  } catch {
    return false;
  }
}

/** Cifra. Formato: `v1:<iv>:<tag>:<cifrado>`, tudo em base64. */
export function cifrarCom(chave: Buffer, texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  const cifrado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [VERSAO, iv.toString("base64"), c.getAuthTag().toString("base64"), cifrado.toString("base64")].join(":");
}

/**
 * Decifra. Lança se a chave estiver errada OU se o conteúdo tiver sido adulterado (o GCM
 * autentica). As duas mensagens são do chamador: o erro cru do Node aqui é
 * "Unsupported state or unable to authenticate data", inútil para quem está na tela.
 */
export function decifrarCom(chave: Buffer, guardado: string, mensagens: { formato: string; ilegivel: string }): string {
  const [versao, ivB64, tagB64, cifradoB64] = guardado.split(":");
  if (versao !== VERSAO || !ivB64 || !tagB64 || !cifradoB64) {
    throw new Error(mensagens.formato);
  }
  const d = createDecipheriv("aes-256-gcm", chave, Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  try {
    return Buffer.concat([d.update(Buffer.from(cifradoB64, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new Error(mensagens.ilegivel);
  }
}

/**
 * Subchave derivada por HKDF, para usar a mesma env em dois propósitos sem que um vaze no outro.
 * Ex.: a chave do paciente cifra o CPF **e** gera o HMAC de busca — com a MESMA chave nos dois
 * papéis, quem obtivesse um oráculo de HMAC ganharia material sobre a cifra.
 */
export function subchave(chave: Buffer, proposito: string): Buffer {
  return Buffer.from(hkdfSync("sha256", chave, Buffer.alloc(0), proposito, 32));
}

/**
 * HMAC-SHA256 em hexadecimal — o "apelido" determinístico de um valor, para indexar e casar.
 *
 * Por que HMAC e não `sha256(valor)`: um hash puro de CPF **se quebra**. São ~11 dígitos com
 * dígito verificador, ou seja, um espaço pequeno o bastante para tabelar inteiro em minutos —
 * o hash devolveria o CPF. Com chave secreta, quem tiver o banco e não tiver a chave não tem nada.
 */
export function apelidoHmac(chave: Buffer, texto: string): string {
  return createHmac("sha256", chave).update(texto, "utf8").digest("hex");
}
