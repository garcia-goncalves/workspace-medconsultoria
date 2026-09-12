import { config } from "../config.js";
import { cifrarCom, decifrarCom, lerChave } from "./cripto.js";

/**
 * Segredo da caixa de e-mail plugada por cada pessoa (senha IMAP/SMTP).
 *
 * O algoritmo saiu daqui para `cripto.ts` quando a Conciliação passou a precisar cifrar dado de
 * paciente — a implementação é uma só, mas a CHAVE é deste domínio: rotacionar a chave do
 * paciente não pode deixar ilegível a senha de ninguém. Formato guardado inalterado
 * (`v1:<iv>:<tag>:<cifrado>`), portanto tudo que já está no banco continua abrindo.
 */

function chave(): Buffer {
  return lerChave(
    config.EMAIL_CRYPTO_KEY,
    "EMAIL_CRYPTO_KEY",
    "EMAIL_CRYPTO_KEY não configurada — o e-mail dentro da aplicação está desligado.",
  );
}

/** Cifra a senha da caixa. Formato: `v1:<iv>:<tag>:<cifrado>`, tudo em base64. */
export function cifrar(texto: string): string {
  return cifrarCom(chave(), texto);
}

/** Decifra. Lança se a chave estiver errada OU se o conteúdo tiver sido adulterado (GCM). */
export function decifrar(guardado: string): string {
  return decifrarCom(chave(), guardado, {
    formato: "Formato de segredo desconhecido — a caixa precisa ser reconectada.",
    // Chave trocada (rotação da EMAIL_CRYPTO_KEY) ou conteúdo adulterado. O erro do Node aqui
    // é "Unsupported state or unable to authenticate data" — inútil para quem está na tela e,
    // pior, chegava lá como 500 com stack. A única saída é reconectar a caixa: dizer isso.
    ilegivel: "A senha guardada desta caixa não pôde ser aberta — a caixa precisa ser reconectada.",
  });
}
