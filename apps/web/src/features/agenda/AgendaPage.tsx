import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Video,
  Loader2,
  Pencil,
  Trash2,
  Repeat,
  CheckCircle2,
  Users,
  Sparkles,
  CalendarClock,
  CalendarDays,
  Clock,
  Search,
  X,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@app/ui";
import { EVENTO_TIPO_LABEL, type EventoTipo } from "@app/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@app/api/router";
import { Link } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { hora, data, dataExtenso, diaSemana } from "../../lib/format-date";

type Occ = inferRouterOutputs<AppRouter>["agenda"]["list"][number];
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Select } from "../../components/ui/select";
import { QueryError } from "../../components/ui/query-error";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { AssistenteIADialog } from "../../components/ui/assistente-ia";
import { EventoFormDialog, type EventoEditavel } from "./EventoFormDialog";

type Modo = "lista" | "dia" | "semana" | "mes" | "ano";

// ── Helpers de data ──────────────────────────────────────
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day)); // segunda-feira
  return x;
}
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
const dayKey = (d: Date) => new Date(d).toDateString();
const sameMonth = (a: Date, b: Date) => a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DOW = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const DOW_MIN = ["S", "T", "Q", "Q", "S", "S", "D"];

const HOUR_PX = 48;
const SNAP_MIN = 15;
const GUTTER = 52;

const tipoBorda: Record<EventoTipo, string> = {
  COMPROMISSO: "border-l-brand-blueLight",
  RETORNO: "border-l-warning",
  REUNIAO: "border-l-success",
  LEMBRETE: "border-l-muted-foreground",
  PESSOAL: "border-l-brand-blueText",
};
const tipoChip: Record<EventoTipo, string> = {
  COMPROMISSO: "bg-brand-blueLight/15 text-brand-blueText",
  RETORNO: "bg-warning/15 text-warning",
  REUNIAO: "bg-success/15 text-success",
  LEMBRETE: "bg-muted text-muted-foreground",
  PESSOAL: "bg-brand-blueText/10 text-brand-blueText",
};
const tipoBloco: Record<EventoTipo, string> = {
  COMPROMISSO: "bg-brand-blueLight/15 border-brand-blueLight/40 text-brand-blueText",
  RETORNO: "bg-warning/15 border-warning/40 text-warning",
  REUNIAO: "bg-success/15 border-success/40 text-success",
  LEMBRETE: "bg-muted border-border text-muted-foreground",
  PESSOAL: "bg-brand-blueText/10 border-brand-blueText/30 text-brand-blueText",
};

const minutosNoDia = (d: Date) => new Date(d).getHours() * 60 + new Date(d).getMinutes();
const duracaoMin = (ev: Occ) => (ev.fim ? Math.max(15, (new Date(ev.fim).getTime() - new Date(ev.inicio).getTime()) / 60000) : 30);
const intervaloTexto = (ev: Occ) => (ev.diaInteiro ? "Dia inteiro" : ev.fim ? `${hora(ev.inicio)}–${hora(ev.fim)}` : hora(ev.inicio));

/** occurrenceIds de eventos COM HORA que se sobrepõem a outro no mesmo dia (conflito de horário). */
function conflitosNoDia(evs: Occ[]): string[] {
  const timed = evs.filter((e) => !e.diaInteiro);
  const ids: string[] = [];
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i]!;
    const ai = +new Date(a.inicio);
    const af = a.fim ? +new Date(a.fim) : ai + 30 * 60000;
    for (let j = 0; j < timed.length; j++) {
      if (i === j) continue;
      const b = timed[j]!;
      const bi = +new Date(b.inicio);
      const bf = b.fim ? +new Date(b.fim) : bi + 30 * 60000;
      if (ai < bf && bi < af) {
        ids.push(a.occurrenceId);
        break;
      }
    }
  }
  return ids;
}

