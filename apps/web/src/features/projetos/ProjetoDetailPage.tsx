import { useEffect, useMemo, useState } from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowLeft, Plus, Loader2, Pencil, UserPlus, Building2, AlertTriangle, CalendarClock, ListTodo } from "lucide-react";
import { cn } from "@app/ui";
import { CARD_STATUS_ORDER, CARD_STATUS_LABEL, type CardStatus } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { data } from "../../lib/format-date";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import { QueryError } from "../../components/ui/query-error";
import { isNotFoundError } from "../../lib/trpc-error";
import { KanbanCard, type CardItem } from "./KanbanCard";
import { CardPanel } from "./CardPanel";
import { CardFormDialog, type CardEditavel } from "./CardFormDialog";
import { ProjetoFormDialog } from "./ProjetoFormDialog";
import { ParticipantesDialog } from "./ParticipantesDialog";
import { TarefaFormDialog } from "../tarefas/TarefaFormDialog";
import { useDynamicCrumb } from "../../components/layout/Breadcrumbs";

const route = getRouteApi("/projetos/$projetoId");
type Board = Record<CardStatus, CardItem[]>;

function emptyBoard(): Board {
  return {
    A_FAZER: [],
    EM_ANDAMENTO: [],
    AGUARDANDO_CLIENTE: [],
    AGUARDANDO_TERCEIROS: [],
    CONCLUIDO: [],
  };
}

