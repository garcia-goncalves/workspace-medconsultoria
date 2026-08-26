import { z } from "zod";
import { cnpjOpcional } from "./cliente.js";

const emailOpcional = z.union([z.string().trim().toLowerCase().email("E-mail inválido"), z.literal("")]);
const textoOpcional = z.string().trim().max(2000).optional().or(z.literal(""));

/** Estimativa: aceita vazio/undefined; "" → undefined; número >= 0. */
const valorOpcional = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : v),
  z.coerce.number().nonnegative().optional(),
);

export const createLeadSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome"),
  // A CONTA que vai nascer na conversão (razão social / nome da clínica). `nome` é a
  // PESSOA com quem se fala. Todo cliente da Med é PJ — ADR-119.
  empresa: textoOpcional,
  // Opcional de propósito: no primeiro contato nem sempre se tem o CNPJ em mãos. Quando
  // vem preenchido, é validado por dígito verificador e viaja pronto para a ficha do
  // cliente na conversão, sem ninguém redigitar.
  cnpj: cnpjOpcional.optional(),
  email: emailOpcional.optional(),
  telefone: textoOpcional,
  origem: textoOpcional,
  valorEstimado: valorOpcional,
  // Faturamento mensal da clínica. Só é perguntado quando TODOS os serviços do lead são
  // percentuais (hoje: só o Faturamento de contas médicas) — ali não há valor fixo a estimar,
  // e é desta base que o `valorEstimado` acima é calculado. Ver ADR-125.
  faturamentoMensalEstimado: valorOpcional,
  observacoes: textoOpcional,
  pipelineStageId: z.string().optional(),
  responsavelId: z.string().optional().or(z.literal("")),
  // Serviços da MedConsultoria que o lead precisa (catálogo editável).
  servicoIds: z.array(z.string()).optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = createLeadSchema.partial().extend({
  id: z.string().min(1),
});
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const moveLeadSchema = z.object({
  id: z.string().min(1),
  pipelineStageId: z.string().min(1),
  ordem: z.number().int().nonnegative(),
});
export type MoveLeadInput = z.infer<typeof moveLeadSchema>;

/** Abrir uma nova oportunidade para um cliente existente, já com os serviços desejados. */
export const novaOportunidadeSchema = z.object({
  clienteId: z.string().min(1),
  servicoIds: z.array(z.string()).optional(),
  valorEstimado: valorOpcional,
  observacoes: textoOpcional,
});
export type NovaOportunidadeInput = z.infer<typeof novaOportunidadeSchema>;

/** Autosserviço do Portal: o cliente escolhe os serviços que precisa. */
export const solicitarServicosSchema = z.object({
  servicoIds: z.array(z.string()).min(1, "Escolha ao menos um serviço"),
  mensagem: textoOpcional,
});
export type SolicitarServicosInput = z.infer<typeof solicitarServicosSchema>;

/** Captura pública de lead (formulário do site). Inclui honeypot anti-spam. */
export const capturaLeadSchema = z.object({
  nome: z.string().trim().min(1, "Informe seu nome").max(120),
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido"),
  telefone: z.string().trim().max(40).optional().or(z.literal("")),
  empresa: z.string().trim().max(120).optional().or(z.literal("")),
  mensagem: z.string().trim().max(2000).optional().or(z.literal("")),
  // Serviços marcados no formulário público.
  servicoIds: z.array(z.string()).optional(),
  // Rastreamento de atribuição (preenchido automaticamente pelo formulário).
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utmTerm: z.string().max(200).optional(),
  utmContent: z.string().max(200).optional(),
  gclid: z.string().max(300).optional(),
  fbclid: z.string().max(300).optional(),
  referrer: z.string().max(500).optional(),
  landing: z.string().max(500).optional(),
  // Honeypot: deve chegar VAZIO. Se vier preenchido, é bot (tratado no serviço).
  website: z.string().optional(),
});
export type CapturaLeadInput = z.infer<typeof capturaLeadSchema>;

