/**
 * Textos puros da verificação em duas etapas (onda 4C), separados do componente para serem
 * testados sem montar tela.
 */

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": digitar 32 letras seguidas no celular é onde se erra. */
export function agruparChave(chave: string): string {
  return chave.replace(/(.{4})(?=.)/g, "$1 ");
}

/** Conteúdo do .txt dos códigos de recuperação — com o aviso junto, porque o arquivo vai viver longe da tela. */
export function textoDosCodigos(codigos: string[]): string {
  return [
    "MedConsultoria — códigos de recuperação da verificação em duas etapas",
    "",
    "Cada código entra UMA vez, no lugar do código do aplicativo, se você perder o celular.",
    "Guarde este arquivo num lugar seguro e apague-o deste computador depois.",
    "",
    ...codigos,
    "",
  ].join("\n");
}
