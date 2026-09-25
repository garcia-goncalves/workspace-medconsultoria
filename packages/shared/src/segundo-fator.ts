import { z } from "zod";
import { hasRoleLevel, type Role } from "./constants/roles.js";
import type { SessionUser } from "./types.js";

/**
 * VERIFICAÇÃO EM DUAS ETAPAS (TOTP) — as regras que servidor e tela precisam ler IGUAIS.
 *
 * ⚠️ **HOJE É OPCIONAL.** ADMIN e ROOT veem um aviso persistente no Início até ativarem, mas
 * ninguém é barrado. Para torná-la OBRIGATÓRIA depois, virar esta constante para `true` NÃO
 * basta sozinho: é preciso também uma página que prenda quem ainda não ativou logo depois do
 * login — no molde da senha do 1º acesso (ADR-91, `TrocarSenhaPrimeiroAcessoPage`), lendo
 * `segundoFatorExigidoPara`. A constante existe para que essa mudança seja uma linha num lugar
 * só, e não uma caça a `role === "ADMIN"` espalhados.
 */
export const SEGUNDO_FATOR_OBRIGATORIO = false;

/** Quem é convidado (e, um dia, obrigado) a ativar: quem pode mexer em dinheiro e em acessos. */
export function segundoFatorRecomendadoPara(role: Role): boolean {
  return hasRoleLevel(role, "ADMIN");
}

/** Quem é OBRIGADO a ativar. Hoje ninguém — ver `SEGUNDO_FATOR_OBRIGATORIO`. */
export function segundoFatorExigidoPara(role: Role): boolean {
  return SEGUNDO_FATOR_OBRIGATORIO && segundoFatorRecomendadoPara(role);
}

/**
 * O que o login devolve. Com 2FA ativo, a senha certa NÃO abre sessão: devolve um desafio curto,
 * que só vira sessão com o código do aplicativo (`auth.confirmarSegundoFator`).
 *
 * ⚠️ O mesmo formato vale para `redefinirSenha` e `aceitarConvite`, que também criam sessão:
 * redefinir a senha pelo e-mail NÃO pode ser um atalho para pular o segundo fator — quem roubou
 * a caixa de e-mail teria, de outro jeito, as duas etapas numa só.
 */
export type ResultadoDeEntrada =
  | { segundoFator: false; user: SessionUser }
  | { segundoFator: true; desafio: string };

/** Código digitado: 6 dígitos do aplicativo OU um código de recuperação (`XXXX-XXXX-XXXX-XXXX`). */
const codigoSegundoFator = z
  .string()
  .trim()
  .min(6, "Informe o código")
  .max(40, "Código longo demais");

export const confirmarSegundoFatorSchema = z.object({
  desafio: z.string().min(1).max(600),
  codigo: codigoSegundoFator,
});
export type ConfirmarSegundoFatorInput = z.infer<typeof confirmarSegundoFatorSchema>;

export const confirmarAtivacaoSegundoFatorSchema = z.object({
  // A senha é exigida para ATIVAR também: quem só roubou a sessão não cadastra o próprio celular.
  senha: z.string().min(1, "Informe a sua senha").max(200),
  codigo: z
    .string()
    .trim()
    .regex(/^\d{3}\s?\d{3}$/, "Informe os 6 dígitos que o aplicativo mostra"),
});
export type ConfirmarAtivacaoSegundoFatorInput = z.infer<typeof confirmarAtivacaoSegundoFatorSchema>;

export const desativarSegundoFatorSchema = z.object({
  senha: z.string().min(1, "Informe a sua senha").max(200),
  codigo: codigoSegundoFator,
});
export type DesativarSegundoFatorInput = z.infer<typeof desativarSegundoFatorSchema>;