// ── Serviço (catálogo) ───────────────────────────────────
/** Categorias do catálogo de serviços (os pilares da MedConsultoria). */
export const CATEGORIAS_SERVICO = ["Gestão", "Faturamento", "Networking", "Desenvolvimento", "Marketing"] as const;

/** Como um valor é cobrado: uma vez (avulso) ou todo mês (recorrente). */
export const precoRecorrenciaEnum = z.enum(["AVULSO", "MENSAL"]);
export type PrecoRecorrencia = z.infer<typeof precoRecorrenciaEnum>;
export const PRECO_RECORRENCIA_LABEL: Record<PrecoRecorrencia, string> = {
  AVULSO: "Avulso (1x)",
  MENSAL: "Mensal",
};

export const createServicoSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome do serviço").max(120),
  descricao: z.string().trim().max(1000).optional().or(z.literal("")),
  categoria: z.string().trim().max(60).optional().or(z.literal("")),
  valor: z.number().nonnegative().nullable().optional(),
  valorRecorrencia: precoRecorrenciaEnum.default("AVULSO"),
  percentual: z.number().min(0).max(100).nullable().optional(),
  percentualRecorrencia: precoRecorrenciaEnum.default("MENSAL"),
  clausulasContrato: z.string().trim().max(20000).optional().or(z.literal("")),
  // Frase de condição de pagamento que a PROPOSTA pré-preenche (ADR-125). Curta de propósito:
  // é uma linha do documento, não um bloco de cláusulas.
  condicaoPagamento: z.string().trim().max(500).optional().or(z.literal("")),
});
export type CreateServicoInput = z.infer<typeof createServicoSchema>;

export const updateServicoSchema = z.object({
  id: z.string().min(1),
  nome: z.string().trim().min(1).max(120).optional(),
  descricao: z.string().trim().max(1000).optional().or(z.literal("")),
  categoria: z.string().trim().max(60).optional().or(z.literal("")),
  valor: z.number().nonnegative().nullable().optional(),
  valorRecorrencia: precoRecorrenciaEnum.optional(),
  percentual: z.number().min(0).max(100).nullable().optional(),
  percentualRecorrencia: precoRecorrenciaEnum.optional(),
  clausulasContrato: z.string().trim().max(20000).optional().or(z.literal("")),
  // Frase de condição de pagamento que a PROPOSTA pré-preenche (ADR-125). Curta de propósito:
  // é uma linha do documento, não um bloco de cláusulas.
  condicaoPagamento: z.string().trim().max(500).optional().or(z.literal("")),
  ativo: z.boolean().optional(),
});
export type UpdateServicoInput = z.infer<typeof updateServicoSchema>;

/** Roteiro do projeto: tarefas (cada uma vira um cartão) com seu checklist. */
export const roteiroTarefaSchema = z.object({
  titulo: z.string().trim().min(1, "Dê um nome à tarefa").max(120),
  itens: z.array(z.string().trim().min(1).max(200)).default([]),
});
export type RoteiroTarefa = z.infer<typeof roteiroTarefaSchema>;
export const setRoteiroSchema = z.object({
  servicoId: z.string().min(1),
  roteiro: z.array(roteiroTarefaSchema).max(30),
});
export type SetRoteiroInput = z.infer<typeof setRoteiroSchema>;

// ── Origem (catálogo) ────────────────────────────────────
export const createOrigemSchema = z.object({
  nome: z.string().trim().min(1, "Informe a origem").max(60),
});
export type CreateOrigemInput = z.infer<typeof createOrigemSchema>;

export const updateOrigemSchema = z.object({
  id: z.string().min(1),
  nome: z.string().trim().min(1).max(60).optional(),
  ativo: z.boolean().optional(),
});
export type UpdateOrigemInput = z.infer<typeof updateOrigemSchema>;

