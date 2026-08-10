import { z } from "zod";

/**
 * CREDENCIAMENTO — regras puras, compartilhadas por tela e servidor.
 * Fonte: `docs/superpowers/specs/2026-08-10-proposta-credenciamento-design.md` (§3 e §6.2),
 * derivada dos dois PDFs reais da Thaís em `brand/identidade/`.
 *
 * Aqui não há acesso a banco de propósito: a triagem e a contagem de progresso são as duas
 * regras que precisam dar a MESMA resposta na ficha do cliente, no painel do lead e no
 * Portal. Uma fonte só, testável sem subir nada.
 */

// ── Escopo da exigência: a quem o documento pertence ─────────────────────────

/**
 * `EMPRESA` e `CLINICA` valem uma vez por cliente; `PROFISSIONAL` REPETE por médico
 * (é o que faz o progresso contar pares, e não exigências); `RESPONSAVEL_TECNICO` vale
 * uma vez, para quem responde tecnicamente pela clínica.
 * Exigência sem escopo = comportamento de sempre (uma vaga, sem vínculo com médico).
 */
export const escopoRequisitoEnum = z.enum(["EMPRESA", "CLINICA", "PROFISSIONAL", "RESPONSAVEL_TECNICO"]);
export type EscopoRequisito = z.infer<typeof escopoRequisitoEnum>;
export const ESCOPOS_REQUISITO = escopoRequisitoEnum.options;
export const ESCOPO_REQUISITO_LABEL: Record<EscopoRequisito, string> = {
  EMPRESA: "Documentos da empresa",
  CLINICA: "Documentos da clínica",
  PROFISSIONAL: "Documentos de cada profissional",
  RESPONSAVEL_TECNICO: "Documentos do responsável técnico",
};

/** Lado do documento, quando a exigência é "frente e verso" (duas vagas de envio). */
export const ladoArquivoEnum = z.enum(["FRENTE", "VERSO"]);
export type LadoArquivo = z.infer<typeof ladoArquivoEnum>;
export const LADO_ARQUIVO_LABEL: Record<LadoArquivo, string> = { FRENTE: "Frente", VERSO: "Verso" };

/**
 * Chaves das exigências que TRAVAM a elegibilidade (§3.1). Ficam gravadas na exigência
 * (`ServicoRequisito.travaElegibilidade`) para que renomear o documento na tela não quebre
 * a regra — quem manda é a chave, não o título.
 */
export const travaElegibilidadeEnum = z.enum(["ALVARA_FUNCIONAMENTO", "ALVARA_VIGILANCIA", "CNES", "TITULO_ESPECIALISTA"]);
export type TravaElegibilidade = z.infer<typeof travaElegibilidadeEnum>;

// ── Conselhos aceitos ────────────────────────────────────────────────────────

/**
 * Os cinco conselhos do PDF da Thaís + **CRO**, confirmado pelo dono em 10/08/2026
 * ("atendemos odonto sim"). Guardado como texto validado por Zod, e não como enum do
 * banco: aceitar um conselho novo passa a ser uma linha aqui, sem migração.
 */
export const conselhoEnum = z.enum(["CRM", "CRO", "CRP", "CRN", "CREFITO", "CRFA"]);
export type Conselho = z.infer<typeof conselhoEnum>;
export const CONSELHOS = conselhoEnum.options;
export const CONSELHO_LABEL: Record<Conselho, string> = {
  CRM: "CRM",
  CRO: "CRO",
  CRP: "CRP",
  CRN: "CRN",
  CREFITO: "Crefito",
  CRFA: "CRFa",
};

// ── Profissional (o médico/dentista a credenciar) ────────────────────────────

const textoOpcional = z.string().trim().max(160).optional().or(z.literal(""));

export const createProfissionalSchema = z.object({
  clienteId: z.string().min(1),
  nome: z.string().trim().min(1, "Informe o nome").max(160),
  conselho: conselhoEnum,
  conselhoNumero: textoOpcional,
  conselhoUf: z.string().trim().length(2, "UF tem 2 letras").toUpperCase().optional().or(z.literal("")),
  especialidade: textoOpcional,
  anoFormatura: z
    .number()
    .int()
    .min(1900, "Ano de formatura muito antigo")
    .nullable()
    .optional()
    .refine((v) => v == null || v <= new Date().getFullYear(), "O ano de formatura não pode estar no futuro"),
  tituloEspecialista: z.boolean().default(false),
  responsavelTecnico: z.boolean().default(false),
});
export type CreateProfissionalInput = z.infer<typeof createProfissionalSchema>;

