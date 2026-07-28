import { prisma } from "@app/db";
import { EMAIL_TIPOS, EMAIL_CATEGORIAS, hasRoleLevel, type Role } from "@app/shared";
import { enviarEmail } from "../../lib/email.js";
import { renderTemplate } from "../emails/emails.service.js";
import { registrarEmailEnviado } from "../emails/enviados.service.js";
import { notificationService } from "../../realtime/socket.js";
import { config } from "../../config.js";

/** Rota no workspace para a entidade da notificação (usada no botão do e-mail). */
function rotaEntidade(tipo?: string | null, id?: string | null): string {
  switch (tipo) {
    case "projeto":
      return id ? `/projetos/${id}` : "/projetos";
    case "documento":
      return id ? `/documentos/${id}` : "/documentos";
    case "cliente":
      return id ? `/clientes/${id}` : "/clientes";
    case "evento":
      return "/agenda";
    case "tarefa":
      return "/tarefas";
    case "conta":
      return "/financeiro";
    case "lead":
      return "/leads";
    case "incidente":
    case "erro":
      return "/sistema";
    default:
      return "/";
  }
}

export function listNotificacoes(userId: string) {
  return prisma.notificacao.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
}

export async function markAllRead(userId: string) {
  await prisma.notificacao.updateMany({ where: { userId, lida: false }, data: { lida: true } });
  return { ok: true };
}

/** Marca UMA notificação como lida (só se for do próprio usuário). */
export async function markRead(userId: string, id: string) {
  await prisma.notificacao.updateMany({ where: { id, userId }, data: { lida: true } });
  return { ok: true };
}

interface NotificarOpts {
  entidadeTipo?: string;
  entidadeId?: string;
  /** Não duplica se já existir notificação do mesmo tipo/entidade p/ o usuário. */
  unico?: boolean;
}

/**
 * PONTO ÚNICO de notificação. Renderiza o template (título/corpo, editável na
 * página de E-mails), cria a notificação in-app, faz o push em tempo real e
 * dispara o e-mail — se a categoria for "emailável" e o usuário não a desativou.
 */
export async function notificar(
  userId: string,
  tipo: string,
  vars: Record<string, string>,
  opts: NotificarOpts = {},
): Promise<void> {
  // Dedup (para os alertas do scan proativo).
  if (opts.unico && opts.entidadeId) {
    const existe = await prisma.notificacao.findFirst({
      where: { userId, tipo, entidadeId: opts.entidadeId },
      select: { id: true },
    });
    if (existe) return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { nome: true, email: true, ativo: true, deletedAt: true },
  });
  if (!user) return;

  const link = config.WEB_ORIGIN + rotaEntidade(opts.entidadeTipo, opts.entidadeId);
  const render = await renderTemplate(tipo, { ...vars, nome: user.nome, link });

  const notif = await prisma.notificacao.create({
    data: {
      userId,
      tipo,
      titulo: render.titulo,
      corpo: render.corpo || null,
      entidadeTipo: opts.entidadeTipo ?? null,
      entidadeId: opts.entidadeId ?? null,
    },
  });
  notificationService.emitToUser(userId, "notificacao", notif);

  // E-mail (respeitando categoria emailável + preferência + conta válida).
  const podeEmail =
    EMAIL_TIPOS.includes(tipo) &&
    user.ativo &&
    !user.deletedAt &&
    !!user.email &&
    !user.email.startsWith("deleted+");
  if (podeEmail) {
    const pref = await prisma.preferenciaEmail.findUnique({
      where: { userId_tipo: { userId, tipo } },
      select: { ativo: true },
    });
    if (!pref || pref.ativo) {
      const para = user.email!;
      void enviarEmail({ para, assunto: render.assunto, html: render.html, texto: render.texto })
        .then(({ enviado, erro }) => registrarEmailEnviado(para, render.assunto, render.texto ?? "", tipo, enviado, erro))
        .catch(() => {});
    }
  }
}

/** Lista as categorias de e-mail com o estado (ativo) para o usuário. */
export async function listarPreferenciasEmail(userId: string, role: Role) {
  const rows = await prisma.preferenciaEmail.findMany({ where: { userId }, select: { tipo: true, ativo: true } });
  const map = new Map(rows.map((r) => [r.tipo, r.ativo]));
  return EMAIL_CATEGORIAS.filter((c) => !c.minRole || hasRoleLevel(role, c.minRole)).map((c) => ({
    tipo: c.tipo,
    label: c.label,
    descricao: c.descricao,
    ativo: map.get(c.tipo) ?? true,
  }));
}

/** Liga/desliga uma categoria de e-mail para o usuário. */
export async function setPreferenciaEmail(userId: string, tipo: string, ativo: boolean) {
  await prisma.preferenciaEmail.upsert({
    where: { userId_tipo: { userId, tipo } },
    create: { userId, tipo, ativo },
    update: { ativo },
  });
  return { ok: true };
}
