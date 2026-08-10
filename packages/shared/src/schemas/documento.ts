import { z } from "zod";
import { celulaGradeSchema } from "./credenciamento.js";

// ── Assinatura eletrônica (Fase 3) ───────────────────────
export const assinarSchema = z
  .object({
    token: z.string().min(1),
    metodo: z.enum(["DESENHO", "DIGITADO"]),
    imagem: z.string().optional(), // data-URI PNG (quando DESENHO)
    nomeDigitado: z.string().trim().max(120).optional(),
    consentimento: z.literal(true, { errorMap: () => ({ message: "É necessário concordar para assinar." }) }),
  })
  .refine((v) => (v.metodo === "DESENHO" ? !!v.imagem : !!v.nomeDigitado?.trim()), {
    message: "Assine desenhando ou digitando seu nome.",
    path: ["imagem"],
  });
export type AssinarInput = z.infer<typeof assinarSchema>;

export const tipoModeloEnum = z.enum([
  "PROPOSTA",
  "CONTRATO",
  "BRIEFING",
  "ESCOPO",
  "ONBOARDING",
  "CHECKLIST",
  "ATA",
  "RELATORIO",
  "PAUTA_REUNIAO",
  "PAUTA_POSTAGEM",
  "RECIBO",
  "DIAGNOSTICO",
  "PLANO_ACAO",
]);
export type TipoModelo = z.infer<typeof tipoModeloEnum>;

export const statusDocumentoEnum = z.enum(["RASCUNHO", "EM_REVISAO", "APROVADO", "ENVIADO"]);
export type StatusDocumento = z.infer<typeof statusDocumentoEnum>;

/**
 * Como o cliente interage com cada tipo de documento:
 * - `assinatura`: assinatura eletrônica bilateral (Lei 14.063/2020) — vínculo jurídico (contrato, escopo).
 * - `aceite`: aceite/recusa online em 1 clique + trilha (proposta) — concordância comercial.
 * - `nenhum`: só leitura/entrega (relatórios, ata, recibo…) ou preenchido online no Portal (briefing).
 * Documento sem modelo (`modeloId` nulo) também é tratado como `nenhum`.
 */
export type DocInteracao = "assinatura" | "aceite" | "nenhum";
export const DOC_INTERACAO: Record<TipoModelo, DocInteracao> = {
  CONTRATO: "assinatura", // único documento que exige assinatura eletrônica
  ESCOPO: "nenhum", // anexo da proposta/contrato — o vínculo vem pela proposta (aceite) e pelo contrato (assinatura)
  PROPOSTA: "aceite",
  BRIEFING: "nenhum", // o cliente PREENCHE (formulário online no Portal); a ação é enviar
  ATA: "nenhum",
  PAUTA_REUNIAO: "nenhum",
  PAUTA_POSTAGEM: "nenhum",
  RELATORIO: "nenhum",
  DIAGNOSTICO: "nenhum",
  PLANO_ACAO: "nenhum",
  ONBOARDING: "nenhum",
  CHECKLIST: "nenhum",
  RECIBO: "nenhum",
};

export const TIPO_MODELO_LABEL: Record<TipoModelo, string> = {
  PROPOSTA: "Proposta",
  CONTRATO: "Contrato",
  BRIEFING: "Briefing",
  ESCOPO: "Escopo",
  ONBOARDING: "Onboarding",
  CHECKLIST: "Checklist",
  ATA: "Ata de reunião",
  RELATORIO: "Relatório",
  PAUTA_REUNIAO: "Pauta de reunião",
  PAUTA_POSTAGEM: "Pauta de postagem",
  RECIBO: "Recibo",
  DIAGNOSTICO: "Diagnóstico",
  PLANO_ACAO: "Plano de ação",
};

export const STATUS_DOCUMENTO_LABEL: Record<StatusDocumento, string> = {
  RASCUNHO: "Rascunho",
  EM_REVISAO: "Em revisão",
  APROVADO: "Aprovado",
  ENVIADO: "Enviado",
};

