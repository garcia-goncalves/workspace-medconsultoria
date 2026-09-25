import { z } from "zod";
import { recorrenciaEnum } from "./evento";

const textoOpcional = z.string().trim().max(4000).optional().or(z.literal(""));
const idOpcional = z.string().optional().or(z.literal(""));
// Data opcional vinda de <input type="date"> ("" quando vazia).
const dataOpcional = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional());

// ── Status e prioridade ──────────────────────────────────
export const tarefaStatusEnum = z.enum(["PENDENTE", "FAZENDO", "CONCLUIDA"]);
export type TarefaStatus = z.infer<typeof tarefaStatusEnum>;
export const TAREFA_STATUS_LABEL: Record<TarefaStatus, string> = {
  PENDENTE: "Pendente",
  FAZENDO: "Fazendo",
  CONCLUIDA: "Concluída",
};

export const tarefaPrioridadeEnum = z.enum(["BAIXA", "NORMAL", "ALTA"]);
export type TarefaPrioridade = z.infer<typeof tarefaPrioridadeEnum>;
export const TAREFA_PRIORIDADE_LABEL: Record<TarefaPrioridade, string> = {
  BAIXA: "Baixa",
  NORMAL: "Normal",
  ALTA: "Alta",
};

// ── Tarefa (delegação interna) ───────────────────────────
export const createTarefaSchema = z.object({
  titulo: z.string().trim().min(1, "Informe o que precisa ser feito").max(200),
  descricao: textoOpcional,
  // Quem faz — UM ou VÁRIOS responsáveis (tarefa "da equipe"). Vazio = eu mesmo (o back usa o logado).
  responsavelIds: z.array(z.string().min(1)).default([]),
  prazo: dataOpcional,
  prioridade: tarefaPrioridadeEnum.default("NORMAL"),
  clienteId: idOpcional,
  projetoId: idOpcional,
  // Tarefa que se repete: ao CONCLUIR, nasce a próxima ocorrência da série. Exige prazo — a
  // conferência mora no servidor (sobre o ANTES + o DEPOIS), porque a edição é parcial.
  recorrencia: recorrenciaEnum.default("NENHUMA"),
  // Último dia em que a série ainda gera ocorrência (vazio = sem fim).
  recorrenciaAte: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
});
export type CreateTarefaInput = z.infer<typeof createTarefaSchema>;

export const updateTarefaSchema = createTarefaSchema.partial().extend({
  id: z.string().min(1),
  status: tarefaStatusEnum.optional(),
});
export type UpdateTarefaInput = z.infer<typeof updateTarefaSchema>;

/** Muda só o status (usado nos chips de status da lista). */
export const setTarefaStatusSchema = z.object({ id: z.string().min(1), status: tarefaStatusEnum });
export type SetTarefaStatusInput = z.infer<typeof setTarefaStatusSchema>;

/**
 * Abas da página: "Comigo" (sou responsável), "Deleguei" (pedi a alguém),
 * "Equipe" (visão de gestão — só ADMIN+). Filtro por situação (abertas/concluídas/todas).
 */
export const listTarefasSchema = z.object({
  aba: z.enum(["COMIGO", "DELEGUEI", "EQUIPE"]).default("COMIGO"),
  filtro: z.enum(["ABERTAS", "CONCLUIDAS", "TODAS"]).default("ABERTAS"),
});
export type ListTarefasInput = z.infer<typeof listTarefasSchema>;

/**
 * Relatório de entregas da equipe (ADMIN+): período em dias de Brasília, `de` e `ate` inclusivos
 * ("AAAA-MM-DD"). Teto de ~1 ano para a consulta não virar varredura da base inteira.
 */
export const relatorioEntregasSchema = z
  .object({ de: z.coerce.date(), ate: z.coerce.date() })
  .refine((v) => v.de <= v.ate, { message: "A data inicial precisa vir antes da final.", path: ["ate"] })
  .refine((v) => v.ate.getTime() - v.de.getTime() <= 366 * 24 * 60 * 60 * 1000, {
    message: "Escolha um período de até um ano.",
    path: ["ate"],
  });
export type RelatorioEntregasInput = z.infer<typeof relatorioEntregasSchema>;
