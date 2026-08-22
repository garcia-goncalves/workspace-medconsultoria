/**
 * FALHAS SEGUIDAS DE E-MAIL TRANSACIONAL — o sinal que faltou em agosto de 2026.
 *
 * O defeito da ADR-122 (o certificado do SMTP local não se chama "localhost") derrubou
 * **100%** dos envios de produção e ficou assim por semanas: 25 falhas em 7 dias, taxa de
 * entrega 0% desde sempre. Nada avisou. Quem descobriu foi o dono, criando um lead pelo
 * site e não recebendo o e-mail. O monitor `/emails-enviados` mostrava tudo — depois que
 * alguém pensava em abrir a tela.
 *
 * POR QUE "FALHAS SEGUIDAS" E NÃO "TAXA DE ENTREGA":
 * taxa exige volume. Este sistema manda poucos e-mails por dia, então uma regra do tipo
 * "menos de X% entregue na última hora" nunca teria disparado — foi exatamente por isso que
 * o problema durou semanas. Falha seguida não depende de volume: na TERCEIRA tentativa
 * morta o alerta sobe, mande a app 3 e-mails por dia ou 300.
 *
 * O contador é "falhas registradas DEPOIS do último sucesso". Isso dá a recuperação de
 * graça: um único e-mail que sai zera a conta e resolve o incidente. E é honesto com o
 * caso extremo real — quando NUNCA houve um sucesso, todas as falhas contam.
 */

/** Só o que a regra precisa da tabela `EmailEnviado`. */
export interface TentativaFalha {
  para: string;
}

/**
 * A partir de 10 falhas para o MESMO destinatário, o problema deixa de ser plausivelmente
 * dele. Abaixo disso, um endereço só é endereço errado — não transporte quebrado.
 */
export const LIMITE_MESMO_DESTINATARIO = 10;

/**
 * Quantas falhas seguidas contam como sintoma de transporte, ou `null` para "não avalio".
 *
 * Devolve `null` — e não zero — quando as falhas são todas para o mesmo destinatário e ainda
 * são poucas: caixa cheia, endereço digitado errado ou domínio inexistente é problema de UMA
 * mensagem, e alarme falso ensina a ignorar alarme. O motor de alertas trata `null` como
 * "pular esta avaliação", que é o comportamento certo aqui.
 *
 * Devolve `0` quando não há falha alguma depois do último sucesso — é o que resolve o
 * incidente, porque zero fica abaixo do limiar de recuperação.
 */
export function falhasSeguidas(falhas: TentativaFalha[]): number | null {
  if (falhas.length === 0) return 0;

  const destinatarios = new Set(
    falhas.map((f) => f.para.trim().toLowerCase()).filter((p) => p.length > 0),
  );
  if (destinatarios.size < 2 && falhas.length < LIMITE_MESMO_DESTINATARIO) return null;

  return falhas.length;
}
