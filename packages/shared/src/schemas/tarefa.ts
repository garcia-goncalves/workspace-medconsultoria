import { z } from "zod";

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
  // Quem faz. Em branco = eu mesmo (o back usa o usuário logado).
  responsavelId: idOpcional,
  prazo: dataOpcional,
  prioridade: tarefaPrioridadeEnum.default("NORMAL"),
  clienteId: idOpcional,
  projetoId: idOpcional,
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
