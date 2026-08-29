import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, CheckSquare } from "lucide-react";
import { cn } from "@app/ui";
import { PRIORIDADE_LABEL, type CardStatus, type Prioridade } from "@app/shared";
import { Badge, type BadgeProps } from "../../components/ui/badge";

export interface CardItem {
  id: string;
  projetoId: string;
  titulo: string;
  descricao: string | null;
  status: CardStatus;
  prioridade: Prioridade;
  prazo: Date | null;
  ordem: number;
  responsavel: { nome: string } | null;
  servico: { nome: string } | null;
  checklist: { id: string; concluido: boolean }[];
  tempoTotalSeg: number;
  timerInicio: Date | null;
}

const prioridadeVariant: Record<Prioridade, BadgeProps["variant"]> = {
  BAIXA: "default",
  MEDIA: "primary",
  ALTA: "warning",
  URGENTE: "danger",
};

function fmtDur(seg: number): string {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function KanbanCard({
  card,
  onOpen,
  overlay = false,
  draggable = true,
  className,
}: {
  card: CardItem;
  onOpen?: () => void;
  overlay?: boolean;
  /** `false` no celular: sem arraste (5 colunas lado a lado não cabem a 360px) — o card só abre ao toque. */
  draggable?: boolean;
  className?: string;
}) {
  // useSortable precisa ficar dentro do DndContext do quadro mesmo quando `draggable` é falso
  // (regra dos hooks) — só não aplicamos ref/listeners/estilo de arraste nesse caso.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !draggable || overlay,
  });
  const ativo = draggable && !overlay;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: ativo && isDragging ? 0.4 : 1,
  };
  const feitos = card.checklist.filter((c) => c.concluido).length;
  const aguardandoCliente = card.status === "AGUARDANDO_CLIENTE";

  // O card INTEIRO é a alça de arrastar E o clique para abrir: o sensor de ponteiro
  // usa distância mínima (6px), então um clique curto abre e um movimento arrasta.
  return (
    <button
      type="button"
      ref={ativo ? setNodeRef : undefined}
      style={ativo ? style : undefined}
      onClick={onOpen}
      {...(ativo ? attributes : {})}
      {...(ativo ? listeners : {})}
      className={cn(
        "w-full rounded-lg border bg-card p-2.5 text-left shadow-sm transition-shadow hover:border-primary/30 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        aguardandoCliente && "border-l-[3px] border-l-warning",
        ativo && "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      <div className="text-sm font-medium">{card.titulo}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <Badge variant={prioridadeVariant[card.prioridade]}>{PRIORIDADE_LABEL[card.prioridade]}</Badge>
        {card.checklist.length > 0 && (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground">
            <CheckSquare className="h-3 w-3" />
            {feitos}/{card.checklist.length}
          </span>
        )}
        {(card.tempoTotalSeg > 0 || card.timerInicio) && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5",
              card.timerInicio ? "font-medium text-success" : "text-muted-foreground",
            )}
          >
            <Clock className="h-3 w-3" />
            {fmtDur(card.tempoTotalSeg)}
            {card.timerInicio && " ▸"}
          </span>
        )}
      </div>
    </button>
  );
}
