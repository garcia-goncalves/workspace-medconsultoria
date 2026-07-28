import { z } from "zod";

export const clienteTipoEnum = z.enum(["PF", "PJ"]);
export type ClienteTipo = z.infer<typeof clienteTipoEnum>;
export const CLIENTE_TIPO_LABEL: Record<ClienteTipo, string> = {
  PF: "Pessoa física",
  PJ: "Pessoa jurídica",
};

/**
 * Situação da relação comercial da conta (Cliente). PROSPECT/NEGOCIACAO/PERDIDO são
 * estados do FUNIL (leads no pipeline). ATIVO/INATIVO são estados de CLIENTE de verdade
 * (definidos na mão na ficha). A página Clientes só lista ATIVO/INATIVO — os demais são
 * geridos no Funil de vendas.
 */
export const situacaoComercialEnum = z.enum(["PROSPECT", "NEGOCIACAO", "ATIVO", "INATIVO", "PERDIDO"]);
export type SituacaoComercial = z.infer<typeof situacaoComercialEnum>;
export const SITUACAO_COMERCIAL = situacaoComercialEnum.options;
export const SITUACAO_COMERCIAL_LABEL: Record<SituacaoComercial, string> = {
  PROSPECT: "Prospect",
  NEGOCIACAO: "Em negociação",
  ATIVO: "Ativo",
  INATIVO: "Inativo",
  PERDIDO: "Perdido",
};

/** Estados que representam um CLIENTE de verdade (os que a página Clientes lista). */
export const SITUACOES_CLIENTE = ["ATIVO", "INATIVO"] as const;

/** Ativar/desativar um cliente (toggle manual na ficha). */
export const setAtivoClienteSchema = z.object({
  id: z.string().min(1),
  ativo: z.boolean(),
});
export type SetAtivoClienteInput = z.infer<typeof setAtivoClienteSchema>;

/** Campo de e-mail opcional que aceita vazio (o service converte "" → null). */
const emailOpcional = z.union([z.string().trim().toLowerCase().email("E-mail inválido"), z.literal("")]);
const textoOpcional = z.string().trim().max(2000).optional().or(z.literal(""));

export const createClienteSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome"),
  tipo: clienteTipoEnum.default("PJ"),
  documento: textoOpcional,
  email: emailOpcional.optional(),
  telefone: textoOpcional,
  observacoes: textoOpcional,
  // Vazio = mantém/atribui ao criador (definido no serviço).
  responsavelId: z.string().optional().or(z.literal("")),
});
export type CreateClienteInput = z.infer<typeof createClienteSchema>;

export const updateClienteSchema = createClienteSchema.partial().extend({
  id: z.string().min(1),
});
export type UpdateClienteInput = z.infer<typeof updateClienteSchema>;

/**
 * Dados que o PRÓPRIO cliente pode editar pelo Portal (LGPD: acesso + retificação dos
 * seus dados). Subconjunto seguro do cadastro — nunca inclui campos internos
 * (responsável, situação comercial, observações da equipe).
 */
export const portalMeusDadosSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome").max(160),
  tipo: clienteTipoEnum,
  documento: textoOpcional,
  email: emailOpcional.optional(),
  telefone: textoOpcional,
});
export type PortalMeusDadosInput = z.infer<typeof portalMeusDadosSchema>;

export const createContatoSchema = z.object({
  clienteId: z.string().min(1),
  nome: z.string().trim().min(1, "Informe o nome"),
  cargo: textoOpcional,
  email: emailOpcional.optional(),
  telefone: textoOpcional,
  principal: z.boolean().default(false),
});
export type CreateContatoInput = z.infer<typeof createContatoSchema>;

export const createNotaSchema = z.object({
  entidadeTipo: z.string().min(1),
  entidadeId: z.string().min(1),
  conteudo: z.string().trim().min(1, "Escreva algo"),
});
export type CreateNotaInput = z.infer<typeof createNotaSchema>;
