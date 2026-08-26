/**
 * DADOS PARA PAGAMENTO e a FRASE DO REPASSE — as duas peças que a proposta precisa dizer sobre
 * dinheiro e que não cabem no preço de nenhum serviço.
 *
 * Por que aqui, puro e sem Prisma: o bloco bancário sai no papel que vai ao cliente. Conta
 * errada ali é dinheiro no lugar errado, e a única forma honesta de provar que ele monta certo
 * (e que SOME quando falta informação, em vez de sair pela metade) é um teste de unidade sobre
 * uma função pura. Ver ADR-127.
 */

/** Os dados bancários como a Thaís os cadastra em Ajustes → Dados da empresa. */
export interface DadosParaPagamento {
  bancoNome: string | null | undefined;
  bancoAgencia: string | null | undefined;
  bancoConta: string | null | undefined;
  bancoTitular: string | null | undefined;
  pixChave: string | null | undefined;
}

const limpo = (v: string | null | undefined) => (v ?? "").trim();

/**
 * Monta o bloco "Dados para pagamento" em Markdown, ou devolve `""` quando não há **nada**
 * cadastrado.
 *
 * A regra do vazio é a parte que importa: um campo em branco não vira "Agência: " na frente do
 * cliente — a linha inteira desaparece. Se nenhum dos cinco estiver preenchido, o bloco todo
 * desaparece, e a proposta sai sem uma seção pela metade. Preencher é trabalho da Thaís, em
 * Ajustes; inventar número de conta não é trabalho de ninguém.
 */
export function montarDadosPagamento(d: DadosParaPagamento): string {
  const linhas: string[] = [];
  const par = (rotulo: string, valor: string) => {
    if (valor) linhas.push(`| ${rotulo} | ${valor} |`);
  };
  par("Banco", limpo(d.bancoNome));
  par("Agência", limpo(d.bancoAgencia));
  par("Conta", limpo(d.bancoConta));
  par("Titular", limpo(d.bancoTitular));
  par("Chave PIX", limpo(d.pixChave));
  if (!linhas.length) return "";
  return ["| | |", "| --- | --- |", ...linhas].join("\n");
}

/**
 * A frase do repasse do faturamento médico, quando o serviço não tem uma cadastrada.
 *
 * O texto de verdade mora em `Servico.condicaoPagamento`, editável pela Thaís na tela de
 * Serviços — este é só o valor de partida, para a proposta nunca sair muda sobre quando o
 * repasse é pago. Ver ADR-125 (de onde vem o campo) e ADR-127 (que tirou a "Condição de
 * pagamento" genérica das propostas: é sempre PIX, e o PIX já vai no bloco acima).
 */
export const FRASE_REPASSE_FATURAMENTO =
  "O recebimento do Repasse do faturamento médico será sempre feito após o crédito na conta da Clínica.";

/**
 * A frase do repasse que entra nesta proposta: a cadastrada nos serviços cobrados **só por
 * percentual**, ou a padrão quando nenhum deles tem texto próprio.
 *
 * Recebe já filtrada a lista de condições dos serviços percentuais — quem decide o que é
 * "percentual" é o PREÇO (`ehServicoSomentePercentual`), nunca a categoria. Junta sem repetir,
 * porque dois serviços com o mesmo texto não devem imprimir a frase duas vezes.
 */
export function fraseDoRepasse(condicoesDosServicosPercentuais: (string | null | undefined)[]): string {
  const frases: string[] = [];
  for (const c of condicoesDosServicosPercentuais) {
    const t = limpo(c);
    if (t && !frases.includes(t)) frases.push(t);
  }
  return frases.length ? frases.join(" ") : FRASE_REPASSE_FATURAMENTO;
}