function Column({
  status,
  cards,
  onAdd,
  onOpen,
}: {
  status: CardStatus;
  cards: CardItem[];
  onAdd: () => void;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40">
      <div className="flex items-center gap-2 px-3.5 py-3">
        <span className="text-sm font-medium">{CARD_STATUS_LABEL[status]}</span>
        <span className="rounded-full bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {cards.length}
        </span>
        <button
          onClick={onAdd}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Adicionar cartão"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "flex min-h-24 flex-1 flex-col gap-2.5 rounded-b-xl p-2.5 transition-colors lg:min-h-0 lg:overflow-y-auto",
            isOver && "bg-accent/50",
          )}
        >
          {cards.map((card) => (
            <KanbanCard key={card.id} card={card} onOpen={() => onOpen(card.id)} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

export function ProjetoDetailPage() {
  const { projetoId } = route.useParams();
  const projeto = trpc.projetos.get.useQuery({ id: projetoId });
  useDynamicCrumb(projeto.data?.nome);
  const cards = trpc.cards.list.useQuery({ projetoId });
  const utils = trpc.useUtils();

  const [board, setBoard] = useState<Board>(() => emptyBoard());
  const [activeCard, setActiveCard] = useState<CardItem | null>(null);
  const [painelCardId, setPainelCardId] = useState<string | null>(null);
  const [criarStatus, setCriarStatus] = useState<CardStatus | null>(null);
  const [editCard, setEditCard] = useState<CardEditavel | null>(null);
  const [editarProjeto, setEditarProjeto] = useState(false);
  const [delegar, setDelegar] = useState(false);
  const [gerenciarPart, setGerenciarPart] = useState(false);

  useEffect(() => {
    if (!cards.data) return;
    const next = emptyBoard();
    for (const card of cards.data) next[card.status].push(card);
    setBoard(next);
  }, [cards.data]);

  const move = trpc.cards.move.useMutation({
    onSettled: () => {
      utils.cards.list.invalidate({ projetoId });
      // O move pode auto-concluir/reabrir o projeto (automação) — reflete no header, lista e ficha.
      utils.projetos.get.invalidate({ id: projetoId });
      utils.projetos.list.invalidate();
      utils.clientes.relacionados.invalidate();
    },
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Resumo dos cartões: progresso e atrasos (integração com prazos das tarefas).
  const resumoCards = useMemo(() => {
    const cs = cards.data ?? [];
    const total = cs.length;
    const concluidos = cs.filter((c) => c.status === "CONCLUIDO").length;
    const agora = Date.now();
    const atrasados = cs.filter((c) => c.prazo && new Date(c.prazo).getTime() < agora && c.status !== "CONCLUIDO").length;
    return { total, concluidos, atrasados, progresso: total ? Math.round((concluidos / total) * 100) : 0 };
  }, [cards.data]);

  const findContainer = (id: string): CardStatus | undefined => {
    if (id in board) return id as CardStatus;
    return (Object.keys(board) as CardStatus[]).find((k) => board[k].some((c) => c.id === id));
  };

  const onDragStart = (e: DragStartEvent) => {
    const c = findContainer(String(e.active.id));
    if (c) setActiveCard(board[c].find((x) => x.id === String(e.active.id)) ?? null);
  };

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = findContainer(activeId);
    const to = findContainer(overId);
    if (!from || !to || from === to) return;

    setBoard((prev) => {
      const fromItems = prev[from];
      const toItems = prev[to];
      const idx = fromItems.findIndex((c) => c.id === activeId);
      const moving = fromItems[idx];
      if (!moving) return prev;
      let insertAt = toItems.length;
      if (!(overId in prev)) {
        const oi = toItems.findIndex((c) => c.id === overId);
        if (oi >= 0) insertAt = oi;
      }
      return {
        ...prev,
        [from]: fromItems.filter((c) => c.id !== activeId),
        [to]: [...toItems.slice(0, insertAt), moving, ...toItems.slice(insertAt)],
      };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveCard(null);
    if (!over) {
      // Solto fora de qualquer coluna: reverte o estado otimista com um refetch.
      utils.cards.list.invalidate({ projetoId });
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    const to = findContainer(overId) ?? findContainer(activeId);
    if (!to) return;
    const items = board[to];
    const oldIndex = items.findIndex((c) => c.id === activeId);
    if (oldIndex < 0) return;
    const newIndex = overId in board ? items.length - 1 : items.findIndex((c) => c.id === overId);

    let finalItems = items;
    if (newIndex >= 0 && newIndex !== oldIndex) {
      finalItems = arrayMove(items, oldIndex, newIndex);
      setBoard((prev) => ({ ...prev, [to]: finalItems }));
    }
    const finalIndex = Math.max(0, finalItems.findIndex((c) => c.id === activeId));
    move.mutate({ id: activeId, status: to, ordem: finalIndex });
  };

  if (projeto.isError && !isNotFoundError(projeto.error)) {
    return <QueryError onRetry={() => projeto.refetch()} />;
  }
  if (projeto.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!projeto.data) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Projeto não encontrado.</p>
        <Link to="/projetos" className="text-primary hover:underline">
          ← Voltar para projetos
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      <div>
        <Link
          to="/projetos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Projetos
        </Link>
        <div className="mt-1">
          <PageHeader title={projeto.data.nome} subtitle={projeto.data.cliente.nome}>
            <Button variant="outline" onClick={() => setEditarProjeto(true)}>
              <Pencil className="h-4 w-4" />
              Editar projeto
            </Button>
            <Button variant="outline" title="Pedir para alguém da equipe cuidar de algo deste projeto" onClick={() => setDelegar(true)}>
              <ListTodo className="h-4 w-4" />
              Delegar tarefa
            </Button>
            <Button onClick={() => setCriarStatus("A_FAZER")}>
              <Plus className="h-4 w-4" />
              Novo cartão
            </Button>
          </PageHeader>

          {/* Equipe do projeto (responsável + participantes) */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Equipe</span>
            <div className="flex -space-x-2">
              {projeto.data.responsavel && (
                <span
                  title={`${projeto.data.responsavel.nome} (responsável)`}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-gradient-to-br from-primary to-brand-blueText text-[11px] font-semibold text-white ring-1 ring-primary/30"
                >
                  {projeto.data.responsavel.nome.charAt(0).toUpperCase()}
                </span>
              )}
              {projeto.data.participantes.map((p) => (
                <span
                  key={p.id}
                  title={p.user.nome}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-gradient-to-br from-brand-blueLight to-primary text-[11px] font-semibold text-white"
                >
                  {p.user.nome.charAt(0).toUpperCase()}
                </span>
              ))}
              {!projeto.data.responsavel && projeto.data.participantes.length === 0 && (
                <span className="text-sm text-muted-foreground">Sem equipe definida</span>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setGerenciarPart(true)}>
              <UserPlus className="h-4 w-4" />
              Participantes
            </Button>
          </div>

          {/* Resumo do projeto: status + cliente + progresso + atrasos + entrega */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <span
              className={
                "rounded px-2 py-0.5 text-[11px] font-semibold " +
                (projeto.data.status === "CONCLUIDO"
                  ? "bg-muted text-muted-foreground"
                  : projeto.data.status === "PAUSADO"
                    ? "bg-warning/10 text-warning"
                    : "bg-success/10 text-success")
              }
            >
              {projeto.data.status === "CONCLUIDO" ? "Concluído" : projeto.data.status === "PAUSADO" ? "Pausado" : "Ativo"}
            </span>
            <Link
              to="/clientes/$clienteId"
              params={{ clienteId: projeto.data.cliente.id }}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"
            >
              <Building2 className="h-3.5 w-3.5" /> Ver ficha do cliente
            </Link>
            {resumoCards.total > 0 && (
              <span className="inline-flex items-center gap-2">
                <span className="text-muted-foreground">
                  {resumoCards.concluidos}/{resumoCards.total} cartões
                </span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn("block h-full rounded-full", resumoCards.progresso === 100 ? "bg-success" : "bg-primary")}
                    style={{ width: `${resumoCards.progresso}%` }}
                  />
                </span>
                <span className="font-medium tabular-nums">{resumoCards.progresso}%</span>
              </span>
            )}
            {resumoCards.atrasados > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
                <AlertTriangle className="h-3 w-3" /> {resumoCards.atrasados} atrasado{resumoCards.atrasados > 1 ? "s" : ""}
              </span>
            )}
            {projeto.data.previsaoFim && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-muted-foreground",
                  new Date(projeto.data.previsaoFim).getTime() < Date.now() && projeto.data.status !== "CONCLUIDO" && "font-medium text-destructive",
                )}
              >
                <CalendarClock className="h-3.5 w-3.5" /> Entrega {data(projeto.data.previsaoFim)}
              </span>
            )}
          </div>
        </div>
      </div>

      {cards.isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
            {CARD_STATUS_ORDER.map((status) => (
              <Column
                key={status}
                status={status}
                cards={board[status]}
                onAdd={() => setCriarStatus(status)}
                onOpen={(id) => setPainelCardId(id)}
              />
            ))}
          </div>
          <DragOverlay>{activeCard ? <KanbanCard card={activeCard} overlay /> : null}</DragOverlay>
        </DndContext>
      )}

      {painelCardId && (
        <CardPanel
          cardId={painelCardId}
          projetoId={projetoId}
          onClose={() => setPainelCardId(null)}
          onEdit={(card) => {
            setPainelCardId(null);
            setEditCard(card);
          }}
        />
      )}

      <CardFormDialog
        open={criarStatus !== null}
        onClose={() => setCriarStatus(null)}
        projetoId={projetoId}
        statusInicial={criarStatus ?? undefined}
      />
      <CardFormDialog
        open={!!editCard}
        onClose={() => setEditCard(null)}
        projetoId={projetoId}
        card={editCard ?? undefined}
      />

      {projeto.data && (
        <ProjetoFormDialog
          open={editarProjeto}
          onClose={() => setEditarProjeto(false)}
          projeto={{
            id: projeto.data.id,
            clienteId: projeto.data.clienteId,
            nome: projeto.data.nome,
            descricao: projeto.data.descricao,
            status: projeto.data.status,
            previsaoFim: projeto.data.previsaoFim,
            responsavelId: projeto.data.responsavelId,
          }}
        />
      )}

      {projeto.data && (
        <ParticipantesDialog
          open={gerenciarPart}
          onClose={() => setGerenciarPart(false)}
          projetoId={projetoId}
          atuais={projeto.data.participantes.map((p) => p.user.id)}
        />
      )}

      {projeto.data && (
        <TarefaFormDialog
          open={delegar}
          onClose={() => setDelegar(false)}
          defaults={{ projetoId: projeto.data.id, clienteId: projeto.data.clienteId }}
        />
      )}
    </div>
  );
}