// ── Situação COERENTE do documento (une o fluxo interno + aceite da proposta + assinatura) ──
// É a fonte única de "em que pé está o documento", usada em TODA a app (arquivo, ficha,
// Portal, funil). O desfecho com o cliente (aceito/recusado/assinado) prevalece sobre o fluxo.
export type SituacaoDocKey =
  | "RASCUNHO"
  | "EM_REVISAO"
  | "APROVADO"
  | "ENVIADO"
  | "AGUARDANDO_ACEITE"
  | "ACEITA"
  | "RECUSADA"
  | "AGUARDANDO_ASSINATURA"
  | "ASSINADO";

export type SituacaoAtencao = "REVISAR" | "AGUARDANDO_CLIENTE";

export interface SituacaoDoc {
  key: SituacaoDocKey;
  label: string;
  variant: "default" | "warning" | "primary" | "success" | "danger";
  /** Quando o documento pede uma ação da equipe Med agora (alimenta a faixa "Precisa de atenção"). */
  atencao?: SituacaoAtencao;
}

export const SITUACAO_DOC_LABEL: Record<SituacaoDocKey, string> = {
  RASCUNHO: "Rascunho",
  EM_REVISAO: "Em revisão",
  APROVADO: "Aprovado",
  ENVIADO: "Enviado",
  AGUARDANDO_ACEITE: "Aguardando aceite",
  ACEITA: "Aceita",
  RECUSADA: "Recusada",
  AGUARDANDO_ASSINATURA: "Aguardando assinatura",
  ASSINADO: "Assinado",
};

export interface SituacaoDocInput {
  status: StatusDocumento;
  propostaStatus?: string | null;
  assinaturaSolicitadaEm?: Date | string | null;
  assinadoEm?: Date | string | null;
}

export function situacaoDocumento(d: SituacaoDocInput): SituacaoDoc {
  // 1) Desfechos finais (o que aconteceu com o cliente prevalece).
  if (d.assinadoEm) return { key: "ASSINADO", label: "Assinado", variant: "success" };
  if (d.propostaStatus === "ACEITA") return { key: "ACEITA", label: "Aceita", variant: "success" };
  if (d.propostaStatus === "RECUSADA") return { key: "RECUSADA", label: "Recusada", variant: "danger" };
  // 2) Aguardando o cliente responder/assinar.
  if (d.propostaStatus === "PENDENTE")
    return { key: "AGUARDANDO_ACEITE", label: "Aguardando aceite", variant: "warning", atencao: "AGUARDANDO_CLIENTE" };
  if (d.assinaturaSolicitadaEm && !d.assinadoEm)
    return { key: "AGUARDANDO_ASSINATURA", label: "Aguardando assinatura", variant: "warning", atencao: "AGUARDANDO_CLIENTE" };
  // 3) Fluxo interno.
  switch (d.status) {
    case "EM_REVISAO":
      return { key: "EM_REVISAO", label: "Em revisão", variant: "warning", atencao: "REVISAR" };
    case "APROVADO":
      return { key: "APROVADO", label: "Aprovado", variant: "primary" };
    case "ENVIADO":
      return { key: "ENVIADO", label: "Enviado", variant: "success" };
    case "RASCUNHO":
    default:
      return { key: "RASCUNHO", label: "Rascunho", variant: "default" };
  }
}

/** Extrai as chaves de placeholders {{...}} de um corpo de modelo. */
export function extrairVariaveis(corpo: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(corpo)) !== null) {
    if (m[1]) set.add(m[1]);
  }
  return [...set];
}

const textoOpcional = z.string().trim().max(200).optional().or(z.literal(""));

export const createModeloSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome"),
  tipo: tipoModeloEnum,
  corpo: z.string().min(1, "Escreva o corpo do modelo"),
});
export type CreateModeloInput = z.infer<typeof createModeloSchema>;

export const updateModeloSchema = createModeloSchema.partial().extend({ id: z.string().min(1) });
export type UpdateModeloInput = z.infer<typeof updateModeloSchema>;

