import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { EMAIL_TEMPLATES, templateDe, exemploVars } from "./emails.registry.js";
import { montarEmail, LOGO_CID } from "../../lib/email-template.js";
import { LOGO_PNG_BASE64 } from "../../lib/brand-assets.js";
import { enviarEmail } from "../../lib/email.js";
import { config } from "../../config.js";

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const interpolar = (s: string, vars: Record<string, string>) =>
  s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");

interface CamposTemplate {
  assunto: string;
  titulo: string;
  corpo: string;
  ctaTexto?: string | null;
  nota?: string | null;
}

interface OverrideRow {
  assunto: string;
  titulo: string;
  corpo: string;
  ctaTexto: string | null;
  nota: string | null;
}

/** Campos efetivos = override do banco (se houver) sobre o padrão do registro. */
function efetivo(chave: string, o: OverrideRow | null): CamposTemplate {
  const d = templateDe(chave)!.default;
  return {
    assunto: o?.assunto ?? d.assunto,
    titulo: o?.titulo ?? d.titulo,
    corpo: o?.corpo ?? d.corpo,
    ctaTexto: o?.ctaTexto ?? d.ctaTexto ?? "",
    nota: o?.nota ?? d.nota ?? "",
  };
}

/** Monta { assunto, titulo, corpo, html, texto } a partir de campos + variáveis. */
function construir(chave: string, campos: CamposTemplate, vars: Record<string, string>) {
  const meta = templateDe(chave)!;
  const assunto = interpolar(campos.assunto, vars);
  const titulo = interpolar(campos.titulo, vars);
  const corpo = interpolar(campos.corpo, vars); // texto plano (também usado na notificação in-app)
  const paragrafos = corpo
    .split(/\n\s*\n/)
    .map((p) => escHtml(p.trim()))
    .filter(Boolean);
  const nota = interpolar(campos.nota ?? "", vars);
  const cta =
    meta.temCta && vars.link
      ? { texto: interpolar(campos.ctaTexto || "Abrir", vars), url: vars.link }
      : undefined;
  const { html, texto } = montarEmail({
    preheader: titulo,
    titulo,
    saudacao: vars.nome ? `Olá, ${vars.nome.split(" ")[0]}!` : undefined,
    paragrafos: paragrafos.length ? paragrafos : [" "],
    cta,
    nota: nota || undefined,
  });
  return { assunto, titulo, corpo, html, texto };
}

/** Lista os templates (efetivos) + metadados, para a tela de gestão. */
export async function listarTemplates() {
  const overrides = await prisma.emailTemplate.findMany();
  const map = new Map(overrides.map((o) => [o.chave, o]));
  return Object.entries(EMAIL_TEMPLATES).map(([chave, meta]) => {
    const o = map.get(chave) ?? null;
    return {
      chave,
      label: meta.label,
      descricao: meta.descricao,
      grupo: meta.grupo,
      notificacao: meta.notificacao,
      variaveis: meta.variaveis,
      temCta: meta.temCta,
      personalizado: !!o,
      ...efetivo(chave, o),
    };
  });
}

export async function atualizarTemplate(
  chave: string,
  dados: CamposTemplate,
  atorNome: string,
) {
  if (!templateDe(chave)) throw new TRPCError({ code: "NOT_FOUND", message: "Template inexistente." });
  const data = {
    assunto: dados.assunto.trim(),
    titulo: dados.titulo.trim(),
    corpo: dados.corpo.trim(),
    ctaTexto: dados.ctaTexto?.trim() || null,
    nota: dados.nota?.trim() || null,
    atualizadoPor: atorNome,
  };
  await prisma.emailTemplate.upsert({
    where: { chave },
    create: { chave, ...data },
    update: data,
  });
  return { ok: true };
}

/** Remove a personalização — volta ao texto padrão. */
export async function resetarTemplate(chave: string) {
  await prisma.emailTemplate.deleteMany({ where: { chave } });
  return { ok: true };
}

/** Renderiza o template efetivo (override ou padrão) — usado pelos envios reais. */
export async function renderTemplate(chave: string, vars: Record<string, string>) {
  const o = await prisma.emailTemplate.findUnique({ where: { chave } });
  return construir(chave, efetivo(chave, o), vars);
}

/** Valores de exemplo para prévia/teste: campos do template + nome/e-mail/link base. */
function exemploCompleto(chave: string): Record<string, string> {
  const vars: Record<string, string> = { nome: "Maria Silva", email: "maria@exemplo.com", ...exemploVars(chave) };
  vars.link = `${config.WEB_ORIGIN}/exemplo`; // link sempre real para o botão funcionar na prévia
  return vars;
}

/**
 * Prévia a partir dos campos em edição, com TODOS os campos automáticos preenchidos
 * por valores de exemplo. Retorna o HTML do e-mail (logo em data-URI p/ o navegador)
 * e o texto que apareceria na notificação do sino (título/corpo).
 */
export function gerarPreview(chave: string, campos: CamposTemplate) {
  if (!templateDe(chave)) throw new TRPCError({ code: "NOT_FOUND", message: "Template inexistente." });
  const { html, titulo, corpo } = construir(chave, campos, exemploCompleto(chave));
  return {
    html: html.replace(`cid:${LOGO_CID}`, `data:image/png;base64,${LOGO_PNG_BASE64}`),
    notifTitulo: titulo,
    notifCorpo: corpo,
  };
}

/** Envia um e-mail de teste com o template salvo e campos automáticos de exemplo. */
export async function enviarTeste(chave: string, para: string) {
  if (!templateDe(chave)) throw new TRPCError({ code: "NOT_FOUND", message: "Template inexistente." });
  const { assunto, html, texto } = await renderTemplate(chave, exemploCompleto(chave));
  const { enviado } = await enviarEmail({ para, assunto: `[Teste] ${assunto}`, html, texto });
  if (!enviado) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível enviar o e-mail de teste (verifique a configuração SMTP).",
    });
  }
  return { enviado };
}