/** Layout de colunas para eventos que se sobrepõem no mesmo dia. */
function layoutColunas(evs: Occ[]) {
  const sorted = [...evs].sort(
    (a, b) => +new Date(a.inicio) - +new Date(b.inicio) || +new Date(a.fim ?? a.inicio) - +new Date(b.fim ?? b.inicio),
  );
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: Occ[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const lanesEnd: number[] = [];
    const laneOf = new Map<string, number>();
    for (const ev of cluster) {
      const s = +new Date(ev.inicio);
      const e = ev.fim ? +new Date(ev.fim) : s + 30 * 60000;
      let placed = -1;
      for (let i = 0; i < lanesEnd.length; i++) {
        if (lanesEnd[i]! <= s) {
          lanesEnd[i] = e;
          placed = i;
          break;
        }
      }
      if (placed < 0) {
        lanesEnd.push(e);
        placed = lanesEnd.length - 1;
      }
      laneOf.set(ev.occurrenceId, placed);
    }
    for (const ev of cluster) result.set(ev.occurrenceId, { lane: laneOf.get(ev.occurrenceId)!, lanes: lanesEnd.length });
    cluster = [];
    clusterEnd = 0;
  };
  for (const ev of sorted) {
    const s = +new Date(ev.inicio);
    const e = ev.fim ? +new Date(ev.fim) : s + 30 * 60000;
    if (cluster.length && s >= clusterEnd) flush();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return result;
}

export function AgendaPage() {
  const [modo, setModo] = useState<Modo>("semana");
  const [ref, setRef] = useState(() => new Date());
  const [novo, setNovo] = useState(false);
  const [novoInicio, setNovoInicio] = useState<Date | undefined>(undefined);
  const [editar, setEditar] = useState<EventoEditavel | null>(null);
  const [resumoIA, setResumoIA] = useState(false);

  // Filtros.
  const [busca, setBusca] = useState("");
  const [fTipo, setFTipo] = useState<EventoTipo | "">("");
  const [fEscopo, setFEscopo] = useState<"" | "EMPRESA" | "PESSOAL">("");
  const [fDono, setFDono] = useState("");

  // Intervalo consultado conforme o modo.
  const range = useMemo(() => {
    if (modo === "dia") return { inicio: startOfDay(ref), fim: endOfDay(ref) };
    if (modo === "semana") {
      const i = startOfWeek(ref);
      return { inicio: i, fim: endOfDay(addDays(i, 6)) };
    }
    if (modo === "ano") {
      return {
        inicio: new Date(ref.getFullYear(), 0, 1),
        fim: new Date(ref.getFullYear(), 11, 31, 23, 59, 59, 999),
      };
    }
    if (modo === "mes") {
      return { inicio: startOfWeek(startOfMonth(ref)), fim: endOfDay(addDays(startOfWeek(endOfMonth(ref)), 6)) };
    }
    return { inicio: startOfMonth(ref), fim: endOfMonth(ref) }; // lista
  }, [modo, ref]);

  const eventos = trpc.agenda.list.useQuery({ inicio: range.inicio, fim: range.fim });
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const iaOk = trpc.ia.disponivel.useQuery();
  const resumoAgenda = trpc.ia.resumoAgenda.useMutation();
  const remove = trpc.agenda.remove.useMutation({ onSuccess: () => utils.agenda.list.invalidate() });
  const mover = trpc.agenda.update.useMutation({ onSuccess: () => utils.agenda.list.invalidate() });

  // KPIs — janela fixa (hoje..+7d), independente da visão.
  const hojeInicio = useMemo(() => startOfDay(new Date()), []);
  const kpiFim = useMemo(() => endOfDay(addDays(new Date(), 7)), []);
  const kpiQuery = trpc.agenda.list.useQuery({ inicio: hojeInicio, fim: kpiFim });
  const kpis = useMemo(() => {
    const agora = new Date();
    const fimHoje = endOfDay(new Date());
    const data = kpiQuery.data ?? [];
    const hoje = data.filter((e) => +new Date(e.inicio) >= +hojeInicio && +new Date(e.inicio) <= +fimHoje).length;
    const semana = data.filter((e) => +new Date(e.inicio) >= +agora).length;
    const proxima = data.find(
      (e) => +new Date(e.inicio) >= +agora && (e.tipo === "REUNIAO" || e.tipo === "COMPROMISSO"),
    );
    const aConfirmar = data.filter(
      (e) => e.clienteId && !e.clienteConfirmadoEm && +new Date(e.inicio) >= +agora && (e.tipo === "REUNIAO" || e.tipo === "COMPROMISSO"),
    ).length;
    return { hoje, semana, proxima, aConfirmar };
  }, [kpiQuery.data, hojeInicio]);

  // Donos presentes (para o filtro).
  const donos = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of eventos.data ?? []) if (e.dono) map.set(e.dono.id, e.dono.nome);
    return [...map.entries()].map(([id, nome]) => ({ id, nome }));
  }, [eventos.data]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (eventos.data ?? []).filter((e) => {
      if (fTipo && e.tipo !== fTipo) return false;
      if (fEscopo && e.escopo !== fEscopo) return false;
      if (fDono && e.dono?.id !== fDono) return false;
      if (q && !(`${e.titulo} ${e.cliente?.nome ?? ""} ${e.projeto?.nome ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [eventos.data, busca, fTipo, fEscopo, fDono]);

  const temFiltro = !!(busca || fTipo || fEscopo || fDono);

  const removerEvento = async (id: string, titulo: string) => {
    if (
      await confirm({
        title: "Remover evento",
        description: `"${titulo}" será removido da agenda.`,
        confirmText: "Remover",
        variant: "destructive",
      })
    )
      remove.mutate({ id });
  };

  const porDia = useMemo(() => {
    const map = new Map<string, Occ[]>();
    for (const ev of filtrados) {
      const k = dayKey(ev.inicio);
      const arr = map.get(k) ?? [];
      arr.push(ev);
      map.set(k, arr);
    }
    for (const arr of map.values())
      arr.sort((a, b) => Number(a.diaInteiro) - Number(b.diaInteiro) || +new Date(a.inicio) - +new Date(b.inicio));
    return map;
  }, [filtrados]);

  // Conflitos de horário no período visível. Calculado sobre TODOS os eventos do período
  // (não a lista filtrada): filtrar por tipo/escopo/dono não pode ESCONDER um conflito real.
  const conflitoIds = useMemo(() => {
    const porDiaTodos = new Map<string, Occ[]>();
    for (const ev of eventos.data ?? []) {
      const k = dayKey(ev.inicio);
      const arr = porDiaTodos.get(k) ?? [];
      arr.push(ev);
      porDiaTodos.set(k, arr);
    }
    const s = new Set<string>();
    for (const arr of porDiaTodos.values()) for (const id of conflitosNoDia(arr)) s.add(id);
    return s;
  }, [eventos.data]);

  const abrirEdicao = (ev: Occ) =>
    setEditar({
      id: ev.eventoId,
      titulo: ev.titulo,
      descricao: ev.descricao,
      tipo: ev.tipo,
      escopo: ev.escopo,
      inicio: ev.baseInicio,
      fim: ev.baseFim,
      diaInteiro: ev.diaInteiro,
      local: ev.local,
      linkReuniao: ev.linkReuniao,
      recorrencia: ev.recorrencia,
      recorrenciaAte: ev.recorrenciaAte,
      clienteId: ev.clienteId,
      projetoId: ev.projetoId,
      participanteIds: ev.participantes.map((p) => p.id),
      ocorrenciaClicada: ev.inicio,
    });
  const criarEm = (d: Date) => {
    setNovoInicio(d);
    setNovo(true);
  };

  // Reagendar por arraste (só eventos não recorrentes; edição afeta a série).
  const moverEvento = (ev: Occ, novoInicio: Date) => {
    const delta = novoInicio.getTime() - new Date(ev.inicio).getTime();
    if (!delta) return;
    const novoFim = ev.fim ? new Date(new Date(ev.fim).getTime() + delta) : null;
    mover.mutate({ id: ev.eventoId, inicio: novoInicio, fim: novoFim });
  };

  // Navegação (passo depende do modo).
  const navegar = (dir: -1 | 1) => {
    if (modo === "dia") setRef((r) => addDays(r, dir));
    else if (modo === "semana") setRef((r) => addDays(r, dir * 7));
    else if (modo === "ano") setRef((r) => new Date(r.getFullYear() + dir, r.getMonth(), 1));
    else setRef((r) => new Date(r.getFullYear(), r.getMonth() + dir, 1));
  };

  const titulo = useMemo(() => {
    if (modo === "dia") return cap(diaSemana(ref));
    if (modo === "semana") {
      const i = startOfWeek(ref);
      const f = addDays(i, 6);
      return `${data(i)} – ${data(f)}`;
    }
    if (modo === "ano") return String(ref.getFullYear());
    return cap(ref.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
  }, [modo, ref]);

  const hoje = dayKey(new Date());

  const MODOS: { id: Modo; label: string }[] = [
    { id: "lista", label: "Lista" },
    { id: "dia", label: "Dia" },
    { id: "semana", label: "Semana" },
    { id: "mes", label: "Mês" },
    { id: "ano", label: "Ano" },
  ];

  const rotuloIA = modo === "dia" ? "do dia" : modo === "semana" ? "da semana" : "do período";

  return (
    <div className="flex h-full flex-col gap-3">
      <PageHeader title="Agenda" subtitle={titulo}>
        <div className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5">
          {MODOS.map((m) => (
            <button
              key={m.id}
              onClick={() => setModo(m.id)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                modo === m.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center rounded-md border bg-card shadow-sm">
          <button onClick={() => navegar(-1)} className="p-2 text-muted-foreground transition-colors hover:text-foreground" title="Anterior">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setRef(new Date())} className="border-x px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
            Hoje
          </button>
          <button onClick={() => navegar(1)} className="p-2 text-muted-foreground transition-colors hover:text-foreground" title="Próximo">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {iaOk.data?.disponivel && (
          <Button variant="outline" onClick={() => setResumoIA(true)} title={`Resumo ${rotuloIA} com IA`}>
            <Sparkles className="h-4 w-4" />
            Resumo IA
          </Button>
        )}
        <Button onClick={() => criarEm(new Date())}>
          <Plus className="h-4 w-4" />
          Novo evento
        </Button>
      </PageHeader>

      {/* KPIs */}
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={CalendarDays} label="Hoje" valor={kpis.hoje} hint="compromisso(s)" onClick={() => (setRef(new Date()), setModo("dia"))} />
        <KpiCard icon={CalendarClock} label="Próximos 7 dias" valor={kpis.semana} hint="compromisso(s)" />
        <KpiCard
          icon={Clock}
          label="Próxima reunião"
          valorTexto={kpis.proxima ? `${data(kpis.proxima.inicio)} ${hora(kpis.proxima.inicio)}` : "—"}
          hint={kpis.proxima?.titulo ?? "nada agendado"}
        />
        <KpiCard icon={CheckCircle2} label="Aguardando confirmação" valor={kpis.aConfirmar} hint="reunião(ões) do cliente" destaque={kpis.aConfirmar > 0} />
      </div>

      {/* Filtros */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar evento, cliente ou projeto…"
            className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5 text-sm">
          {([["", "Todos"], ["EMPRESA", "Empresa"], ["PESSOAL", "Pessoal"]] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFEscopo(v)}
              className={cn("rounded-md px-2.5 py-1 font-medium transition-colors", fEscopo === v ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {l}
            </button>
          ))}
        </div>
        <Select aria-label="Filtrar por tipo" value={fTipo} onChange={(e) => setFTipo(e.target.value as EventoTipo | "")} className="h-9 w-auto">
          <option value="">Todos os tipos</option>
          {(Object.keys(EVENTO_TIPO_LABEL) as EventoTipo[]).map((t) => (
            <option key={t} value={t}>
              {EVENTO_TIPO_LABEL[t]}
            </option>
          ))}
        </Select>
        {donos.length > 1 && (
          <Select aria-label="Filtrar por responsável" value={fDono} onChange={(e) => setFDono(e.target.value)} className="h-9 w-auto">
            <option value="">Todos os responsáveis</option>
            {donos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </Select>
        )}
        {temFiltro && (
          <button
            onClick={() => (setBusca(""), setFTipo(""), setFEscopo(""), setFDono(""))}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Limpar busca e filtros"
          >
            <X className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        )}
      </div>

      {/* Aviso de conflito de horário no período visível (só avisa; não bloqueia). */}
      {conflitoIds.size > 0 && modo !== "ano" && (
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong className="tabular-nums">{conflitoIds.size}</strong> evento{conflitoIds.size > 1 ? "s" : ""} com{" "}
            <strong>conflito de horário</strong> neste período — veja os marcados com ⚠.
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1">
      {eventos.isError ? (
        <QueryError onRetry={() => eventos.refetch()} />
      ) : eventos.isLoading ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : modo === "mes" ? (
        <MesView dataRef={ref} porDia={porDia} hoje={hoje} conflitoIds={conflitoIds} onDia={(d) => (setRef(d), setModo("dia"))} onEvento={abrirEdicao} onCriar={criarEm} onMoverDia={moverEvento} />
      ) : modo === "semana" ? (
        <TimeGrid dias={Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(ref), i))} porDia={porDia} hoje={hoje} conflitoIds={conflitoIds} onEvento={abrirEdicao} onCriar={criarEm} onMover={moverEvento} semana />
      ) : modo === "dia" ? (
        <TimeGrid dias={[startOfDay(ref)]} porDia={porDia} hoje={hoje} conflitoIds={conflitoIds} onEvento={abrirEdicao} onCriar={criarEm} onMover={moverEvento} />
      ) : modo === "ano" ? (
        <AnoView ano={ref.getFullYear()} porDia={porDia} hoje={hoje} onMes={(m) => (setRef(new Date(ref.getFullYear(), m, 1)), setModo("mes"))} onDia={(d) => (setRef(d), setModo("dia"))} />
      ) : (
        <ListaView eventos={filtrados} hoje={hoje} dataRef={ref} conflitoIds={conflitoIds} onData={setRef} onEvento={abrirEdicao} onRemover={removerEvento} />
      )}
      </div>

      <EventoFormDialog open={novo} onClose={() => setNovo(false)} inicioPadrao={novoInicio} />
      <EventoFormDialog open={!!editar} onClose={() => setEditar(null)} evento={editar ?? undefined} />
      {resumoIA && (
        <AssistenteIADialog
          title={`Resumo ${rotuloIA} com IA`}
          onClose={() => setResumoIA(false)}
          run={() => resumoAgenda.mutateAsync({ inicio: range.inicio, fim: range.fim, rotulo: titulo })}
        />
      )}
    </div>
  );
}

// ── KPI ──────────────────────────────────────────────────
function KpiCard({
  icon: Icon,
  label,
  valor,
  valorTexto,
  hint,
  onClick,
  destaque,
}: {
  icon: typeof CalendarDays;
  label: string;
  valor?: number;
  valorTexto?: string;
  hint?: string;
  onClick?: () => void;
  destaque?: boolean;
}) {
  return (
    <Card
      className={cn("flex items-center gap-3 p-3", onClick && "cursor-pointer transition-colors hover:border-primary/30", destaque && "border-warning/40 bg-warning/5")}
      onClick={onClick}
    >
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", destaque ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary")}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-lg font-semibold tabular-nums leading-tight">{valorTexto ?? valor ?? 0}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {label}
          {hint ? ` · ${hint}` : ""}
        </div>
      </div>
    </Card>
  );
}

/** Chip compacto de evento (usado em Mês). */
function EventoChip({ ev, onClick, draggable, onDragStart, conflito }: { ev: Occ; onClick: () => void; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; conflito?: boolean }) {
  return (
    <button
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={(e) => (e.stopPropagation(), onClick())}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium",
        tipoChip[ev.tipo],
        draggable && "cursor-grab active:cursor-grabbing",
        conflito && "ring-1 ring-warning",
      )}
      title={`${conflito ? "⚠ Conflito de horário · " : ""}${intervaloTexto(ev)} · ${ev.titulo}${ev.cliente ? ` — ${ev.cliente.nome}` : ""}`}
    >
      {conflito && <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-warning" />}
      {!ev.diaInteiro && <span className="shrink-0 tabular-nums">{hora(ev.inicio)}</span>}
      {ev.recorrencia !== "NENHUMA" && <Repeat className="h-2.5 w-2.5 shrink-0 opacity-70" />}
      {ev.linkReuniao && <Video className="h-2.5 w-2.5 shrink-0 opacity-70" />}
      <span className="truncate">{ev.titulo}</span>
    </button>
  );
}

// ── Grade de horários (Dia / Semana) com linha do "agora" e arraste ──
function TimeGrid({
  dias,
  porDia,
  hoje,
  conflitoIds,
  onEvento,
  onCriar,
  onMover,
  semana,
}: {
  dias: Date[];
  porDia: Map<string, Occ[]>;
  hoje: string;
  conflitoIds: Set<string>;
  onEvento: (ev: Occ) => void;
  onCriar: (d: Date) => void;
  onMover: (ev: Occ, novoInicio: Date) => void;
  semana?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [arrasto, setArrasto] = useState<{ occ: Occ; dx: number; dy: number } | null>(null);
  const dragInfo = useRef<{ occ: Occ; startX: number; startY: number; colW: number } | null>(null);
  const moveuRef = useRef(false);

  // Rola até as 7h ao abrir/trocar de dia. (expressão extraída para checagem estática das deps)
  const primeiroDiaKey = dias[0]?.toDateString();
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX - 8;
  }, [primeiroDiaKey]);

  // Linha do "agora".
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const nowTop = (minutosNoDia(agora) / 60) * HOUR_PX;

  const iniciarArraste = (e: React.PointerEvent, occ: Occ) => {
    if (occ.recorrencia !== "NENHUMA" || occ.diaInteiro) return; // recorrente: edita pelo diálogo
    e.preventDefault();
    e.stopPropagation();
    const colW = gridRef.current ? (gridRef.current.clientWidth - GUTTER) / dias.length : 0;
    dragInfo.current = { occ, startX: e.clientX, startY: e.clientY, colW };
    moveuRef.current = false;
    setArrasto({ occ, dx: 0, dy: 0 });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moverArraste = (e: React.PointerEvent) => {
    if (!dragInfo.current) return;
    const dx = e.clientX - dragInfo.current.startX;
    const dy = e.clientY - dragInfo.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moveuRef.current = true;
    setArrasto({ occ: dragInfo.current.occ, dx, dy });
  };
  const soltarArraste = (e: React.PointerEvent) => {
    const info = dragInfo.current;
    dragInfo.current = null;
    if (!info) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const dy = e.clientY - info.startY;
    const dx = e.clientX - info.startX;
    setArrasto(null);
    const deltaMin = Math.round(dy / HOUR_PX * 60 / SNAP_MIN) * SNAP_MIN;
    const deltaDias = semana && info.colW ? Math.round(dx / info.colW) : 0;
    if (!deltaMin && !deltaDias) return;
    const base = new Date(info.occ.inicio);
    const novo = new Date(base);
    novo.setDate(novo.getDate() + deltaDias);
    novo.setMinutes(novo.getMinutes() + deltaMin);
    onMover(info.occ, novo);
  };

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      {/* Cabeçalho dos dias + faixa de dia inteiro */}
      <div className="flex shrink-0 border-b bg-muted/30" style={{ paddingLeft: GUTTER }}>
        {dias.map((d) => {
          const ehHoje = dayKey(d) === hoje;
          const diaInteiros = (porDia.get(dayKey(d)) ?? []).filter((e) => e.diaInteiro);
          return (
            <div key={d.toISOString()} className={cn("flex-1 border-l px-2 py-1.5 first:border-l-0", ehHoje && "bg-accent/40")}>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-semibold uppercase text-muted-foreground">{DOW[(d.getDay() + 6) % 7]}</span>
                <span className={cn("text-sm font-semibold tabular-nums", ehHoje && "text-primary")}>{d.getDate()}</span>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {diaInteiros.map((ev) => (
                  <EventoChip key={ev.occurrenceId} ev={ev} onClick={() => onEvento(ev)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grade rolável */}
      <div ref={scrollRef} tabIndex={0} role="region" aria-label="Grade de horários" className="relative min-h-0 flex-1 overflow-y-auto">
        <div ref={gridRef} className="relative flex" style={{ height: 24 * HOUR_PX }} onPointerMove={moverArraste} onPointerUp={soltarArraste}>
          {/* Gutter de horas */}
          <div className="relative shrink-0" style={{ width: GUTTER }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground" style={{ top: h * HOUR_PX }}>
                {h > 0 ? `${String(h).padStart(2, "0")}:00` : ""}
              </div>
            ))}
          </div>
          {/* Colunas dos dias */}
          {dias.map((d) => {
            const timed = (porDia.get(dayKey(d)) ?? []).filter((e) => !e.diaInteiro);
            const layout = layoutColunas(timed);
            const ehHoje = dayKey(d) === hoje;
            return (
              <div key={d.toISOString()} className="relative flex-1 border-l" onClick={(e) => {
                // clique numa faixa vazia cria evento naquele horário (snap 30 min)
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const y = e.clientY - rect.top;
                const min = Math.floor((y / HOUR_PX) * 60 / 30) * 30;
                const dt = new Date(d);
                dt.setHours(Math.floor(min / 60), min % 60, 0, 0);
                onCriar(dt);
              }}>
                {/* linhas das horas */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-border/50" style={{ top: h * HOUR_PX }} />
                ))}
                {/* linha do agora */}
                {ehHoje && (
                  <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: nowTop }}>
                    <div className="relative">
                      <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-destructive" />
                      <div className="border-t-2 border-destructive" />
                    </div>
                  </div>
                )}
                {/* eventos */}
                {timed.map((ev) => {
                  const col = layout.get(ev.occurrenceId) ?? { lane: 0, lanes: 1 };
                  const top = (minutosNoDia(ev.inicio) / 60) * HOUR_PX;
                  const height = Math.max(18, (duracaoMin(ev) / 60) * HOUR_PX - 2);
                  const w = 100 / col.lanes;
                  const arrastando = arrasto?.occ.occurrenceId === ev.occurrenceId;
                  const emConflito = conflitoIds.has(ev.occurrenceId);
                  return (
                    <div
                      key={ev.occurrenceId}
                      onPointerDown={(e) => iniciarArraste(e, ev)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (moveuRef.current) {
                          moveuRef.current = false;
                          return;
                        }
                        onEvento(ev);
                      }}
                      className={cn(
                        "absolute z-10 overflow-hidden rounded-md border px-1.5 py-0.5 text-[11px] shadow-sm",
                        tipoBloco[ev.tipo],
                        ev.recorrencia === "NENHUMA" && !ev.diaInteiro ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                        emConflito && !arrastando && "ring-1 ring-warning",
                        arrastando && "z-30 opacity-90 ring-2 ring-primary",
                      )}
                      style={{
                        top,
                        height,
                        left: `calc(${col.lane * w}% + 2px)`,
                        width: `calc(${w}% - 4px)`,
                        transform: arrastando ? `translate(${arrasto!.dx}px, ${arrasto!.dy}px)` : undefined,
                      }}
                      title={`${emConflito ? "⚠ Conflito de horário · " : ""}${intervaloTexto(ev)} · ${ev.titulo}`}
                    >
                      <div className="flex items-center gap-1 font-medium">
                        {emConflito && <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-warning" />}
                        <span className="truncate">{ev.titulo}</span>
                        {ev.recorrencia !== "NENHUMA" && <Repeat className="h-2.5 w-2.5 shrink-0 opacity-70" />}
                        {ev.clienteConfirmadoEm && <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-success" />}
                      </div>
                      {height > 30 && (
                        <div className="truncate">
                          {intervaloTexto(ev)}
                          {ev.cliente ? ` · ${ev.cliente.nome}` : ""}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ── Mês (grade de quadrados) ─────────────────────────────
function MesView({
  dataRef,
  porDia,
  hoje,
  conflitoIds,
  onDia,
  onEvento,
  onCriar,
  onMoverDia,
}: {
  dataRef: Date;
  porDia: Map<string, Occ[]>;
  hoje: string;
  conflitoIds: Set<string>;
  onDia: (d: Date) => void;
  onEvento: (ev: Occ) => void;
  onCriar: (d: Date) => void;
  onMoverDia: (ev: Occ, novoInicio: Date) => void;
}) {
  const inicio = startOfWeek(startOfMonth(dataRef));
  const dias = Array.from({ length: 42 }, (_, i) => addDays(inicio, i));
  const [, setArrastandoId] = useState<string | null>(null);

  const soltarNoDia = (destino: Date, e: React.DragEvent) => {
    e.preventDefault();
    setArrastandoId(null);
    const payload = e.dataTransfer.getData("text/plain");
    if (!payload) return;
    const [occId] = payload.split("|");
    const ev = [...porDia.values()].flat().find((x) => x.occurrenceId === occId);
    if (!ev || ev.recorrencia !== "NENHUMA") return;
    const base = new Date(ev.inicio);
    const novo = new Date(destino);
    novo.setHours(base.getHours(), base.getMinutes(), 0, 0);
    if (dayKey(novo) === dayKey(base)) return;
    onMoverDia(ev, novo);
  };

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="grid shrink-0 grid-cols-7 border-b bg-muted/30 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {DOW.map((d) => (
          <div key={d} className="py-2">{d}</div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {dias.map((d) => {
          const lista = porDia.get(dayKey(d)) ?? [];
          const noMes = sameMonth(d, dataRef);
          const ehHoje = dayKey(d) === hoje;
          return (
            <div
              key={d.toISOString()}
              onClick={() => onDia(d)}
              onDragOver={(e) => (e.preventDefault(), setArrastandoId((id) => id))}
              onDrop={(e) => soltarNoDia(d, e)}
              className={cn(
                "group flex min-h-0 cursor-pointer flex-col overflow-hidden border-b border-r p-1.5 transition-colors last:border-r-0 hover:bg-accent/30 [&:nth-child(7n)]:border-r-0",
                !noMes && "bg-muted/20 text-muted-foreground",
              )}
            >
              <div className="flex shrink-0 items-center justify-between">
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium tabular-nums", ehHoje && "bg-primary text-primary-foreground")}>
                  {d.getDate()}
                </span>
                <button
                  onClick={(e) => (e.stopPropagation(), onCriar(d))}
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                  title="Novo evento"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-hidden">
                {lista.slice(0, 3).map((ev) => (
                  <EventoChip
                    key={ev.occurrenceId}
                    ev={ev}
                    conflito={conflitoIds.has(ev.occurrenceId)}
                    onClick={() => onEvento(ev)}
                    draggable={ev.recorrencia === "NENHUMA"}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", `${ev.occurrenceId}|${ev.eventoId}`);
                      setArrastandoId(ev.occurrenceId);
                    }}
                  />
                ))}
                {lista.length > 3 && <div className="px-1 text-[10px] font-medium text-muted-foreground">+{lista.length - 3} mais</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Lista (mês escolhido, agrupada por dia, com navegação rápida ano/mês) ──
function ListaView({
  eventos,
  hoje,
  dataRef,
  conflitoIds,
  onData,
  onEvento,
  onRemover,
}: {
  eventos: Occ[];
  hoje: string;
  dataRef: Date;
  conflitoIds: Set<string>;
  onData: (d: Date) => void;
  onEvento: (ev: Occ) => void;
  onRemover: (id: string, titulo: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const grupos = useMemo(() => {
    const map = new Map<string, Occ[]>();
    for (const ev of eventos) {
      const k = dayKey(ev.inicio);
      (map.get(k) ?? map.set(k, []).get(k)!).push(ev);
    }
    return [...map.entries()].sort((a, b) => +new Date(a[0]) - +new Date(b[0]));
  }, [eventos]);

  const totalEventos = eventos.length;
  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: 7 }, (_, i) => anoAtual - 2 + i);

  // Ao abrir/mudar de mês, rola até o dia de hoje (se estiver no mês) ou ao topo.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-hoje="1"]');
    if (el) el.scrollIntoView({ block: "start" });
    else if (listRef.current) listRef.current.scrollTop = 0;
  }, [dataRef]);

  const setMes = (mes: number) => onData(new Date(dataRef.getFullYear(), mes, 1));
  const setAno = (ano: number) => onData(new Date(ano, dataRef.getMonth(), 1));

  return (
    <div className="flex h-full flex-col">
      {/* Navegação por mês/ano — escolha rápida do período. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-3">
        <Select aria-label="Mês" value={dataRef.getMonth()} onChange={(e) => setMes(Number(e.target.value))} className="h-9 w-auto">
          {MESES.map((m, i) => (
            <option key={m} value={i}>{m}</option>
          ))}
        </Select>
        <Select aria-label="Ano" value={dataRef.getFullYear()} onChange={(e) => setAno(Number(e.target.value))} className="h-9 w-auto">
          {anos.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Select>
        <span className="text-sm text-muted-foreground">
          {totalEventos === 0 ? "Nenhum evento" : `${totalEventos} evento${totalEventos > 1 ? "s" : ""}`}
        </span>
      </div>

      {grupos.length === 0 ? (
        <Card className="flex min-h-0 flex-1 items-center justify-center">
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">
            Nenhum evento em {MESES[dataRef.getMonth()]?.toLowerCase()} de {dataRef.getFullYear()}.
          </p>
        </Card>
      ) : (
        <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {grupos.map(([k, lista]) => {
            const d = new Date(k);
            const ehHoje = k === hoje;
            return (
              <div key={k} data-hoje={ehHoje ? "1" : undefined}>
                {/* Cabeçalho do dia FIXO ao rolar (não perde a referência da data). */}
                <div className="sticky top-0 z-10 -mx-1 mb-1.5 flex items-center gap-2 border-b bg-background/95 px-1 py-1.5 text-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums", ehHoje ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
                    {d.getDate()}
                  </span>
                  <span className="font-medium capitalize">{d.toLocaleDateString("pt-BR", { weekday: "long" })}</span>
                  <span className="text-xs text-muted-foreground">{dataExtenso(d)}</span>
                  {ehHoje && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">hoje</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{lista.length} evento{lista.length > 1 ? "s" : ""}</span>
                </div>
                <Card>
                  <div className="divide-y">
                    {lista.map((ev) => (
                      <EventoLinha key={ev.occurrenceId} ev={ev} conflito={conflitoIds.has(ev.occurrenceId)} onEditar={() => onEvento(ev)} onRemover={() => onRemover(ev.eventoId, ev.titulo)} />
                    ))}
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Linha de evento (usada em Lista). */
function EventoLinha({ ev, conflito, onEditar, onRemover }: { ev: Occ; conflito?: boolean; onEditar: () => void; onRemover: () => void }) {
  return (
    <div className={cn("group flex items-center gap-3 border-l-4 px-4 py-2.5 transition-colors hover:bg-accent/40", tipoBorda[ev.tipo])}>
      <div className="w-20 shrink-0 text-sm font-medium tabular-nums">{ev.diaInteiro ? "Dia inteiro" : intervaloTexto(ev)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{ev.titulo}</span>
          {conflito && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-warning/15 px-1 py-0.5 text-[10px] font-semibold text-warning" title="Conflito de horário">
              <AlertTriangle className="h-3 w-3" /> conflito
            </span>
          )}
          {ev.recorrencia !== "NENHUMA" && <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" />}
          {ev.clienteConfirmadoEm && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{EVENTO_TIPO_LABEL[ev.tipo]}</span>
          {ev.cliente && (
            <Link to="/clientes/$clienteId" params={{ clienteId: ev.cliente.id }} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">
              {ev.cliente.nome}
            </Link>
          )}
          {ev.projeto && <span>· {ev.projeto.nome}</span>}
          {ev.local && <span>· {ev.local}</span>}
          {ev.participantes.length > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Users className="h-3 w-3" />
              {ev.participantes.length + 1}
            </span>
          )}
          {ev.escopo === "PESSOAL" && <Badge>Pessoal</Badge>}
        </div>
      </div>
      {ev.linkReuniao && (
        <a
          href={ev.linkReuniao}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success/20"
        >
          <Video className="h-3.5 w-3.5" /> Entrar
        </a>
      )}
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button onClick={onEditar} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Editar">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={onRemover} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remover">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Ano (12 mini-meses) ──────────────────────────────────
function AnoView({
  ano,
  porDia,
  hoje,
  onMes,
  onDia,
}: {
  ano: number;
  porDia: Map<string, Occ[]>;
  hoje: string;
  onMes: (mes: number) => void;
  onDia: (d: Date) => void;
}) {
  return (
    <div className="grid h-full auto-rows-min gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      {Array.from({ length: 12 }, (_, mes) => {
        const primeiro = new Date(ano, mes, 1);
        const inicio = startOfWeek(primeiro);
        const celulas = Array.from({ length: 42 }, (_, i) => addDays(inicio, i));
        const usadas = celulas.slice(0, sameMonth(celulas[35]!, primeiro) ? 42 : 35);
        return (
          <Card key={mes} className="p-2.5">
            <button onClick={() => onMes(mes)} className="mb-2 w-full text-left text-sm font-semibold capitalize text-primary hover:underline">
              {primeiro.toLocaleDateString("pt-BR", { month: "long" })}
            </button>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted-foreground">
              {DOW_MIN.map((d, i) => (
                <div key={i} className="py-0.5">{d}</div>
              ))}
              {usadas.map((d) => {
                const temEvento = (porDia.get(dayKey(d)) ?? []).length > 0;
                const noMes = d.getMonth() === mes;
                const ehHoje = dayKey(d) === hoje;
                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => onDia(d)}
                    className={cn(
                      "relative flex h-6 items-center justify-center rounded text-[11px] tabular-nums transition-colors hover:bg-accent",
                      !noMes && "text-muted-foreground/40",
                      ehHoje && "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
                    )}
                  >
                    {d.getDate()}
                    {temEvento && noMes && !ehHoje && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary" />}
                  </button>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
