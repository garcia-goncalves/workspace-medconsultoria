import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { ChamadoStatus, ChamadoPrioridade } from "@app/shared";
import { notificationService } from "../../realtime/socket.js";
import { notificar } from "../notificacoes/notificacoes.service.js";
import { enviarEmailTemplate } from "../emails/enviados.service.js";
import { destinatariosDaRespostaAoCliente } from "./aviso-de-resposta.js";
import { config } from "../../config.js";

async function ensureParticipant(conversaId: string, userId: string) {
  const p = await prisma.conversaParticipante.findUnique({ where: { conversaId_userId: { conversaId, userId } } });
  if (!p) throw new TRPCError({ code: "FORBIDDEN", message: "Você não participa desta conversa" });
  return p;
}

async function ehAdmin(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return u?.role === "ADMIN" || u?.role === "ROOT";
}

/** Usuários internos para iniciar conversas (exclui clientes e você mesmo). */
export function listUsuarios(userId: string) {
  return prisma.user.findMany({
    where: { ativo: true, deletedAt: null, role: { not: "CLIENTE" }, id: { not: userId } },
    select: { id: true, nome: true, role: true, avatarUrl: true },
    orderBy: { nome: "asc" },
  });
}

/** Clientes/leads para a equipe abrir um chamado (busca por nome). */
export function listClientesParaChamado(busca?: string) {
  const q = busca?.trim();
  return prisma.cliente.findMany({
    where: { deletedAt: null, ...(q ? { nome: { contains: q } } : {}) },
    select: { id: true, nome: true, situacaoComercial: true },
    orderBy: { nome: "asc" },
    take: 50,
  });
}

async function contarNaoLidas(conversaId: string, userId: string, ultimaLeituraEm: Date | null) {
  return prisma.mensagem.count({
    where: { conversaId, deletedAt: null, autorId: { not: userId }, ...(ultimaLeituraEm ? { createdAt: { gt: ultimaLeituraEm } } : {}) },
  });
}

/** Conversas do usuário, enriquecidas. `arquivadas`=true lista só as arquivadas. */
export async function listConversas(userId: string, arquivadas = false) {
  const parts = await prisma.conversaParticipante.findMany({
    where: {
      userId,
      ocultoEm: null,
      ...(arquivadas ? { NOT: { arquivadoEm: null } } : { arquivadoEm: null }),
      conversa: { deletedAt: null },
    },
    include: {
      conversa: {
        include: {
          participantes: { include: { user: { select: { id: true, nome: true, role: true, avatarUrl: true } } } },
          mensagens: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
          cliente: { select: { id: true, nome: true } },
          responsavel: { select: { id: true, nome: true } },
        },
      },
    },
  });

  const clienteIds = parts.map((p) => p.conversa.clienteId).filter((x): x is string => !!x);
  const leadsAtivos = clienteIds.length
    ? await prisma.lead.findMany({ where: { clienteId: { in: clienteIds }, convertidoEmClienteId: null, perdidoEm: null, deletedAt: null }, select: { clienteId: true } })
    : [];
  const ehLead = new Set(leadsAtivos.map((l) => l.clienteId));

  const result = [];
  for (const p of parts) {
    const conv = p.conversa;
    let categoria: "direta" | "grupo" | "cliente" | "lead";
    let nome: string;
    if (conv.tipo === "GRUPO") {
      categoria = "grupo";
      nome = conv.nome ?? "Grupo";
    } else if (conv.tipo === "CLIENTE") {
      categoria = conv.clienteId && ehLead.has(conv.clienteId) ? "lead" : "cliente";
      nome = conv.cliente?.nome ?? "Cliente";
    } else {
      categoria = "direta";
      nome = conv.participantes.find((pp) => pp.userId !== userId)?.user.nome ?? "Conversa";
    }
    // Avatar da conversa: em diretas = a outra pessoa; em chamados = a foto/logo do cliente (usuário do Portal).
    let avatarUserId: string | null = null;
    let avatarUrl: string | null = null;
    if (conv.tipo === "INDIVIDUAL") {
      const o = conv.participantes.find((pp) => pp.userId !== userId)?.user;
      if (o?.avatarUrl) {
        avatarUserId = o.id;
        avatarUrl = o.avatarUrl;
      }
    } else if (conv.tipo === "CLIENTE") {
      const cli = conv.participantes.find((pp) => pp.user.role === "CLIENTE" && pp.user.avatarUrl)?.user;
      if (cli) {
        avatarUserId = cli.id;
        avatarUrl = cli.avatarUrl;
      }
    }
    const ultima = conv.mensagens[0] ?? null;
    result.push({
      id: conv.id,
      tipo: conv.tipo,
      categoria,
      nome,
      numero: conv.numero,
      assunto: conv.assunto,
      status: conv.status,
      prioridade: conv.prioridade,
      resolvidoEm: conv.resolvidoEm,
      clienteId: conv.clienteId,
      responsavel: conv.responsavel,
      avatarUserId,
      avatarUrl,
      membros: conv.participantes.length,
      updatedAt: conv.updatedAt,
      ultimaMensagem: ultima ? { conteudo: ultima.conteudo, createdAt: ultima.createdAt } : null,
      naoLidas: await contarNaoLidas(conv.id, userId, p.ultimaLeituraEm),
      fixado: !!p.fixadoEm,
      silenciado: !!p.silenciadoEm,
      arquivado: !!p.arquivadoEm,
    });
  }
  // Fixadas primeiro, depois por atividade recente.
  result.sort((a, b) => Number(b.fixado) - Number(a.fixado) || +new Date(b.updatedAt) - +new Date(a.updatedAt));
  return result;
}

