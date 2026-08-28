/**
 * Peneira de dado pessoal para o que sai da casa (hoje: a OpenAI). Ver ADR-141.
 *
 * DUAS FUNÇÕES, e o par é o ponto: `redigirDadoPessoal` troca cada dado por uma
 * etiqueta ANTES de enviar, `restaurarDadoPessoal` devolve o original NA VOLTA.
 * Apagar de vez seria mais simples e estaria errado — "melhorar com IA" devolve o
 * corpo do documento, e um contrato voltando com "[removido]" no lugar do CNPJ é
 * perda de dado. Assim o terceiro nunca vê o dado e o texto continua inteiro.
 *
 * O que NÃO é escondido, de propósito: o NOME. Sem ele o resumo do cliente não
 * serve para nada, e a decisão de trocá-lo por identificador está registrada como
 * pendência jurídica em docs/IA_PRIVACIDADE.md.
 *
 * ⚠️ Isto pega dado ESTRUTURADO (o que tem forma). Texto corrido — "o filho do
 * Dr. João" — nenhuma expressão regular pega. Por isso campo de texto livre que
 * ninguém precisa (como `observacoes`) é retirado do contexto na origem, além
 * desta peneira. São duas camadas, não uma.
 */

export type TipoDadoPessoal = "EMAIL" | "CNPJ" | "CPF" | "CRM" | "RG" | "CEP" | "TELEFONE" | "NUMERO";

export type AchadoPessoal = {
  tipo: TipoDadoPessoal;
  indice: number;
  /** O que foi posto no lugar, ex.: `[[CPF-1]]`. */
  etiqueta: string;
  /** O valor real, que volta no lugar da etiqueta. */
  original: string;
};

export type TextoRedigido = { texto: string; achados: AchadoPessoal[] };

/**
 * A ordem importa: e-mail primeiro (tem ponto e dígito dentro), documento com
 * máscara antes do número nu, senão o pedaço maior é comido pelo padrão menor.
 */
const PADROES: { tipo: TipoDadoPessoal; re: RegExp }[] = [
  { tipo: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]{2,}/g },
  // CNPJ aceita o formato alfanumérico válido desde julho/2026 (ver packages/shared/src/cnpj.ts).
  { tipo: "CNPJ", re: /(?<![A-Za-z0-9])[A-Za-z0-9]{2}\.[A-Za-z0-9]{3}\.[A-Za-z0-9]{3}\/[A-Za-z0-9]{4}-\d{2}(?![A-Za-z0-9])/g },
  { tipo: "CPF", re: /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g },
  { tipo: "CRM", re: /\bCRM\s*[-/:]?\s*[A-Za-z]{0,2}\s*[-/:]?\s*\d{4,7}\b/g },
  { tipo: "RG", re: /\bRG\s*(?:n[ºo°]?\.?)?\s*[:.-]?\s*\d[\d.]{4,12}-?[\dxX]?\b/g },
  { tipo: "CEP", re: /(?<!\d)\d{5}-\d{3}(?!\d)/g },
  { tipo: "TELEFONE", re: /(?<![\d-])(?:\+55[\s-]?)?(?:\(\d{2}\)\s?|\d{2}\s)?(?:9\s?)?\d{4}[-\s]\d{4}(?![\d-])/g },
  { tipo: "NUMERO", re: /(?<!\d)\d{14}(?!\d)/g }, // CNPJ sem máscara
  { tipo: "NUMERO", re: /(?<!\d)\d{11}(?!\d)/g }, // CPF ou celular sem máscara — não dá para saber qual, e os dois são pessoais
];

/** "2024-2025" tem a forma de telefone e é intervalo de anos. Não é dado de ninguém. */
function ehIntervaloDeAnos(trecho: string): boolean {
  return /^(?:19|20)\d{2}\s?[-\s]\s?(?:19|20)\d{2}$/.test(trecho.trim());
}

/** Troca todo dado pessoal com forma reconhecível por uma etiqueta estável. */
export function redigirDadoPessoal(texto: string): TextoRedigido {
  if (!texto) return { texto: texto ?? "", achados: [] };

  const achados: AchadoPessoal[] = [];
  const jaVisto = new Map<string, string>(); // o mesmo dado repetido usa a MESMA etiqueta
  let saida = texto;

  for (const { tipo, re } of PADROES) {
    saida = saida.replace(re, (encontrado) => {
      if (tipo === "TELEFONE" && ehIntervaloDeAnos(encontrado)) return encontrado;
      const existente = jaVisto.get(encontrado);
      if (existente) return existente;
      const indice = achados.length + 1;
      const etiqueta = `[[${tipo}-${indice}]]`;
      jaVisto.set(encontrado, etiqueta);
      achados.push({ tipo, indice, etiqueta, original: encontrado });
      return etiqueta;
    });
  }

  return { texto: saida, achados };
}

/**
 * Devolve os originais. Etiqueta que não voltou (a IA pode ter reescrito o trecho)
 * simplesmente não é restaurada — some do rascunho, que é revisado por gente.
 */
export function restaurarDadoPessoal(texto: string, achados: AchadoPessoal[]): string {
  let saida = texto;
  for (const a of achados) {
    // tolera espaço extra que o modelo às vezes acrescenta dentro dos colchetes
    saida = saida.replace(new RegExp(`\\[\\[\\s*${a.tipo}-${a.indice}\\s*\\]\\]`, "g"), a.original);
  }
  return saida;
}

/** Instrução acrescentada ao system quando houve algo a esconder. */
export const AVISO_MARCADORES_IA =
  "IMPORTANTE: o texto contém marcadores no formato [[TIPO-N]] (ex.: [[CPF-1]]) que substituem dados sigilosos. Mantenha cada marcador EXATAMENTE como está, no mesmo lugar. Nunca invente, complete, traduza ou remova um marcador.";

/**
 * ELIMINAÇÃO PELO TITULAR (LGPD art. 18, V) — ADR-141.
 *
 * Apagar de verdade é impossível aqui, e não por preguiça: contrato assinado, conta a
 * receber e processo de credenciamento têm guarda obrigatória, e `excluirDefinitivoCliente`
 * bloqueia diante de QUALQUER vínculo — na prática nenhum cliente real é eliminável.
 * Anonimizar é a saída que a lei aceita quando existe dever de guarda: o dado deixa de
 * identificar a pessoa, as linhas contábeis continuam de pé.
 */
export const MARCADOR_ANONIMIZADO = "[dado removido a pedido do titular]";

/**
 * E-mail de quem foi anonimizado. Precisa ser ÚNICO (a coluna é única) e precisa ser
 * inválido de propósito — endereço plausível voltaria a receber e-mail nosso.
 */
export function emailAnonimizado(id: string): string {
  return `removido-${id}@invalido.local`;
}

/**
 * Versão do AVISO DE PRIVACIDADE em vigor (ADR-141) — a data em que o texto de
 * `/privacidade` mudou pela última vez.
 *
 * ⚠️ Guardar só a data do aceite não prova nada: o texto muda com o tempo, e a prova do
 * consentimento é a data MAIS o que estava escrito naquele dia. Quem editar a página
 * PRECISA subir este número — é por isso que ele mora ao lado do resto da regra de dado
 * pessoal, e não escondido dentro do componente da tela.
 */
export const AVISO_PRIVACIDADE_VERSAO = "2026-08-28";
