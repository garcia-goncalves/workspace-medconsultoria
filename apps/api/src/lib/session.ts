import type { SessionUser } from "@app/shared";
import { prisma } from "@app/db";

export const SESSION_COOKIE = "sid";
const TTL_DAYS = 30;

/**
 * SESSÃO DE SUPORTE — dura 30 minutos, não 30 dias (ADR-128).
 *
 * A equipe entra no Painel do cliente para conferir uma coisa, não para morar lá. Prazo curto
 * é o que impede uma aba esquecida de virar acesso permanente ao dado de outra pessoa; e o
 * "voltar ao meu acesso" continua a um clique, então o custo de expirar é zero.
 */
const SUPORTE_TTL_MS = 30 * 60 * 1000;

export interface OpcoesDeSessao {
  userAgent?: string;
  ip?: string;
  /** Quem da EQUIPE está abrindo esta sessão para ver o Portal de um cliente. */
  operadorId?: string;
  /** A sessão do operador, para o "voltar ao meu acesso" não pedir login de novo. */
  voltarParaSessionId?: string;
}

/** Cria uma sessão persistida e devolve seu id (valor do cookie). */
export async function createSession(userId: string, opts: OpcoesDeSessao = {}): Promise<string> {
  const ehSuporte = !!opts.operadorId;
  const ttl = ehSuporte ? SUPORTE_TTL_MS : TTL_DAYS * 24 * 60 * 60 * 1000;
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + ttl),
      userAgent: opts.userAgent ?? null,
      ip: opts.ip ?? null,
      operadorId: opts.operadorId ?? null,
      voltarParaSessionId: opts.voltarParaSessionId ?? null,
    },
  });
  return session.id;
}

/** Quantos segundos o cookie desta sessão deve viver. */
export function ttlDaSessao(ehSuporte: boolean): number {
  return ehSuporte ? SUPORTE_TTL_MS / 1000 : SESSION_TTL_SECONDS;
}

/** Valida a sessão pelo id e devolve o usuário (ou null se inválida/expirada). */
export async function getUserFromSession(sid: string | undefined): Promise<SessionUser | null> {
  if (!sid) return null;

  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: true, operador: { select: { id: true, nome: true } } },
  });

  if (!session || session.expiresAt < new Date()) return null;
  const { user } = session;
  if (!user.ativo || user.deletedAt) return null;

  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    clienteId: user.clienteId,
    senhaTrocadaEm: user.senhaTrocadaEm,
    // SESSÃO DE SUPORTE (ADR-128). Preenchido só quando alguém da equipe abriu o Painel deste
    // cliente. Quem lê isto: a faixa do Portal, o guarda das ações de compromisso e o registro
    // de histórico — que passa a dizer quem realmente agiu.
    operador: session.operador ? { id: session.operador.id, nome: session.operador.nome } : null,
    voltarParaSessionId: session.voltarParaSessionId,
  };
}

/** Remove a sessão (logout). */
export async function destroySession(sid: string | undefined): Promise<void> {
  if (!sid) return;
  await prisma.session.deleteMany({ where: { id: sid } });
}

export const SESSION_TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;
