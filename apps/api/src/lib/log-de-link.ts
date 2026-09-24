/**
 * O que o servidor escreve no log quando um e-mail com LINK DE ACESSO não saiu.
 *
 * POR QUE ISTO EXISTE (Onda 1, 24/09/2026): `solicitarReset` imprimia o link de redefinição de
 * senha — com o token dentro — sempre que o e-mail não saía. A intenção era o modo dev (sem
 * SMTP, o link só existe no log, e é assim que se testa localmente). Mas `enviado: false`
 * também acontece EM PRODUÇÃO: SMTP fora do ar, senha vencida, certificado recusado (a ADR-122
 * passou meses assim). Nesse caso o token, válido por uma hora, ia parar no `docker logs` da
 * VPS COMPARTILHADA — legível por quem mais tiver acesso ao Docker da máquina —, e quem o lesse
 * trocava a senha de qualquer conta, inclusive ROOT, sem passar pelo login.
 *
 * ⚠️ A régua é o `NODE_ENV`, não "tem SMTP?": é o mesmo critério que separa dev de produção no
 * resto do código (o banco de produção também é `localhost`, então host não separa nada).
 * ⚠️ Em produção a linha continua existindo — sem o link. Sumir com ela esconderia que o
 * e-mail não saiu, e é essa linha que faz alguém ir olhar o monitor de e-mails.
 */
export function linhaDeLinkNaoEnviado(
  tipo: string,
  email: string,
  url: string,
  nodeEnv: string | undefined,
): string {
  if (nodeEnv === "production") {
    return `[${tipo}] o e-mail para ${email} NÃO saiu — o link não é registrado em produção. Veja o monitor de e-mails.`;
  }
  return `[${tipo}:dev] link para ${email}: ${url}`;
}