export const etapaChaveEnum = z.enum(["novo", "qualificacao", "proposta", "negociacao", "fechado"]);
export const ETAPA_CHAVES = etapaChaveEnum.options;
export const ETAPA_CHAVE_LABEL: Record<z.infer<typeof etapaChaveEnum>, string> = {
  novo: "Novo",
  qualificacao: "Qualificação",
  proposta: "Proposta",
  negociacao: "Negociação",
  fechado: "Fechado",
};

export const addServicoPassoSchema = z.object({
  servicoId: z.string().min(1),
  titulo: z.string().trim().min(1, "Escreva o passo").max(200),
  etapaChave: etapaChaveEnum,
  obrigatorio: z.boolean().default(false),
});
export type AddServicoPassoInput = z.infer<typeof addServicoPassoSchema>;

export const updateServicoPassoSchema = z.object({
  id: z.string().min(1),
  titulo: z.string().trim().min(1).max(200).optional(),
  etapaChave: etapaChaveEnum.optional(),
  obrigatorio: z.boolean().optional(),
});
export type UpdateServicoPassoInput = z.infer<typeof updateServicoPassoSchema>;

// ── Exigências (requisitos) de um serviço: o que é preciso para executá-lo ──
export const requisitoTipoEnum = z.enum(["DOCUMENTO", "INFORMACAO", "BRIEFING"]);
export const REQUISITO_TIPO_LABEL: Record<z.infer<typeof requisitoTipoEnum>, string> = {
  DOCUMENTO: "Documento (upload de arquivo)",
  INFORMACAO: "Informação (texto na tela)",
  BRIEFING: "Formulário / briefing (várias perguntas)",
};

export const addRequisitoSchema = z.object({
  servicoId: z.string().min(1),
  titulo: z.string().trim().min(1, "Descreva a exigência").max(200),
  descricao: z.string().trim().max(1000).optional().or(z.literal("")),
  tipo: requisitoTipoEnum.default("DOCUMENTO"),
  obrigatorio: z.boolean().default(true),
  formularioId: z.string().optional().or(z.literal("")),
});
export type AddRequisitoInput = z.infer<typeof addRequisitoSchema>;

export const updateRequisitoSchema = z.object({
  id: z.string().min(1),
  titulo: z.string().trim().min(1).max(200).optional(),
  descricao: z.string().trim().max(1000).optional().or(z.literal("")),
  tipo: requisitoTipoEnum.optional(),
  obrigatorio: z.boolean().optional(),
  formularioId: z.string().optional().or(z.literal("")),
});
export type UpdateRequisitoInput = z.infer<typeof updateRequisitoSchema>;

// ── Serviços contratados por um cliente (ClienteServico) ──
export const ativarServicoClienteSchema = z.object({
  clienteId: z.string().min(1),
  servicoId: z.string().min(1),
  valor: z.number().nonnegative().nullable().optional(),
  observacao: z.string().trim().max(1000).optional().or(z.literal("")),
  avisarCliente: z.boolean().optional(),
});
export type AtivarServicoClienteInput = z.infer<typeof ativarServicoClienteSchema>;

export const cancelarServicoClienteSchema = z.object({
  clienteId: z.string().min(1),
  servicoId: z.string().min(1),
  motivo: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type CancelarServicoClienteInput = z.infer<typeof cancelarServicoClienteSchema>;

/** Edita o preço/cobrança de um serviço já contratado (o que o cliente paga). */
export const atualizarContratacaoClienteSchema = z.object({
  clienteId: z.string().min(1),
  servicoId: z.string().min(1),
  valor: z.number().nonnegative().nullable().optional(),
  valorRecorrencia: precoRecorrenciaEnum.optional(),
  percentual: z.number().min(0).max(100).nullable().optional(),
  percentualRecorrencia: precoRecorrenciaEnum.optional(),
  observacao: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type AtualizarContratacaoClienteInput = z.infer<typeof atualizarContratacaoClienteSchema>;