export const createDocumentoSchema = z.object({
  modeloId: z.string().min(1, "Selecione um modelo"),
  clienteId: z.string().optional().or(z.literal("")),
  titulo: textoOpcional,
  variaveis: z.record(z.string(), z.string()).optional(),
});
export type CreateDocumentoInput = z.infer<typeof createDocumentoSchema>;

/**
 * Operadoras/convênios mais comuns no credenciamento médico/odontológico no Brasil — base para a
 * seleção na Proposta de credenciamento (a equipe pode adicionar outras). São nomes reais; a lista
 * definitiva por cliente depende da especialidade e da região.
 */
export const OPERADORAS_COMUNS = [
  "Unimed",
  "Bradesco Saúde",
  "SulAmérica",
  "Amil",
  "Hapvida NotreDame Intermédica",
  "Porto Seguro Saúde",
  "Golden Cross",
  "Care Plus",
  "Omint",
  "Prevent Senior",
  "Cassi",
  "Assim Saúde",
  "Mediservice",
  "Allianz Saúde",
] as const;

/**
 * Proposta inteligente. Dois formatos, conforme o modelo escolhido:
 * - **Comercial**: `itens` = serviços do catálogo (com preços).
 * - **Credenciamento**: `operadoras` a credenciar + `valorPorOperadora` (não usa o catálogo).
 */
/**
 * Um item de serviço num documento estruturado (proposta OU contrato): serviço do catálogo +
 * valor + recorrência (avulso/mensal) + % opcional (Faturamento). É a unidade que o construtor
 * de serviços manipula e que fica persistida em `Documento.itens` (fonte estruturada por trás
 * do Markdown — permite o aceite sincronizar os serviços contratados). Ver ADR-81.
 */
export const documentoServicoItemSchema = z.object({
  servicoId: z.string().min(1),
  valor: z.number().nonnegative().default(0),
  quantidade: z.number().int().min(1).default(1),
  // Cobrança do item: avulso (1x) ou mensal, e um % opcional (Faturamento).
  recorrencia: z.enum(["AVULSO", "MENSAL"]).default("AVULSO"),
  percentual: z.number().min(0).max(100).nullable().optional(),
});
export type DocumentoServicoItem = z.infer<typeof documentoServicoItemSchema>;

export const criarPropostaSchema = z
  .object({
    clienteId: z.string().optional().or(z.literal("")),
    /** Modelo de proposta escolhido (comercial × credenciamento) — vira a moldura do documento. */
    modeloId: z.string().optional(),
    itens: z.array(documentoServicoItemSchema).default([]),
    /** Credenciamento: operadoras a credenciar (entram no corpo) — em vez do catálogo de serviços. */
    operadoras: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
    /** Credenciamento: investimento por operadora (o total = valor × nº de operadoras). */
    valorPorOperadora: z.number().nonnegative().optional(),
    /**
     * Credenciamento por PESSOA (ADR-104): a grade médico × operadora, um valor por cruzamento.
     * Quando vem preenchida, ela manda — `operadoras`/`valorPorOperadora` só continuam valendo
     * para o cliente que ainda não tem médico cadastrado, e a proposta sai por operadora.
     */
    grade: z.array(celulaGradeSchema).max(400).optional(),
    prazo: z.string().trim().max(200).optional().or(z.literal("")),
    condicoes: z.string().trim().max(300).optional().or(z.literal("")),
    observacoes: z.string().trim().max(2000).optional().or(z.literal("")),
    titulo: textoOpcional,
    /** Se true, a IA escreve a apresentação/escopo (quando disponível). */
    usarIA: z.boolean().optional(),
  })
  .refine((v) => (v.itens?.length ?? 0) > 0 || (v.operadoras?.length ?? 0) > 0 || (v.grade?.length ?? 0) > 0, {
    message: "Escolha ao menos um serviço, uma operadora ou um cruzamento da grade.",
    path: ["itens"],
  });
export type CriarPropostaInput = z.infer<typeof criarPropostaSchema>;

