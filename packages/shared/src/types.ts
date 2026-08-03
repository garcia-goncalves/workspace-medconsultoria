import type { Role } from "./constants/roles.js";

/** Usuário autenticado exposto ao front (sem campos sensíveis). */
export interface SessionUser {
  id: string;
  nome: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
  clienteId: string | null;
  /** Quando a pessoa definiu a PRÓPRIA senha. Nulo = nunca (senha veio do seed). */
  senhaTrocadaEm: Date | string | null;
}

/**
 * Convidar a definir a própria senha no 1º acesso (ADR-91).
 *
 * Só papéis INTERNOS: o cliente do Portal escolhe a senha dele ao aceitar o convite, então
 * já entra com senha própria — incomodá-lo seria ruído. Uma conta interna com
 * `senhaTrocadaEm` nulo está usando a senha compartilhada do seed.
 */
export function precisaTrocarSenha(u: { role: Role; senhaTrocadaEm: Date | string | null }): boolean {
  return u.role !== "CLIENTE" && !u.senhaTrocadaEm;
}
