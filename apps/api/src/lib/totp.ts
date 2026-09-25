import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) — o código de 6 dígitos do aplicativo autenticador, feito à mão.
 *
 * Por que não uma biblioteca: são ~40 linhas de `node:crypto`, testadas contra os vetores
 * oficiais do RFC (ver `totp.test.ts`), e a política da casa é não trazer pacote para o que
 * 20 linhas resolvem — cada dependência nova é mais uma superfície de cadeia de suprimento,
 * e aqui ela ficaria justamente no caminho do login.
 *
 * Parâmetros FIXOS, os que todo aplicativo (Google Authenticator, Microsoft, 1Password, Authy)
 * entende sem configuração: HMAC-SHA1, passo de 30 s, 6 dígitos. ⚠️ SHA1 aqui NÃO é fraqueza:
 * o HMAC-SHA1 continua seguro (o ataque de colisão ao SHA1 não se aplica a HMAC), e trocar para
 * SHA256 faz vários aplicativos gerarem o código ERRADO em silêncio — a pessoa ficaria trancada.
 */

export const PASSO_SEGUNDOS = 30;
const DIGITOS = 6;
/** Tolerância de ±1 passo (±30 s): relógio de celular atrasado não pode trancar ninguém fora. */
const JANELA = 1;

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 (RFC 4648) SEM o preenchimento `=` — é a forma que o `otpauth://` espera. */
export function base32Codificar(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const byte of bytes) {
    valor = ((valor << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

/**
 * Decodifica Base32, tolerante ao que a pessoa cola: minúscula, espaço, hífen e `=` final.
 * Caractere fora do alfabeto é ERRO, nunca ignorado — um segredo decodificado pela metade daria
 * códigos que nunca batem, e o sintoma seria "o aplicativo não funciona".
 */
export function base32Decodificar(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  let bits = 0;
  let valor = 0;
  const saida: number[] = [];
  for (const ch of limpo) {
    const i = ALFABETO.indexOf(ch);
    if (i < 0) throw new Error("Chave em Base32 inválida.");
    valor = ((valor << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}

/** Segredo novo: 20 bytes (160 bits), o tamanho que o RFC 4226 recomenda para HMAC-SHA1. */
export function gerarSegredoTotp(): Buffer {
  return randomBytes(20);
}

/** Passo de tempo (contador do HOTP) de um instante. */
export function passoDoInstante(agoraMs: number): number {
  return Math.floor(agoraMs / 1000 / PASSO_SEGUNDOS);
}

/**
 * O código de um passo (HOTP, RFC 4226 §5.3). `digitos` existe só para o teste conferir os
 * vetores de 8 dígitos do RFC 6238; a aplicação usa sempre 6.
 */
export function codigoDoPasso(segredo: Buffer, passo: number, digitos = DIGITOS): string {
  const contador = Buffer.alloc(8);
  // ⚠️ `writeBigUInt64BE` e não dois `writeUInt32BE` à mão: o passo cabe em 32 bits hoje, mas o
  // vetor do RFC para o ano 2603 (T = 20000000000) não cabe — e é esse vetor que prova a conta.
  contador.writeBigUInt64BE(BigInt(passo));
  const hmac = createHmac("sha1", segredo).update(contador).digest();
  const deslocamento = hmac[hmac.length - 1]! & 0x0f;
  const binario =
    ((hmac[deslocamento]! & 0x7f) << 24) |
    (hmac[deslocamento + 1]! << 16) |
    (hmac[deslocamento + 2]! << 8) |
    hmac[deslocamento + 3]!;
  return String(binario % 10 ** digitos).padStart(digitos, "0");
}

/** Comparação em tempo constante de dois códigos do mesmo tamanho. */
function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Confere um código digitado e devolve o PASSO que ele representa (ou `null`).
 *
 * Devolver o passo, e não um booleano, é o que permite o anti-replay: quem chama grava o passo
 * aceito e recusa qualquer código de passo igual ou anterior (`ultimoPasso`). Sem isso, quem
 * espiasse o código por cima do ombro podia reusá-lo durante a janela de ±30 s.
 *
 * ⚠️ Percorre a janela INTEIRA mesmo depois de achar, para o tempo de resposta não dizer em qual
 * passo o código bateu.
 */
export function conferirCodigoTotp(
  segredo: Buffer,
  codigo: string,
  agoraMs: number,
  ultimoPasso: number | null,
): number | null {
  const digitado = codigo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digitado)) return null;
  const atual = passoDoInstante(agoraMs);
  let aceito: number | null = null;
  for (let d = -JANELA; d <= JANELA; d++) {
    const passo = atual + d;
    if (iguais(codigoDoPasso(segredo, passo), digitado) && aceito === null) aceito = passo;
  }
  if (aceito === null) return null;
  if (ultimoPasso !== null && aceito <= ultimoPasso) return null;
  return aceito;
}

/**
 * O endereço `otpauth://` que o aplicativo autenticador importa (formato do Google, o padrão
 * de fato). O emissor vai no rótulo E no parâmetro, como a especificação recomenda — é ele que
 * faz a entrada aparecer como "MedConsultoria" no celular, e não só o e-mail solto.
 */
export function uriOtpauth(segredoBase32: string, conta: string, emissor = "MedConsultoria"): string {
  const rotulo = `${encodeURIComponent(emissor)}:${encodeURIComponent(conta)}`;
  const q = new URLSearchParams({
    secret: segredoBase32,
    issuer: emissor,
    algorithm: "SHA1",
    digits: String(DIGITOS),
    period: String(PASSO_SEGUNDOS),
  });
  return `otpauth://totp/${rotulo}?${q.toString()}`;
}
