/**
 * O ESCRITOR DE PLANILHA DA CASA — CSV que o Excel em pt-BR abre certo, sem dependência.
 *
 * É a mesma receita da exportação da Conciliação (`modules/conciliacao/exportacao.ts`): BOM na
 * frente (sem ele o Excel lê "Honorários" como "HonorÃ¡rios"), `;` como separador (o `,` é a
 * vírgula decimal daqui), `\r\n` entre linhas, texto sempre entre aspas e dinheiro como
 * `1234,56` — sem milhar, para o Excel ler como NÚMERO e o contador conseguir somar a coluna.
 *
 * ⚠️ POR QUE NÃO `exceljs`: a metade dele que escreve arrasta um `minimatch` com falha ALTA, e
 * fechar isso exige override que o tradutor do artefato de publicação recusa (ADR-116/117).
 *
 * ⚠️ As regras aqui são CÓPIA FIEL das privadas da Conciliação, e não um import: aquele módulo
 * está sendo mexido em paralelo por outra frente, e tirar as funções de lá agora criaria conflito
 * sem ganho para o usuário. O passo seguinte é a Conciliação importar DAQUI — duas cópias da
 * proteção contra fórmula divergem no dia em que alguém corrigir só uma.
 */

/**
 * Texto entre aspas, e SEM ABRIR PORTA PARA FÓRMULA quando a planilha for aberta no Excel.
 *
 * ⚠️ A descrição de uma conta é digitada por gente, e o nome do cliente pode ter nascido no
 * formulário público `/comecar`, que qualquer anônimo preenche. Uma célula que começa com `=`,
 * `+`, `-` ou `@` o Excel EXECUTA como fórmula (CSV injection) — no computador do contador, que
 * confia no arquivo porque veio de nós. O apóstrofo na frente faz o Excel mostrar o texto como
 * texto. Tab e retorno de carro entram na lista porque também disparam a interpretação.
 */
export function celulaTexto(v: string | null | undefined): string {
  let s = v ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Dinheiro no jeito brasileiro, sem milhar: `1234,56` — o Excel em pt-BR lê como número. */
export function celulaReais(v: number | null): string {
  return v === null ? "" : v.toFixed(2).replace(".", ",");
}

/** Junta as linhas no CSV final (BOM + `;` + `\r\n`). As células já vêm formatadas. */
export function montarCsv(linhas: string[][]): string {
  return "\uFEFF" + linhas.map((l) => l.join(";")).join("\r\n") + "\r\n";
}
