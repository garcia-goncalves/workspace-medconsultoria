import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Filter,
  FolderKanban,
  CheckSquare,
  ListTodo,
  Video,
  AlertTriangle,
  Calendar,
  CalendarClock,
  ArrowRight,
  FileText,
  Activity,
  Wallet,
  Clock,
  CheckCircle2,
  Users,
  TrendingUp,
  Building2,
  ServerCog,
  Cpu,
  Database,
  Siren,
  Bug,
  Radio,
  Sparkles,
  Loader2,
  Sun,
  Plus,
  RefreshCw,
  ChevronDown,
  SlidersHorizontal,
  RotateCcw,
  Zap,
} from "lucide-react";
import { cn } from "@app/ui";
import {
  EVENTO_TIPO_LABEL,
  STATUS_DOCUMENTO_LABEL,
  PRIORIDADE_LABEL,
  TAREFA_PRIORIDADE_LABEL,
  type StatusDocumento,
  type Prioridade,
} from "@app/shared";
import { trpc, type RouterOutputs } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { TarefaFormDialog } from "../tarefas/TarefaFormDialog";
import { PageHeader } from "../../components/ui/page-header";
import { Badge, type BadgeProps } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { Popover } from "../../components/ui/popover";
import { formatBRL, formatEstimativaDoFunil } from "../../lib/masks";
import { hora, dataUTC, haQuanto, diaSemana } from "../../lib/format-date";

const diaCurto = (d: Date) =>
  new Date(d).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

const prioridadeVariant: Record<Prioridade, BadgeProps["variant"]> = {
  BAIXA: "default",
  MEDIA: "primary",
  ALTA: "warning",
  URGENTE: "danger",
};
const docStatusVariant: Record<StatusDocumento, BadgeProps["variant"]> = {
  RASCUNHO: "default",
  EM_REVISAO: "warning",
  APROVADO: "primary",
  ENVIADO: "success",
};

const ACAO_LABEL: Record<string, string> = {
  "cliente.criado": "cadastrou um cliente",
  "cliente.removido": "removeu um cliente",
  "lead.criado": "criou um lead",
  "lead.capturado": "recebeu um lead pelo site",
  "lead.recapturado": "recebeu um novo contato de um lead",
  "lead.convertido": "converteu um lead em cliente",
  "lead.removido": "removeu um lead",
  "lead.perdido": "marcou um lead como perdido",
  "lead.reaberto": "reabriu um lead no funil",
  "lead.moveu_etapa": "moveu um lead de etapa",
  "lead.avancou_etapa": "avançou um lead de etapa",
  "lead.auto_avancou": "avançou um lead no funil (automático)",
  "lead.auto_avancou_checklist": "avançou um lead no funil (checklist concluído)",
  "conta.criada": "provisionou uma conta a receber",
  "projeto.criado": "criou um projeto",
  "projeto.removido": "removeu um projeto",
  "projeto.concluido": "concluiu um projeto",
  "projeto.reaberto": "reabriu um projeto",
  "card.criado": "criou uma tarefa",
  "evento.criado": "agendou um compromisso",
  "evento.removido": "removeu um compromisso",
  "documento.rascunho": "salvou um rascunho de documento",
  "documento.em_revisao": "enviou um documento para revisão",
  "documento.aprovado": "aprovou um documento",
  "documento.enviado": "enviou um documento",
  "documento.ia_gerado": "gerou um documento com IA",
  "documento.ia_ata": "gerou uma ata com IA",
  "documento.ia_pauta": "gerou uma pauta com IA",
  "documento.proposta_gerado": "gerou uma proposta",
  "documento.proposta_gerada": "gerou uma proposta",
  "documento.proposta_auto": "gerou uma proposta automaticamente",
  "documento.contrato_gerado": "gerou um contrato",
  "documento.contrato_auto": "gerou um contrato automaticamente",
  "documento.briefing_gerado": "gerou um briefing",
  "documento.assinado": "assinou um documento",
  "documento.assinatura_solicitada": "solicitou a assinatura de um documento",
  "proposta.aceite_habilitado": "liberou o aceite online de uma proposta",
  "arquivo.removido": "removeu um arquivo",
  "cliente.dados_atualizados_portal": "atualizou os próprios dados pelo Portal",
  "cliente.excluido_definitivo": "excluiu um cliente definitivamente",
  "servico.contratado": "contratou um serviço",
  "servico.cancelado": "cancelou um serviço",
  "servico.sincronizado_aceite": "sincronizou os serviços após o aceite",
  "lead.servicos_portal": "escolheu serviços pelo Portal",
  login: "entrou no sistema",
};

/**
 * Frase da atividade. O fallback antigo (trocar `.`/`_` por espaço) produzia texto sem verbo
 * — "Thaís arquivo removido". Documentos gerados por modelo têm a ação montada em tempo de
 * execução (`documento.<tipo>_gerado`), então não dá para listar todos: o padrão cobre o resto.
 */
