import { prisma } from "@app/db";
import { EMAIL_CATEGORIAS, decidirEmailOperacional, hasRoleLevel, type Role } from "@app/shared";
import { enviarEmail } from "../../lib/email.js";
import { renderTemplate } from "../emails/emails.service.js";
import type { EmailTemplateChave } from "../emails/emails.registry.js";
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
    case "conversa":
      return "/mensagens";
    case "evento":
      return "/agenda";
    case "tarefa":
      return "/tarefas";
    case "conta":
      return "/financeiro";
    case "lead":
      return "/leads";
    // Honorário do faturamento a lançar: o id é `<clienteId>:<AAAA-MM>` (um aviso por cliente +
    // mês, `unico`), e o botão abre a aba do honorário daquele cliente na Conciliação.
    case "honorario": {
      const clienteId = id?.split(":")[0];
      return clienteId ? `/conciliacao?cliente=${encodeURIComponent(clienteId)}&aba=honorario` : "/conciliacao";
    }
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

/** Tamanho da página do histórico do sininho ("ver mais antigos"). */
export const PAGINA_HISTORICO = 30;

/**
 * Histórico do sininho, página a página, do mais novo para o mais antigo. O que o sino mostra de
 * cara continua sendo `listNotificacoes` (as 30 últimas, com polling); isto só é chamado quando a
 * pessoa pede "ver mais antigos" ou filtra "não lidas".
 *
 * Paginação por CHAVE `(createdAt, id)`, não por deslocamento: com `skip`, um aviso novo chegando
 * entre duas páginas empurra a lista e a página seguinte REPETE uma linha (ou pula uma, ao marcar
 * como lida no filtro "não lidas"). `antesDe` é o último item já na tela; o `id` desempata avisos
 * gravados no mesmo milissegundo. Sempre escopado ao próprio usuário.
 */
export function historicoNotificacoes(
  userId: string,
  opts: { antesDe?: { createdAt: Date; id: string }; apenasNaoLidas?: boolean; limite?: number } = {},
) {
  const { antesDe, apenasNaoLidas } = opts;
  return prisma.notificacao.findMany({
    where: {
      userId,
      ...(apenasNaoLidas ? { lida: false } : {}),
      ...(antesDe ? { OR: [{ createdAt: { lt: antesDe.createdAt } }, { createdAt: antesDe.createdAt, id: { lt: antesDe.id } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limite ?? PAGINA_HISTORICO,
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
/**
 * Cria a notificação in-app e dispara o e-mail branded correspondente.
 *
 * `tipo` é a chave de um template do `emails.registry` — tipado como união literal de
 * propósito: um tipo sem template fazia o `renderTemplate` explodir em RUNTIME e derrubar
 * o scan proativo. Agora não compila.
 */
export async function notificar(
  userId: string,
  tipo: EmailTemplateChave,
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
    select: { nome: true, email: true, ativo: true, deletedAt: true, role: true },
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

  // E-mail: a decisão inteira mora em `decidirEmailOperacional` (@app/shared), a MESMA
  // régua que a tela de preferências usa para mostrar o estado. Duas cópias divergiriam
  // e a tela passaria a mentir sobre o que está sendo enviado.
  const pref = await prisma.preferenciaEmail.findUnique({
    where: { userId_tipo: { userId, tipo } },
    select: { ativo: true },
  });
  const podeEmail = decidirEmailOperacional({
    tipo,
    role: user.role,
    email: user.email,
    ativo: user.ativo,
    excluido: !!user.deletedAt,
    preferencia: pref ? pref.ativo : null,
    emailDoSistema: config.ROOT_PROTEGIDO_EMAIL,
  });
  if (podeEmail) {
    const para = user.email!;
    void enviarEmail({ para, assunto: render.assunto, html: render.html, texto: render.texto })
      .then(({ enviado, erro }) => registrarEmailEnviado(para, render.assunto, render.texto ?? "", tipo, enviado, erro))
      .catch(() => {});
  }
}

/** Lista as categorias de e-mail com o estado (ativo) para o usuário. */
export async function listarPreferenciasEmail(userId: string, role: Role) {
  const [rows, user] = await Promise.all([
    prisma.preferenciaEmail.findMany({ where: { userId }, select: { tipo: true, ativo: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, ativo: true, deletedAt: true } }),
  ]);
  const map = new Map(rows.map((r) => [r.tipo, r.ativo]));
  // `soParaCliente` some da tela da equipe: seria um interruptor que não liga nada para ela.
  return EMAIL_CATEGORIAS.filter(
    (c) => (!c.minRole || hasRoleLevel(role, c.minRole)) && (!c.soParaCliente || role === "CLIENTE"),
  ).map((c) => ({
    tipo: c.tipo,
    label: c.label,
    descricao: c.descricao,
    grupo: c.grupo,
    // Mesma régua do envio: a tela mostra o que REALMENTE vai acontecer, inclusive quando
    // o padrão da categoria nasce desligado para este papel.
    ativo: decidirEmailOperacional({
      tipo: c.tipo,
      role,
      email: user?.email ?? null,
      ativo: user?.ativo ?? false,
      excluido: !!user?.deletedAt,
      preferencia: map.has(c.tipo) ? map.get(c.tipo)! : null,
      emailDoSistema: config.ROOT_PROTEGIDO_EMAIL,
    }),
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
