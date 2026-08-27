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
  /**
   * SESSÃO DE SUPORTE (ADR-128) — quem da EQUIPE está vendo este Portal, quando alguém da casa
   * entrou pelo botão "Painel" do card. Nulo em sessão normal, que é a esmagadora maioria.
   *
   * Três coisas leem isto: a **faixa** do Portal ("você está vendo como Clínica X"), o **guarda**
   * das ações de compromisso (aceitar/recusar proposta, assinar, desistir — a equipe vê tudo e
   * não assina nada) e o **histórico**, que passa a registrar quem realmente agiu em vez de
   * culpar o cliente.
   */
  operador?: { id: string; nome: string } | null;
  /** A sessão do operador, para o "voltar ao meu acesso" não pedir login de novo. */
  voltarParaSessionId?: string | null;
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

/**
 * ESTADO DO ACESSO AO PORTAL, como o card do lead e o do cliente precisam mostrar (ADR-128).
 *
 * Três estados, não dois. O do meio é o que a Thaís não tinha e mais precisa: saber que ela
 * convidou e **ninguém apareceu** — é isso que se cobra, e antes disso o card só dizia
 * "Reenviar acesso" sem contar por quê.
 *
 * `SEM_ACESSO` — não existe conta de Portal. O card oferece **Enviar acesso**.
 * `CONVIDADO`  — a conta existe, o cliente ainda não definiu a senha. O card oferece
 *                **Reenviar acesso** e diz há quantos dias o convite está parado.
 * `ATIVO`      — o cliente definiu a senha e entrou. O card oferece **Painel** e diz quando
 *                foi o último acesso DELE (sessão de suporte da equipe não conta).
 */
export type EstadoDoPortal = "SEM_ACESSO" | "CONVIDADO" | "ATIVO";

export interface AcessoAoPortal {
  estado: EstadoDoPortal;
  /** Quando a conta de Portal foi criada — a régua do "convidado há N dias". */
  convidadoEm: Date | string | null;
  /** Último login DO CLIENTE. Nulo enquanto ele nunca entrou. */
  ultimoAcessoEm: Date | string | null;
}