export function acaoLabel(acao: string): string {
  const conhecida = ACAO_LABEL[acao];
  if (conhecida) return conhecida;
  const tipo = acao.match(/^documento\.(.+)_gerad[oa]$/)?.[1];
  if (tipo) return `gerou um documento (${tipo.replace(/_/g, " ")})`;
  return `registrou: ${acao.replace(/[._]/g, " ")}`;
}

/**
 * Quem aparece como autor da linha. Nem toda atividade tem gente atrás: o projeto se
 * conclui e se reabre sozinho quando o último cartão fecha (`reconciliarStatusProjeto`),
 * e o funil avança sozinho. Isso saía como "Alguém concluiu um projeto" — o dono ficava
 * procurando quem tinha mexido, e não havia ninguém. Quando o servidor marca o evento
 * como automático, a linha diz **Automação**; "Alguém" fica só para o caso genuinamente
 * desconhecido, que é o que a palavra quer dizer.
 */
export function atorDaAtividade(a: { acao: string; usuario?: string | null; auto?: boolean }): {
  nome: string;
  automatico: boolean;
} {
  const automatico = a.auto === true || a.acao.startsWith("lead.auto");
  if (automatico) return { nome: "Automação", automatico: true };
  return { nome: a.usuario ?? "Alguém", automatico: false };
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

function uptimeFmt(seg: number): string {
  const d = Math.floor(seg / 86400);
  const h = Math.floor((seg % 86400) / 3600);
  const m = Math.floor((seg % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

// ── Leaf components ───────────────────────────────────────

function StatCard({ to, icon: Icon, label, value, sub }: { to: string; icon: LucideIcon; label: string; value: string | number; sub?: string }) {
  return (
    <Link
      to={to}
      className="group rounded-xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/5 text-primary ring-1 ring-inset ring-primary/10 transition-colors group-hover:bg-primary/10">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-primary">{value}</div>
      <div className="mt-0.5 min-h-4 text-xs text-muted-foreground">{sub}</div>
    </Link>
  );
}

const chipTone = {
  danger: { box: "border-destructive/30 hover:border-destructive/50", icon: "bg-destructive/10 text-destructive", num: "text-destructive" },
  warning: { box: "border-warning/40 hover:border-warning/60", icon: "bg-warning/10 text-warning", num: "text-warning" },
  info: { box: "border-primary/25 hover:border-primary/45", icon: "bg-primary/10 text-primary", num: "text-primary" },
} as const;

function AttentionChip({ to, icon: Icon, count, label, tone }: { to: string; icon: LucideIcon; count: number; label: string; tone: keyof typeof chipTone }) {
  const t = chipTone[tone];
  return (
    <Link
      to={to}
      className={cn(
        // `min-w-0`: item de grid nasce com `min-width:auto` (= min-content dele) e estoura a
        // trilha. Estes avisos só existem quando há alerta de verdade, então o defeito não aparece
        // em banco vazio — apareceu na CI, a 360px, com 21px de excesso.
        "group flex min-w-0 items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        t.box,
      )}
    >
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", t.icon)}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className={cn("text-lg font-semibold leading-none tabular-nums", t.num)}>{count}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{label}</div>
      </div>
      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function MoneyTile({ label, valor, tom }: { label: string; valor: number; tom: "verde" | "vermelho" | "neutro" }) {
  const cor = tom === "verde" ? "text-success" : tom === "vermelho" ? "text-destructive" : valor >= 0 ? "text-success" : "text-destructive";
  return (
    <div className="rounded-lg border bg-background/60 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", cor)}>{formatBRL(valor)}</div>
    </div>
  );
}

function MiniStat({ to, label, value, tone = "neutro" }: { to: string; label: string; value: number; tone?: "neutro" | "danger" | "warning" }) {
  const cor = tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <Link to={to} className="rounded-lg border bg-background/60 p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
      <div className={cn("text-xl font-semibold tabular-nums", cor)}>{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</div>
    </Link>
  );
}

function BarRow({ label, value, max, valueLabel, sub, danger }: { label: string; value: number; max: number; valueLabel?: string; sub?: string; danger?: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-sm sm:gap-3">
      <div className="w-16 shrink-0 truncate text-muted-foreground sm:w-28" title={label}>
        {label}
      </div>
      <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-muted">
        <div className="h-full rounded-md bg-primary/70" style={{ width: `${pct}%` }} />
      </div>
      {/* min-w (não w-fixo): com o crachá "N atr." somado ao rótulo, o conteúdo pode passar dos
          96px de antes — largura fixa cortava/vazava. min-w preserva o alinhamento comum sem
          travar o que precisar de mais espaço. */}
      <div className="flex min-w-[4rem] shrink-0 items-center justify-end gap-1.5 tabular-nums sm:min-w-[6rem]">
        {danger != null && danger > 0 && (
          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">{danger} atr.</span>
        )}
        <span className="font-medium">{valueLabel ?? value}</span>
      </div>
      {/* sub (a estimativa em dinheiro por etapa) some no celular: o total já aparece embaixo da
          lista, e a 360px ele não cabia — vazava a linha para fora do card. */}
      {sub && <div className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground sm:block">{sub}</div>}
    </div>
  );
}

/** "Seu dia com a IA": plano do dia priorizado, gerado sob demanda a partir das pendências reais. */
function PlanoDoDia() {
  const gerar = trpc.ia.resumoDoDia.useMutation();
  return (
    <div className="p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sun className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Um plano priorizado do que fazer hoje</div>
          <div className="text-xs text-muted-foreground">Baseado nas suas pendências reais (tarefas, contas, funil).</div>
        </div>
        <button
          onClick={() => gerar.mutate()}
          disabled={gerar.isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {gerar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : gerar.data ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          {gerar.isPending ? "Pensando…" : gerar.data ? "Refazer" : "Gerar meu plano"}
        </button>
      </div>
      {gerar.error && <p className="mt-3 text-sm text-destructive">{gerar.error.message}</p>}
      {gerar.data && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border bg-background/60 p-3.5 text-sm leading-relaxed text-foreground">{gerar.data}</div>
      )}
    </div>
  );
}

function AcoesRapidas() {
  const [novaTarefa, setNovaTarefa] = useState(false);
  const acoes: { to: string; icon: LucideIcon; label: string }[] = [
    { to: "/leads", icon: Filter, label: "Novo lead" },
    { to: "/clientes", icon: Building2, label: "Novo cliente" },
    { to: "/documentos", icon: FileText, label: "Nova proposta" },
    { to: "/agenda", icon: Calendar, label: "Novo evento" },
    { to: "/projetos", icon: FolderKanban, label: "Novo projeto" },
  ];
  const classe =
    "inline-flex items-center gap-1.5 rounded-lg border bg-background/60 px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40";
  return (
    <div className="flex flex-wrap gap-2 p-4">
      {acoes.map((a) => (
        <Link key={a.to + a.label} to={a.to} className={classe}>
          <Plus className="h-3.5 w-3.5 text-primary" />
          <a.icon className="h-4 w-4 text-muted-foreground" />
          {a.label}
        </Link>
      ))}
      {/* Abre o formulário de tarefa direto (não navega) — pedido do dono. */}
      <button type="button" onClick={() => setNovaTarefa(true)} className={classe}>
        <Plus className="h-3.5 w-3.5 text-primary" />
        <ListTodo className="h-4 w-4 text-muted-foreground" />
        Nova tarefa
      </button>
      <TarefaFormDialog open={novaTarefa} onClose={() => setNovaTarefa(false)} />
    </div>
  );
}

// ── Personalização (widgets recolhíveis + mostrar/ocultar, por usuário) ──

type WidgetId =
  | "acoes" | "sistema" | "atencao" | "plano" | "kpis" | "tarefas" | "tarefas-comigo" | "agenda"
  | "financeiro" | "funil" | "projetos" | "equipe" | "clientes" | "docs" | "atividade";

type Grupo = "dia" | "gestao";
interface WidgetDef {
  id: WidgetId;
  titulo: string;
  icon: LucideIcon;
  grupo: Grupo;
  span: 1 | 2;
  link?: { to: string; label: string };
  render: () => ReactNode;
}

interface Prefs {
  ocultos: WidgetId[];
  recolhidos: WidgetId[];
}

/** Preferências do dashboard por usuário (persistidas no navegador). */
function useDashboardPrefs(userId: string) {
  const KEY = `dashboard-prefs:v1:${userId}`;
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Prefs>;
        return { ocultos: p.ocultos ?? [], recolhidos: p.recolhidos ?? [] };
      }
    } catch {
      /* storage indisponível */
    }
    return { ocultos: [], recolhidos: [] };
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* ignora */
    }
  }, [KEY, prefs]);

  const alterna = (chave: keyof Prefs, id: WidgetId) =>
    setPrefs((p) => ({ ...p, [chave]: p[chave].includes(id) ? p[chave].filter((x) => x !== id) : [...p[chave], id] }));

  return {
    ocultos: prefs.ocultos,
    recolhidos: prefs.recolhidos,
    ocultar: (id: WidgetId) => alterna("ocultos", id),
    recolher: (id: WidgetId) => alterna("recolhidos", id),
    restaurar: () => setPrefs({ ocultos: [], recolhidos: [] }),
    personalizado: prefs.ocultos.length > 0 || prefs.recolhidos.length > 0,
  };
}

/** Contêiner de widget: cabeçalho com título + link + recolher; corpo some quando recolhido. */
function WidgetCard({
  def,
  recolhido,
  onRecolher,
  children,
}: {
  def: WidgetDef;
  recolhido: boolean;
  onRecolher: () => void;
  children: ReactNode;
}) {
  const Icon = def.icon;
  return (
    <section className={cn("flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm", def.span === 2 && "lg:col-span-2")}>
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{def.titulo}</h3>
        {def.link && (
          <Link
            to={def.link.to}
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
          >
            {def.link.label}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
        <button
          onClick={onRecolher}
          className="shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={recolhido ? "Expandir" : "Recolher"}
          title={recolhido ? "Expandir" : "Recolher"}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", recolhido && "-rotate-90")} />
        </button>
      </header>
      {!recolhido && children}
    </section>
  );
}

/** Menu "Personalizar": liga/desliga cada widget + restaura o padrão. */
function PersonalizarMenu({
  defs,
  ocultos,
  onToggle,
  onRestaurar,
  personalizado,
}: {
  defs: WidgetDef[];
  ocultos: WidgetId[];
  onToggle: (id: WidgetId) => void;
  onRestaurar: () => void;
  personalizado: boolean;
}) {
  const [aberto, setAberto] = useState(false);

  const grupos: { titulo: string; grupo: Grupo }[] = [
    { titulo: "Meu dia", grupo: "dia" },
    { titulo: "Gestão da empresa", grupo: "gestao" },
  ];

  return (
    // O balão custom antigo era `absolute right-0` ancorado num botão à ESQUERDA do cabeçalho
    // (no celular o PageHeader empilha e o botão fica alinhado à esquerda) — um balão de 288px
    // "crescendo para a esquerda" a partir dali vazava para fora da tela a 360px. O `Popover` do
    // kit mede a si mesmo e desliza para caber, sem vazar (ver docs/UI_GUIDELINES.md §4).
    <Popover
      open={aberto}
      onOpenChange={setAberto}
      ariaLabel="Personalizar o que mostrar no Início"
      trigger={(p) => (
        <button
          {...p}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-sm outline-none transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          Personalizar
        </button>
      )}
    >
      <div className="w-72 max-w-[80vw]">
        <div className="flex items-center justify-between border-b px-1 pb-2">
          <span className="text-sm font-semibold">O que mostrar no Início</span>
          {personalizado && (
            <button onClick={onRestaurar} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <RotateCcw className="h-3 w-3" /> Padrão
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto pt-1.5">
          {grupos.map((gr) => {
            const itens = defs.filter((d) => d.grupo === gr.grupo);
            if (itens.length === 0) return null;
            return (
              <div key={gr.grupo} className="mb-1">
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{gr.titulo}</p>
                {itens.map((d) => {
                  const visivel = !ocultos.includes(d.id);
                  return (
                    <label key={d.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                      <input type="checkbox" checked={visivel} onChange={() => onToggle(d.id)} className="h-4 w-4 accent-[var(--primary)]" />
                      <d.icon className="h-4 w-4 text-muted-foreground" />
                      <span className={cn("min-w-0 flex-1 truncate", !visivel && "text-muted-foreground line-through")}>{d.titulo}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}

// ── Página ────────────────────────────────────────────────

export function DashboardPage() {
  const { user } = useAuth();
  const dash = trpc.dashboard.resumo.useQuery(undefined, { refetchInterval: 60_000 });
  const ia = trpc.ia.disponivel.useQuery(undefined, { staleTime: 60_000 });
  const prefs = useDashboardPrefs(user.id);

  const primeiroNome = user.nome.split(" ")[0] ?? user.nome;
  const horaAtual = new Date().getHours();
  const saudacao = horaAtual < 12 ? "Bom dia" : horaAtual < 18 ? "Boa tarde" : "Boa noite";
  const dataTitulo = (() => {
    const s = diaSemana(new Date());
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();

  if (dash.isError) return <QueryError onRetry={() => dash.refetch()} />;

  if (dash.isLoading || !dash.data) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const d = dash.data;
  const g = d.gestao;
  const sis = d.sistema;
  const hoje0 = startOfToday();

  const proximoHoje = d.eventosHoje.find((e) => !e.diaInteiro) ?? d.eventosHoje[0];
  const compromissosSub =
    d.eventosHoje.length === 0 ? "agenda livre" : proximoHoje && !proximoHoje.diaInteiro ? `próximo às ${hora(proximoHoje.inicio)}` : "ver agenda";

  const vencidasCount = g ? g.financeiro.vencidasPagar.count + g.financeiro.vencidasReceber.count : 0;
  const vencidasTotal = g ? g.financeiro.vencidasPagar.total + g.financeiro.vencidasReceber.total : 0;

  const nEventos = d.eventosHoje.length;
  const nTarefas = d.minhasTarefas;
  const resumoDia =
    `${dataTitulo} · ` +
    (nEventos === 0 ? "sem compromissos" : `${nEventos} compromisso${nEventos > 1 ? "s" : ""} hoje`) +
    ` · ${nTarefas} tarefa${nTarefas !== 1 ? "s" : ""} sua${nTarefas !== 1 ? "s" : ""}` +
    (vencidasCount > 0 ? ` · ${vencidasCount} conta${vencidasCount > 1 ? "s" : ""} vencendo` : "");

  const temAtencao =
    d.minhasTarefasAtrasadasCount > 0 ||
    d.tarefasComigoAtrasadasCount > 0 ||
    d.conflitosAgendaCount > 0 ||
    (g != null &&
      (g.tarefasAtrasadasEquipeCount > 0 ||
        vencidasCount > 0 ||
        g.financeiro.aVencer7.count > 0 ||
        g.docsPendentesCount > 0 ||
        g.docsAguardandoClienteCount > 0 ||
        g.funil.parados > 0 ||
        g.projetos.parados > 0 ||
        g.projetos.semResponsavel > 0));

  // ── Definição dos widgets (só os disponíveis para o papel/dados entram) ──
  const defs: WidgetDef[] = [];

  defs.push({ id: "acoes", titulo: "Ações rápidas", icon: Zap, grupo: "dia", span: 2, render: () => <AcoesRapidas /> });

  if (sis)
    defs.push({
      id: "sistema",
      titulo: "Saúde do sistema",
      icon: ServerCog,
      grupo: "gestao",
      span: 2,
      link: { to: "/sistema", label: "Abrir painel" },
      render: () => <SystemBody s={sis} />,
    });

  defs.push({
    id: "atencao",
    titulo: "Precisa da sua atenção",
    icon: AlertTriangle,
    grupo: "dia",
    span: 2,
    render: () =>
      temAtencao ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {d.conflitosAgendaCount > 0 && (
            <AttentionChip to="/agenda" icon={CalendarClock} count={d.conflitosAgendaCount} label="conflito(s) de horário na agenda" tone="danger" />
          )}
          {d.minhasTarefasAtrasadasCount > 0 && (
            <AttentionChip to="/projetos" icon={AlertTriangle} count={d.minhasTarefasAtrasadasCount} label="cartão(ões) seu(s) atrasado(s)" tone="danger" />
          )}
          {d.tarefasComigoAtrasadasCount > 0 && (
            <AttentionChip to="/tarefas" icon={ListTodo} count={d.tarefasComigoAtrasadasCount} label="pedido(s) atrasado(s) comigo" tone="danger" />
          )}
          {g && g.tarefasAtrasadasEquipeCount > 0 && (
            <AttentionChip to="/projetos" icon={CheckSquare} count={g.tarefasAtrasadasEquipeCount} label="tarefa(s) atrasada(s) na equipe" tone="warning" />
          )}
          {g && vencidasCount > 0 && (
            <AttentionChip to="/financeiro" icon={Wallet} count={vencidasCount} label={`conta(s) vencida(s) · ${formatBRL(vencidasTotal)}`} tone="warning" />
          )}
          {g && g.financeiro.aVencer7.count > 0 && (
            <AttentionChip to="/financeiro" icon={Clock} count={g.financeiro.aVencer7.count} label={`conta(s) a vencer (7 dias) · ${formatBRL(g.financeiro.aVencer7.total)}`} tone="warning" />
          )}
          {/* O número conta RASCUNHO + EM_REVISAO (`dashboard.service.ts`), e o rótulo dizia só
              "aguardando revisão": o Início mostrava 28, a pessoa clicava e a página Documentos
              dizia 10. Três telas sobre o mesmo assunto precisam contar a mesma coisa — ou dizer,
              cada uma, exatamente o que estão contando. */}
          {g && g.docsPendentesCount > 0 && (
            <AttentionChip to="/documentos" icon={FileText} count={g.docsPendentesCount} label="documento(s) em rascunho ou revisão" tone="info" />
          )}
          {g && g.docsAguardandoClienteCount > 0 && (
            <AttentionChip to="/documentos" icon={FileText} count={g.docsAguardandoClienteCount} label="documento(s) parado(s) aguardando o cliente" tone="warning" />
          )}
          {g && g.funil.parados > 0 && <AttentionChip to="/leads" icon={Filter} count={g.funil.parados} label="lead(s) parado(s) há +14 dias" tone="info" />}
          {g && g.projetos.parados > 0 && (
            <AttentionChip to="/projetos" icon={FolderKanban} count={g.projetos.parados} label="projeto(s) parado(s) há +14 dias" tone="warning" />
          )}
          {g && g.projetos.semResponsavel > 0 && (
            <AttentionChip to="/projetos" icon={FolderKanban} count={g.projetos.semResponsavel} label="projeto(s) sem responsável" tone="info" />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-medium">Tudo em dia por aqui.</div>
            <div className="text-xs text-muted-foreground">Nenhuma pendência urgente no momento.</div>
          </div>
        </div>
      ),
  });

  if (ia.data?.disponivel)
    defs.push({ id: "plano", titulo: "Seu dia com a IA", icon: Sparkles, grupo: "dia", span: 2, render: () => <PlanoDoDia /> });

  defs.push({
    id: "kpis",
    titulo: "Indicadores do dia",
    icon: TrendingUp,
    grupo: "dia",
    span: 2,
    render: () => (
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard to="/agenda" icon={Calendar} label="Compromissos hoje" value={d.eventosHoje.length} sub={compromissosSub} />
        <StatCard
          to="/projetos"
          icon={CheckSquare}
          label="Meus cartões"
          value={d.minhasTarefas}
          sub={
            d.minhasTarefasAtrasadasCount > 0
              ? `${d.minhasTarefasAtrasadasCount} atrasada(s)`
              : d.minhasTarefasHoje > 0
                ? `${d.minhasTarefasHoje} vencem hoje`
                : "nada vence hoje"
          }
        />
        {g ? (
          <>
            <StatCard to="/leads" icon={Filter} label="Leads no funil" value={g.funil.total} sub={formatEstimativaDoFunil(g.funil) || "sem valor estimado"} />
            <StatCard to="/projetos" icon={FolderKanban} label="Projetos ativos" value={g.projetos.ativos} sub={g.projetos.parados > 0 ? `${g.projetos.parados} parado(s)` : "em movimento"} />
          </>
        ) : (
          <>
            <StatCard to="/projetos" icon={AlertTriangle} label="Tarefas atrasadas" value={d.minhasTarefasAtrasadasCount} sub={d.minhasTarefasAtrasadasCount > 0 ? "priorize estas" : "nenhuma 🎉"} />
            <StatCard to="/projetos" icon={CheckCircle2} label="Concluídas (7 dias)" value={d.minhasTarefasConcluidas7} sub="nesta semana" />
          </>
        )}
      </div>
    ),
  });

  defs.push({
    id: "tarefas",
    titulo: "Meus cartões",
    icon: CheckSquare,
    grupo: "dia",
    span: 1,
    link: { to: "/projetos", label: "Ver tudo" },
    render: () =>
      d.minhasTarefasLista.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">Você está em dia. Nenhum cartão de projeto com você. 🎉</p>
      ) : (
        <div className="divide-y divide-border/60">
          {d.minhasTarefasLista.map((t) => {
            const atrasada = t.prazo && new Date(t.prazo) < hoje0;
            return (
              <Link
                key={t.id}
                to="/projetos/$projetoId"
                params={{ projetoId: t.projeto.id }}
                className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent/40"
              >
                <Badge variant={prioridadeVariant[t.prioridade]}>{PRIORIDADE_LABEL[t.prioridade]}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.titulo}</div>
                  <div className="truncate text-xs text-muted-foreground">{t.projeto.nome}</div>
                </div>
                {t.prazo && (
                  <span className={cn("shrink-0 text-xs font-medium tabular-nums", atrasada ? "text-destructive" : "text-muted-foreground")}>{dataUTC(t.prazo)}</span>
                )}
              </Link>
            );
          })}
        </div>
      ),
  });

  defs.push({
    id: "tarefas-comigo",
    titulo: "Pedidos comigo",
    icon: ListTodo,
    grupo: "dia",
    span: 1,
    link: { to: "/tarefas", label: "Ver tarefas" },
    render: () =>
      d.tarefasComigo.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum pedido para você agora. 🎉</p>
      ) : (
        <div className="divide-y divide-border/60">
          {d.tarefasComigo.map((t) => {
            const atrasada = t.prazo && new Date(t.prazo) < hoje0;
            return (
              <Link key={t.id} to="/tarefas" className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent/40">
                {t.prioridade === "ALTA" && <Badge variant="danger">{TAREFA_PRIORIDADE_LABEL.ALTA}</Badge>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.titulo}</div>
                  <div className="truncate text-xs text-muted-foreground">{t.cliente?.nome ?? t.projeto?.nome ?? "Tarefa interna"}</div>
                </div>
                {t.prazo && (
                  <span className={cn("shrink-0 text-xs font-medium tabular-nums", atrasada ? "text-destructive" : "text-muted-foreground")}>{dataUTC(t.prazo)}</span>
                )}
              </Link>
            );
          })}
        </div>
      ),
  });

  defs.push({
    id: "agenda",
    titulo: "Sua agenda",
    icon: Calendar,
    grupo: "dia",
    span: 1,
    link: { to: "/agenda", label: "Ver tudo" },
    render: () => (
      <div className="space-y-4 p-4">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Hoje</div>
          {d.eventosHoje.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum compromisso hoje.</p>
          ) : (
            <div className="space-y-1.5">
              {d.eventosHoje.map((ev) => (
                <div key={ev.occurrenceId} className="flex items-center gap-3 text-sm">
                  <span className="w-12 shrink-0 font-medium tabular-nums text-primary">{ev.diaInteiro ? "—" : hora(ev.inicio)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{ev.titulo}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {EVENTO_TIPO_LABEL[ev.tipo]}
                      {ev.cliente ? ` · ${ev.cliente.nome}` : ""}
                    </div>
                  </div>
                  {ev.linkReuniao && (
                    <a
                      href={ev.linkReuniao}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success/20"
                    >
                      <Video className="h-3.5 w-3.5" />
                      Entrar
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {d.proximosEventos.length > 0 && (
          <div className="border-t pt-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Próximos dias</div>
            <div className="space-y-1.5">
              {d.proximosEventos.map((ev) => (
                <div key={ev.occurrenceId} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {diaCurto(ev.inicio)}
                    {!ev.diaInteiro && ` · ${hora(ev.inicio)}`}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{ev.titulo}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    ),
  });

  if (g) {
    defs.push({
      id: "financeiro",
      titulo: "Financeiro",
      icon: Wallet,
      grupo: "gestao",
      span: 2,
      link: { to: "/financeiro", label: "Ver tudo" },
      render: () => (
        <div className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MoneyTile label="A receber (pendente)" valor={g.financeiro.aReceberPendente} tom="verde" />
            <MoneyTile label="A pagar (pendente)" valor={g.financeiro.aPagarPendente} tom="vermelho" />
            <MoneyTile label="Saldo previsto" valor={g.financeiro.saldoPrevisto} tom="neutro" />
            <MoneyTile label="Resultado do mês" valor={g.financeiro.resultadoMes} tom="neutro" />
          </div>
          <div className="flex flex-wrap gap-4 border-t pt-3 text-xs text-muted-foreground">
            {vencidasCount > 0 ? (
              <span className="text-destructive">
                <strong>{vencidasCount}</strong> conta(s) vencida(s) · {formatBRL(vencidasTotal)}
              </span>
            ) : (
              <span className="text-success">Nenhuma conta vencida</span>
            )}
            {g.financeiro.aVencer7.count > 0 && (
              <span>
                A pagar em 7 dias: <strong>{g.financeiro.aVencer7.count}</strong> · {formatBRL(g.financeiro.aVencer7.total)}
              </span>
            )}
          </div>
        </div>
      ),
    });

    defs.push({
      id: "funil",
      titulo: "Funil de vendas",
      icon: TrendingUp,
      grupo: "gestao",
      span: 1,
      link: { to: "/leads", label: "Ver funil" },
      render: () => (
        <div className="space-y-3 p-4">
          {g.funil.total === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum lead ativo no funil.</p>
          ) : (
            <div className="space-y-2">
              {g.funil.etapas.map((e) => (
                <BarRow key={e.nome} label={e.nome} value={e.count} max={Math.max(1, ...g.funil.etapas.map((x) => x.count))} sub={formatEstimativaDoFunil(e, { compacto: true }) || undefined} />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-4 border-t pt-3 text-xs text-muted-foreground">
            <span>Previsto: <strong>{formatEstimativaDoFunil(g.funil) || "—"}</strong></span>
            <span>Novos (7d): <strong>{g.funil.novos7}</strong></span>
            <span>Convertidos (30d): <strong className="text-success">{g.funil.convertidos30}</strong></span>
          </div>
        </div>
      ),
    });

    defs.push({
      id: "projetos",
      titulo: "Projetos",
      icon: FolderKanban,
      grupo: "gestao",
      span: 1,
      link: { to: "/projetos", label: "Ver tudo" },
      render: () => (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
          <MiniStat to="/projetos" label="Ativos" value={g.projetos.ativos} />
          <MiniStat to="/projetos" label="Aguardando cliente" value={g.projetos.aguardandoCliente} />
          <MiniStat to="/projetos" label="Pausados" value={g.projetos.pausados} />
          <MiniStat to="/projetos" label="Concluídos" value={g.projetos.concluidos} />
          <MiniStat to="/projetos" label="Parados (+14d)" value={g.projetos.parados} tone={g.projetos.parados > 0 ? "warning" : "neutro"} />
          <MiniStat to="/projetos" label="Sem responsável" value={g.projetos.semResponsavel} tone={g.projetos.semResponsavel > 0 ? "danger" : "neutro"} />
        </div>
      ),
    });

    defs.push({
      id: "equipe",
      titulo: "Carga da equipe",
      icon: Users,
      grupo: "gestao",
      span: 1,
      link: { to: "/projetos", label: "Ver projetos" },
      render: () =>
        g.equipe.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma tarefa aberta atribuída.</p>
        ) : (
          <div className="space-y-2.5 p-4">
            {g.equipe.map((m) => (
              <BarRow key={m.nome} label={m.nome} value={m.abertas} max={g.equipeMaxAbertas} valueLabel={`${m.abertas} aberta(s)`} danger={m.atrasadas} />
            ))}
          </div>
        ),
    });

    defs.push({
      id: "clientes",
      titulo: "Clientes",
      icon: Building2,
      grupo: "gestao",
      span: 1,
      link: { to: "/clientes", label: "Ver tudo" },
      render: () => (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <MiniStat to="/clientes" label="Total de clientes" value={g.clientes.total} />
          <MiniStat to="/clientes" label="Novos (30 dias)" value={g.clientes.novos30} />
          <MiniStat to="/clientes" label="Em prospecção" value={g.clientes.prospects} />
          <MiniStat to="/clientes" label="Querendo mais (upsell)" value={g.clientes.querendoMais} tone={g.clientes.querendoMais > 0 ? "warning" : "neutro"} />
        </div>
      ),
    });

    defs.push({
      id: "docs",
      titulo: "Documentos em rascunho ou revisão",
      icon: FileText,
      grupo: "gestao",
      span: 1,
      link: { to: "/documentos", label: "Ver tudo" },
      render: () =>
        g.docsPendentes.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum documento em rascunho ou revisão.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {g.docsPendentes.map((doc) => (
              <Link
                key={doc.id}
                to="/documentos/$documentoId"
                params={{ documentoId: doc.id }}
                className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent/40"
              >
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{doc.titulo}</div>
                  {doc.cliente && <div className="truncate text-xs text-muted-foreground">{doc.cliente.nome}</div>}
                </div>
                <Badge variant={docStatusVariant[doc.status]}>{STATUS_DOCUMENTO_LABEL[doc.status]}</Badge>
              </Link>
            ))}
          </div>
        ),
    });

    defs.push({
      id: "atividade",
      titulo: "Atividade recente",
      icon: Activity,
      grupo: "gestao",
      span: 1,
      render: () =>
        g.atividadeRecente.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Sem atividade recente.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {g.atividadeRecente.map((a) => {
              const { nome: ator, automatico: auto } = atorDaAtividade(a);
              return (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white", auto ? "bg-primary/80" : "bg-gradient-to-br from-brand-blueLight to-primary")}>
                    {auto ? <Sparkles className="h-3.5 w-3.5" /> : ator.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="font-medium">{ator}</span> <span className="text-muted-foreground">{acaoLabel(a.acao)}</span>
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {haQuanto(a.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        ),
    });
  }

  const visiveis = defs.filter((def) => !prefs.ocultos.includes(def.id));
  const doDia = visiveis.filter((w) => w.grupo === "dia");
  const daGestao = visiveis.filter((w) => w.grupo === "gestao");

  const renderWidget = (def: WidgetDef) => (
    <WidgetCard key={def.id} def={def} recolhido={prefs.recolhidos.includes(def.id)} onRecolher={() => prefs.recolher(def.id)}>
      {def.render()}
    </WidgetCard>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={`${saudacao}, ${primeiroNome} 👋`} subtitle={resumoDia}>
        <PersonalizarMenu defs={defs} ocultos={prefs.ocultos} onToggle={prefs.ocultar} onRestaurar={prefs.restaurar} personalizado={prefs.personalizado} />
      </PageHeader>

      {doDia.length > 0 && <div className="grid items-start gap-4 lg:grid-cols-2">{doDia.map(renderWidget)}</div>}

      {daGestao.length > 0 && (
        <>
          <div className="flex items-center gap-2 pt-2">
            <Building2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Gestão da empresa</h2>
            <span className="text-xs text-muted-foreground">· visão completa da MedConsultoria</span>
            <div className="ml-2 h-px flex-1 bg-border" />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">{daGestao.map(renderWidget)}</div>
        </>
      )}

      {visiveis.length === 0 && (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">Você ocultou tudo do Início.</p>
          <button onClick={prefs.restaurar} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <RotateCcw className="h-4 w-4" /> Restaurar o padrão
          </button>
        </div>
      )}
    </div>
  );
}

// ── ROOT: saúde do sistema (corpo do widget) ──────────────

const statusMeta = {
  ok: { label: "Tudo saudável", dot: "bg-success", text: "text-success" },
  degradado: { label: "Degradado", dot: "bg-warning", text: "text-warning" },
  critico: { label: "Crítico", dot: "bg-destructive", text: "text-destructive" },
} as const;

function SystemChip({ icon: Icon, label, value, alerta }: { icon: LucideIcon; label: string; value: string; alerta?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("h-4 w-4", alerta ? "text-destructive" : "text-muted-foreground")} />
      <div className="leading-tight">
        <div className={cn("text-sm font-semibold tabular-nums", alerta && "text-destructive")}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function SystemBody({ s }: { s: NonNullable<RouterOutputs["dashboard"]["resumo"]["sistema"]> }) {
  const meta = statusMeta[s.statusGeral as keyof typeof statusMeta] ?? statusMeta.ok;
  const jobsParados = (s.idadeLembreteMin ?? 99) > 5 || (s.idadeScanMin ?? 99) > 25;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", meta.dot)} />
          <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", meta.dot)} />
        </span>
        <div className="leading-tight">
          <div className={cn("text-sm font-semibold", meta.text)}>{meta.label}</div>
          <div className="text-[11px] text-muted-foreground">
            {s.ambiente} · Node {s.nodeVersao} · no ar há {uptimeFmt(s.uptimeSeg)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <SystemChip icon={Cpu} label="Event loop p99" value={`${s.loopP99}ms`} alerta={s.loopP99 >= 100} />
        <SystemChip icon={Activity} label="Memória (heap)" value={`${s.heapUsoPct}%`} alerta={s.heapUsoPct >= 85} />
        <SystemChip icon={Database} label="Banco" value={s.db.ok ? `${s.db.latenciaMs}ms` : "offline"} alerta={!s.db.ok || s.db.latenciaMs > 400} />
        <SystemChip icon={Bug} label="Erros abertos" value={String(s.errosAbertos)} alerta={s.errosAbertos > 0} />
        <SystemChip icon={Siren} label="Incidentes" value={String(s.incidentesAbertos)} alerta={s.incidentesAbertos > 0} />
        <SystemChip icon={Clock} label="Jobs" value={jobsParados ? "atrasados" : "ok"} alerta={jobsParados} />
        <SystemChip icon={Radio} label="Sessões / conexões" value={`${s.sessoesAtivas} / ${s.conexoesSocket}`} />
      </div>
    </div>
  );
}
