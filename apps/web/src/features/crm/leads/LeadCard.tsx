import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2, UserCheck, KeyRound } from "lucide-react";
import { cn } from "@app/ui";
import { formatBRL } from "../../../lib/masks";
import { Badge } from "../../../components/ui/badge";

export interface LeadItem {
  id: string;
  nome: string;
  empresa: string | null;
  email: string | null;
  telefone: string | null;
  origem: string | null;
  valorEstimado: number | null;
  observacoes: string | null;
  pipelineStageId: string;
  ordem: number;
  responsavelId: string | null;
  responsavel: { nome: string } | null;
  clienteId: string | null;
  portalAtivo: boolean;
  servicos: { id: string; nome: string }[];
  updatedAt: Date;
}

export function LeadCard({
  lead,
  onOpen,
  onEdit,
  onRemove,
  onConvert,
  onConvidarPortal,
  converting,
  convidandoPortal,
  overlay = false,
}: {
  lead: LeadItem;
  onOpen?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
  onConvert?: () => void;
  onConvidarPortal?: () => void;
  converting?: boolean;
  convidandoPortal?: boolean;
  overlay?: boolean;
}) {
  // Sem `attributes` do dnd-kit no card: elas adicionam role="button", o que, com botões de ação
  // dentro, viola `nested-interactive` (axe). O arraste continua pelo `listeners` (ponteiro) e o
  // clique do mouse abre; o teclado abre pelo BOTÃO do nome (abaixo).
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const dias = Math.max(0, Math.floor((Date.now() - new Date(lead.updatedAt).getTime()) / 86400000));
  const idadeLabel = dias === 0 ? "hoje" : dias === 1 ? "há 1 dia" : `há ${dias} dias`;
  const parado = dias >= 14;

  // O card inteiro é a "alça" de arrastar (exceto os botões de ação, que param a
  // propagação do pointerdown). A restrição de distância (6px) evita disparar no clique.
  const dragProps = overlay ? {} : { ...listeners };

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={overlay ? undefined : style}
      {...dragProps}
      onClick={overlay ? undefined : onOpen}
      className={cn(
        "touch-none rounded-md border bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        !overlay && "cursor-grab active:cursor-grabbing hover:border-primary/40",
      )}
    >
      <div className="flex items-start gap-2">
        {!overlay && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden />}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen?.();
            }}
            className="block max-w-full truncate rounded text-left font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {lead.nome}
          </button>
          {lead.empresa && (
            <div className="truncate text-xs text-muted-foreground">{lead.empresa}</div>
          )}
          {lead.servicos.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {lead.servicos.map((s) => (
                <span
                  key={s.id}
                  className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                >
                  {s.nome}
                </span>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {lead.valorEstimado != null && (
              <Badge variant="success">{formatBRL(lead.valorEstimado)}</Badge>
            )}
            {lead.origem && <Badge>{lead.origem}</Badge>}
            {lead.portalAtivo && (
              <Badge variant="primary">
                <KeyRound className="h-3 w-3" />
                Portal
              </Badge>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            {lead.responsavel && (
              <span className="flex min-w-0 items-center gap-1">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blueLight to-primary text-[8px] font-semibold text-white">
                  {lead.responsavel.nome.charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{lead.responsavel.nome.split(" ")[0]}</span>
              </span>
            )}
            <span
              className={cn(
                "ml-auto flex shrink-0 items-center gap-1",
                parado && "font-medium text-warning",
              )}
              title={parado ? "Lead parado há um tempo" : undefined}
            >
              {parado && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
              {idadeLabel}
            </span>
          </div>
        </div>
      </div>

      {!overlay && (
        <div
          className="mt-2 flex items-center gap-1 border-t pt-2"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onConvert}
            disabled={converting}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success/10 disabled:opacity-50"
            title="Converter em cliente"
          >
            <UserCheck className="h-3.5 w-3.5" />
            Converter
          </button>
          <button
            onClick={onConvidarPortal}
            disabled={convidandoPortal}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
            title={lead.portalAtivo ? "Reenviar acesso ao Portal do Cliente" : "Enviar acesso ao Portal do Cliente"}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {lead.portalAtivo ? "Reenviar acesso" : "Enviar acesso"}
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={onEdit}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Editar"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onRemove}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              title="Remover"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
