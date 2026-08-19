/**
 * CNPJ: validação por dígito verificador e formatação para exibir.
 *
 * Vive em `@app/shared` de propósito: a tela valida para avisar cedo, e o SERVIDOR valida
 * de novo porque entrada de fora é hostil. Uma regra só, nos dois lados.
 *
 * Não confundir com `schemas/documento.ts`, que trata de DOCUMENTO no sentido de proposta,
 * contrato e ata — outra coisa.
 *
 * Só CNPJ, e é de propósito: todo cliente da MedConsultoria é pessoa jurídica (ADR-119).
 *
 * **CNPJ alfanumérico** (Receita Federal, IN 2.229/2024, em vigor desde julho/2026): os 12
 * primeiros caracteres podem ser letra ou número; os 2 verificadores continuam numéricos.
 * O cálculo é o módulo 11 de sempre sobre o código ASCII menos 48 de cada caractere
 * ("0"→0 … "9"→9, "A"→17 … "Z"→42). Validador só-numérico recusaria empresa aberta depois
 * de julho/2026 — e a clínica nova é justamente o cliente que a Med quer cadastrar.
 */

/** Tira pontuação e espaço, e sobe para maiúscula (o alfanumérico é sempre maiúsculo). */
export const limparCNPJ = (v: string | null | undefined): string =>
  (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/** Valor de um caractere no módulo 11 do CNPJ: código ASCII menos 48. */
const valorCaractere = (c: string): number => c.charCodeAt(0) - 48;

/** Dígito verificador módulo 11 sobre os valores já convertidos (peso 2..9 da direita). */
function digitoModulo11(valores: number[]): number {
  let peso = 2;
  let soma = 0;
  for (let i = valores.length - 1; i >= 0; i--) {
    soma += valores[i]! * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * CNPJ válido? Aceita com ou sem pontuação, numérico ou alfanumérico.
 * Recusa a sequência de 14 caracteres iguais (`00000000000000`), que passa no cálculo
 * mas não é CNPJ de ninguém.
 */
export function validarCNPJ(valor: string | null | undefined): boolean {
  const limpo = limparCNPJ(valor);
  if (limpo.length !== 14) return false;
  if (/^(.)\1{13}$/.test(limpo)) return false;
  // Os dois verificadores são obrigatoriamente numéricos, mesmo no formato alfanumérico.
  if (!/^\d{2}$/.test(limpo.slice(12))) return false;

  const valores = limpo.slice(0, 12).split("").map(valorCaractere);
  const dv1 = digitoModulo11(valores);
  const dv2 = digitoModulo11([...valores, dv1]);
  return limpo === limpo.slice(0, 12) + String(dv1) + String(dv2);
}

/** 11222333000181 → "11.222.333/0001-81". Sem os 14 caracteres, devolve o que veio. */
export function formatarCNPJ(valor: string | null | undefined): string {
  const limpo = limparCNPJ(valor);
  if (limpo.length !== 14) return valor ?? "";
  return `${limpo.slice(0, 2)}.${limpo.slice(2, 5)}.${limpo.slice(5, 8)}/${limpo.slice(8, 12)}-${limpo.slice(12)}`;
}
