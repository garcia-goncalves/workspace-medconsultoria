import { TRPCError } from "@trpc/server";

/**
 * A caixa perdeu a senha (trocada no webmail, ou `EMAIL_CRYPTO_KEY` rotacionada). É um estado
 * ESPERADO, com remédio conhecido e oferecido na própria tela: o botão *Reconectar*. Não é bug
 * de servidor, e por isso não pode chegar ao painel de Sistema.
 *
 * O `onError` do tRPC (`server.ts`) grava no `ErrorLog` — e avisa o ROOT por e-mail — só o que
 * tem código `INTERNAL_SERVER_ERROR`. Um `new Error(...)` sem código cai exatamente nesse balde.
 * Medido no banco local em 28/08/2026: **66 ocorrências** desta situação no painel do ROOT,
 * contra 2 registros de bug de verdade, e o cartão de saúde anunciando "5 erros não resolvidos"
 * sem que nenhum fosse um erro.
 *
 * `PRECONDITION_FAILED` é o código certo: a operação não é inválida nem proibida — falta uma
 * condição prévia (a caixa estar conectada) que a pessoa resolve sozinha.
 */
/**
 * Classe própria, e não só o código: `PRECONDITION_FAILED` é usado por pelo menos oito outros
 * erros da aplicação (IA sem chave, backup só no servidor, quatro em `acoes.service`, dois em
 * `envio.service`). Reconhecer por código faria quem tratasse "preciso reconectar" engolir erro
 * alheio — achado da revisão de segurança da ADR-135. O `cause` não serve para isso: o construtor
 * do `TRPCError` reembrulha o que recebe, e a marca não sobrevive à volta.
 *
 * ⚠️ Continua sendo um `TRPCError` para todos os efeitos, inclusive o `instanceof` que o tRPC faz.
 */
export class ErroPrecisaReconectar extends TRPCError {
  constructor(message: string) {
    super({ code: "PRECONDITION_FAILED", message });
  }
}

export function erroPrecisaReconectar(mensagem: string): TRPCError {
  return new ErroPrecisaReconectar(mensagem);
}

/** `true` só para o erro acima — serve a quem precisa tratar reconexão sem engolir falha real. */
export function ehErroPrecisaReconectar(e: unknown): boolean {
  return e instanceof ErroPrecisaReconectar;
}
