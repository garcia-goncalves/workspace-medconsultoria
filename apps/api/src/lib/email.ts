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
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
      ...opcoesTls(config.SMTP_HOST),
    });
    if (ehHostLocal(config.SMTP_HOST)) {
      console.info(
        `[email] SMTP local (${config.SMTP_HOST}:${port}) — o nome do certificado não é conferido. ` +
          `Correto para servidor de e-mail na própria máquina; nunca use um host remoto aqui.`,
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
