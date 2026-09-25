/**
 * ⚠️ **`%` E `_` SÃO CORINGAS DO `LIKE`, E O `contains` DO PRISMA NÃO OS ESCAPA.**
 *
 * Sem isto, um termo `"%%"` passa em qualquer mínimo de 2 caracteres e vira `LIKE '%%%%'`, que
 * **casa tudo**: a busca deixa de ser busca e vira listagem da base. Achado primeiro na API do
 * agente (ADR-150) e de novo na busca global (revisão da onda 4) — por isso mora aqui, num lugar
 * só, em vez de ser copiado a cada busca nova. A barra invertida entra junto porque é o caractere
 * de escape do próprio `LIKE`.
 */
export function escaparCoringas(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}
