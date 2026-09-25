/**
 * O TEXTO DA PROPOSTA E OS VALORES QUE O ACEITE COBRA SÃO DUAS COISAS — e podem divergir.
 *
 * A proposta guarda o papel em Markdown (`Documento.conteudo`, editável à mão) e, por trás dele,
 * os ITENS estruturados (`Documento.itens` e as linhas avulsas), que são o que o aceite copia para
 * o serviço contratado e para a conta a receber. Editar "R$ 3.500,00" para "R$ 3.000,00" no texto
 * muda o que o cliente LÊ e não muda o que o sistema COBRA. Sem aviso, o cliente aceita um preço e
 * é cobrado por outro — e ninguém percebe até a cobrança.
 *
 * Esta função responde "algum valor dos itens sumiu do texto?". Ela NÃO bloqueia a edição (o texto
 * da proposta se negocia, e reescrever a apresentação não pode travar ninguém): quem chama mostra o
 * alerta antes de a proposta ir ao cliente. É pura e mora aqui para o servidor (resposta da edição
 * e leitura do documento) e a tela (aviso ao vivo, enquanto digita) usarem a MESMA régua.
 *
 * ⚠️ LIMITE CONHECIDO: a régua pergunta se o valor ainda aparece EM ALGUM LUGAR do texto. Mudar
 * só a linha e deixar o total antigo (que repete o mesmo número) não acende o alerta — o papel
 * continua dizendo o valor cobrado ali. Por isso a tela também mostra o aviso fixo.
 *
 * ⚠️ A comparação ignora o TIPO de espaço: o `toLocaleString` do Node escreve "R$" com espaço
 * inseparável (U+00A0), e o editor do navegador pode devolvê-lo como espaço comum. Sem normalizar,
 * todo valor pareceria "sumido" depois da primeira edição.
 */

export type ValorDeItem = {
  valor?: number | null;
  quantidade?: number | null;
  percentual?: number | null;
};

const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Qualquer espaço (inclusive o inseparável e o fino) vira espaço comum. */
const normalizar = (s: string) => s.replace(/[\s\u00a0\u202f]+/g, " ");

/**
 * Os valores dos itens (como aparecem no papel: "R$ 3.500,00", "5%") que NÃO estão mais no texto.
 * Lista vazia = texto e itens concordam. O subtotal é o que todos os geradores imprimem
 * (quantidade × valor), sozinho ou em "3 × R$ 400,00 = R$ 1.200,00".
 */
export function valoresDeItensAusentesNoTexto(conteudo: string, itens: ValorDeItem[]): string[] {
  const texto = normalizar(conteudo);
  const ausentes = new Set<string>();
  for (const it of itens) {
    const sub = centavos((it.valor ?? 0) * Math.max(1, it.quantidade ?? 1));
    if (sub > 0) {
      const esperado = normalizar(reais(sub));
      if (!texto.includes(esperado)) ausentes.add(esperado);
    }
    if (it.percentual != null && it.percentual > 0) {
      const esperado = pct(it.percentual);
      // Com borda à esquerda: "15%" no texto não pode passar por "5%" presente.
      const escapado = esperado.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`(^|[^\\d.,])${escapado}`).test(texto)) ausentes.add(esperado);
    }
  }
  return [...ausentes];
}