/** Detalhes de uma conversa (para o painel de configurações). */
export async function getConversaInfo(conversaId: string, userId: string) {
  await ensureParticipant(conversaId, userId);
  const conv = await prisma.conversa.findUnique({
    where: { id: conversaId },
    include: {
      participantes: { include: { user: { select: { id: true, nome: true, role: true, avatarUrl: true } } } },
      cliente: { select: { id: true, nome: true } },
      responsavel: { select: { id: true, nome: true } },
    },
  });
  if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });
  const admin = await ehAdmin(userId);
  return {
    id: conv.id,
    tipo: conv.tipo,
    nome: conv.nome,
    numero: conv.numero,
    assunto: conv.assunto,
    status: conv.status,
    prioridade: conv.prioridade,
    resolvidoEm: conv.resolvidoEm,
    clienteId: conv.clienteId,
    cliente: conv.cliente,
    responsavel: conv.responsavel,
    criadoPorId: conv.criadoPorId,
    podeGerir: (conv.tipo === "GRUPO" && (conv.criadoPorId === userId || admin)) || (conv.tipo === "CLIENTE"),
    ehAdmin: admin,
    participantes: conv.participantes
      .map((p) => ({ id: p.user.id, nome: p.user.nome, role: p.user.role, avatarUrl: p.user.avatarUrl }))
      .sort((a, b) => a.nome.localeCompare(b.nome)),
  };
}

export async function startIndividual(userId: string, outroUserId: string) {
  if (outroUserId === userId) throw new TRPCError({ code: "BAD_REQUEST", message: "Não é possível conversar consigo mesmo" });
  const existente = await prisma.conversa.findFirst({
    where: { tipo: "INDIVIDUAL", deletedAt: null, AND: [{ participantes: { some: { userId } } }, { participantes: { some: { userId: outroUserId } } }] },
  });
  if (existente) {
    // Reexibe se o usuário havia ocultado a conversa.
    await prisma.conversaParticipante.updateMany({ where: { conversaId: existente.id, userId }, data: { ocultoEm: null } });
    return existente;
  }
  return prisma.conversa.create({ data: { tipo: "INDIVIDUAL", participantes: { create: [{ userId }, { userId: outroUserId }] } } });
}

export function createGrupo(userId: string, nome: string, participantIds: string[]) {
  const ids = Array.from(new Set([userId, ...participantIds]));
  return prisma.conversa.create({ data: { tipo: "GRUPO", nome: nome.trim(), criadoPorId: userId, participantes: { create: ids.map((id) => ({ userId: id })) } } });
}

// ── Gestão de grupo ──────────────────────────────────────
async function ensureGrupoGerivel(conversaId: string, userId: string) {
  const conv = await prisma.conversa.findUnique({ where: { id: conversaId }, select: { tipo: true, criadoPorId: true } });
  if (!conv || conv.tipo !== "GRUPO") throw new TRPCError({ code: "BAD_REQUEST", message: "Não é um grupo" });
  await ensureParticipant(conversaId, userId);
  if (conv.criadoPorId !== userId && !(await ehAdmin(userId))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Só o criador do grupo ou um administrador pode gerenciá-lo" });
  }
}

