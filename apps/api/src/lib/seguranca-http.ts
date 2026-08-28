/**
 * Estado REAL das proteções de cabeçalho HTTP, para o painel SISTEMA → Manutenção.
 *
 * Existe porque o painel guardava `cspLigada: false` fixo enquanto o `helmet` já publicava a
 * política inteira — um painel de segurança dizendo o contrário do que o servidor faz. O valor
 * aqui não é uma constante: quem o acende é o boot, na mesma linha em que registra a política.
 * Assim, o dia em que alguém tirar o registro apaga a marcação junto, e o painel volta a dizer
 * "Desligada" — que é o comportamento correto.
 */
let cspLigada = false;

/** Chamado pelo boot logo depois de registrar o helmet COM `contentSecurityPolicy`. */
export function marcarCspLigada(): void {
  cspLigada = true;
}

export function estaCspLigada(): boolean {
  return cspLigada;
}

/** Só para teste: o módulo guarda estado de processo, e cada caso precisa começar do zero. */
export function _resetarParaTeste(): void {
  cspLigada = false;
}
