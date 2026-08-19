import { z } from "zod";
import { validarCNPJ } from "../cnpj.js";

/**
 * **Todo cliente da MedConsultoria é pessoa jurídica** — os clientes são médicos e clínicas,
 * e todos têm CNPJ (ADR-119). Por isso não existe `tipo` de pessoa nem campo de CPF: não há
 * escolha a fazer na tela, e o banco não tem onde guardar PF.
 *
 * O CNPJ é OPCIONAL (nem sempre se tem o número no primeiro contato) mas, quando preenchido,
 * é VALIDADO por dígito verificador — antes daqui a aplicação só aplicava máscara e aceitava
 * "11.111.111/1111-11".
 */
export const cnpjOpcional = z
  .string()
  .trim()
  .max(20)
  .refine((v) => v === "" || validarCNPJ(v), { message: "CNPJ inválido — confira os números" });

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
  cnpj: cnpjOpcional.optional(),
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
 *
 * **`email` ficou de fora, e o motivo é de segurança, não de produto.** O endereço do
 * cadastro é CHAVE DE CONSULTA (`chaveDeEndereco` em `emails/enviados.service.ts`, e
 * `clientesPorEnderecos` em `email/acoes.service.ts`): quem escolhe o endereço escolhe o
 * que a consulta devolve. Com o campo aqui, um cliente do Portal punha o endereço de
 * OUTRO cliente no próprio cadastro e passava a enxergar os e-mails endereçados a ele.
 * A trava que existia (`ehDaCasa`, ADR-97) só barra endereço do nosso domínio.
 * A retificação do e-mail continua garantida — passa pela equipe, que tem o histórico.
 */
export const portalMeusDadosSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome").max(160),
  cnpj: cnpjOpcional.optional(),
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