export async function renomearGrupo(conversaId: string, userId: string, nome: string) {
  await ensureGrupoGerivel(conversaId, userId);
  return prisma.conversa.update({ where: { id: conversaId }, data: { nome: nome.trim() } });
}

export async function addParticipantes(conversaId: string, userId: string, userIds: string[]) {
  await ensureGrupoGerivel(conversaId, userId);
  await prisma.conversaParticipante.createMany({ data: userIds.map((uid) => ({ conversaId, userId: uid })), skipDuplicates: true });
  await prisma.conversa.update({ where: { id: conversaId }, data: { updatedAt: new Date() } });
  return { ok: true };
}

export async function removerParticipante(conversaId: string, userId: string, alvoId: string) {
  await ensureGrupoGerivel(conversaId, userId);
  await prisma.conversaParticipante.deleteMany({ where: { conversaId, userId: alvoId } });
  return { ok: true };
}

export async function sairDaConversa(conversaId: string, userId: string) {
  await ensureParticipant(conversaId, userId);
  await prisma.conversaParticipante.deleteMany({ where: { conversaId, userId } });
  return { ok: true };
}

/** Apagar conversa: grupo/chamado (admin) some p/ todos; direta é ocultada só p/ você. */
export async function apagarConversa(conversaId: string, userId: string) {
  await ensureParticipant(conversaId, userId);
  const conv = await prisma.conversa.findUnique({ where: { id: conversaId }, select: { tipo: true, criadoPorId: true } });
  if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });
  const admin = await ehAdmin(userId);
  if (conv.tipo === "GRUPO" && (conv.criadoPorId === userId || admin)) {
    await prisma.conversa.update({ where: { id: conversaId }, data: { deletedAt: new Date() } });
  } else if (conv.tipo === "CLIENTE" && admin) {
    await prisma.conversa.update({ where: { id: conversaId }, data: { deletedAt: new Date() } });
  } else if (conv.tipo === "INDIVIDUAL") {
    await prisma.conversaParticipante.updateMany({ where: { conversaId, userId }, data: { ocultoEm: new Date() } });
  } else {
    throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode apagar esta conversa" });
  }
  return { ok: true };
}

// Preferências por usuário (fixar/silenciar/arquivar).
async function setPreferencia(conversaId: string, userId: string, campo: "fixadoEm" | "silenciadoEm" | "arquivadoEm", ligar: boolean) {
  await ensureParticipant(conversaId, userId);
  await prisma.conversaParticipante.updateMany({ where: { conversaId, userId }, data: { [campo]: ligar ? new Date() : null } });
  return { ok: true };
}
export const fixar = (c: string, u: string, l: boolean) => setPreferencia(c, u, "fixadoEm", l);
export const silenciar = (c: string, u: string, l: boolean) => setPreferencia(c, u, "silenciadoEm", l);
export const arquivar = (c: string, u: string, l: boolean) => setPreferencia(c, u, "arquivadoEm", l);

// ── Chamados/tickets (conversa CLIENTE) ──────────────────
async function participantesDoCliente(clienteId: string, atorId?: string | null): Promise<string[]> {
  const [cliente, portalUsers, admins] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { responsavelId: true } }),
    prisma.user.findMany({ where: { clienteId, role: "CLIENTE", ativo: true, deletedAt: null }, select: { id: true } }),
    prisma.user.findMany({ where: { role: { in: ["ADMIN", "ROOT"] }, ativo: true, deletedAt: null }, select: { id: true } }),
  ]);
  const ids = new Set<string>([...portalUsers.map((u) => u.id), ...admins.map((a) => a.id)]);
  if (cliente?.responsavelId) ids.add(cliente.responsavelId);
  if (atorId) ids.add(atorId);
  return [...ids];
}

