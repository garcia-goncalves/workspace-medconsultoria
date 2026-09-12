/**
 * A chave de comparação de nome de serviço — a MESMA régua que o banco usa.
 *
 * ⚠️ EXISTE PORQUE JAVASCRIPT E MySQL DISCORDAM SOBRE O QUE É "O MESMO NOME". A coluna
 * `Servico.nome` é `utf8mb4_unicode_ci`: para o banco, "Conteúdo & SEO" e "Conteudo & SEO" são a
 * MESMA linha, e "Faturamento" e "faturamento" também. Para o `Set` do JavaScript, são quatro
 * strings diferentes.
 *
 * Enquanto não havia índice único, essa divergência produzia no máximo um clone silencioso. Com o
 * índice, ela vira INDISPONIBILIDADE: a semeadura do catálogo (`semearCatalogoSeFaltar`) roda em
 * TODA leitura de catálogo — inclusive na página pública `/comecar` e no "Solicitar" do Portal —,
 * e ela decide o que criar comparando com um `Set`. Um serviço apagado e recriado sem acento faria
 * a semeadura tentar recriar o canônico, levar `P2002` do banco, e a rota pública passar a
 * responder erro em vez de lista.
 *
 * ⚠️ NÃO É NORMALIZAÇÃO PARA GRAVAR. O nome vai ao banco como a pessoa escreveu, com acento e
 * maiúscula; esta chave serve só para COMPARAR.
 */
export function chaveDoNomeDeServico(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}
