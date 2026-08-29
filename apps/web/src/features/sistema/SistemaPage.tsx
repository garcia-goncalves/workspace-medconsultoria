import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bug,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  Cpu,
  Database,
  Download,
  Gauge,
  GitBranch,
  HardDrive,
  HeartPulse,
  MonitorSmartphone,
  RefreshCw,
  RotateCcw,
  Server,
  Settings2,
  Sparkles,
  Siren,
  ShieldCheck,
  Timer,
  Trash2,
  TrendingUp,
  Wifi,
  History,
  EyeOff,
  Zap,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
import { dataHora, dataUTC, haQuanto } from "../../lib/format-date";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { PageHeader } from "../../components/ui/page-header";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { EmptyState } from "../../components/ui/empty-state";
import { DataTable } from "../../components/ui/data-table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { AssistenteIADialog } from "../../components/ui/assistente-ia";
import { toast } from "../../components/ui/toast";
import { AreaMini, BarraUso } from "./MiniChart";
import { AbaAuditoria } from "./AbaAuditoria";

type Aba =
  | "geral"
  | "incidentes"
  | "desempenho"
  | "banco"
  | "operacao"
  | "erros"
  | "sessoes"
  | "atividade"
  | "manutencao"
  | "auditoria"
  | "privacidade";
type Nivel = "ok" | "degradado" | "critico";

const ABAS: { id: Aba; label: string; icon: typeof Activity }[] = [
  { id: "geral", label: "Visão geral", icon: HeartPulse },
  { id: "incidentes", label: "Incidentes", icon: Siren },
  { id: "desempenho", label: "Desempenho", icon: Gauge },
  { id: "banco", label: "Banco", icon: Database },
  { id: "operacao", label: "Operação", icon: HardDrive },
  { id: "erros", label: "Erros", icon: Bug },
  { id: "sessoes", label: "Sessões", icon: MonitorSmartphone },
  { id: "atividade", label: "Atividade", icon: History },
  { id: "manutencao", label: "Manutenção", icon: Settings2 },
  { id: "auditoria", label: "Auditoria", icon: ClipboardCheck },
  { id: "privacidade", label: "Privacidade", icon: ShieldCheck },
];

