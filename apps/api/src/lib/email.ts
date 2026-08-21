import nodemailer, { type Transporter } from "nodemailer";
import { config, isEmailReal } from "../config.js";
import { LOGO_CID } from "./email-template.js";
import { LOGO_PNG_BASE64 } from "./brand-assets.js";
import { ehHostLocal, opcoesTls } from "./email-tls.js";

export interface EmailMsg {
  para: string;
  assunto: string;
  html: string;
  texto?: string;
}

/** Logo embutido (CID) — referenciado como cid:logo@medconsultoria nos templates. */
const anexoLogo = {
  filename: "logo.png",
  content: Buffer.from(LOGO_PNG_BASE64, "base64"),
  cid: LOGO_CID,
  contentType: "image/png",
};

let transporter: Transporter | null = null;
function getTransporter(): Transporter {
  if (!transporter) {
    const port = config.SMTP_PORT ?? 587;
    // `opcoesTls` dispensa a conferência do NOME do certificado quando — e somente quando — o
    // SMTP é a própria máquina. Sem isto, 100% dos e-mails de produção morriam em
    // "Host: localhost. is not in the cert's altnames: DNS:atena.hostsrv.org" e a taxa de
    // entrega do monitor era 0% desde sempre. O porquê inteiro está em `email-tls.ts`.
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port,
      secure: port === 465, // 465 = SSL direto; 587 = STARTTLS (negociado)
      // Sem isto, na 587 o STARTTLS é oportunista: servidor que não o anuncia faz o nodemailer
      // seguir em TEXTO CLARO, com o AUTH junto. A caixa pessoal já se protegia assim
      // (`modules/email/smtp.ts`); o transacional não. Alinhado aqui — o servidor de produção
      // comprovadamente anuncia STARTTLS, já que a falha era DEPOIS dele, no certificado.
      requireTLS: true,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
      ...opcoesTls(config.SMTP_HOST, port),
    });
    if (ehHostLocal(config.SMTP_HOST)) {
      // Dois avisos diferentes de propósito. O segundo é o que evita uma caçada às cegas: host
      // local em porta alta volta a falhar no certificado, e sem esta linha a mensagem no
      // monitor seria idêntica à do defeito que a ADR-122 consertou.
      console.info(
        port <= 1023
          ? `[email] SMTP local (${config.SMTP_HOST}:${port}) — o nome do certificado não é conferido. ` +
              `Correto para servidor de e-mail na própria máquina; nunca use um host remoto aqui.`
          : `[email] SMTP local em porta ALTA (${config.SMTP_HOST}:${port}) — a conferência do ` +
              `certificado segue INTEIRA de propósito: porta >=1024 pode ser ocupada por outro ` +
              `processo da máquina sem ser root. Se o envio falhar no certificado, mude a porta ` +
              `para 465/587, não afrouxe o TLS.`,
      );
    }
  }
  return transporter;
}

/**
 * Envia um e-mail transacional. Em **modo dev** (SMTP incompleto) NÃO envia — o
 * chamador exibe o link na tela. Em produção usa o SMTP; se o envio falhar,
 * devolve `enviado: false` (o chamador cai no fallback de mostrar o link).
 */
export async function enviarEmail(msg: EmailMsg): Promise<{ enviado: boolean; erro?: string }> {
  if (!isEmailReal) {
    console.info(`[email:dev] para=${msg.para} · assunto="${msg.assunto}" (não enviado — modo dev)`);
    return { enviado: false, erro: "SMTP não configurado (modo dev) — e-mail não enviado." };
  }
  try {
    await getTransporter().sendMail({
      from: config.SMTP_FROM ?? config.SMTP_USER,
      to: msg.para,
      subject: msg.assunto,
      text: msg.texto,
      html: msg.html,
      attachments: [anexoLogo],
    });
    return { enviado: true };
  } catch (err) {
    console.error(`[email] falha ao enviar para ${msg.para}:`, err);
    return { enviado: false, erro: err instanceof Error ? err.message : String(err) };
  }
}