/** Cria um NOVO chamado (ticket) para um cliente/lead. Protocolo sequencial. */
export async function criarChamado(atorId: string | null, clienteId: string, assunto: string, prioridade: ChamadoPrioridade = "NORMAL") {
  const ids = await participantesDoCliente(clienteId, atorId);
  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { responsavelId: true } });
  const agg = await prisma.conversa.aggregate({ _max: { numero: true } });
  const numero = (agg._max.numero ?? 1002) + 1;
  return prisma.conversa.create({
    data: {
      tipo: "CLIENTE",
      clienteId,
      numero,
      assunto: assunto.trim(),
      prioridade,
      status: "ABERTO",
      responsavelId: cliente?.responsavelId ?? null,
      criadoPorId: atorId ?? null,
      participantes: { create: ids.map((id) => ({ userId: id })) },
    },
    select: { id: true, numero: true },
  });
}

/** Equipe abre um chamado. */
export async function iniciarChamado(atorId: string, clienteId: string, assunto: string, prioridade?: ChamadoPrioridade) {
  return criarChamado(atorId, clienteId, assunto, prioridade ?? "NORMAL");
}

/** Todos os chamados de um cliente (abertos + histórico) — ficha e Portal. */
export async function listChamadosDoCliente(clienteId: string, userId?: string) {
  const chamados = await prisma.conversa.findMany({
    where: { tipo: "CLIENTE", clienteId, deletedAt: null },
    include: { mensagens: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1 }, responsavel: { select: { id: true, nome: true } } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
  const out = [];
  for (const c of chamados) {
    let naoLidas = 0;
    if (userId) {
      const part = await prisma.conversaParticipante.findUnique({ where: { conversaId_userId: { conversaId: c.id, userId } }, select: { ultimaLeituraEm: true } });
      naoLidas = part ? await contarNaoLidas(c.id, userId, part.ultimaLeituraEm) : 0;
    }
    out.push({
      id: c.id,
      numero: c.numero,
      assunto: c.assunto,
      status: c.status,
      prioridade: c.prioridade,
      resolvidoEm: c.resolvidoEm,
      updatedAt: c.updatedAt,
      responsavel: c.responsavel,
      ultimaMensagem: c.mensagens[0] ? { conteudo: c.mensagens[0].conteudo, createdAt: c.mensagens[0].createdAt } : null,
      naoLidas,
    });
  }
  return out;
}

async function ensureChamado(conversaId: string, userId: string) {
  await ensureParticipant(conversaId, userId);
  const conv = await prisma.conversa.findUnique({ where: { id: conversaId }, select: { tipo: true } });
  if (conv?.tipo !== "CLIENTE") throw new TRPCError({ code: "BAD_REQUEST", message: "Não é um chamado" });
}

export async function setChamadoStatus(conversaId: string, userId: string, status: ChamadoStatus) {
  await ensureChamado(conversaId, userId);
  const conv = await prisma.conversa.update({ where: { id: conversaId }, data: { status, resolvidoEm: status === "RESOLVIDO" ? new Date() : null } });
  // Atualiza equipe (outros membros) e Portal do cliente em tempo real.
  await pushParaParticipantes(conversaId, "mensagem", { conversaId });
  return conv;
}
export const resolverChamado = (c: string, u: string) => setChamadoStatus(c, u, "RESOLVIDO");
export const reabrirChamado = (c: string, u: string) => setChamadoStatus(c, u, "ABERTO");

export async function setChamadoResponsavel(conversaId: string, userId: string, responsavelId: string | null) {
  await ensureChamado(conversaId, userId);
  if (responsavelId) await prisma.conversaParticipante.createMany({ data: [{ conversaId, userId: responsavelId }], skipDuplicates: true });
  return prisma.conversa.update({ where: { id: conversaId }, data: { responsavelId } });
}
export async function setChamadoAssunto(conversaId: string, userId: string, assunto: string) {
  await ensureChamado(conversaId, userId);
  return prisma.conversa.update({ where: { id: conversaId }, data: { assunto: assunto.trim() } });
}
export async function setChamadoPrioridade(conversaId: string, userId: string, prioridade: ChamadoPrioridade) {
  await ensureChamado(conversaId, userId);
  return prisma.conversa.update({ where: { id: conversaId }, data: { prioridade } });
}

// ── Mensagens ────────────────────────────────────────────
export async function listMensagens(conversaId: string, userId: string) {
  await ensureParticipant(conversaId, userId);
  const msgs = await prisma.mensagem.findMany({
    where: { conversaId },
    orderBy: { createdAt: "asc" },
    take: 400,
    include: { autor: { select: { id: true, nome: true, role: true, avatarUrl: true } } },
  });
  // Mensagens apagadas viram lápide (não vaza o conteúdo).
  return msgs.map((m) => ({ ...m, conteudo: m.deletedAt ? "" : m.conteudo }));
}

async function pushParaParticipantes(conversaId: string, evento: string, payload: unknown, exceto?: string) {
  const parts = await prisma.conversaParticipante.findMany({
    where: { conversaId },
    // `nome`, `email` e `acessoRevogadoEm` vêm junto porque a resposta da equipe precisa
    // alcançar o cliente por e-mail (M8) — e `ativo` não distingue revogado de convidado.
    select: {
      userId: true,
      user: { select: { role: true, nome: true, email: true, ativo: true, acessoRevogadoEm: true } },
    },
  });
  for (const p of parts) if (p.userId !== exceto) notificationService.emitToUser(p.userId, evento, payload);
  return parts;
}

export async function sendMensagem(conversaId: string, conteudo: string, userId: string) {
  await ensureParticipant(conversaId, userId);
  const conv = await prisma.conversa.findUnique({ where: { id: conversaId }, select: { tipo: true, clienteId: true } });
  const msg = await prisma.mensagem.create({ data: { conversaId, autorId: userId, conteudo: conteudo.trim() }, include: { autor: { select: { id: true, nome: true, role: true, avatarUrl: true } } } });
  await prisma.conversa.update({ where: { id: conversaId }, data: { updatedAt: new Date() } });
  await prisma.conversaParticipante.update({ where: { conversaId_userId: { conversaId, userId } }, data: { ultimaLeituraEm: new Date() } });
  // Reexibe a conversa para quem a havia ocultado.
  await prisma.conversaParticipante.updateMany({ where: { conversaId, NOT: { ocultoEm: null } }, data: { ocultoEm: null } });

  const parts = await pushParaParticipantes(conversaId, "mensagem", { conversaId, mensagem: msg }, userId);

  // ⚠️ A VOLTA DO CANAL DE SUPORTE (M8) — a equipe responde e o cliente fica sabendo.
  //
  // A ida (abaixo) sempre existiu; esta metade não. O cliente abria o chamado, a equipe
  // respondia, e ele só descobria se voltasse ao Portal por conta própria — trabalho feito e
  // invisível para quem pediu. O push em tempo real acima só alcança quem está com o Portal
  // ABERTO neste segundo, que é justamente quem não precisa de aviso.
  //
  // Vai por `enviarEmailTemplate`, e não por `notificar`: é e-mail transacional PARA O CLIENTE,
  // como as boas-vindas e o "serviço ativado" — não um aviso interno com interruptor na tela de
  // preferências da equipe (o cliente nem abre aquela tela). Best-effort: a mensagem não deixa
  // de ser gravada porque o e-mail tropeçou.
  if (conv?.tipo === "CLIENTE" && msg.autor.role !== "CLIENTE") {
    const assunto = (await prisma.conversa.findUnique({ where: { id: conversaId }, select: { assunto: true } }))?.assunto;
    const destinos = destinatariosDaRespostaAoCliente(
      parts.map((p) => ({ userId: p.userId, ...p.user })),
      userId,
    );
    // `allSettled` e não `void`: o envio precisa ficar OBSERVÁVEL (é ele que grava a linha em
    // `EmailEnviado`, de onde sai o monitor de entregas). Uma caixa fora do ar não derruba a
    // mensagem — cada destinatário falha sozinho —, mas some do monitor era como a ADR-122
    // passou meses sem ninguém notar que NENHUM e-mail saía.
    await Promise.allSettled(
      destinos.map((d) =>
        enviarEmailTemplate("suporte_resposta", d.email, {
          nome: d.nome,
          assunto: assunto ?? "seu chamado",
          mensagem: conteudo.trim().slice(0, 200),
          link: config.WEB_ORIGIN,
        }),
      ),
    );
  }

  // Chamado: cliente escreveu → avisa a equipe (respeita silenciar via notificar? notificação sempre; e-mail sim).
  if (conv?.tipo === "CLIENTE" && msg.autor.role === "CLIENTE") {
    const cliente = conv.clienteId ? await prisma.cliente.findUnique({ where: { id: conv.clienteId }, select: { nome: true } }) : null;
    for (const p of parts) {
      if (p.userId !== userId && p.user.role !== "CLIENTE") {
        await notificar(p.userId, "suporte", { cliente: cliente?.nome ?? "cliente", mensagem: conteudo.trim().slice(0, 120) }, { entidadeTipo: "cliente", entidadeId: conv.clienteId ?? undefined });
      }
    }
  }
  return msg;
}

export async function editarMensagem(mensagemId: string, userId: string, conteudo: string) {
  const m = await prisma.mensagem.findUnique({ where: { id: mensagemId }, select: { autorId: true, conversaId: true, deletedAt: true } });
  if (!m || m.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada" });
  if (m.autorId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode editar suas mensagens" });
  const msg = await prisma.mensagem.update({ where: { id: mensagemId }, data: { conteudo: conteudo.trim(), editadoEm: new Date() }, include: { autor: { select: { id: true, nome: true, role: true, avatarUrl: true } } } });
  await pushParaParticipantes(m.conversaId, "mensagem", { conversaId: m.conversaId, mensagem: msg });
  return msg;
}

export async function apagarMensagem(mensagemId: string, userId: string) {
  const m = await prisma.mensagem.findUnique({ where: { id: mensagemId }, select: { autorId: true, conversaId: true } });
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada" });
  if (m.autorId !== userId && !(await ehAdmin(userId))) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode apagar suas mensagens" });
  await prisma.mensagem.update({ where: { id: mensagemId }, data: { deletedAt: new Date() } });
  await pushParaParticipantes(m.conversaId, "mensagem", { conversaId: m.conversaId });
  return { ok: true };
}

export async function markRead(conversaId: string, userId: string) {
  await ensureParticipant(conversaId, userId);
  await prisma.conversaParticipante.update({ where: { conversaId_userId: { conversaId, userId } }, data: { ultimaLeituraEm: new Date() } });
  return { ok: true };
}

// ── Portal (escopado ao clienteId da sessão) ─────────────
async function ensureChamadoDoCliente(conversaId: string, clienteId: string) {
  const conv = await prisma.conversa.findFirst({ where: { id: conversaId, tipo: "CLIENTE", clienteId, deletedAt: null }, select: { id: true, status: true } });
  if (!conv) throw new TRPCError({ code: "FORBIDDEN", message: "Chamado indisponível" });
  return conv;
}

export function portalListChamados(clienteId: string, portalUserId: string) {
  return listChamadosDoCliente(clienteId, portalUserId);
}

export async function portalAbrirChamado(clienteId: string, portalUserId: string, assunto: string, mensagem?: string) {
  const conv = await criarChamado(portalUserId, clienteId, assunto, "NORMAL");
  if (mensagem?.trim()) {
    await sendMensagem(conv.id, mensagem, portalUserId);
  } else {
    // Sem primeira mensagem: ainda avisa a equipe do novo chamado.
    const cli = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } });
    const parts = await prisma.conversaParticipante.findMany({ where: { conversaId: conv.id }, select: { userId: true, user: { select: { role: true } } } });
    for (const p of parts) {
      if (p.user.role !== "CLIENTE") await notificar(p.userId, "suporte", { cliente: cli?.nome ?? "cliente", mensagem: `Novo chamado: ${assunto}` }, { entidadeTipo: "cliente", entidadeId: clienteId });
    }
  }
  return conv;
}

export async function portalMensagens(clienteId: string, portalUserId: string, conversaId: string) {
  await ensureChamadoDoCliente(conversaId, clienteId);
  const info = await prisma.conversa.findUnique({ where: { id: conversaId }, select: { numero: true, assunto: true, status: true } });
  const mensagens = await listMensagens(conversaId, portalUserId);
  return { conversaId, numero: info?.numero ?? null, assunto: info?.assunto ?? null, status: info?.status ?? "ABERTO", mensagens };
}

export async function portalEnviar(clienteId: string, portalUserId: string, conversaId: string, corpo: string) {
  const conv = await ensureChamadoDoCliente(conversaId, clienteId);
  // Cliente respondeu num chamado resolvido → reabre automaticamente.
  if (conv.status === "RESOLVIDO") await prisma.conversa.update({ where: { id: conversaId }, data: { status: "ABERTO", resolvidoEm: null } });
  return sendMensagem(conversaId, corpo, portalUserId);
}