/**
 * Contrato INTELIGENTE. Espelha o construtor da proposta, mas voltado ao vínculo jurídico:
 * os serviços contratados (com valores/recorrência reais) + vigência viram o `{{objeto}}`
 * (serviço + cláusula de cada um), a tabela de `{{valor}}` e o `{{prazo}}` do modelo de contrato.
 */
export const criarContratoSchema = z
  .object({
    clienteId: z.string().min(1, "Selecione o cliente do contrato"),
    modeloId: z.string().optional(),
    itens: z.array(documentoServicoItemSchema).default([]),
    /** Vigência em meses (padrão 12) — vira o texto de prazo/renovação do contrato. */
    vigenciaMeses: z.number().int().min(1).max(120).default(12),
    observacoes: z.string().trim().max(2000).optional().or(z.literal("")),
    titulo: textoOpcional,
  })
  .refine((v) => v.itens.length > 0, {
    message: "Escolha ao menos um serviço para o contrato.",
    path: ["itens"],
  });
export type CriarContratoInput = z.infer<typeof criarContratoSchema>;

/**
 * Contexto do cliente para o "Novo documento" se preencher sozinho. Dado um cliente + o tipo
 * de documento, o backend devolve os serviços que ele já tem (com valores reais), o investimento
 * agregado e a proposta aceita — o dialog usa isso para pré-marcar o construtor e sugerir campos.
 */
export const contextoClienteDocSchema = z.object({
  clienteId: z.string().min(1),
  tipo: tipoModeloEnum,
});
export type ContextoClienteDocInput = z.infer<typeof contextoClienteDocSchema>;

export const updateConteudoSchema = z.object({
  id: z.string().min(1),
  conteudo: z.string(),
});

// ── Aceite online da proposta (Fase C) ───────────────────
/** Resposta do cliente à proposta pelo link público / Portal. Recusa pede motivo. */
export const responderPropostaSchema = z
  .object({
    token: z.string().min(1),
    decisao: z.enum(["ACEITA", "RECUSADA"]),
    motivo: z.string().trim().max(1000).optional().or(z.literal("")),
  })
  .refine((v) => v.decisao === "ACEITA" || !!v.motivo?.trim(), {
    message: "Conte rapidamente o motivo para nos ajudar a melhorar.",
    path: ["motivo"],
  });
export type ResponderPropostaInput = z.infer<typeof responderPropostaSchema>;

export const setStatusDocumentoSchema = z.object({
  id: z.string().min(1),
  status: statusDocumentoEnum,
});

// ── IA (Fase 9) ──────────────────────────────────────────
export const gerarComIASchema = z.object({
  modeloId: z.string().min(1, "Selecione um modelo"),
  clienteId: z.string().optional().or(z.literal("")),
  titulo: textoOpcional,
  instrucoes: z.string().trim().min(1, "Descreva o que a IA deve gerar").max(4000),
});
export type GerarComIAInput = z.infer<typeof gerarComIASchema>;

export const melhorarComIASchema = z.object({
  id: z.string().min(1),
  instrucao: z.string().trim().min(1, "Descreva o ajuste").max(2000),
});

export const resumirReuniaoSchema = z.object({
  anotacoes: z.string().trim().min(1, "Cole as anotações da reunião").max(12000),
  clienteId: z.string().optional().or(z.literal("")),
  titulo: z.string().trim().max(200).optional().or(z.literal("")),
});
export type ResumirReuniaoInput = z.infer<typeof resumirReuniaoSchema>;

/** Pauta de reunião (antes): a IA gera a pauta/pontos a partir do que se quer tratar + contexto do cliente. */
export const gerarPautaSchema = z.object({
  topicos: z.string().trim().min(1, "Diga o que você quer tratar na reunião").max(4000),
  clienteId: z.string().optional().or(z.literal("")),
  titulo: z.string().trim().max(200).optional().or(z.literal("")),
});
export type GerarPautaInput = z.infer<typeof gerarPautaSchema>;
