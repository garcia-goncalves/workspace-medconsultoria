import { ImapFlow } from "imapflow";
import { prisma } from "@app/db";
import { decifrar } from "../../lib/cripto-caixa.js";

export type DadosConexao = { imapHost: string; imapPorta: number; usuario: string; senha: string };

/** Prazos curtos de propósito: servidor de e-mail lento não pode travar a página. */
const TEMPO_CONEXAO = 15_000;
const TEMPO_OPERACAO = 45_000;

/**
 * Deduz o servidor a partir do domínio do endereço. Vale para o domínio da MedConsultoria e
 * para qualquer hospedagem que siga a convenção `mail.<domínio>` — que é o caso da TineHost
 * (verificado: MX = mail.medconsultoria.com.br). Caixas externas não entram nesta fase.
 */
export function descobrirServidor(email: string) {
  const dominio = email.split("@")[1]?.trim().toLowerCase();
  if (!dominio) throw new Error("Endereço de e-mail inválido.");
  return { imapHost: `mail.${dominio}`, imapPorta: 993, smtpHost: `mail.${dominio}`, smtpPorta: 465 };
}

function novoCliente(d: DadosConexao): ImapFlow {
  return new ImapFlow({
    host: d.imapHost,
    port: d.imapPorta,
    secure: true,
    auth: { user: d.usuario, pass: d.senha },
    logger: false, // NUNCA ligar: o log do imapflow inclui o diálogo de autenticação
    connectionTimeout: TEMPO_CONEXAO,
    greetingTimeout: TEMPO_CONEXAO,
    socketTimeout: TEMPO_OPERACAO,
  });
}

/**
 * Testa a credencial ANTES de gravar a caixa. Distingue senha errada de servidor fora do ar:
 * a primeira é culpa de quem digitou, a segunda não — e a mensagem na tela muda por causa disso.
 */
export async function testarConexao(
  d: DadosConexao,
): Promise<{ ok: true } | { ok: false; motivo: "AUTENTICACAO" | "REDE"; detalhe: string }> {
  const c = novoCliente(d);
  try {
    await c.connect();
    // A credencial já foi aceita aqui. Um LOGOUT que falhe não pode virar "senha recusada" —
    // seria recusar senha CERTA por causa de um socket que caiu meio segundo depois.
    await c.logout().catch(() => {});
    return { ok: true };
  } catch (e) {
    const err = e as { authenticationFailed?: boolean; responseText?: string; message?: string };
    const autenticacao = err.authenticationFailed === true || /auth/i.test(err.responseText ?? "");
    return {
      ok: false,
      motivo: autenticacao ? "AUTENTICACAO" : "REDE",
      detalhe: err.responseText ?? err.message ?? "Falha desconhecida ao conectar.",
    };
  } finally {
    // `close` é síncrono e idempotente — garante que o socket não fique pendurado se `logout` falhar.
    c.close();
  }
}

/**
 * Abre uma conexão para a caixa, roda `fn` e fecha SEMPRE. Conexão curta é obrigatória: o
 * LiteSpeed/lsnode derruba o processo Node ocioso (mesma causa do ADR-84), então não existe
 * conexão viva entre requisições nem `IDLE`.
 *
 * Falha de autenticação marca a caixa como `AUTENTICACAO_FALHOU` e a app PARA de tentar — tentar
 * em laço faz o servidor de e-mail bloquear o IP por suspeita de invasão, e aí ninguém mais
 * recebe e-mail, nem os automáticos.
 *
 * `marcarErro: false` desliga APENAS a marcação genérica `estado: "ERRO"`, para quem chama numa
 * operação ACESSÓRIA (descartar rascunho depois de um envio, gravação automática de rascunho).
 * Nesses casos a conexão IMAP é NOVA e o modo de falha mais provável não é a caixa estar quebrada:
 * é o servidor recusar mais uma conexão simultânea logo depois de o envio já ter gastado duas
 * (a do SMTP e a da cópia em Enviados), ou um timeout de 15 s. Marcar ali só produz falso positivo
 * — "sua caixa está com erro" logo depois de o e-mail ter saído —, e não acrescenta informação:
 * se o servidor estiver mesmo fora, a próxima sincronização marca a caixa de qualquer jeito.
 * Senha recusada continua marcando SEMPRE (é informação real e o remédio é reconectar).
 */
export async function comCaixa<T>(
  caixaId: string,
  fn: (c: ImapFlow) => Promise<T>,
  opcoes?: { marcarErro?: boolean },
): Promise<T> {
  const caixa = await prisma.caixaEmail.findFirst({
    where: { id: caixaId, deletedAt: null },
    select: { id: true, imapHost: true, imapPorta: true, usuario: true, segredo: true, estado: true },
  });
  if (!caixa) throw new Error("Caixa não encontrada.");
  if (caixa.estado === "AUTENTICACAO_FALHOU") {
    throw new Error("Esta caixa precisa ser reconectada: a senha guardada foi recusada pelo servidor.");
  }

  // Se o segredo não abre (EMAIL_CRYPTO_KEY rotacionada, por exemplo), o remédio é o mesmo da
  // senha recusada: a pessoa reconecta a caixa. Marcar o estado faz a tela oferecer isso — sem
  // este trecho, o erro subia cru e virava um 500 sem instrução nenhuma, e a caixa continuava
  // parecendo "OK" na lista.
  let senha: string;
  try {
    senha = decifrar(caixa.segredo);
  } catch (e) {
    await prisma.caixaEmail.update({
      where: { id: caixa.id },
      data: { estado: "AUTENTICACAO_FALHOU", ultimoErro: (e as Error).message.slice(0, 500) },
    });
    throw e;
  }

  const c = novoCliente({
    imapHost: caixa.imapHost,
    imapPorta: caixa.imapPorta,
    usuario: caixa.usuario,
    senha,
  });

  try {
    await c.connect();
    const r = await fn(c);
    // O LOGOUT não pode derrubar um trabalho que já deu certo: se o servidor fecha o socket
    // logo depois do último comando, `logout()` lança — e, dentro do `try`, isso marcaria a
    // caixa como ERRO e devolveria falha ao usuário com a sincronização INTEIRA já gravada.
    // O `finally` abaixo fecha o socket de qualquer jeito.
    await c.logout().catch(() => {});
    return r;
  } catch (e) {
    const err = e as { authenticationFailed?: boolean; message?: string };
    if (err.authenticationFailed === true) {
      await prisma.caixaEmail.update({
        where: { id: caixa.id },
        data: { estado: "AUTENTICACAO_FALHOU", ultimoErro: "Senha recusada pelo servidor de e-mail." },
      });
    } else if (opcoes?.marcarErro !== false) {
      await prisma.caixaEmail.update({
        where: { id: caixa.id },
        data: { estado: "ERRO", ultimoErro: (err.message ?? "Falha ao falar com o servidor.").slice(0, 500) },
      });
    }
    throw e;
  } finally {
    c.close();
  }
}
