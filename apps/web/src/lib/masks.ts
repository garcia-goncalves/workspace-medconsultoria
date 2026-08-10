/** Máscaras de formatação para inputs (aplicadas conforme o usuário digita). */

function aplicar(digitos: string, grupos: number[], seps: string[]): string {
  let out = "";
  let i = 0;
  for (let g = 0; g < grupos.length && i < digitos.length; g++) {
    if (g > 0) out += seps[g - 1];
    out += digitos.slice(i, i + grupos[g]!);
    i += grupos[g]!;
  }
  return out;
}

/** Telefone BR: (11) 90000-0000 (celular) ou (11) 3000-0000 (fixo). */
export function maskTelefone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** CPF: 000.000.000-00. */
export function maskCPF(v: string): string {
  return aplicar(v.replace(/\D/g, "").slice(0, 11), [3, 3, 3, 2], [".", ".", "-"]);
}

/** CNPJ: 00.000.000/0000-00. */
export function maskCNPJ(v: string): string {
  return aplicar(v.replace(/\D/g, "").slice(0, 14), [2, 3, 3, 4, 2], [".", ".", "/", "-"]);
}

/** CPF ou CNPJ, detectado pelo tamanho. */
export function maskCpfCnpj(v: string): string {
  return v.replace(/\D/g, "").length <= 11 ? maskCPF(v) : maskCNPJ(v);
}

/** CEP: 00000-000. */
export function maskCEP(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Só dígitos (para desmascarar antes de enviar, quando necessário). */
export const soDigitos = (v: string): string => v.replace(/\D/g, "");

const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Formata um número como moeda brasileira: 1000 → "R$ 1.000,00". Vazio → "". */
export function formatBRL(valor: number | null | undefined): string {
  if (valor == null || Number.isNaN(valor)) return "";
  return brlFmt.format(valor);
}

/**
 * Interpreta o que o usuário digita num campo de moeda como centavos (preenche da
 * direita p/ esquerda): "150090" → 1500.90. Devolve `undefined` se não houver dígitos.
 */
export function parseBRL(texto: string): number | undefined {
  const d = texto.replace(/\D/g, "");
  if (!d) return undefined;
  return Number(d) / 100;
}

/**
 * Valor em reais POR EXTENSO (recibos, proposta de credenciamento). Vive em `@app/shared`
 * porque o servidor também escreve documento — reexportado aqui para os imports de tela
 * continuarem vindo de `lib/masks`, o endereço único de formatação da app (ADR-32).
 */
export { valorPorExtenso } from "@app/shared";

/** Moeda compacta para KPIs: 1500 → "R$ 1,5k"; abaixo de mil → completo. Vazio → "". */
export function formatBRLCompact(valor: number | null | undefined): string {
  if (valor == null || Number.isNaN(valor)) return "";
  if (Math.abs(valor) >= 1000) return `R$ ${(valor / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return brlFmt.format(valor);
}

/** Percentual pt-BR: 5 → "5%"; 2.5 → "2,5%". */
export function formatPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "";
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

type PrecoServico = {
  valor?: number | null;
  valorRecorrencia?: "AVULSO" | "MENSAL" | null;
  percentual?: number | null;
  percentualRecorrencia?: "AVULSO" | "MENSAL" | null;
};

/**
 * Rótulo de preço de um serviço, cobrindo os cenários: valor fixo, % do faturamento,
 * ou os dois juntos — cada um avulso (1x) ou mensal. Ex.: "R$ 1.800,00/mês",
 * "5% do faturamento/mês", "R$ 1.000,00 + 5% do faturamento/mês". Vazio → "".
 */
export function formatPreco(s: PrecoServico): string {
  const suf = (r?: string | null) => (r === "MENSAL" ? "/mês" : "");
  const partes: string[] = [];
  if (s.valor != null && s.valor > 0) partes.push(formatBRL(s.valor) + suf(s.valorRecorrencia));
  if (s.percentual != null && s.percentual > 0) partes.push(`${formatPct(s.percentual)} do faturamento${suf(s.percentualRecorrencia)}`);
  return partes.join(" + ");
}
