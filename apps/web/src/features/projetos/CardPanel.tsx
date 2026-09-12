import { useEffect, useState } from "react";
import { Play, Square, Trash2, Pencil, Plus, Loader2, Clock } from "lucide-react";
import { PRIORIDADE_LABEL, CARD_STATUS_LABEL, hasRoleLevel, type Prioridade } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { dataHora, dataUTC } from "../../lib/format-date";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Badge, type BadgeProps } from "../../components/ui/badge";
import { Modal } from "../../components/ui/modal";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { toast } from "../../components/ui/toast";
import type { CardEditavel } from "./CardFormDialog";

const prioridadeVariant: Record<Prioridade, BadgeProps["variant"]> = {
  BAIXA: "default",
  MEDIA: "primary",
  ALTA: "warning",
  URGENTE: "danger",
};

function fmtClock(totalSeg: number): string {
  const s = Math.max(0, Math.floor(totalSeg));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function CardPanel({
  cardId,
  projetoId,
  onClose,
  onEdit,
}: {
  cardId: string;
  projetoId: string;
  onClose: () => void;
  onEdit: (card: CardEditavel) => void;
}) {
  const confirm = useConfirm();
  const { user } = useAuth();
  const ehGestor = hasRoleLevel(user.role, "ADMIN");
  const utils = trpc.useUtils();
  const card = trpc.cards.get.useQuery({ id: cardId });
  const [novoItem, setNovoItem] = useState("");
  const [comentario, setComentario] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState("");
  const [agora, setAgora] = useState(0);

  const refresh = () => {
    utils.cards.get.invalidate({ id: cardId });
    utils.cards.list.invalidate({ projetoId });
    // Marcar checklist pode auto-mover o card e auto-concluir/reabrir o projeto.
    utils.projetos.get.invalidate({ id: projetoId });
    utils.projetos.list.invalidate();
    // A ficha do cliente lista os projetos dele com a situação — reflete a auto-conclusão/reabertura.
    utils.clientes.relacionados.invalidate();
  };

  const startTimer = trpc.cards.startTimer.useMutation({ onSuccess: refresh });
  const stopTimer = trpc.cards.stopTimer.useMutation({ onSuccess: refresh });
  const addChecklist = trpc.cards.addChecklist.useMutation({
    onSuccess: () => (setNovoItem(""), refresh()),
  });
  const toggleChecklist = trpc.cards.toggleChecklist.useMutation({
    onSuccess: (data) => {
      refresh();
      // Avisa quando a automação moveu o card de coluna (nada de "sumir" sem explicação).
      if (data?.movidoPara) {
        toast(
          data.movidoPara === "CONCLUIDO"
            ? "Tudo pronto! Cartão movido para “Concluído” 🎉"
            : `Cartão movido para “${CARD_STATUS_LABEL[data.movidoPara]}”`,
          "success",
        );
      }
    },
  });
  const removeChecklist = trpc.cards.removeChecklist.useMutation({ onSuccess: refresh });
  const addComentario = trpc.cards.addComentario.useMutation({
    onSuccess: () => (setComentario(""), refresh()),
  });
  const editComentario = trpc.cards.editComentario.useMutation({
    onSuccess: () => (setEditandoId(null), refresh()),
  });
  const removeComentario = trpc.cards.removeComentario.useMutation({ onSuccess: refresh });
  const removeCard = trpc.cards.remove.useMutation({
    onSuccess: () => {
      // Remover cartão muda o progresso/contagem do projeto — invalida também projetos.
      utils.cards.list.invalidate({ projetoId });
      utils.projetos.get.invalidate({ id: projetoId });
      utils.projetos.list.invalidate();
      onClose();
    },
  });

  const timerInicio = card.data?.timerInicio ?? null;
  const rodando = timerInicio !== null;

  useEffect(() => {
    if (!timerInicio) return;
    const inicioMs = new Date(timerInicio).getTime();
    const tick = () => setAgora(Math.floor((Date.now() - inicioMs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timerInicio]);

  const c = card.data;
  const totalAoVivo = (c?.tempoTotalSeg ?? 0) + (rodando ? agora : 0);
  const feitos = c ? c.checklist.filter((i) => i.concluido).length : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={c?.titulo ?? "Cartão"}
      size="xl"
      bodyClassName="p-0"
      titleExtra={
        c && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={prioridadeVariant[c.prioridade]}>{PRIORIDADE_LABEL[c.prioridade]}</Badge>
            {c.prazo && <span>Prazo: {dataUTC(c.prazo)}</span>}
            {c.responsavel && <span>Resp.: {c.responsavel.nome}</span>}
          </div>
        )
      }
      headerActions={
        c && (
          <>
            <button
              onClick={() =>
                onEdit({
                  id: c.id,
                  titulo: c.titulo,
                  descricao: c.descricao,
                  prioridade: c.prioridade,
                  prazo: c.prazo,
                  responsavelId: c.responsavelId,
                })
              }
              className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground md:h-8 md:w-8"
              aria-label="Editar cartão"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={async () => {
                if (
                  await confirm({
                    title: "Remover cartão",
                    description: "Este cartão e seu checklist serão removidos. Esta ação não pode ser desfeita.",
                    confirmText: "Remover",
                    variant: "destructive",
                  })
                )
                  removeCard.mutate({ id: c.id });
              }}
              className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:h-8 md:w-8"
              aria-label="Remover cartão"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )
      }
    >
      {card.isLoading || !c ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* ── Corpo: 2 colunas no desktop (empilha e rola no mobile) ── */}
          <div className="flex min-h-0 flex-col lg:h-full lg:grid lg:grid-cols-[1.55fr_1fr] lg:grid-rows-1 lg:overflow-hidden">
              {/* Coluna ESQUERDA: Descrição + Checklist */}
              <div className="flex min-w-0 flex-col gap-4 p-5 lg:min-h-0 lg:border-r">
                {c.descricao && (
                  <p className="max-h-24 shrink-0 overflow-y-auto whitespace-pre-wrap text-sm text-foreground">
                    {c.descricao}
                  </p>
                )}

                <div className="flex min-h-0 flex-col lg:flex-1">
                  <div className="mb-2 flex shrink-0 items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">Checklist</h3>
                    {c.checklist.length > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {feitos}/{c.checklist.length}
                      </span>
                    )}
                  </div>

                  {/* A LISTA de tarefas rola por dentro; o campo "novo item" fica fixo abaixo. */}
                  <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 max-lg:max-h-[46vh]">
                    {c.checklist.length === 0 && (
                      <p className="py-4 text-center text-sm text-muted-foreground">Nenhum item ainda. Adicione abaixo.</p>
                    )}
                    {c.checklist.map((item) => {
                      // Item ligado a uma exigência = entrega do CLIENTE: marca-se sozinho, só-leitura.
                      const doCliente = !!item.requisitoId;
                      return (
                        <div key={item.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent/40">
                          <input
                            type="checkbox"
                            checked={item.concluido}
                            disabled={doCliente}
                            onChange={(e) => toggleChecklist.mutate({ id: item.id, concluido: e.target.checked })}
                            className="h-4 w-4 shrink-0 accent-[hsl(var(--success))] disabled:opacity-60"
                            title={doCliente ? "Entrega do cliente — marca sozinho quando ele envia" : undefined}
                          />
                          <span className={"min-w-0 flex-1 " + (item.concluido ? "text-muted-foreground line-through" : "")}>
                            {item.texto}
                          </span>
                          {doCliente ? (
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              cliente
                            </span>
                          ) : (
                            <button
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: "Remover item",
                                    description: `Remover "${item.texto}" do checklist?`,
                                    confirmText: "Remover",
                                    variant: "destructive",
                                  })
                                )
                                  removeChecklist.mutate({ id: item.id });
                              }}
                              className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-destructive md:h-6 md:w-6"
                              aria-label="Remover item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <form
                    className="mt-2 flex shrink-0 gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (novoItem.trim()) addChecklist.mutate({ cardId: c.id, texto: novoItem });
                    }}
                  >
                    <Input value={novoItem} onChange={(e) => setNovoItem(e.target.value)} placeholder="Novo item…" className="h-9" />
                    <Button type="submit" size="sm" variant="secondary" disabled={addChecklist.isPending}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </form>
                </div>
              </div>

              {/* Coluna DIREITA: Timer + Comentários */}
              <div className="flex min-w-0 flex-col gap-4 border-t p-5 lg:min-h-0 lg:border-t-0">
                {/* Timer (fixo) */}
                <div className="flex shrink-0 items-center gap-3 rounded-lg bg-muted/30 p-3">
                  <Clock className={rodando ? "h-5 w-5 text-success" : "h-5 w-5 text-muted-foreground"} />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-lg font-semibold tabular-nums">{fmtClock(totalAoVivo)}</div>
                    <div className="text-xs text-muted-foreground">
                      {rodando ? "Cronômetro rodando…" : "Tempo total registrado"}
                    </div>
                  </div>
                  {rodando ? (
                    <Button variant="destructive" size="sm" onClick={() => stopTimer.mutate({ cardId: c.id })} disabled={stopTimer.isPending}>
                      <Square className="h-4 w-4" />
                      Parar
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => startTimer.mutate({ cardId: c.id })} disabled={startTimer.isPending}>
                      <Play className="h-4 w-4" />
                      Iniciar
                    </Button>
                  )}
                </div>

                <div className="flex min-h-0 flex-col lg:flex-1">
                  <h3 className="mb-2 shrink-0 text-sm font-semibold text-foreground">Comentários</h3>

                  {/* Escrever comentário (fixo) */}
                  <form
                    className="mb-3 shrink-0 space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (comentario.trim()) addComentario.mutate({ cardId: c.id, conteudo: comentario });
                    }}
                  >
                    <Textarea
                      value={comentario}
                      onChange={(e) => setComentario(e.target.value)}
                      placeholder="Escreva um comentário…"
                      className="min-h-16"
                    />
                    <Button type="submit" size="sm" disabled={addComentario.isPending || !comentario.trim()}>
                      Comentar
                    </Button>
                  </form>

                  {/* O HISTÓRICO de comentários rola por dentro. */}
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 max-lg:max-h-[40vh]">
                    {c.comentarios.length === 0 && (
                      <p className="py-2 text-sm text-muted-foreground">Nenhum comentário ainda.</p>
                    )}
                    {c.comentarios.map((n) => {
                      const meu = n.autorId === user.id;
                      const editando = editandoId === n.id;
                      return (
                        <div key={n.id} className="group border-l-2 border-accent pl-3 text-sm">
                          {editando ? (
                            <div className="space-y-2">
                              <Textarea value={editTexto} onChange={(e) => setEditTexto(e.target.value)} className="min-h-16" autoFocus />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  disabled={!editTexto.trim() || editComentario.isPending}
                                  onClick={() => editComentario.mutate({ id: n.id, conteudo: editTexto })}
                                >
                                  Salvar
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setEditandoId(null)}>
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 flex-1 whitespace-pre-wrap">{n.conteudo}</p>
                                {(meu || ehGestor) && (
                                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-lg:opacity-100">
                                    {meu && (
                                      <button
                                        onClick={() => (setEditandoId(n.id), setEditTexto(n.conteudo))}
                                        className="text-muted-foreground hover:text-foreground"
                                        title="Editar comentário"
                                        aria-label="Editar comentário"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                    <button
                                      onClick={async () => {
                                        if (
                                          await confirm({
                                            title: "Remover comentário",
                                            description: "Este comentário será removido. Esta ação não pode ser desfeita.",
                                            confirmText: "Remover",
                                            variant: "destructive",
                                          })
                                        )
                                          removeComentario.mutate({ id: n.id });
                                      }}
                                      className="text-muted-foreground hover:text-destructive"
                                      title="Apagar comentário"
                                      aria-label="Apagar comentário"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {n.autor?.nome ?? "Sistema"} · {dataHora(n.createdAt)}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
    </Modal>
  );
}