export const updateProfissionalSchema = createProfissionalSchema.partial().extend({
  id: z.string().min(1),
  ativo: z.boolean().optional(),
});
export type UpdateProfissionalInput = z.infer<typeof updateProfissionalSchema>;

// ── Triagem de elegibilidade (§3.1) ──────────────────────────────────────────

/** Anos de formado exigidos pelas operadoras. Regra do negócio, ditada pelo dono. */
export const ANOS_MINIMOS_DE_FORMADO = 5;

export type RegraTriagem = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";

/**
 * `INAPTO` = fato que papelada nenhuma resolve hoje — a Thaís não vende.
 * `PENDENTE` = falta documento ou informação — a Thaís cobra o cliente e segue.
 * `APTO` = nada trava.
 */
export type VereditoTriagem = "APTO" | "PENDENTE" | "INAPTO";

export type MotivoTriagem = {
  regra: RegraTriagem;
  nivel: "INAPTO" | "PENDENTE";
  /** Texto interno, para a equipe. Pode nomear a recusa. */
  texto: string;
  /** Texto para o CLIENTE — só existe em pendência, e é sempre um pedido, nunca um julgamento. */
  pedido: string | null;
  profissionalId?: string;
  /** Só em R5: ano a partir do qual o profissional completa os anos de formado. */
  aptoAPartirDe?: number;
};

export type ResultadoTriagem = { veredito: VereditoTriagem; motivos: MotivoTriagem[] };

export type EntradaTriagem = {
  cliente: { tipo: "PF" | "PJ" };
  clinica: { alvaraFuncionamento: boolean; alvaraVigilancia: boolean; cnes: boolean };
  profissionais: { id: string; nome: string; anoFormatura?: number | null; tituloEspecialista: boolean }[];
  /** Injetável para o teste não depender do calendário. */
  anoAtual?: number;
};

/**
 * Diz se dá para credenciar — e, quando não dá, se é por falta de papel (PENDENTE) ou por
 * um fato do mundo (INAPTO). **Avisa; não bloqueia** (§3.1): gerar a proposta mesmo assim
 * continua possível, mediante justificativa escrita. Bloqueio duro erraria toda vez que a
 * realidade estivesse na frente do cadastro — e o sistema seria contornado por fora.
 */
export function triarCredenciamento(entrada: EntradaTriagem): ResultadoTriagem {
  const anoAtual = entrada.anoAtual ?? new Date().getFullYear();
  const motivos: MotivoTriagem[] = [];

  if (entrada.cliente.tipo !== "PJ") {
    motivos.push({
      regra: "R1",
      nivel: "INAPTO",
      texto: "Credenciamento só existe para pessoa jurídica — este cadastro é pessoa física.",
      pedido: null,
    });
  }

  if (!entrada.clinica.alvaraFuncionamento) {
    motivos.push({
      regra: "R2",
      nivel: "PENDENTE",
      texto: "A clínica ainda não tem o alvará de funcionamento registrado.",
      pedido: "Falta enviar o alvará de funcionamento da clínica.",
    });
  }
  if (!entrada.clinica.alvaraVigilancia) {
    motivos.push({
      regra: "R3",
      nivel: "PENDENTE",
      texto: "A clínica ainda não tem o alvará da Vigilância Sanitária registrado.",
      pedido: "Falta enviar o alvará da Vigilância Sanitária.",
    });
  }
  if (!entrada.clinica.cnes) {
    motivos.push({
      regra: "R4",
      nivel: "PENDENTE",
      texto: "A clínica ainda não tem o registro no CNES.",
      pedido: "Falta enviar o registro no CNES (Cadastro Nacional dos Estabelecimentos de Saúde).",
    });
  }

  for (const p of entrada.profissionais) {
    if (p.anoFormatura == null) {
      // Sem o dado não dá para afirmar que é inapto — o que falta é a informação.
      motivos.push({
        regra: "R5",
        nivel: "PENDENTE",
        texto: `Falta o ano de formatura de ${p.nome} para conferir os ${ANOS_MINIMOS_DE_FORMADO} anos exigidos.`,
        pedido: `Informe o ano de formatura de ${p.nome}.`,
        profissionalId: p.id,
      });
    } else if (anoAtual - p.anoFormatura < ANOS_MINIMOS_DE_FORMADO) {
      const aptoAPartirDe = p.anoFormatura + ANOS_MINIMOS_DE_FORMADO;
      motivos.push({
        regra: "R5",
        nivel: "INAPTO",
        texto: `${p.nome} tem menos de ${ANOS_MINIMOS_DE_FORMADO} anos de formado — apto a partir de ${aptoAPartirDe}.`,
        pedido: null,
        profissionalId: p.id,
        aptoAPartirDe,
      });
    }

    if (!p.tituloEspecialista) {
      motivos.push({
        regra: "R6",
        nivel: "PENDENTE",
        texto: `${p.nome} ainda não tem título de especialista informado.`,
        pedido: `Falta o título de especialista de ${p.nome}.`,
        profissionalId: p.id,
      });
    }
  }

  const veredito: VereditoTriagem = motivos.some((m) => m.nivel === "INAPTO")
    ? "INAPTO"
    : motivos.length > 0
      ? "PENDENTE"
      : "APTO";

  return { veredito, motivos };
}

