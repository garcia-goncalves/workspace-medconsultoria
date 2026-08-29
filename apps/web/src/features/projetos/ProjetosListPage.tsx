import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Plus,
  Search,
  FolderKanban,
  LayoutGrid,
  List,
  Pencil,
  Trash2,
  Building2,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  X,
} from "lucide-react";
import { cn } from "@app/ui";
import type { BadgeProps } from "../../components/ui/badge";
import { trpc, type RouterOutputs } from "../../lib/trpc";
import { data } from "../../lib/format-date";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { PageHeader } from "../../components/ui/page-header";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { Badge } from "../../components/ui/badge";
import { EmptyState } from "../../components/ui/empty-state";
import { Skeleton, TableSkeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { ProjetoFormDialog, type ProjetoEditavel } from "./ProjetoFormDialog";

type ProjetoItem = RouterOutputs["projetos"]["list"][number];

const statusLabel: Record<string, string> = { ATIVO: "Ativo", PAUSADO: "Pausado", CONCLUIDO: "Concluído" };
const statusVariant: Record<string, BadgeProps["variant"]> = { ATIVO: "success", PAUSADO: "warning", CONCLUIDO: "default" };
const FILTROS: { v: string; label: string }[] = [
  { v: "", label: "Todos" },
  { v: "ATIVO", label: "Ativos" },
  { v: "PAUSADO", label: "Pausados" },
  { v: "CONCLUIDO", label: "Concluídos" },
];

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const escolhidas = partes.length > 1 ? [partes[0], partes[partes.length - 1]] : partes;
  return escolhidas.map((p) => p?.[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Métricas derivadas dos cartões de um projeto: progresso, atrasos, previsão e próxima reunião. */
function resumo(p: ProjetoItem) {
  const total = p.cards.length;
  const concluidos = p.cards.filter((c) => c.status === "CONCLUIDO").length;
  const agora = Date.now();
  const atrasados = p.cards.filter((c) => c.prazo && new Date(c.prazo).getTime() < agora && c.status !== "CONCLUIDO").length;
  const progresso = total ? Math.round((concluidos / total) * 100) : 0;
  const previsaoVencida = !!p.previsaoFim && new Date(p.previsaoFim).getTime() < agora && p.status !== "CONCLUIDO";
  const proxReuniao = p.eventos[0] ?? null;
  return { total, concluidos, atrasados, progresso, previsaoVencida, proxReuniao };
}

function Kpi({ icon: Icon, label, value, tom = "primary" }: { icon: LucideIcon; label: string; value: string; tom?: "primary" | "success" | "warning" | "danger" }) {
  const tons: Record<string, string> = {
    primary: "bg-primary/5 text-primary ring-primary/10",
    success: "bg-success/5 text-success ring-success/10",
    warning: "bg-warning/5 text-warning ring-warning/10",
    danger: "bg-destructive/5 text-destructive ring-destructive/10",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-sm">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", tons[tom])}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0">
        <div className="text-lg font-semibold leading-none">{value}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function Progresso({ concluidos, total, progresso }: { concluidos: number; total: number; progresso: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total === 0 ? "Sem cartões" : `${concluidos} de ${total} cartões`}
        </span>
        {total > 0 && <span className="font-medium tabular-nums text-foreground">{progresso}%</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", progresso === 100 ? "bg-success" : "bg-primary")}
          style={{ width: `${progresso}%` }}
        />
      </div>
    </div>
  );
}

export function ProjetosListPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<ProjetoEditavel | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [visao, setVisao] = useState<"cards" | "lista">("cards");

  const projetos = trpc.projetos.list.useQuery();
  const equipe = trpc.usuarios.equipe.useQuery();
  const remove = trpc.projetos.remove.useMutation({
    onSuccess: () => {
      utils.projetos.list.invalidate();
      utils.clientes.relacionados.invalidate(); // a ficha do cliente lista os projetos dele
    },
  });

  // Referência estável (senão `?? []` gera novo array a cada render e derrota os useMemo abaixo).
  const base = useMemo(() => projetos.data ?? [], [projetos.data]);
  const kpis = useMemo(() => {
    let ativos = 0, pausados = 0, concluidos = 0, comAtraso = 0;
    for (const p of base) {
      if (p.status === "ATIVO") ativos++;
      else if (p.status === "PAUSADO") pausados++;
      else if (p.status === "CONCLUIDO") concluidos++;
      const r = resumo(p);
      if (r.atrasados > 0 || r.previsaoVencida) comAtraso++;
    }
    return { ativos, pausados, concluidos, comAtraso };
  }, [base]);

  const porBusca = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((p) => [p.nome, p.cliente.nome].some((v) => v?.toLowerCase().includes(q)));
  }, [base, search]);

  const contagemStatus = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of porBusca) m[p.status] = (m[p.status] ?? 0) + 1;
    return m;
  }, [porBusca]);

  const filtrados = useMemo(() => {
    const lista = porBusca.filter((p) => (!status || p.status === status) && (!responsavelId || p.responsavelId === responsavelId));
    // Ordena por URGÊNCIA: mais atrasados / entrega vencida primeiro; concluídos por último.
    const urgencia = (p: ProjetoItem) => {
      const r = resumo(p);
      if (p.status === "CONCLUIDO") return -1;
      return r.atrasados * 10 + (r.previsaoVencida ? 5 : 0);
    };
    return [...lista].sort((a, b) => urgencia(b) - urgencia(a));
  }, [porBusca, status, responsavelId]);

  const filtrando = !!search.trim() || status !== "" || responsavelId !== "";
  const limpar = () => {
    setSearch("");
    setStatus("");
    setResponsavelId("");
  };

  const abrirProjeto = (id: string) => navigate({ to: "/projetos/$projetoId", params: { projetoId: id } });

  const abrirEditar = (p: ProjetoItem) =>
    setEditando({
      id: p.id,
      clienteId: p.clienteId,
      nome: p.nome,
      descricao: p.descricao,
      status: p.status,
      previsaoFim: p.previsaoFim,
      responsavelId: p.responsavelId,
    });

  const remover = async (p: ProjetoItem) => {
    if (
      await confirm({
        title: "Remover projeto",
        description: `O projeto "${p.nome}", suas etapas e cartões serão removidos. Esta ação não pode ser desfeita.`,
        confirmText: "Remover",
        variant: "destructive",
      })
    )
      remove.mutate({ id: p.id });
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Projetos"
        subtitle="Os trabalhos de cada cliente, organizados em quadros (kanban) com tarefas, prazos e responsáveis."
      >
        <Button onClick={() => setNovo(true)}>
          <Plus className="h-4 w-4" />
          Novo projeto
        </Button>
      </PageHeader>

      {/* KPIs */}
      <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {projetos.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[68px] rounded-xl" />)
        ) : (
          <>
            <Kpi icon={PlayCircle} tom="success" label="Ativos" value={String(kpis.ativos)} />
            <Kpi icon={PauseCircle} tom="warning" label="Pausados" value={String(kpis.pausados)} />
            <Kpi icon={CheckCircle2} label="Concluídos" value={String(kpis.concluidos)} />
            <Kpi icon={AlertTriangle} tom="danger" label="Com atraso" value={String(kpis.comAtraso)} />
          </>
        )}
      </div>

      {/* Busca + filtros + visão */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por projeto ou cliente…"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg border p-0.5">
          {FILTROS.map((f) => {
            const n = f.v === "" ? porBusca.length : contagemStatus[f.v] ?? 0;
            return (
              <button
                key={f.v || "todos"}
                onClick={() => setStatus(f.v)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                  status === f.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label} <span className="tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>

        <Select aria-label="Filtrar por responsável" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className="w-auto min-w-[160px]">
          <option value="">Todos os responsáveis</option>
          {(equipe.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </Select>

        {filtrando && (
          <button
            onClick={limpar}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Limpar busca e filtros"
          >
            <X className="h-4 w-4" />
            Limpar
          </button>
        )}

        <div className="ml-auto flex items-center gap-0.5 rounded-lg border p-0.5">
          <button
            onClick={() => setVisao("cards")}
            aria-label="Ver em cartões"
            aria-pressed={visao === "cards"}
            className={cn("flex h-11 w-11 items-center justify-center rounded-md transition-colors md:h-8 md:w-8", visao === "cards" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setVisao("lista")}
            aria-label="Ver em lista"
            aria-pressed={visao === "lista"}
            className={cn("flex h-11 w-11 items-center justify-center rounded-md transition-colors md:h-8 md:w-8", visao === "lista" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {projetos.isError ? (
        <QueryError onRetry={() => projetos.refetch()} />
      ) : projetos.isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : base.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Nenhum projeto ainda"
          description="Crie um projeto para organizar as tarefas de um cliente em um kanban. Ao converter um lead, um projeto de onboarding é criado automaticamente."
        >
          <Button onClick={() => setNovo(true)}>
            <Plus className="h-4 w-4" />
            Novo projeto
          </Button>
        </EmptyState>
      ) : filtrados.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">Nenhum projeto para os filtros escolhidos.</p>
          <Button variant="outline" onClick={limpar} className="mt-3">
            <X className="h-4 w-4" />
            Limpar filtros
          </Button>
        </div>
      ) : visao === "cards" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtrados.map((p) => {
            const r = resumo(p);
            return (
              <div
                key={p.id}
                className="group relative flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-within:ring-2 focus-within:ring-primary/40"
              >
                <div className="flex items-start gap-2">
                  {/* Botão-título com área clicável esticada (padrão de card acessível: um único
                      elemento interativo cobre o card; ações internas sobem com z-10). */}
                  <button
                    type="button"
                    onClick={() => abrirProjeto(p.id)}
                    className="min-w-0 flex-1 cursor-pointer text-left font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-xl group-hover:text-primary"
                  >
                    {p.nome}
                  </button>
                  <Badge variant={statusVariant[p.status]}>{statusLabel[p.status] ?? p.status}</Badge>
                </div>

                <Progresso concluidos={r.concluidos} total={r.total} progresso={r.progresso} />

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {p.previsaoFim && (
                    <span className={cn("inline-flex items-center gap-1", r.previsaoVencida && "font-medium text-destructive")}>
                      <CalendarClock className="h-3.5 w-3.5" /> Entrega {data(p.previsaoFim)}
                    </span>
                  )}
                  {r.atrasados > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
                      <AlertTriangle className="h-3 w-3" /> {r.atrasados} atrasado{r.atrasados > 1 ? "s" : ""}
                    </span>
                  )}
                  {r.proxReuniao && (
                    <span className="inline-flex items-center gap-1" title={r.proxReuniao.titulo}>
                      <CalendarClock className="h-3.5 w-3.5 text-primary" /> Reunião {data(r.proxReuniao.inicio)}
                    </span>
                  )}
                </div>

                {/* Rodapé: link para o cliente + responsável + ações (não abrem o projeto).
                    z-10 para ficar ACIMA da área clicável esticada do título. */}
                <div className="relative z-10 mt-auto flex items-center justify-between gap-2 border-t pt-2.5">
                  <Link
                    to="/clientes/$clienteId"
                    params={{ clienteId: p.cliente.id }}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                    title={`Abrir ficha de ${p.cliente.nome}`}
                  >
                    <Building2 className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{p.cliente.nome}</span>
                  </Link>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {p.responsavel && (
                      <span
                        title={`Responsável: ${p.responsavel.nome}`}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary to-brand-blueText text-[10px] font-semibold text-white"
                      >
                        {iniciais(p.responsavel.nome)}
                      </span>
                    )}
                    <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          abrirEditar(p);
                        }}
                        aria-label={`Editar "${p.nome}"`}
                        className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:h-7 md:w-7"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          remover(p);
                        }}
                        aria-label={`Remover "${p.nome}"`}
                        className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive md:h-7 md:w-7"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Projeto</TH>
              <TH>Cliente</TH>
              <TH>Status</TH>
              <TH className="w-40">Progresso</TH>
              <TH>Entrega</TH>
              <TH>Responsável</TH>
              <TH className="text-right">Ações</TH>
            </tr>
          </THead>
          <tbody>
            {filtrados.map((p) => {
              const r = resumo(p);
              return (
                <TR key={p.id}>
                  <TD>
                    <Link to="/projetos/$projetoId" params={{ projetoId: p.id }} className="font-medium text-primary hover:underline">
                      {p.nome}
                    </Link>
                    {r.atrasados > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                        <AlertTriangle className="h-3 w-3" /> {r.atrasados}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <Link to="/clientes/$clienteId" params={{ clienteId: p.cliente.id }} className="text-muted-foreground hover:text-primary">
                      {p.cliente.nome}
                    </Link>
                  </TD>
                  <TD>
                    <Badge variant={statusVariant[p.status]}>{statusLabel[p.status] ?? p.status}</Badge>
                  </TD>
                  <TD>
                    <Progresso concluidos={r.concluidos} total={r.total} progresso={r.progresso} />
                  </TD>
                  <TD className={cn("text-muted-foreground", r.previsaoVencida && "font-medium text-destructive")}>
                    {p.previsaoFim ? data(p.previsaoFim) : "—"}
                  </TD>
                  <TD className="text-muted-foreground">{p.responsavel?.nome ?? "—"}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => abrirEditar(p)}
                        aria-label={`Editar "${p.nome}"`}
                        className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:h-7 md:w-7"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => remover(p)}
                        aria-label={`Remover "${p.nome}"`}
                        className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive md:h-7 md:w-7"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      )}
      </div>

      <ProjetoFormDialog open={novo} onClose={() => setNovo(false)} />
      <ProjetoFormDialog open={!!editando} onClose={() => setEditando(null)} projeto={editando ?? undefined} />
    </div>
  );
}
