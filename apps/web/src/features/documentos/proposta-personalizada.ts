import {
  ehServicoSomentePercentual,
  fraseDoRepasse,
  type CriarPropostaPersonalizadaInput,
  type ItemPersonalizadoResolvido,
} from "@app/shared";

/**
 * O estado do editor da Proposta PERSONALIZADA (ADR-156) e as conversões puras dele — para a
 * prévia e para o envio ao servidor. Fica fora do componente para ser testável sem DOM.
 */

export type LinhaForm = {
  chave: string;
  /** Serviço do catálogo; `null` = linha avulsa. */
  servicoId: string | null;
  /** Linha avulsa: o nome dela. Linha do catálogo: texto que substitui o nome no papel (opcional). */
  descricao: string;
  cobranca: "FIXO" | "PERCENTUAL";
  valor: number;
  quantidade: number;
  recorrencia: "AVULSO" | "MENSAL";
  percentual: number | null;
};
export type SecaoForm = { chave: string; titulo: string; corpo: string };
export type ClausulaForm = { chave: string; texto: string };
export type PersonalizadaForm = {
  itens: LinhaForm[];
  secoes: SecaoForm[];
  clausulas: ClausulaForm[];
  validadeDias: number;
  observacoes: string;
};

let seq = 0;
/** Chave estável da linha na lista (o `key` do React) — nunca vai ao servidor. */
export const novaChave = () => `k${++seq}`;

export const APRESENTACAO_PADRAO =
  "A MedConsultoria cuida de todos os processos da sua clínica para lhe dar mais tempo e tranquilidade " +
  "para fazer o que mais importa: cuidar de vidas. Apresentamos a seguir a proposta pensada para as suas necessidades.";

export function novaPersonalizada(): PersonalizadaForm {
  return {
    itens: [],
    secoes: [
      { chave: novaChave(), titulo: "Apresentação", corpo: APRESENTACAO_PADRAO },
      { chave: novaChave(), titulo: "Escopo do trabalho", corpo: "" },
    ],
    clausulas: [],
    validadeDias: 15,
    observacoes: "",
  };
}

export function novaLinha(servico?: { id: string; valor: number | null; valorRecorrencia: "AVULSO" | "MENSAL" | null }): LinhaForm {
  return {
    chave: novaChave(),
    servicoId: servico?.id ?? null,
    descricao: "",
    cobranca: "FIXO",
    valor: servico?.valor ?? 0,
    quantidade: 1,
    recorrencia: servico?.valorRecorrencia ?? "AVULSO",
    percentual: null,
  };
}

/** Move o elemento `i` uma casa para cima (`-1`) ou para baixo (`+1`); nas pontas, não mexe. */
export function mover<T>(lista: T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  if (i < 0 || i >= lista.length || j < 0 || j >= lista.length) return lista;
  const nova = [...lista];
  [nova[i], nova[j]] = [nova[j]!, nova[i]!];
  return nova;
}

/** A linha como ela é COBRADA: valor fixo zera o percentual e vice-versa (nunca os dois). */
function precoDaLinha(l: LinhaForm) {
  return l.cobranca === "PERCENTUAL"
    ? { valor: 0, quantidade: 1, recorrencia: "MENSAL" as const, percentual: l.percentual ?? null }
    : { valor: l.valor || 0, quantidade: Math.max(1, l.quantidade || 1), recorrencia: l.recorrencia, percentual: null };
}

type ServicoDaTela = { id: string; nome: string; descricao?: string | null; condicaoPagamento?: string | null };

/**
 * As linhas com nome resolvido, para a PRÉVIA — a mesma regra do servidor: o texto digitado vale
 * como nome; senão o nome do catálogo.
 */
export function resolverParaPrevia(form: PersonalizadaForm, servicos: ServicoDaTela[]) {
  const itens: ItemPersonalizadoResolvido[] = [];
  const condicoes: (string | null)[] = [];
  for (const l of form.itens) {
    const sv = l.servicoId ? servicos.find((s) => s.id === l.servicoId) : undefined;
    const preco = precoDaLinha(l);
    if (ehServicoSomentePercentual({ valor: preco.valor, percentual: preco.percentual })) condicoes.push(sv?.condicaoPagamento ?? null);
    itens.push({ nome: l.descricao.trim() || sv?.nome || "Serviço", detalhe: sv?.descricao ?? null, ...preco });
  }
  return { itens, fraseRepasse: condicoes.length ? fraseDoRepasse(condicoes) : null };
}

/** O que a tela manda ao servidor (sem destino/modelo/título, que o diálogo acrescenta). */
export function payloadDaPersonalizada(
  form: PersonalizadaForm,
): Pick<CriarPropostaPersonalizadaInput, "itens" | "secoes" | "clausulas" | "validadeDias" | "formaPagamento" | "observacoes"> {
  return {
    itens: form.itens
      // Linha avulsa sem nome não vai: o servidor a recusaria e a pessoa não saberia qual.
      .filter((l) => l.servicoId || l.descricao.trim())
      .map((l) => ({ servicoId: l.servicoId ?? undefined, descricao: l.descricao.trim() || undefined, ...precoDaLinha(l) })),
    secoes: form.secoes
      .filter((s) => s.titulo.trim() || s.corpo.trim())
      .map((s) => ({ titulo: s.titulo.trim() || "Seção", corpo: s.corpo.trim() })),
    clausulas: form.clausulas.map((c) => c.texto.trim()).filter(Boolean),
    validadeDias: Math.min(365, Math.max(1, Math.round(form.validadeDias || 15))),
    formaPagamento: "PIX",
    observacoes: form.observacoes.trim() || undefined,
  };
}

/** Há o mínimo para gerar? (um item, ou uma seção com texto) — a mesma régua do schema. */
export function personalizadaTemConteudo(form: PersonalizadaForm): boolean {
  const p = payloadDaPersonalizada(form);
  return p.itens.length > 0 || p.secoes.some((s) => s.corpo);
}
