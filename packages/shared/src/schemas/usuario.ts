import { z } from "zod";
import { ROLES } from "../constants/roles.js";
import { senhaForte } from "./auth.js";

/** Papel atribuível na gestão de usuários. */
export const roleEnum = z.enum(ROLES);

/** Criação de um usuário (equipe interna ou acesso de Portal do Cliente). */
export const createUsuarioSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome"),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: senhaForte,
  role: roleEnum,
  // Obrigatório quando role = CLIENTE (escopo do Portal). Validado no serviço.
  clienteId: z.string().optional().or(z.literal("")),
});
export type CreateUsuarioInput = z.infer<typeof createUsuarioSchema>;

/** Convite de um usuário (sem senha — ele define a própria ao aceitar). */
export const inviteUsuarioSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome"),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  role: roleEnum,
  // Obrigatório quando role = CLIENTE (escopo do Portal). Validado no serviço.
  clienteId: z.string().optional().or(z.literal("")),
});
export type InviteUsuarioInput = z.infer<typeof inviteUsuarioSchema>;

/** Atualização de um usuário. Campos ausentes ficam inalterados. */
export const updateUsuarioSchema = z.object({
  id: z.string().min(1),
  nome: z.string().trim().min(2, "Informe o nome").optional(),
  email: z.string().trim().toLowerCase().email("E-mail inválido").optional(),
  role: roleEnum.optional(),
  ativo: z.boolean().optional(),
  clienteId: z.string().optional().or(z.literal("")),
  // Se preenchida, redefine a senha (e revoga sessões existentes).
  novaSenha: senhaForte.optional().or(z.literal("")),
});
export type UpdateUsuarioInput = z.infer<typeof updateUsuarioSchema>;

/** Exclusão (soft delete) de um usuário, com transferência opcional de responsabilidades. */
export const deleteUsuarioSchema = z.object({
  id: z.string().min(1),
  // Para quem transferir clientes/leads/projetos/tarefas do excluído. Vazio = deixar sem responsável.
  transferirParaId: z.string().optional().or(z.literal("")),
});
export type DeleteUsuarioInput = z.infer<typeof deleteUsuarioSchema>;

/**
 * CONVIDAR UMA PESSOA DA CLÍNICA PARA O PORTAL (ADR-131).
 *
 * Sem `clienteId` aqui de propósito: quem convida pela ficha manda o id do cliente na rota
 * interna, e quem convida de dentro do Portal tem o dele na SESSÃO. Deixar o cliente entrar
 * pelo formulário seria dar ao dono da Clínica A um campo para digitar o id da Clínica B.
 */
export const convidarPessoaPortalSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome da pessoa"),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  papel: z.enum(["RESPONSAVEL", "EQUIPE"]),
});
export type ConvidarPessoaPortalInput = z.infer<typeof convidarPessoaPortalSchema>;

/** Promover ou rebaixar alguém dentro da clínica. */
export const papelDaPessoaPortalSchema = z.object({
  pessoaId: z.string().min(1),
  papel: z.enum(["RESPONSAVEL", "EQUIPE"]),
});
export type PapelDaPessoaPortalInput = z.infer<typeof papelDaPessoaPortalSchema>;

/** Revogar, devolver acesso ou reenviar convite — todas identificam só a pessoa. */
export const pessoaPortalSchema = z.object({ pessoaId: z.string().min(1) });
export type PessoaPortalInput = z.infer<typeof pessoaPortalSchema>;