export function SistemaPage() {
  const [aba, setAba] = useState<Aba>("geral");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sistema"
        subtitle="Painel técnico de operação — saúde, desempenho, erros e manutenção. Visível só para ROOT."
      >
        <BotaoDiagnosticoIA />
        <BotaoVarredura />
        <BotaoDiagnostico />
        <BotaoBaixarDiagnostico />
      </PageHeader>

      <HealthBanner />

      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList aria-label="Abas do painel Sistema">
          {ABAS.map((a) => (
            <TabsTrigger key={a.id} value={a.id}>
              <a.icon className="h-4 w-4" />
              {a.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="geral" className="pt-6">
          <AbaGeral />
        </TabsContent>
        <TabsContent value="incidentes" className="pt-6">
          <AbaIncidentes />
        </TabsContent>
        <TabsContent value="desempenho" className="pt-6">
          <AbaDesempenho />
        </TabsContent>
        <TabsContent value="banco" className="pt-6">
          <AbaBanco />
        </TabsContent>
        <TabsContent value="operacao" className="pt-6">
          <AbaOperacao />
        </TabsContent>
        <TabsContent value="erros" className="pt-6">
          <AbaErros />
        </TabsContent>
        <TabsContent value="sessoes" className="pt-6">
          <AbaSessoes />
        </TabsContent>
        <TabsContent value="atividade" className="pt-6">
          <AbaAtividade />
        </TabsContent>
        <TabsContent value="manutencao" className="pt-6">
          <AbaManutencao />
        </TabsContent>
        <TabsContent value="auditoria" className="pt-6">
          <AbaAuditoria />
        </TabsContent>
        <TabsContent value="privacidade" className="pt-6">
          <AbaPrivacidade />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ----------------------------- helpers ----------------------------- */

function formatUptime(seg: number): string {
  const d = Math.floor(seg / 86400);
  const h = Math.floor((seg % 86400) / 3600);
  const m = Math.floor((seg % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seg % 60}s`;
}

const NIVEL_INFO: Record<Nivel, { label: string; badge: "success" | "warning" | "danger"; dot: string }> = {
  ok: { label: "Operacional", badge: "success", dot: "bg-success" },
  degradado: { label: "Degradado", badge: "warning", dot: "bg-warning" },
  critico: { label: "Crítico", badge: "danger", dot: "bg-destructive" },
};

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tom = "default",
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  hint?: string;
  tom?: "default" | "ok" | "alerta";
}) {
  const cor = tom === "ok" ? "text-success" : tom === "alerta" ? "text-warning" : "text-primary";
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="rounded-lg bg-muted p-2">
          <Icon className={"h-5 w-5 " + cor} />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-0.5 truncate text-lg font-semibold">{value}</div>
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function GridSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Cartão de gráfico de série temporal. */
function GraficoCard({
  titulo,
  valor,
  unidade,
  dados,
  cor,
}: {
  titulo: string;
  valor: string | number;
  unidade?: string;
  dados: number[];
  cor?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</span>
          <span className="text-lg font-semibold">
            {valor}
            {unidade && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unidade}</span>}
          </span>
        </div>
        <AreaMini dados={dados} cor={cor} />
      </CardContent>
    </Card>
  );
}

/* ----------------------------- Health banner + diagnóstico ----------------------------- */

function HealthBanner() {
  const saude = trpc.sistema.saude.useQuery(undefined, { refetchInterval: 15_000 });
  // ⚠️ A ORDEM ERA O DEFEITO, e o ramo de erro era código morto.
  //
  // Com `saude.isError`, `saude.data` também é indefinido — então a linha do esqueleto disparava
  // primeiro e a de erro nunca era alcançada. Resultado: o painel que existe para avisar que
  // algo está errado ficava pulsando para sempre exatamente quando algo estava errado. E devolver
  // `null` também não servia: sumir é outra forma de mentir.
  if (saude.isError) {
    return <QueryError onRetry={() => void saude.refetch()} message="Não foi possível ler a saúde do servidor." />;
  }
  if (saude.isLoading || !saude.data) return <Skeleton className="h-20 w-full rounded-xl" />;
  const info = NIVEL_INFO[saude.data.statusGeral];

  return (
    <Card
      className={
        saude.data.statusGeral === "critico"
          ? "border-destructive/40"
          : saude.data.statusGeral === "degradado"
            ? "border-warning/40"
            : ""
      }
    >
      <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${info.dot}`} />
            <span className={`relative inline-flex h-3 w-3 rounded-full ${info.dot}`} />
          </span>
          <div>
            <div className="text-lg font-semibold">
              {saude.data.statusGeral === "ok" ? "Todos os sistemas operacionais" : `Sistema ${info.label.toLowerCase()}`}
            </div>
            <div className="text-xs text-muted-foreground">
              Uptime {formatUptime(saude.data.uptimeSeg)} · {saude.data.ambiente} · atualizado {haQuanto(new Date(saude.dataUpdatedAt))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {saude.data.componentes.map((c) => (
            <span
              key={c.nome}
              title={c.detalhe}
              className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs"
            >
              <span className={`h-2 w-2 rounded-full ${NIVEL_INFO[c.nivel as Nivel].dot}`} />
              {c.nome}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BotaoDiagnostico() {
  const utils = trpc.useUtils();
  const [copiado, setCopiado] = useState(false);
  const [carregando, setCarregando] = useState(false);

  async function copiar() {
    setCarregando(true);
    try {
      const d = await utils.sistema.diagnostico.fetch();
      await navigator.clipboard.writeText(JSON.stringify(d, null, 2));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Alguns navegadores bloqueiam a área de transferência (sem gesto/contexto seguro).
      toast('Não consegui copiar. Use "Baixar diagnóstico" para exportar o arquivo.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Button variant="outline" onClick={copiar} disabled={carregando}>
      {copiado ? <ClipboardCheck className="h-4 w-4 text-success" /> : <Clipboard className="h-4 w-4" />}
      {copiado ? "Copiado!" : "Copiar diagnóstico"}
    </Button>
  );
}

/** Baixa o diagnóstico completo do sistema como um JSON — confiável mesmo sem clipboard; ideal para anexar a um chamado. */
function BotaoBaixarDiagnostico() {
  const utils = trpc.useUtils();
  const [baixando, setBaixando] = useState(false);

  async function baixar() {
    setBaixando(true);
    try {
      const d = await utils.sistema.diagnostico.fetch();
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sistema-diagnostico-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast("Não consegui gerar o arquivo de diagnóstico.");
    } finally {
      setBaixando(false);
    }
  }

  return (
    <Button variant="outline" onClick={baixar} disabled={baixando}>
      <Download className="h-4 w-4" />
      Baixar diagnóstico
    </Button>
  );
}

/** Botão genérico que abre a análise da IA (roda `run` ao abrir). */
function BotaoIA({
  label,
  title,
  run,
  variant = "outline",
  size,
  iconOnly,
}: {
  label?: string;
  title: string;
  run: () => Promise<string>;
  variant?: "outline" | "ghost";
  size?: "sm";
  iconOnly?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setAberto(true)}
        title={title}
        aria-label={iconOnly ? title : undefined}
      >
        <Sparkles className="h-4 w-4 text-primary" />
        {!iconOnly && (label ?? "IA")}
      </Button>
      {aberto && <AssistenteIADialog title={title} onClose={() => setAberto(false)} run={run} />}
    </>
  );
}

/** Diagnóstico geral do sistema com IA (só aparece se a IA estiver configurada). */
function BotaoDiagnosticoIA() {
  const iaOk = trpc.ia.disponivel.useQuery();
  const diag = trpc.ia.diagnosticoSistema.useMutation();
  if (!iaOk.data?.disponivel) return null;
  return <BotaoIA label="Diagnóstico com IA" title="Diagnóstico do sistema com IA" run={() => diag.mutateAsync()} />;
}

/** Dispara a varredura proativa sob demanda. */
function BotaoVarredura() {
  const utils = trpc.useUtils();
  const varrer = trpc.sistema.rodarVarredura.useMutation({
    onSuccess: () => {
      void utils.sistema.atencao.invalidate();
      void utils.sistema.incidentes.invalidate();
    },
  });
  return (
    <Button variant="outline" onClick={() => varrer.mutate()} disabled={varrer.isPending} title="Rodar a varredura proativa agora">
      <RefreshCw className={"h-4 w-4" + (varrer.isPending ? " animate-spin" : "")} />
      Rodar varredura
    </Button>
  );
}

/* ----------------------------- Visão geral ----------------------------- */

function AbaGeral() {
  const saude = trpc.sistema.saude.useQuery(undefined, { refetchInterval: 15_000 });
  const atencao = trpc.sistema.atencao.useQuery(undefined, { refetchInterval: 30_000 });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Saúde do servidor</h2>
          <Button variant="ghost" size="sm" onClick={() => saude.refetch()}>
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </Button>
        </div>
        {saude.isError ? (
          <QueryError onRetry={() => saude.refetch()} />
        ) : saude.isLoading || !saude.data ? (
          <GridSkeleton />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Database}
              label="Banco de dados"
              value={saude.data.db.ok ? "Online" : "Falha"}
              hint={`latência ${saude.data.db.latenciaMs}ms`}
              tom={saude.data.db.ok ? "ok" : "alerta"}
            />
            <StatCard
              icon={Server}
              label="Uptime"
              value={formatUptime(saude.data.uptimeSeg)}
              hint={`ambiente ${saude.data.ambiente}`}
            />
            <StatCard
              icon={Cpu}
              label="Memória (heap)"
              value={`${saude.data.memoria.heapUsadoMB} MB`}
              hint={`${saude.data.memoria.heapUsoPct}% do limite · RSS ${saude.data.memoria.rssMB} MB`}
              tom={saude.data.memoria.heapUsoPct >= 85 ? "alerta" : "default"}
            />
            <StatCard
              icon={Zap}
              label="Event loop p99"
              value={`${saude.data.memoria.loopP99} ms`}
              hint={`CPU ${saude.data.memoria.cpuPct}% · GC ${saude.data.memoria.gcMs}ms`}
              tom={saude.data.memoria.loopP99 >= 100 ? "alerta" : "ok"}
            />
            <StatCard
              icon={TrendingUp}
              label="Tráfego (1min)"
              value={`${saude.data.trafego.reqUltimoMin} req`}
              hint={`${saude.data.trafego.taxaErroUltimoMin}% de erro`}
              tom={saude.data.trafego.taxaErroUltimoMin >= 5 ? "alerta" : "ok"}
            />
            <StatCard
              icon={Wifi}
              label="Conexões ao vivo"
              value={saude.data.conexoesSocket}
              hint="Socket.IO agora"
              tom="ok"
            />
            <StatCard
              icon={Sparkles}
              label="IA"
              value={saude.data.iaAtiva ? "Ativa" : "Desligada"}
              hint={saude.data.iaAtiva ? "OpenAI configurada" : "sem OPENAI_API_KEY"}
              tom={saude.data.iaAtiva ? "ok" : "default"}
            />
            <StatCard
              icon={HeartPulse}
              label="Jobs"
              value={haQuanto(saude.data.jobs.ultimoScanEm)}
              hint={`lembrete ${haQuanto(saude.data.jobs.ultimoLembreteEm)}`}
            />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Precisa de atenção</h2>
        {atencao.isError ? (
          <QueryError onRetry={() => atencao.refetch()} />
        ) : atencao.isLoading || !atencao.data ? (
          <GridSkeleton />
        ) : (
          <AtencaoGrid dados={atencao.data} />
        )}
      </section>
    </div>
  );
}

function AtencaoGrid({ dados }: { dados: Record<string, number> }) {
  const itens: { chave: string; label: string; critico?: boolean }[] = [
    { chave: "errosAbertos", label: "Erros não resolvidos", critico: true },
    { chave: "contasVencidas", label: "Contas vencidas", critico: true },
    { chave: "docsRevisao", label: "Documentos em revisão" },
    { chave: "projetosSemResp", label: "Projetos sem responsável" },
    { chave: "clientesSemResp", label: "Clientes sem responsável" },
    { chave: "leadsParados", label: "Leads parados (14d+)" },
    { chave: "usuariosInativos", label: "Usuários inativos" },
    { chave: "sessoesExpiradas", label: "Sessões expiradas (lixo)" },
  ];
  const tudoZerado = itens.every((i) => (dados[i.chave] ?? 0) === 0);
  if (tudoZerado) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-5 text-success">
          <CheckCircle2 className="h-5 w-5" />
          <span className="text-sm font-medium">Tudo em ordem — nada pedindo atenção agora.</span>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {itens.map((i) => {
        const n = dados[i.chave] ?? 0;
        const alerta = n > 0;
        return (
          <Card key={i.chave} className={alerta && i.critico ? "border-destructive/40" : ""}>
            <CardContent className="flex items-center gap-3 p-4">
              <div
                className={
                  "rounded-lg p-2 " +
                  (alerta ? (i.critico ? "bg-destructive/10" : "bg-warning/10") : "bg-muted")
                }
              >
                {alerta ? (
                  <AlertTriangle className={"h-5 w-5 " + (i.critico ? "text-destructive" : "text-warning")} />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                )}
              </div>
              <div>
                <div className="text-2xl font-semibold">{n}</div>
                <div className="text-xs text-muted-foreground">{i.label}</div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ----------------------------- Incidentes ----------------------------- */

function duracao(inicio: string | Date, fim?: string | Date | null): string {
  const ms = (fim ? new Date(fim).getTime() : Date.now()) - new Date(inicio).getTime();
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}min`;
}

function AbaIncidentes() {
  const incidentes = trpc.sistema.incidentes.useQuery(undefined, { refetchInterval: 30_000 });
  const uptime = trpc.sistema.historicoUptime.useQuery();
  const utils = trpc.useUtils();
  const invalidar = () => {
    void utils.sistema.incidentes.invalidate();
    void utils.sistema.historicoUptime.invalidate();
    void utils.sistema.saude.invalidate();
  };
  const reconhecer = trpc.sistema.reconhecerIncidente.useMutation({ onSuccess: invalidar });
  const resolver = trpc.sistema.resolverIncidente.useMutation({ onSuccess: invalidar });
  const resolverTodos = trpc.sistema.resolverTodosIncidentes.useMutation({ onSuccess: invalidar });
  const iaOk = trpc.ia.disponivel.useQuery();
  const explicar = trpc.ia.explicarIncidente.useMutation();
  const abertos = (incidentes.data ?? []).filter((i) => i.status !== "RESOLVIDO").length;

  return (
    <div className="space-y-6">
      {/* Grade de uptime 90 dias */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            Uptime — últimos 90 dias
          </h2>
          {uptime.data && <span className="text-sm font-semibold">{uptime.data.uptimePct}%</span>}
        </div>
        <Card>
          <CardContent className="p-4">
            {uptime.isLoading || !uptime.data ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <div className="flex items-end gap-[3px]">
                {uptime.data.dias.map((d) => (
                  <span
                    key={d.dia}
                    title={`${dataUTC(d.dia)} — ${NIVEL_INFO[d.nivel as Nivel].label}`}
                    className={
                      "h-8 flex-1 rounded-sm " +
                      (d.nivel === "critico"
                        ? "bg-destructive"
                        : d.nivel === "degradado"
                          ? "bg-warning"
                          : "bg-success/70")
                    }
                  />
                ))}
              </div>
            )}
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>90 dias atrás</span>
              <span>hoje</span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Lista de incidentes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Incidentes</h2>
          {abertos > 0 && (
            <Button variant="outline" size="sm" disabled={resolverTodos.isPending} onClick={() => resolverTodos.mutate()}>
              <CheckCircle2 className="h-4 w-4" />
              Resolver todos
            </Button>
          )}
        </div>
        {incidentes.isError ? (
          <QueryError onRetry={() => incidentes.refetch()} />
        ) : incidentes.isLoading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : !incidentes.data || incidentes.data.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nenhum incidente"
            description="O motor de alertas abre um incidente aqui quando um sinal cruza o limiar (event loop, memória, erros, banco, jobs)."
          />
        ) : (
          <div className="space-y-3">
            {incidentes.data.map((i) => {
              const aberto = i.status !== "RESOLVIDO";
              return (
                <Card
                  key={i.id}
                  className={
                    !aberto
                      ? "opacity-70"
                      : i.severidade === "critico"
                        ? "border-destructive/40"
                        : "border-warning/40"
                  }
                >
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={i.severidade === "critico" ? "danger" : "warning"}>
                          {i.severidade === "critico" ? "Crítico" : "Degradado"}
                        </Badge>
                        <Badge variant={aberto ? "default" : "success"}>
                          {i.status === "ABERTO" ? "Aberto" : i.status === "RECONHECIDO" ? "Reconhecido" : "Resolvido"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{i.componente}</span>
                      </div>
                      <p className="text-sm font-medium">{i.titulo}</p>
                      <p className="text-xs text-muted-foreground">{i.detalhe}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.status === "RESOLVIDO"
                          ? `Durou ${duracao(i.createdAt, i.resolvidoEm)} · resolvido ${haQuanto(i.resolvidoEm)}`
                          : `Aberto há ${duracao(i.createdAt)} · ${haQuanto(i.createdAt)}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {iaOk.data?.disponivel && (
                        <BotaoIA title="Incidente — análise da IA" run={() => explicar.mutateAsync({ id: i.id })} size="sm" variant="ghost" iconOnly />
                      )}
                      {aberto && i.status === "ABERTO" && (
                        <Button variant="ghost" size="sm" disabled={reconhecer.isPending} onClick={() => reconhecer.mutate({ id: i.id })}>
                          Reconhecer
                        </Button>
                      )}
                      {aberto && (
                        <Button variant="outline" size="sm" disabled={resolver.isPending} onClick={() => resolver.mutate({ id: i.id })}>
                          <CheckCircle2 className="h-4 w-4" />
                          Resolver
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* ----------------------------- Desempenho ----------------------------- */

function AbaDesempenho() {
  const d = trpc.sistema.desempenho.useQuery(undefined, { refetchInterval: 10_000 });
  if (d.isError) return <QueryError onRetry={() => d.refetch()} />;
  if (d.isLoading || !d.data) return <GridSkeleton n={4} />;

  const serie = d.data.serie;
  const ultima = serie[serie.length - 1];
  const taxaErroSerie = serie.map((s) => (s.req ? Math.round((s.err / s.req) * 100) : 0));

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Janela ao vivo dos últimos ~10 minutos (amostra a cada 10s). RED = Requisições / Erros / Duração.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <GraficoCard
          titulo="Requisições"
          valor={ultima?.req ?? 0}
          unidade="/10s"
          dados={serie.map((s) => s.req)}
          cor="text-brand-blueLight"
        />
        <GraficoCard
          titulo="Taxa de erro"
          valor={taxaErroSerie[taxaErroSerie.length - 1] ?? 0}
          unidade="%"
          dados={taxaErroSerie}
          cor="text-destructive"
        />
        <GraficoCard
          titulo="Event loop p99"
          valor={ultima?.loopP99 ?? 0}
          unidade="ms"
          dados={serie.map((s) => s.loopP99)}
          cor="text-warning"
        />
        <GraficoCard
          titulo="CPU do processo"
          valor={ultima?.cpuPct ?? 0}
          unidade="%"
          dados={serie.map((s) => s.cpuPct)}
          cor="text-primary"
        />
        <GraficoCard
          titulo="Memória (heap)"
          valor={ultima?.heapMB ?? 0}
          unidade="MB"
          dados={serie.map((s) => s.heapMB)}
          cor="text-success"
        />
        <GraficoCard
          titulo="Utilização do loop"
          valor={Math.round((ultima?.elu ?? 0) * 100)}
          unidade="%"
          dados={serie.map((s) => Math.round(s.elu * 100))}
          cor="text-brand-blueLight"
        />
        <GraficoCard
          titulo="RSS (processo)"
          valor={ultima?.rssMB ?? 0}
          unidade="MB"
          dados={serie.map((s) => s.rssMB)}
          cor="text-muted-foreground"
        />
        <GraficoCard
          titulo="Pausas de GC major"
          valor={ultima?.gcMs ?? 0}
          unidade="ms"
          dados={serie.map((s) => s.gcMs)}
          cor="text-warning"
        />
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Timer className="h-4 w-4" />
          Endpoints mais lentos (p95)
        </h2>
        <DataTable
          dados={d.data.maisLentos}
          chaveLinha={(e) => e.path}
          vazio={
            <Card>
              <CardContent className="p-5 text-sm text-muted-foreground">
                Ainda sem chamadas registradas nesta execução.
              </CardContent>
            </Card>
          }
          colunas={[
            {
              chave: "path",
              cabecalho: "Endpoint",
              principal: true,
              render: (e) => <span className="font-mono text-xs">{e.path}</span>,
              valorOrdenacao: (e) => e.path,
            },
            {
              chave: "count",
              cabecalho: "Chamadas",
              alinhamento: "direita",
              render: (e) => e.count,
              valorOrdenacao: (e) => e.count,
            },
            {
              chave: "mediaMs",
              cabecalho: "Média",
              alinhamento: "direita",
              ocultaEmCelular: true,
              render: (e) => `${e.mediaMs}ms`,
              valorOrdenacao: (e) => e.mediaMs,
            },
            {
              chave: "p95Ms",
              cabecalho: "p95",
              alinhamento: "direita",
              render: (e) => <span className="font-medium">{e.p95Ms}ms</span>,
              valorOrdenacao: (e) => e.p95Ms,
            },
            {
              chave: "maxMs",
              cabecalho: "Máx",
              alinhamento: "direita",
              ocultaEmCelular: true,
              render: (e) => <span className="text-muted-foreground">{e.maxMs}ms</span>,
              valorOrdenacao: (e) => e.maxMs,
            },
            {
              chave: "erros",
              cabecalho: "Erros",
              alinhamento: "direita",
              render: (e) =>
                e.errors > 0 ? (
                  <Badge variant="danger">{e.taxaErro}%</Badge>
                ) : (
                  <span className="text-muted-foreground">0</span>
                ),
              valorOrdenacao: (e) => e.errors,
            },
          ]}
        />
      </section>

      {d.data.queriesLentas.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Database className="h-4 w-4" />
            Queries lentas (&gt; 300ms)
          </h2>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {d.data.queriesLentas.slice(0, 20).map((q, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <code className="text-xs">{q.op}</code>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      <Badge variant="warning">{q.ms}ms</Badge>
                      {haQuanto(new Date(q.ts))}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

/* ----------------------------- Banco ----------------------------- */

function AbaBanco() {
  const b = trpc.sistema.banco.useQuery(undefined, { refetchInterval: 30_000 });
  if (b.isError) return <QueryError onRetry={() => b.refetch()} />;
  if (b.isLoading || !b.data) return <GridSkeleton n={4} />;
  const d = b.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Database}
          label="Conexão"
          value={d.ok ? "Online" : "Falha"}
          hint={`latência ${d.latenciaMs}ms`}
          tom={d.ok ? "ok" : "alerta"}
        />
        <StatCard
          icon={Server}
          label="Uptime do MySQL"
          value={d.uptimeSeg != null ? formatUptime(d.uptimeSeg) : "—"}
          hint={d.uptimeSeg == null ? "sem permissão" : "desde o último restart"}
        />
        <StatCard
          icon={HardDrive}
          label="Tamanho do banco"
          value={`${d.totalMB} MB`}
          hint={`${d.tabelas.length} tabela(s)`}
        />
        <StatCard
          icon={Activity}
          label="Threads ativas"
          value={d.threadsRodando != null ? d.threadsRodando : "—"}
          hint={d.threadsConectadas != null ? `${d.threadsConectadas} conectada(s)` : "sem permissão"}
        />
      </div>

      {d.usoConexoesPct != null && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <BarraUso
              pct={d.usoConexoesPct}
              label={`Uso de conexões (${d.threadsConectadas}/${d.maxConnections} · pico ${d.picoConexoes ?? "?"})`}
            />
          </CardContent>
        </Card>
      )}

      {d.tabelasSemIndice.length > 0 && (
        <Card className="border-warning/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <div className="text-sm">
              <div className="font-medium">Tabelas grandes sem índice</div>
              <div className="text-xs text-muted-foreground">
                Podem deixar consultas lentas: {d.tabelasSemIndice.join(", ")}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Tabelas por tamanho</h2>
        <DataTable
          dados={d.tabelas}
          chaveLinha={(t) => t.nome}
          vazio={
            <Card>
              <CardContent className="p-5 text-sm text-muted-foreground">
                Não foi possível ler as informações do banco (permissão negada no servidor).
              </CardContent>
            </Card>
          }
          colunas={[
            {
              chave: "nome",
              cabecalho: "Tabela",
              principal: true,
              render: (t) => <span className="font-mono text-xs">{t.nome}</span>,
              valorOrdenacao: (t) => t.nome,
            },
            {
              chave: "linhas",
              cabecalho: "Linhas (aprox.)",
              alinhamento: "direita",
              render: (t) => t.linhas.toLocaleString("pt-BR"),
              valorOrdenacao: (t) => t.linhas,
            },
            {
              chave: "dadosMB",
              cabecalho: "Dados",
              alinhamento: "direita",
              ocultaEmCelular: true,
              render: (t) => <span className="text-muted-foreground">{t.dadosMB} MB</span>,
              valorOrdenacao: (t) => t.dadosMB,
            },
            {
              chave: "indiceMB",
              cabecalho: "Índices",
              alinhamento: "direita",
              ocultaEmCelular: true,
              render: (t) => <span className="text-muted-foreground">{t.indiceMB} MB</span>,
              valorOrdenacao: (t) => t.indiceMB,
            },
            {
              chave: "totalMB",
              cabecalho: "Total",
              alinhamento: "direita",
              render: (t) => <span className="font-medium">{t.totalMB} MB</span>,
              valorOrdenacao: (t) => t.totalMB,
            },
          ]}
        />
      </section>
    </div>
  );
}

/* ----------------------------- Erros (agrupados por fingerprint) ----------------------------- */

function AbaErros() {
  const [verOcultos, setVerOcultos] = useState(false);
  const erros = trpc.sistema.erros.useQuery({ ocultos: verOcultos }, { refetchInterval: 30_000 });
  const utils = trpc.useUtils();
  const invalidarErros = () => {
    void utils.sistema.erros.invalidate();
    void utils.sistema.atencao.invalidate();
  };
  const resolver = trpc.sistema.resolverErro.useMutation({ onSuccess: invalidarErros });
  const ignorar = trpc.sistema.ignorarErro.useMutation({ onSuccess: invalidarErros });
  const reexibir = trpc.sistema.reexibirErro.useMutation({ onSuccess: invalidarErros });
  const resolverTodos = trpc.sistema.resolverTodosErros.useMutation({ onSuccess: invalidarErros });
  const iaOk = trpc.ia.disponivel.useQuery();
  const explicar = trpc.ia.explicarErro.useMutation();

  const chip = (ativo: boolean) =>
    "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
    (ativo ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent");
  const abertos = (erros.data ?? []).filter((e) => !e.resolvido).length;

  return (
    <div className="space-y-3">
      {/* Alternador Ativos ↔ Ocultos (achar/restaurar erros silenciados) */}
      <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-2 text-sm">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setVerOcultos(false)} className={chip(!verOcultos)}>
            Ativos
          </button>
          <button onClick={() => setVerOcultos(true)} className={chip(verOcultos)}>
            <EyeOff className="mr-1 inline h-3 w-3" />
            Ocultos
          </button>
          {!verOcultos && abertos > 0 && <span className="ml-2 text-muted-foreground">{abertos} aberto(s)</span>}
        </div>
        {!verOcultos && abertos > 0 && (
          <Button variant="outline" size="sm" disabled={resolverTodos.isPending} onClick={() => resolverTodos.mutate()}>
            <CheckCircle2 className="h-4 w-4" />
            Resolver todos
          </Button>
        )}
      </div>

      {erros.isError ? (
        <QueryError onRetry={() => erros.refetch()} />
      ) : erros.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !erros.data || erros.data.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={verOcultos ? "Nenhum erro oculto" : "Nenhum erro registrado"}
          description={verOcultos ? "Erros que você ocultar aparecem aqui — e podem ser reexibidos a qualquer momento." : "Erros internos do servidor (500) são agrupados aqui automaticamente, com contagem de ocorrências."}
        />
      ) : (
        erros.data.map((e) => (
        <Card key={e.id} className={e.resolvido ? "opacity-60" : e.regrediu ? "border-warning/50" : "border-destructive/30"}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {e.resolvido ? (
                    <Badge variant="success">Resolvido</Badge>
                  ) : e.regrediu ? (
                    <Badge variant="warning">
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Regressão
                    </Badge>
                  ) : (
                    <Badge variant="danger">Aberto</Badge>
                  )}
                  <Badge variant="default">{e.ocorrencias}× ocorrência(s)</Badge>
                  {e.rota && <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.rota}</code>}
                </div>
                <p className="break-words text-sm font-medium">{e.mensagem}</p>
                <div className="text-xs text-muted-foreground">
                  Primeira vez {haQuanto(e.createdAt)} · última {haQuanto(e.ultimaVez)}
                </div>
                {e.stack && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none hover:text-foreground">Ver stack trace</summary>
                    <pre className="mt-1 max-h-56 overflow-auto rounded bg-muted p-2 text-xs leading-relaxed">
                      {e.stack}
                    </pre>
                  </details>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {iaOk.data?.disponivel && (
                  <BotaoIA title="Erro — análise da IA" run={() => explicar.mutateAsync({ id: e.id })} size="sm" variant="ghost" iconOnly />
                )}
                {verOcultos ? (
                  <Button variant="outline" size="sm" disabled={reexibir.isPending} onClick={() => reexibir.mutate({ id: e.id })}>
                    <RotateCcw className="h-4 w-4" />
                    Reexibir
                  </Button>
                ) : (
                  !e.resolvido && (
                    <>
                      <Button variant="outline" size="sm" disabled={resolver.isPending} onClick={() => resolver.mutate({ id: e.id })}>
                        <CheckCircle2 className="h-4 w-4" />
                        Resolver
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        title="Ocultar (fica em 'Ocultos', reversível)"
                        aria-label="Ocultar erro (fica em 'Ocultos', reversível)"
                        disabled={ignorar.isPending}
                        onClick={() => ignorar.mutate({ id: e.id })}
                      >
                        <EyeOff className="h-4 w-4" />
                      </Button>
                    </>
                  )
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        ))
      )}
    </div>
  );
}

/* ----------------------------- Sessões ----------------------------- */

function AbaSessoes() {
  const sessoes = trpc.sistema.sessoes.useQuery();
  const utils = trpc.useUtils();
  const revogar = trpc.sistema.revogarSessao.useMutation({
    onSuccess: () => {
      void utils.sistema.sessoes.invalidate();
      void utils.sistema.metricas.invalidate();
    },
  });

  if (sessoes.isError) return <QueryError onRetry={() => sessoes.refetch()} />;
  if (sessoes.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!sessoes.data || sessoes.data.length === 0) {
    return (
      <EmptyState
        icon={MonitorSmartphone}
        title="Nenhuma sessão ativa"
        description="Sessões de usuários logados aparecem aqui, com opção de revogar acesso."
      />
    );
  }

  return (
    <DataTable
      dados={sessoes.data}
      chaveLinha={(s) => s.id}
      acoes={(s) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10"
          disabled={revogar.isPending}
          onClick={() => revogar.mutate({ id: s.id })}
        >
          <Trash2 className="h-4 w-4" />
          Revogar
        </Button>
      )}
      colunas={[
        {
          chave: "usuario",
          cabecalho: "Usuário",
          principal: true,
          render: (s) => (
            <>
              <span className="font-medium">{s.user.nome}</span>
              <div className="text-xs text-muted-foreground">{s.user.email}</div>
            </>
          ),
          valorOrdenacao: (s) => s.user.nome,
        },
        {
          chave: "papel",
          cabecalho: "Papel",
          render: (s) => <Badge variant={s.user.role === "ROOT" ? "danger" : "default"}>{s.user.role}</Badge>,
          valorOrdenacao: (s) => s.user.role,
        },
        {
          chave: "dispositivo",
          cabecalho: "Dispositivo",
          ocultaEmCelular: true,
          render: (s) => <span className="block max-w-[220px] truncate text-xs text-muted-foreground">{s.userAgent ?? "—"}</span>,
        },
        {
          chave: "ip",
          cabecalho: "IP",
          ocultaEmCelular: true,
          render: (s) => <span className="text-xs">{s.ip ?? "—"}</span>,
        },
        {
          chave: "inicio",
          cabecalho: "Início",
          render: (s) => <span className="text-xs text-muted-foreground">{haQuanto(s.createdAt)}</span>,
          valorOrdenacao: (s) => new Date(s.createdAt),
        },
        {
          chave: "expira",
          cabecalho: "Expira",
          ocultaEmCelular: true,
          render: (s) => <span className="text-xs text-muted-foreground">{dataHora(s.expiresAt)}</span>,
          valorOrdenacao: (s) => new Date(s.expiresAt),
        },
      ]}
    />
  );
}

/* ----------------------------- Atividade ----------------------------- */

function AbaAtividade() {
  const atividade = trpc.sistema.atividade.useQuery();
  if (atividade.isError) return <QueryError onRetry={() => atividade.refetch()} />;
  if (atividade.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!atividade.data || atividade.data.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Sem atividade registrada"
        description="As ações da equipe (auditoria/LGPD) aparecem aqui."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y">
          {atividade.data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Activity className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1">
                <span className="font-medium">{a.user?.nome ?? "Sistema"}</span>{" "}
                <span className="text-muted-foreground">{a.acao}</span>
                {a.entidadeTipo && <span className="text-muted-foreground"> · {a.entidadeTipo}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{haQuanto(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}


/* ----------------------------- Privacidade (LGPD — ADR-141) ----------------------------- */

/**
 * PRIVACIDADE — onde o direito de eliminação vira uma ação que alguém consegue executar.
 *
 * ⚠️ A LISTA É DE ARQUIVADOS, e não é uma escolha estética: toda tela de cliente filtra
 * `deletedAt: null`, então depois de arquivado o cliente some da aplicação inteira. Sem
 * esta tela, um pedido de eliminação não teria por onde ser atendido.
 *
 * ⚠️ ANONIMIZAR É IRREVERSÍVEL e não pede confirmação de brincadeira: a frase diz o que
 * SAI e o que FICA, porque quem clica precisa saber que o contrato assinado continua com o
 * nome dentro — é o dever de guarda, não uma falha.
 */
function AbaPrivacidade() {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const lista = trpc.sistema.clientesArquivados.useQuery();
  const expurgo = trpc.sistema.expurgarAgora.useMutation();
  const anonimizar = trpc.clientes.anonimizar.useMutation({
    onSuccess: () => void utils.sistema.clientesArquivados.invalidate(),
  });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Trash2 className="h-4 w-4" /> Prazo de guarda
        </h2>
        <div className="rounded-xl border p-4 text-sm">
          <p className="text-muted-foreground">
            O texto dos e-mails enviados e a pilha dos erros são apagados sozinhos todo dia,
            depois do prazo definido em <strong>Ajustes → Dados da empresa</strong>. Este botão
            só antecipa a passada de hoje — não muda prazo nenhum.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" disabled={expurgo.isPending} onClick={() => expurgo.mutate()}>
              Rodar o expurgo agora
            </Button>
            {expurgo.data && (
              <span className="text-xs text-muted-foreground">
                Prazo de {expurgo.data.dias} dias · {expurgo.data.emails} e-mails e {expurgo.data.erros} erros limpos nesta passada.
              </span>
            )}
            {expurgo.error && <span className="text-xs text-destructive">{expurgo.error.message}</span>}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <ShieldCheck className="h-4 w-4" /> Pedido de eliminação (clientes arquivados)
        </h2>
        {lista.isLoading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : lista.error ? (
          <QueryError message={lista.error.message} onRetry={() => lista.refetch()} />
        ) : !lista.data?.clientes.length ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nenhum cliente arquivado"
            description="A eliminação só é possível depois de arquivar o cliente. Enquanto ele está ativo, anonimizar apagaria o registro dos médicos no meio de credenciamentos em andamento."
          />
        ) : (
          <DataTable
            dados={lista.data.clientes}
            chaveLinha={(c) => c.id}
            colunas={[
              {
                chave: "cliente",
                cabecalho: "Cliente",
                principal: true,
                render: (c) => (
                  <>
                    <div className="font-medium">{c.nome}</div>
                    {c.cnpj && <div className="text-xs text-muted-foreground">{c.cnpj}</div>}
                  </>
                ),
                valorOrdenacao: (c) => c.nome,
              },
              {
                chave: "arquivadoEm",
                cabecalho: "Arquivado em",
                ocultaEmCelular: true,
                render: (c) => <span className="text-muted-foreground">{c.arquivadoEm ? dataHora(c.arquivadoEm) : "—"}</span>,
                valorOrdenacao: (c) => (c.arquivadoEm ? new Date(c.arquivadoEm) : null),
              },
              {
                chave: "pessoas",
                cabecalho: "Pessoas no cadastro",
                ocultaEmCelular: true,
                render: (c) => <span className="text-muted-foreground">{c.pessoas}</span>,
                valorOrdenacao: (c) => c.pessoas,
              },
              {
                chave: "acervo",
                cabecalho: "Acervo",
                render: (c) =>
                  c.acervoVencido ? (
                    <span className="text-xs font-medium text-warning">
                      {c.arquivos} arquivos · passou dos {lista.data!.anos} anos
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{c.arquivos} arquivos</span>
                  ),
              },
              {
                chave: "situacao",
                cabecalho: "Situação",
                render: (c) =>
                  c.anonimizadoEm ? (
                    <span className="text-xs text-muted-foreground">
                      Anonimizado em {dataHora(c.anonimizadoEm)}
                      {c.anonimizadoPor ? ` por ${c.anonimizadoPor}` : ""}
                    </span>
                  ) : (
                    <span className="text-xs">Dados pessoais presentes</span>
                  ),
              },
            ]}
            acoes={(c) =>
              !c.anonimizadoEm && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={anonimizar.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: "Anonimizar a pedido do titular",
                        description:
                          `SAI para sempre: nome, CNPJ, e-mail, telefone e observações de "${c.nome}", ` +
                          "os dados dos contatos e dos médicos, e o acesso ao Portal (as sessões abertas caem). " +
                          "FICA, por obrigação legal de guarda: os contratos e propostas já emitidos, que " +
                          "continuam com o nome dentro, as contas do financeiro e o registro de auditoria. " +
                          "Não há como desfazer.",
                        confirmText: "Anonimizar",
                        variant: "destructive",
                      })
                    )
                      anonimizar.mutate({ id: c.id });
                  }}
                >
                  Anonimizar
                </Button>
              )
            }
          />
        )}
        {anonimizar.error && <p className="text-sm text-destructive">{anonimizar.error.message}</p>}
      </section>
    </div>
  );
}

/* ----------------------------- Manutenção ----------------------------- */

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * OPERAÇÃO — o cockpit de ops do ROOT: backups automáticos (com "fazer agora"), reinícios do
 * health-check e o estado dos alertas por e-mail. No dev os caminhos não existem → degrada com
 * uma mensagem clara. Ver ADR-87.
 */
function AbaOperacao() {
  const op = trpc.sistema.operacao.useQuery(undefined, { refetchInterval: 30_000 });
  const utils = trpc.useUtils();
  const backup = trpc.sistema.fazerBackup.useMutation({ onSuccess: () => void utils.sistema.operacao.invalidate() });

  if (op.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (op.error) return <QueryError message={op.error.message} onRetry={() => op.refetch()} />;
  const d = op.data!;

  return (
    <div className="space-y-6">
      {/* Backups */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <HardDrive className="h-4 w-4" /> Backups automáticos
        </h2>
        {!d.disponivel ? (
          <EmptyState
            icon={HardDrive}
            title="Disponível no servidor"
            description="Os backups automáticos rodam no servidor de produção (cron diário às 03:00). Este painel os mostra quando aberto lá — no ambiente local não há o que exibir."
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard icon={Timer} label="Último backup" value={d.backups?.ultimo ? haQuanto(d.backups.ultimo.quando) : "nenhum"} tom={d.backups?.ultimo ? "ok" : "alerta"} />
              <StatCard icon={Database} label="Guardados" value={`${d.backups?.total ?? 0} / ${d.backups?.retencao ?? 14}`} hint="retém 14 dias" />
              <StatCard icon={HardDrive} label="Espaço usado" value={d.backups ? fmtBytes(d.backups.tamanhoTotal) : "—"} />
            </div>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="text-xs text-muted-foreground">
                  {d.backups?.ultimo
                    ? `Último em ${dataHora(d.backups.ultimo.quando)} (${fmtBytes(d.backups.ultimo.tamanho)}). `
                    : "Nenhum backup gerado ainda. "}
                  Automático diário às 03:00 (BRT).
                </div>
                <Button variant="outline" disabled={backup.isPending} onClick={() => backup.mutate()}>
                  <HardDrive className="h-4 w-4" />
                  {backup.isPending ? "Gerando…" : "Fazer backup agora"}
                </Button>
              </CardContent>
            </Card>
            {backup.data && <p className="text-xs text-success">Backup gerado. {backup.data.saida}</p>}
            {backup.error && <p className="text-xs text-destructive">{backup.error.message}</p>}
          </>
        )}
      </section>

      {/* Reinícios automáticos */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <RefreshCw className="h-4 w-4" /> Reinícios automáticos (health-check)
        </h2>
        {!d.disponivel ? (
          <p className="text-xs text-muted-foreground">Disponível no servidor.</p>
        ) : d.reinicios.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">Nenhum reinício registrado — o app não caiu.</CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {d.reinicios.map((linha, i) => (
                  <li key={i} className="px-4 py-2 text-xs">
                    <code className="text-muted-foreground">{linha}</code>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Alertas ao ROOT */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <ShieldCheck className="h-4 w-4" /> Alertas ao ROOT
        </h2>
        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={d.alertas.emailReal ? "success" : "warning"}>{d.alertas.emailReal ? "E-mail ativo" : "E-mail em modo dev"}</Badge>
              <span className="text-muted-foreground">
                O ROOT recebe e-mail automático de <strong>incidentes</strong> e de <strong>erros novos/regressões</strong>.
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Quando o app fica <strong>totalmente fora do ar</strong>, o aviso vem do health-check no servidor (cron, independente do app): ele reinicia o app e envia e-mail ao ROOT.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function AbaManutencao() {
  const migracoes = trpc.sistema.migracoes.useQuery();
  const conf = trpc.sistema.config.useQuery();
  const atencao = trpc.sistema.atencao.useQuery();
  const utils = trpc.useUtils();
  const limpar = trpc.sistema.limparSessoesExpiradas.useMutation({
    onSuccess: () => {
      void utils.sistema.atencao.invalidate();
      void utils.sistema.sessoes.invalidate();
    },
  });

  const sessoesExpiradas = atencao.data?.sessoesExpiradas ?? 0;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Limpeza</h2>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="text-sm font-medium">Sessões expiradas</div>
              <div className="text-xs text-muted-foreground">
                {sessoesExpiradas} registro(s) de sessão já vencidos no banco.
              </div>
              {limpar.data && <div className="mt-1 text-xs text-success">{limpar.data.removidas} removida(s).</div>}
            </div>
            <Button variant="outline" disabled={limpar.isPending || sessoesExpiradas === 0} onClick={() => limpar.mutate()}>
              <Trash2 className="h-4 w-4" />
              Limpar agora
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Settings2 className="h-4 w-4" />
          Configuração
        </h2>
        {conf.data && (
          <Card>
            <CardContent className="grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-2">
              <ConfigLinha rotulo="Ambiente" valor={conf.data.ambiente} />
              <ConfigLinha rotulo="Porta da API" valor={String(conf.data.apiPort)} />
              <ConfigLinha rotulo="Endereço de origem (CORS)" valor={conf.data.webOrigin} />
              <ConfigLinha rotulo="IA" valor={conf.data.iaAtiva ? "Ativa" : "Desligada"} />
              <ConfigLinha rotulo="Proteção de cabeçalhos (CSP)" valor={conf.data.cspLigada ? "Ligada" : "Desligada"} />
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <GitBranch className="h-4 w-4" />
          Migrações do banco
        </h2>
        {migracoes.isLoading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : !migracoes.data || migracoes.data.length === 0 ? (
          <EmptyState icon={GitBranch} title="Sem migrações" description="Nenhuma migração registrada." />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {migracoes.data.map((mg) => (
                  <li key={mg.nome} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <code className="truncate text-xs">{mg.nome}</code>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {mg.aplicadaEm ? dataHora(mg.aplicadaEm) : "pendente"}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function ConfigLinha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed py-1 last:border-0 sm:border-0">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="truncate font-medium">{valor}</span>
    </div>
  );
}
