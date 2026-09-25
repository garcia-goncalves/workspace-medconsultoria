/**
 * Para onde o clique num aviso do sininho (`NotificationBell`) deve levar — extraída do
 * componente para ser testável sem montar React/roteador. Cada `entidadeTipo` mapeia para
 * uma família de rota; "tarefa" também escolhe a ABA certa a partir do tipo da própria
 * notificação (quem ela avisa: o responsável ou quem delegou).
 *
 * ⚠️ A tarefa era o único tipo gravado (`tarefas.service.ts`) sem leitura aqui — o clique
 * fechava o sino e não ia a lugar nenhum. Achado ao comparar os `entidadeTipo` que o serviço
 * grava com os que este arquivo reconhecia.
 */
export interface NotifParaRota {
  tipo: string;
  entidadeTipo: string | null;
  entidadeId: string | null;
}

export type DecisaoRotaNotificacao =
  | { destino: "projeto"; id: string }
  | { destino: "documento"; id: string }
  | { destino: "cliente"; id: string }
  | { destino: "evento" }
  | { destino: "tarefa"; aba: "COMIGO" | "DELEGUEI"; id: string }
  | { destino: "conta" }
  | { destino: "lead" }
  | { destino: "sistema" }
  | { destino: "honorario"; clienteId: string }
  | null;

/**
 * Notificações de tarefa cujo destinatário é quem DELEGOU, não o responsável — hoje só
 * "tarefa concluída" (`tarefas.service.ts:avisarConclusao`). As demais (atribuída, delegada,
 * prazo alterado, atrasada) avisam o(s) responsável(is), que vê a tarefa em "Comigo".
 */
const TIPOS_DE_TAREFA_PARA_QUEM_DELEGOU = new Set(["tarefa_concluida"]);

export function decidirRotaDaNotificacao(n: NotifParaRota): DecisaoRotaNotificacao {
  const { entidadeTipo: t, entidadeId: id } = n;
  if (t === "projeto" && id) return { destino: "projeto", id };
  if (t === "documento" && id) return { destino: "documento", id };
  if (t === "cliente" && id) return { destino: "cliente", id };
  if (t === "evento") return { destino: "evento" };
  if (t === "tarefa" && id)
    return { destino: "tarefa", aba: TIPOS_DE_TAREFA_PARA_QUEM_DELEGOU.has(n.tipo) ? "DELEGUEI" : "COMIGO", id };
  if (t === "conta") return { destino: "conta" };
  if (t === "lead") return { destino: "lead" };
  if (t === "incidente" || t === "erro") return { destino: "sistema" };
  // Honorário do faturamento a lançar: o id é `<clienteId>:<AAAA-MM>` (um aviso por cliente + mês).
  if (t === "honorario" && id) return { destino: "honorario", clienteId: id.split(":")[0]! };
  return null;
}
