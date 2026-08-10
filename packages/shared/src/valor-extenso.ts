/**
 * Valor em reais POR EXTENSO: 1500.9 → "mil e quinhentos reais e noventa centavos".
 * Cobre até bilhões. Vazio/zero → "".
 *
 * Mora no `shared` porque o SERVIDOR também precisa escrever valor por extenso: a proposta
 * de credenciamento é montada no back (ADR-104) e o recibo, na tela. O mesmo número escrito
 * de duas formas no mesmo papel é erro de documento, não detalhe de código — por isso há uma
 * implementação só (ADR-32). `apps/web/src/lib/masks.ts` reexporta daqui.
 */
export function valorPorExtenso(valor: number | null | undefined): string {
  if (valor == null || Number.isNaN(valor) || valor <= 0) return "";
  const reais = Math.floor(valor);
  const centavos = Math.round((valor - reais) * 100);

  const unidades = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
  const dez = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const dezenas = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const centenas = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

  // Converte um trio de 0..999 em palavras.
  const trio = (n: number): string => {
    if (n === 0) return "";
    if (n === 100) return "cem";
    const c = Math.floor(n / 100);
    const resto = n % 100;
    const partes: string[] = [];
    if (c > 0) partes.push(centenas[c]!);
    if (resto > 0) {
      if (resto < 10) partes.push(unidades[resto]!);
      else if (resto < 20) partes.push(dez[resto - 10]!);
      else {
        const d = Math.floor(resto / 10);
        const u = resto % 10;
        partes.push(u > 0 ? `${dezenas[d]} e ${unidades[u]}` : dezenas[d]!);
      }
    }
    return partes.join(" e ");
  };

  const escalas: [number, string, string][] = [
    [1_000_000_000, "bilhão", "bilhões"],
    [1_000_000, "milhão", "milhões"],
    [1_000, "mil", "mil"],
  ];
  let resto = reais;
  const grupos: { word: string; val: number }[] = [];
  for (const [valorEscala, sing, plur] of escalas) {
    const q = Math.floor(resto / valorEscala);
    if (q > 0) {
      const word = valorEscala === 1_000 && q === 1 ? "mil" : `${trio(q)} ${q === 1 ? sing : plur}`;
      grupos.push({ word, val: q * valorEscala });
      resto %= valorEscala;
    }
  }
  if (resto > 0) grupos.push({ word: trio(resto), val: resto });

  // Regra do "e" (pt-BR): liga o grupo seguinte com "e" quando ele é < 100 ou centena redonda
  // (ex.: "mil e quinhentos"); senão, apenas espaço (ex.: "mil duzentos e trinta e quatro").
  let texto = "";
  grupos.forEach((g, i) => {
    if (i === 0) texto = g.word;
    else texto += (g.val < 100 || g.val % 100 === 0 ? " e " : " ") + g.word;
  });

  if (reais > 0) {
    // "de reais" quando o valor é milhão/bilhão exato (ex.: "um milhão de reais").
    const soGrande = reais >= 1_000_000 && reais % 1_000_000 === 0;
    texto += soGrande ? " de reais" : reais === 1 ? " real" : " reais";
  }

  if (centavos > 0) {
    const cent = `${trio(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`;
    texto = texto ? `${texto} e ${cent}` : cent;
  }
  return texto.trim();
}
