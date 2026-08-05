import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "@app/db";
import { decifrar } from "../../lib/cripto-caixa.js";

/**
 * Abre uma conexão SMTP para a caixa, roda `fn` e fecha SEMPRE. Conexão curta pela mesma razão
 * do IMAP (ver `imap.ts`): o LiteSpeed/lsnode derruba o processo Node ocioso, então não existe
 * conexão viva entre requisições.
 *
 * Falha de autenticação marca a caixa como `AUTENTICACAO_FALHOU` e a app PARA de tentar —
 * tentar em laço faz o servidor de e-mail bloquear o IP, e aí ninguém mais envia nada, nem os
 * e-mails automáticos da aplicação.
 */
export async function comSmtp<T>(caixaId: string, fn: (t: Transporter) => Promise<T>): Promise<T> {
  const caixa = await prisma.caixaEmail.findFirst({
    where: { id: caixaId, deletedAt: null },
    select: { id: true, smtpHost: true, smtpPorta: true, usuario: true, segredo: true, estado: true },
  });
  if (!caixa) throw new Error("Caixa não encontrada.");
  if (caixa.estado === "AUTENTICACAO_FALHOU") {
    throw new Error("Esta caixa precisa ser reconectada: a senha guardada foi recusada pelo servidor.");
  }

  // Mesmo tratamento do `comCaixa`: segredo que não abre é problema de chave, e o remédio é
  // reconectar — não adianta tentar de novo.
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

  const transporte = nodemailer.createTransport({
    host: caixa.smtpHost,
    port: caixa.smtpPorta,
    secure: caixa.smtpPorta === 465,
    // Inócuo hoje (`descobrirServidor` só produz 465, e o cliente não escolhe a porta), mas
    // obrigatório no dia em que a 587 entrar: sem isto o nodemailer aceita seguir em texto claro
    // quando o servidor não anuncia STARTTLS — downgrade oportunista, com a senha da caixa junto.
    requireTLS: true,
    auth: { user: caixa.usuario, pass: senha },
    // NUNCA ligar logger/debug: o diálogo SMTP inclui a autenticação.
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
  });

  try {
    return await fn(transporte);
  } catch (e) {
    const err = e as { responseCode?: number; message?: string };
    // 535 = credencial recusada. Só isso vira AUTENTICACAO_FALHOU; rede fora do ar não pode
    // parar a caixa de uma pessoa cuja senha está certa.
    if (err.responseCode === 535) {
      await prisma.caixaEmail.update({
        where: { id: caixa.id },
        data: { estado: "AUTENTICACAO_FALHOU", ultimoErro: "Senha recusada pelo servidor de e-mail." },
      });
    }
    throw e;
  } finally {
    transporte.close();
  }
}
