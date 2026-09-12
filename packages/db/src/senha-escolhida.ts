/**
 * Validação da senha ESCOLHIDA no `pnpm senha:rotacionar <senha>` (ambiente local).
 *
 * O script grava o valor dentro de aspas duplas na linha `SEED_ROOT_PASSWORD` do `.env`.
 * Caractere errado ali não estoura erro: corrompe o arquivo em silêncio. E o `.env` é o que
 * a aplicação, os testes e o `pnpm acessos` leem — o desfecho é NADA autenticar no ambiente
 * local, com a senha "certa" na mão. Daí a recusa preventiva, com motivo em português.
 *
 * Função pura (sem I/O) para ser testável, no mesmo molde do `podeRodarDemoSeed`.
 */
export interface ResultadoSenha {
  valida: boolean;
  motivo: string;
}

/** Piso de tamanho. Baixo de propósito: é senha de ambiente de mentira, não de servidor. */
const MINIMO = 8;

export function validarSenhaEscolhida(senha: string): ResultadoSenha {
  if (!senha || !senha.trim()) {
    return { valida: false, motivo: "senha vazia." };
  }
  if (senha !== senha.trim()) {
    return {
      valida: false,
      motivo:
        "a senha começa ou termina com espaço — ele some na leitura do arquivo e ninguém descobre por que o login falha.",
    };
  }
  if (senha.length < MINIMO) {
    return { valida: false, motivo: `a senha tem ${senha.length} caracteres; o mínimo é ${MINIMO}.` };
  }
  if (senha.includes('"')) {
    return { valida: false, motivo: 'a senha tem aspas duplas ("), que fecham a linha do arquivo no meio.' };
  }
  if (senha.includes("\\")) {
    return {
      valida: false,
      motivo: "a senha tem barra invertida (\\), que vira código de escape na leitura do arquivo.",
    };
  }
  if (/[\r\n]/.test(senha)) {
    return { valida: false, motivo: "a senha tem quebra de linha, que partiria o arquivo em duas linhas." };
  }
  return { valida: true, motivo: "" };
}
