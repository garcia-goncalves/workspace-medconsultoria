import { INSTITUCIONAL } from "@app/shared";

/** Content-ID do logo embutido (anexado em toda mensagem por enviarEmail). */
export const LOGO_CID = "logo@medconsultoria";

export interface EmailBrandOpts {
  /** Texto de pré-visualização (aparece na caixa de entrada, oculto no corpo). */
  preheader: string;
  titulo: string;
  saudacao?: string;
  /** Parágrafos do corpo (podem conter <strong>/<em>). */
  paragrafos: string[];
  cta?: { texto: string; url: string };
  /** Observação pequena abaixo do botão (ex.: validade do link). */
  nota?: string;
}

const CORES = {
  azulEscuro: "#002463",
  verde: "#30AD73",
  link: "#003591",
  texto: "#334155",
  muted: "#64748b",
  borda: "#e2e8f0",
  fundo: "#f1f5f9",
};
const FONTE = "'Montserrat', Arial, Helvetica, sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Monta um e-mail transacional com a identidade visual da MedConsultoria. */
export function montarEmail(opts: EmailBrandOpts): { html: string; texto: string } {
  const ano = new Date().getFullYear();

  const paragrafosHtml = opts.paragrafos
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${CORES.texto};">${p}</p>`,
    )
    .join("");

  const botaoHtml = opts.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
         <tr><td align="center" bgcolor="${CORES.verde}" style="border-radius:8px;">
           <a href="${opts.cta.url}" target="_blank"
              style="display:inline-block;padding:13px 26px;font-family:${FONTE};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
             ${esc(opts.cta.texto)}
           </a>
         </td></tr>
       </table>`
    : "";

  const notaHtml = opts.nota
    ? `<p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:${CORES.muted};">${opts.nota}</p>`
    : "";

  const saudacaoHtml = opts.saudacao
    ? `<p style="margin:0 0 12px;font-size:16px;font-weight:600;color:${CORES.azulEscuro};">${esc(opts.saudacao)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(opts.titulo)}</title>
</head>
<body style="margin:0;padding:0;background:${CORES.fundo};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CORES.fundo};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid ${CORES.borda};border-radius:14px;overflow:hidden;">
        <!-- Cabeçalho (fundo branco p/ o logo aparecer + faixa verde de acento) -->
        <tr>
          <td align="center" bgcolor="#ffffff" style="padding:30px 24px 26px;border-bottom:3px solid ${CORES.verde};">
            <img src="cid:${LOGO_CID}" alt="MedConsultoria" width="185" style="width:185px;max-width:75%;height:auto;display:block;border:0;">
          </td>
        </tr>
        <!-- Corpo -->
        <tr>
          <td style="padding:32px 34px 8px;font-family:${FONTE};">
            <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:${CORES.azulEscuro};font-weight:700;">${esc(opts.titulo)}</h1>
            ${saudacaoHtml}
            ${paragrafosHtml}
            ${botaoHtml}
            ${notaHtml}
          </td>
        </tr>
        <!-- Assinatura -->
        <tr>
          <td style="padding:22px 34px 30px;font-family:${FONTE};">
            <p style="margin:0;font-size:15px;line-height:1.6;color:${CORES.texto};">
              Atenciosamente,<br><strong style="color:${CORES.azulEscuro};">Equipe MedConsultoria</strong>
            </p>
          </td>
        </tr>
        <!-- Rodapé -->
        <tr>
          <td style="padding:20px 34px;background:#f8fafc;border-top:1px solid ${CORES.borda};font-family:${FONTE};">
            <!--
              O rodapé é o MESMO nos 42 templates, e mais da metade deles vai para fora da empresa
              (cliente do Portal, lead do site). Ele trazia "Acessar o workspace" apontando para o
              sistema INTERNO e dizia "sua conta no Workspace MedConsultoria" — nome que o médico
              nunca viu. Quem é da casa não perde nada: o e-mail que pede uma ação já traz o botão
              próprio, e o endereço do sistema está no navegador dessa pessoa o dia inteiro.
            -->
            <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${CORES.muted};">
              <a href="mailto:${INSTITUCIONAL.email}" style="color:${CORES.link};text-decoration:none;">${INSTITUCIONAL.email}</a>
              &nbsp;·&nbsp;
              <a href="${INSTITUCIONAL.siteUrl}" target="_blank" style="color:${CORES.link};text-decoration:none;">${INSTITUCIONAL.site}</a>
            </p>
            <p style="margin:0 0 4px;font-size:11px;line-height:1.6;color:${CORES.muted};">
              Você recebeu este e-mail porque há uma ação relacionada à sua conta na MedConsultoria.
              Se não reconhece esta solicitação, ignore esta mensagem.
            </p>
            <p style="margin:0;font-size:11px;line-height:1.6;color:${CORES.muted};">
              © ${ano} MedConsultoria. Seus dados são tratados conforme a LGPD.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Versão texto puro (fallback para clientes sem HTML).
  const linhas: string[] = [];
  if (opts.saudacao) linhas.push(opts.saudacao, "");
  linhas.push(opts.titulo, "");
  for (const p of opts.paragrafos) linhas.push(p.replace(/<[^>]+>/g, ""), "");
  if (opts.cta) linhas.push(`${opts.cta.texto}: ${opts.cta.url}`, "");
  if (opts.nota) linhas.push(opts.nota.replace(/<[^>]+>/g, ""), "");
  // Mesma razão do rodapé em HTML: a assinatura fechava com o endereço do sistema INTERNO, e esta
  // versão é a que o cliente lê em leitor sem HTML. Vai o site institucional.
  linhas.push("—", "Atenciosamente, Equipe MedConsultoria", INSTITUCIONAL.siteUrl);
  const texto = linhas.join("\n");

  return { html, texto };
}