/**
 * O recorte da triagem que o CLIENTE pode ler no Portal: só o que ele resolve entregando
 * alguma coisa. Recusa comercial nunca atravessa esta função — o cliente não lê "inapto"
 * nem o motivo de uma negativa.
 */
export function motivosParaOCliente(resultado: ResultadoTriagem): { regra: RegraTriagem; pedido: string }[] {
  return resultado.motivos
    .filter((m): m is MotivoTriagem & { pedido: string } => m.nivel === "PENDENTE" && !!m.pedido)
    .map((m) => ({ regra: m.regra, pedido: m.pedido }));
}

// ── Vagas de envio e progresso (§6.2) ────────────────────────────────────────

export type RequisitoParaVaga = {
  id: string;
  escopo?: EscopoRequisito | null;
  frenteVerso?: boolean | null;
  obrigatorio: boolean;
};

export type VagaCredenciamento = {
  requisitoId: string;
  profissionalId: string | null;
  lado: LadoArquivo | null;
  /** Identidade da vaga — é por ela que se casa o que foi enviado. */
  chave: string;
};

export function chaveDaVaga(requisitoId: string, profissionalId: string | null, lado: LadoArquivo | null): string {
  return `${requisitoId}|${profissionalId ?? ""}|${lado ?? ""}`;
}

/**
 * Expande as exigências nas VAGAS de envio reais: uma exigência de profissional vira uma
 * vaga por médico, e "frente e verso" vira duas. É o que impede uma clínica com dois
 * médicos de aparecer com 100% tendo entregue metade da papelada.
 *
 * Só entram as **obrigatórias** (o opcional não é dívida) e, para cliente pessoa física,
 * os documentos de empresa ficam de fora — não existem.
 */
export function vagasCredenciamento(entrada: {
  requisitos: RequisitoParaVaga[];
  profissionais: { id: string }[];
  tipoCliente: "PF" | "PJ";
}): VagaCredenciamento[] {
  const vagas: VagaCredenciamento[] = [];
  for (const r of entrada.requisitos) {
    if (!r.obrigatorio) continue;
    if (r.escopo === "EMPRESA" && entrada.tipoCliente !== "PJ") continue;

    const donos: (string | null)[] = r.escopo === "PROFISSIONAL" ? entrada.profissionais.map((p) => p.id) : [null];
    const lados: (LadoArquivo | null)[] = r.frenteVerso ? ["FRENTE", "VERSO"] : [null];

    for (const profissionalId of donos) {
      for (const lado of lados) {
        vagas.push({ requisitoId: r.id, profissionalId, lado, chave: chaveDaVaga(r.id, profissionalId, lado) });
      }
    }
  }
  return vagas;
}

/**
 * Progresso da papelada, contado em vagas (par exigência × profissional × lado) e não em
 * exigências. Envio que não corresponde a nenhuma vaga válida é ignorado — arquivo do
 * médico A não conta pelo médico B.
 */
export function progressoCredenciamento(entrada: {
  requisitos: RequisitoParaVaga[];
  profissionais: { id: string }[];
  tipoCliente: "PF" | "PJ";
  enviados: { requisitoId: string; profissionalId?: string | null; lado?: LadoArquivo | null }[];
}): { total: number; atendidas: number; faltam: number; percentual: number; vagas: VagaCredenciamento[] } {
  const vagas = vagasCredenciamento(entrada);
  const abertas = new Set(vagas.map((v) => v.chave));
  const preenchidas = new Set<string>();
  for (const e of entrada.enviados) {
    const chave = chaveDaVaga(e.requisitoId, e.profissionalId ?? null, e.lado ?? null);
    if (abertas.has(chave)) preenchidas.add(chave);
  }
  const total = vagas.length;
  const atendidas = preenchidas.size;
  return {
    total,
    atendidas,
    faltam: total - atendidas,
    // Sem nenhuma vaga não há dívida — 100%, e sem divisão por zero.
    percentual: total === 0 ? 100 : Math.round((atendidas / total) * 100),
    vagas,
  };
}
