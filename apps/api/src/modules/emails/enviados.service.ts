import { prisma } from "@app/db";
import type { Prisma } from "@app/db";
import { enviarEmail } from "../../lib/email.js";
import { isEmailReal } from "../../config.js";
import { renderTemplate } from "./emails.service.js";
import { templateDe } from "./emails.registry.js";

/**
 * O corpo dos e-mails transacionais carrega o link de ação COM TOKEN (redefinir senha, convite,
 * boas-vindas do Portal). Um link desses no histórico é uma senha em texto puro: quem lê, entra.
 * E o e-mail do destinatário é gravável por qualquer funcionário, então dá para escolher de quem
 * é a conta. O log guarda o que aconteceu — não a chave para refazer.
 *
 * Redige duas formas, que são as duas que a app produz (`grep "WEB_ORIGIN}/"`):
 *   - parâmetro de consulta `token`, `code`, `secret` ou `key` — nome exato, para a regra ser
 *     óbvia de ler. Se um dia aparecer um `access_token`, some ao regex;
 *   - token NO CAMINHO de `/assinar/{token}` e `/proposta/{token}` — quem tem esse link assina o
 *     contrato ou aceita a proposta no lugar do cliente.
 */
export function redigirSegredos(texto: string): string {
  return texto
    .replace(/([?&])(token|code|secret|key)=[^\s&]*/gi, "$1$2=[removido]")
    .replace(/\/(assinar|proposta)\/[^\s/?#]+/gi, "/$1/[removido]");
}

/**
 * Registra no histórico um e-mail enviado, vinculando-o (pelo e-mail do destinatário)
 * ao usuário, cliente e/ou lead correspondentes. Best-effort: nunca lança nem bloqueia
 * o envio. É um LOG — guarda os ids sem FK, então sobrevive à exclusão das entidades.
 */
export async function registrarEmailEnviado(
  para: string,
  assunto: string,
  corpo: string,
  template: string | null,
  enviado: boolean,
  erro?: string,
): Promise<void> {
  try {
    const [user, cliente, lead] = await Promise.all([
      prisma.user.findFirst({ where: { email: para, deletedAt: null }, select: { id: true } }),
      prisma.cliente.findFirst({ where: { email: para, deletedAt: null }, select: { id: true } }),
      prisma.lead.findFirst({ where: { email: para, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    ]);
    await prisma.emailEnviado.create({
      data: {
        para,
        assunto,
        corpo: redigirSegredos(corpo),
        template,
        status: enviado ? "ENVIADO" : "FALHOU",
        erro: enviado ? null : erro ?? null,
        userId: user?.id ?? null,
        clienteId: cliente?.id ?? null,
        leadId: lead?.id ?? null,
      },
    });
  } catch {
    /* histórico de e-mail é best-effort — não pode quebrar o envio */
  }
}

/**
 * Renderiza um template, envia o e-mail e registra no histórico — o caminho único
 * de envio dos e-mails transacionais. Devolve `{ enviado }` (para o fallback de link).
 */
export async function enviarEmailTemplate(
  chave: string,
  para: string,
  vars: Record<string, string>,
): Promise<{ enviado: boolean }> {
  const { assunto, html, texto } = await renderTemplate(chave, vars);
  const { enviado, erro } = await enviarEmail({ para, assunto, html, texto });
  await registrarEmailEnviado(para, assunto, texto ?? "", chave, enviado, erro);
  return { enviado };
}

/**
 * O que toda lista devolve. **Sem `corpo`** — ver `selecaoComCorpo`: o corpo só sai para quem é o
 * destinatário (`listMeus`) ou para o monitor de ADMIN, nunca para a ficha do cliente/lead, que
 * qualquer funcionário abre.
 */
const selecao = {
  id: true,
  para: true,
  assunto: true,
  template: true,
  status: true,
  erro: true,
  createdAt: true,
} as const;

const selecaoComCorpo = { ...selecao, corpo: true } as const;

/** Acrescenta o nome amigável do template (para exibir na lista). */
function comRotulo<T extends { template: string | null }>(rows: T[]) {
  return rows.map((r) => {
    const meta = r.template ? templateDe(r.template) : undefined;
    return { ...r, templateLabel: meta ? meta.label : "E-mail" };
  });
}

/**
 * Histórico na ficha do lead/cliente. Quem chama é a equipe inteira (`funcionarioProcedure`) e,
 * no caso do cliente, também o Portal dele. Assunto, tipo, data e entrega — o corpo fica de fora
 * de propósito: era por ele que vazava o link com token de quem quer que o cadastro apontasse.
 */
export async function listPorLead(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { email: true } });
  const rows = await prisma.emailEnviado.findMany({
    where: lead?.email ? { OR: [{ leadId }, { para: lead.email }] } : { leadId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: selecao,
  });
  return comRotulo(rows);
}

export async function listPorCliente(clienteId: string) {
  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { email: true } });
  const rows = await prisma.emailEnviado.findMany({
    where: cliente?.email ? { OR: [{ clienteId }, { para: cliente.email }] } : { clienteId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: selecao,
  });
  return comRotulo(rows);
}

export async function listMeus(userId: string, email: string) {
  const rows = await prisma.emailEnviado.findMany({
    where: { OR: [{ userId }, { para: email }] },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: selecaoComCorpo,
  });
  return comRotulo(rows);
}

// ── Monitor global de e-mails (ROOT/ADMIN) ──

/** Indicadores de entrega dos e-mails + lista de tipos usados (para o filtro). */
export async function resumoEnviados() {
  const agora = Date.now();
  const seteDias = new Date(agora - 7 * 24 * 60 * 60 * 1000);
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);

  const [enviados7d, falhas7d, hoje, ultimaFalha, usados] = await Promise.all([
    prisma.emailEnviado.count({ where: { status: "ENVIADO", createdAt: { gte: seteDias } } }),
    prisma.emailEnviado.count({ where: { status: "FALHOU", createdAt: { gte: seteDias } } }),
    prisma.emailEnviado.count({ where: { createdAt: { gte: inicioHoje } } }),
    prisma.emailEnviado.findFirst({ where: { status: "FALHOU" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.emailEnviado.findMany({ distinct: ["template"], select: { template: true }, orderBy: { template: "asc" } }),
  ]);

  const total7d = enviados7d + falhas7d;
  const templates = usados
    .map((u) => u.template)
    .filter((t): t is string => !!t)
    .map((t) => ({ chave: t, label: templateDe(t)?.label ?? t }));

  return {
    enviados7d,
    falhas7d,
    hoje,
    taxaEntrega: total7d ? enviados7d / total7d : 1,
    isEmailReal,
    ultimaFalhaEm: ultimaFalha?.createdAt ?? null,
    templates,
  };
}

export interface FiltroEnviados {
  status?: "ENVIADO" | "FALHOU";
  template?: string;
  busca?: string;
  dias?: number;
  limite?: number;
}

/** Lista global do histórico de e-mails, com filtros. Paginação por limite crescente. */
export async function listTodos(f: FiltroEnviados) {
  const limite = Math.min(f.limite ?? 30, 500);
  const where: Prisma.EmailEnviadoWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.template) where.template = f.template;
  if (f.dias && f.dias > 0) where.createdAt = { gte: new Date(Date.now() - f.dias * 24 * 60 * 60 * 1000) };
  const q = f.busca?.trim();
  if (q) where.OR = [{ para: { contains: q } }, { assunto: { contains: q } }];

  const rows = await prisma.emailEnviado.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limite + 1,
    select: selecaoComCorpo,
  });
  const temMais = rows.length > limite;
  return { itens: comRotulo(temMais ? rows.slice(0, limite) : rows), temMais };
}
