/**
 * O CONSENTIMENTO DA ASSINATURA ELETRÔNICA — o texto e a versão dele, num lugar só.
 *
 * A tela de assinar sempre exigiu a caixa marcada (`consentimento: z.literal(true)`), e o
 * servidor sempre recusou sem ela. Mas **nada disso era gravado**: passado o clique, não
 * sobrava no sistema nenhuma prova de que a pessoa consentiu, nem com que texto. Numa
 * assinatura contestada, "a tela exigia a caixa" é afirmação sobre o código de hoje — não
 * prova sobre o que estava na tela naquele dia.
 *
 * ⚠️ **A VERSÃO É O QUE TORNA A PROVA UTILIZÁVEL.** Guardar só a data diria "consentiu em
 * 12/03" sem dizer *com o quê* — e o texto muda. Gravando data **e** versão, a linha do banco
 * aponta para um texto exato, que o histórico do repositório preserva.
 *
 * ⚠️ **Quem editar o TEXTO tem de subir a VERSÃO, no mesmo commit.** Sem isso, assinaturas
 * antigas passam a apontar para um texto que ninguém leu — que é a única forma de esta prova
 * mentir. Há teste que trava as duas coisas juntas.
 *
 * Mesmo molde do `AVISO_PRIVACIDADE_VERSAO`, pelo mesmo motivo.
 */

/** Sobe SEMPRE que o texto abaixo mudar. Formato: data da mudança. */
export const VERSAO_CONSENTIMENTO_ASSINATURA = "2026-09-02";

/**
 * O texto exato que a pessoa lê ao lado da caixa, na página de assinar.
 *
 * A tela lê daqui em vez de trazer a frase escrita nela: com duas cópias, a que fica gravada
 * como prova e a que a pessoa leu podem divergir sem ninguém notar.
 */
export const TEXTO_CONSENTIMENTO_ASSINATURA =
  "Li o documento e concordo em assiná-lo eletronicamente. Entendo que esta assinatura tem validade jurídica (Lei 14.063/2020).";
