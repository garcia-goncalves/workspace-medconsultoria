import type { SessionUser } from "@app/shared";
import { prisma } from "@app/db";

export const SESSION_COOKIE = "sid";
const TTL_DAYS = 30;

/** Cria uma sessão persistida e devolve seu id (valor do cookie). */
export async function createSession(userId: string, userAgent?: string, ip?: string): Promise<string> {
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: { userId, expiresAt, userAgent: userAgent ?? null, ip: ip ?? null },
  });
  return session.id;
}

/** Valida a sessão pelo id e devolve o usuário (ou null se inválida/expirada). */
export async function getUserFromSession(sid: string | undefined): Promise<SessionUser | null> {
  if (!sid) return null;

  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: true },
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
  };
}

/** Remove a sessão (logout). */
export async function destroySession(sid: string | undefined): Promise<void> {
  if (!sid) return;
  await prisma.session.deleteMany({ where: { id: sid } });
}

export const SESSION_TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;
