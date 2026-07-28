import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, Pencil, Trash2, CheckCircle2, Circle, Inbox, Building2, FolderKanban, CalendarClock } from "lucide-react";
import { cn } from "@app/ui";
import {
  TAREFA_PRIORIDADE_LABEL,
  TAREFA_STATUS_LABEL,
  hasRoleLevel,
  tarefaStatusEnum,
  type TarefaStatus,
  type TarefaPrioridade,
  type ListTarefasInput,
} from "@app/shared";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { data } from "../../lib/format-date";
import { PageHeader } from "../../components/ui/page-header";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Avatar } from "../../components/ui/avatar";
import { EmptyState } from "../../components/ui/empty-state";
import { QueryError } from "../../components/ui/query-error";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { TarefaFormDialog, type TarefaEditavel } from "./TarefaFormDialog";

type Aba = ListTarefasInput["aba"];
type Filtro = ListTarefasInput["filtro"];

const PRIORIDADE_STYLE: Record<TarefaPrioridade, string> = {
  BAIXA: "bg-muted text-muted-foreground",
  NORMAL: "bg-brand-blueText/10 text-brand-blueText",
  ALTA: "bg-destructive/10 text-destructive",
};

const inicioDoDia = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export function TarefasPage() {
  const { user } = useAuth();
  const podeVerEquipe = hasRoleLevel(user.role, "ADMIN");
  const confirm = useConfirm();
  const utils = trpc.useUtils();

  const [aba, setAba] = useState<Aba>("COMIGO");
  const [filtro, setFiltro] = useState<Filtro>("ABERTAS");
  const [novo, setNovo] = useState(false);
  const [editar, setEditar] = useState<TarefaEditavel | null>(null);

  const tarefas = trpc.tarefas.list.useQuery({ aba, filtro });
  const contagem = trpc.tarefas.contar.useQuery();

  const invalidate = () => {
    utils.tarefas.list.invalidate();
    utils.tarefas.contar.invalidate();
    utils.dashboard.resumo.invalidate();
  };
  const setStatus = trpc.tarefas.setStatus.useMutation({ onSuccess: invalidate });
  const remover = trpc.tarefas.remove.useMutation({ onSuccess: invalidate });

  const confirmarRemover = async (id: string, titulo: string) => {
    if (
      await confirm({
        title: "Remover tarefa",
        description: `A tarefa "${titulo}" será removida. Esta ação não pode ser desfeita.`,
        confirmText: "Remover",
        variant: "destructive",
      })
    )
      remover.mutate({ id });
  };

  const ABAS: { chave: Aba; label: string; badge?: number }[] = [
    { chave: "COMIGO", label: "Comigo", badge: contagem.data?.comigo },
    { chave: "DELEGUEI", label: "Deleguei", badge: contagem.data?.deleguei },
    ...(podeVerEquipe ? [{ chave: "EQUIPE" as Aba, label: "Da equipe" }] : []),
  ];
  const FILTROS: { chave: Filtro; label: string }[] = [
    { chave: "ABERTAS", label: "Abertas" },
    { chave: "CONCLUIDAS", label: "Concluídas" },
    { chave: "TODAS", label: "Todas" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tarefas"
        subtitle="Peça e acompanhe o que a equipe combina entre si. Em “Comigo” estão os pedidos para você; em “Deleguei”, o que você pediu aos outros."
      >
        <Button onClick={() => setNovo(true)}>
          <Plus className="h-4 w-4" />
          Nova tarefa
        </Button>
      </PageHeader>

      {/* Abas: Comigo / Deleguei / (admin) Da equipe */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border p-0.5">
          {ABAS.map((t) => {
            const on = aba === t.chave;
            return (
              <button
                key={t.chave}
                onClick={() => setAba(t.chave)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {t.badge ? (
                  <span className={cn("rounded-full px-1.5 text-xs", on ? "bg-primary-foreground/20" : "bg-muted")}>{t.badge}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="inline-flex rounded-lg border p-0.5">
          {FILTROS.map((f) => {
            const on = filtro === f.chave;
            return (
              <button
                key={f.chave}
                onClick={() => setFiltro(f.chave)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista */}
      {tarefas.isError ? (
        <QueryError onRetry={() => tarefas.refetch()} />
      ) : tarefas.isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : (tarefas.data ?? []).length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={filtro === "CONCLUIDAS" ? "Nada concluído por aqui ainda" : "Nenhuma tarefa por aqui"}
          description={
            aba === "DELEGUEI"
              ? "Você ainda não pediu nada para ninguém. Crie uma tarefa e escolha o responsável."
              : aba === "EQUIPE"
                ? "Ninguém da equipe tem tarefas abertas neste filtro."
                : "Quando alguém delegar algo a você (ou você criar uma tarefa), ela aparece aqui."
          }
        >
          <Button onClick={() => setNovo(true)}>
            <Plus className="h-4 w-4" />
            Nova tarefa
          </Button>
        </EmptyState>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {(tarefas.data ?? []).map((t) => {
            const concluida = t.status === "CONCLUIDA";
            const atrasada = !concluida && t.prazo && new Date(t.prazo) < inicioDoDia();
            const responsaveis = t.responsaveis.map((r) => r.user);
            // "Comigo" mostra quem pediu; "Deleguei"/"Equipe" mostram os responsáveis.
            const mostrarCriador = aba === "COMIGO";
            const abrirEdicao = () =>
              setEditar({
                id: t.id,
                titulo: t.titulo,
                descricao: t.descricao,
                responsavelIds: responsaveis.map((u) => u.id),
                prazo: t.prazo,
                prioridade: t.prioridade as TarefaPrioridade,
                clienteId: t.cliente?.id ?? null,
                projetoId: t.projeto?.id ?? null,
              });
            return (
              <div key={t.id} className="flex items-start gap-3 p-3 sm:p-4">
                {/* Concluir / reabrir */}
                <button
                  onClick={() => setStatus.mutate({ id: t.id, status: concluida ? "PENDENTE" : "CONCLUIDA" })}
                  title={concluida ? "Reabrir tarefa" : "Marcar como concluída"}
                  className={cn("mt-0.5 shrink-0 transition-colors", concluida ? "text-success" : "text-muted-foreground hover:text-success")}
                >
                  {concluida ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                </button>

                <div className="min-w-0 flex-1">
                  <button
                    onClick={abrirEdicao}
                    className={cn("text-left text-sm font-medium hover:underline", concluida && "text-muted-foreground line-through")}
                  >
                    {t.titulo}
                  </button>
                  {t.descricao && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{t.descricao}</p>}

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {mostrarCriador ? (
                      <span className="inline-flex items-center gap-1">
                        <Avatar id={t.criadoPor.id} nome={t.criadoPor.nome} avatarUrl={t.criadoPor.avatarUrl} className="h-4 w-4" text="text-[9px]" />
                        de {t.criadoPor.nome}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span className="flex -space-x-1">
                          {responsaveis.slice(0, 3).map((u) => (
                            <Avatar key={u.id} id={u.id} nome={u.nome} avatarUrl={u.avatarUrl} className="h-4 w-4 ring-1 ring-card" text="text-[9px]" />
                          ))}
                        </span>
                        para {responsaveis.map((u) => u.nome.split(" ")[0]).join(", ")}
                      </span>
                    )}
                    {t.prazo && (
                      <span className={cn("inline-flex items-center gap-1", atrasada && "font-medium text-destructive")}>
                        <CalendarClock className="h-3.5 w-3.5" />
                        {atrasada ? "Atrasada · " : ""}
                        {data(t.prazo)}
                      </span>
                    )}
                    {t.cliente && (
                      <Link to="/clientes/$clienteId" params={{ clienteId: t.cliente.id }} className="inline-flex items-center gap-1 hover:text-foreground">
                        <Building2 className="h-3.5 w-3.5" />
                        {t.cliente.nome}
                      </Link>
                    )}
                    {t.projeto && (
                      <Link to="/projetos/$projetoId" params={{ projetoId: t.projeto.id }} className="inline-flex items-center gap-1 hover:text-foreground">
                        <FolderKanban className="h-3.5 w-3.5" />
                        {t.projeto.nome}
                      </Link>
                    )}
                  </div>
                </div>

                {/* Prioridade + status + ações */}
                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn("hidden rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline", PRIORIDADE_STYLE[t.prioridade as TarefaPrioridade])}>
                    {TAREFA_PRIORIDADE_LABEL[t.prioridade as TarefaPrioridade]}
                  </span>
                  <Select
                    value={t.status}
                    onChange={(e) => setStatus.mutate({ id: t.id, status: e.target.value as TarefaStatus })}
                    className="h-8 w-auto py-0 text-xs"
                    aria-label="Status da tarefa"
                  >
                    {tarefaStatusEnum.options.map((s) => (
                      <option key={s} value={s}>
                        {TAREFA_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                  <button
                    onClick={abrirEdicao}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => confirmarRemover(t.id, t.titulo)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title="Remover"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TarefaFormDialog open={novo} onClose={() => setNovo(false)} />
      <TarefaFormDialog open={!!editar} onClose={() => setEditar(null)} tarefa={editar ?? undefined} />
    </div>
  );
}
