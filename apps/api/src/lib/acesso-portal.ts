import type { AcessoAoPortal } from "@app/shared";

/** Uma conta de Portal como as consultas de lead/cliente a trazem. */
export type ContaDePortal = {
  ativo: boolean;
  passwordHash: string | null;
  createdAt: Date;
  ultimoAcessoEm: Date | null;
};

/**
 * Traduz as contas de Portal de um cliente nos três estados que o card mostra (ADR-128).
 *
 * Pura e num lugar só porque a mesma pergunta é feita na lista de leads, na lista de clientes e
 * na ficha — e três cópias divergiriam no primeiro ajuste.
 *
 * ⚠️ **Recebe a LISTA, não a primeira conta.** Um mesmo cliente pode ter mais de uma conta de
 * Portal — foi assim que o defeito apareceu na tela em 26/08/2026: a "Clínica teste" tinha uma
 * conta pendente antiga e uma ativa mais nova, e pegar "a primeira por data" mostrava
 * **"Enviar acesso" para quem já entrava no Portal todo dia**. Quem manda é a conta que
 * REALMENTE ABRE A PORTA; a pendente só conta quando não há nenhuma ativa.
 *
 * O critério de "ativo" é o de sempre: conta ativa **com senha definida**. Só ter `clienteId`
 * nunca bastou.
 */
export function acessoAoPortal(contas: ContaDePortal[] | null | undefined): AcessoAoPortal {
  const lista = contas ?? [];
  if (!lista.length) return { estado: "SEM_ACESSO", convidadoEm: null, ultimoAcessoEm: null };

  const ativa = lista.find((c) => c.ativo && c.passwordHash !== null);
  if (ativa) {
    return { estado: "ATIVO", convidadoEm: ativa.createdAt, ultimoAcessoEm: ativa.ultimoAcessoEm };
  }
  // Nenhuma abre a porta: mostra a mais ANTIGA, que é a que dá a régua honesta do "convidado há
  // N dias" — reenviar o convite não zera a espera do cliente.
  const maisAntiga = lista.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
  return { estado: "CONVIDADO", convidadoEm: maisAntiga.createdAt, ultimoAcessoEm: null };
}
