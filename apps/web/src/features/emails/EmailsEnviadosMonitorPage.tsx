import { useState, type FormEvent } from "react";
import { CheckCircle2, AlertTriangle, Inbox, Percent, Search, Loader2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@app/ui";
import { trpc } from "../../lib/trpc";
import { dataHora } from "../../lib/format-date";
import { PageHeader } from "../../components/ui/page-header";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { EmailsEnviadosList } from "../../components/EmailsEnviadosList";

type StatusFiltro = "" | "ENVIADO" | "FALHOU";

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tom = "primary",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tom?: "primary" | "success" | "danger";
}) {
  const cor =
    tom === "success"
      ? "bg-success/5 text-success ring-success/10"
      : tom === "danger"
        ? "bg-destructive/5 text-destructive ring-destructive/10"
        : "bg-primary/5 text-primary ring-primary/10";
  const valorCor = tom === "danger" ? "text-destructive" : tom === "success" ? "text-success" : "text-primary";
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", cor)}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("truncate text-xl font-semibold tabular-nums", valorCor)}>{value}</div>
        {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

export function EmailsEnviadosMonitorPage() {
  const [status, setStatus] = useState<StatusFiltro>("");
  const [template, setTemplate] = useState("");
  const [dias, setDias] = useState(7);
  const [buscaInput, setBuscaInput] = useState("");
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(30);

  const resumo = trpc.emailsEnviados.resumo.useQuery(undefined, { refetchInterval: 60_000 });
  const lista = trpc.emailsEnviados.todos.useQuery({
    status: status || undefined,
    template: template || undefined,
    busca: busca || undefined,
    dias: dias || undefined,
    limite,
  });

  const submeterBusca = (e: FormEvent) => {
    e.preventDefault();
    setLimite(30);
    setBusca(buscaInput.trim());
  };

  const trocar = <T,>(setter: (v: T) => void, v: T) => {
    setLimite(30);
    setter(v);
  };

  const r = resumo.data;
  const itens = lista.data?.itens ?? [];
  const filtrando = !!status || !!template || !!busca || dias !== 7;
  const limpar = () => {
    setStatus("");
    setTemplate("");
    setDias(7);
    setBuscaInput("");
    setBusca("");
    setLimite(30);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="E-mails enviados"
        subtitle="Tudo que o sistema enviou — acompanhe entregas e falhas para saber, na hora, se algo deu errado."
      />

      {/* Aviso quando o envio está desligado no ambiente (evita falso "está bugado") */}
      {r && !r.isEmailReal && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3.5 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <span className="font-semibold text-warning">O envio de e-mails está desligado neste ambiente.</span>{" "}
            <span className="text-muted-foreground">
              O SMTP não está configurado, então os e-mails ficam registrados como não enviados — não é um bug. Configure
              SMTP_HOST/USER/PASS para enviar de verdade.
            </span>
          </div>
        </div>
      )}

      {/* Indicadores */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {resumo.isLoading || !r ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-xl" />)
        ) : (
          <>
            <StatCard icon={CheckCircle2} tom="success" label="Enviados (7 dias)" value={String(r.enviados7d)} />
            <StatCard
              icon={AlertTriangle}
              tom={r.falhas7d > 0 ? "danger" : "primary"}
              label="Falhas (7 dias)"
              value={String(r.falhas7d)}
              hint={r.ultimaFalhaEm ? `última em ${dataHora(r.ultimaFalhaEm)}` : "nenhuma falha recente"}
            />
            <StatCard
              icon={Inbox}
              label="Enviados hoje"
              value={String(r.hoje)}
              // A falha do dia fica ao lado do envio do dia: sem isso, um dia inteiro de e-mail
              // recusado aparece como "0 enviados" e se confunde com "dia parado".
              hint={r.falhasHoje > 0 ? `${r.falhasHoje} falha(s) hoje` : undefined}
              tom={r.falhasHoje > 0 && r.hoje === 0 ? "danger" : undefined}
            />
            <StatCard icon={Percent} label="Taxa de entrega" value={`${Math.round(r.taxaEntrega * 100)}%`} hint="últimos 7 dias" />
          </>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border">
          {(
            [
              { v: "", label: "Todos" },
              { v: "ENVIADO", label: "Enviados" },
              { v: "FALHOU", label: "Falhas" },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              onClick={() => trocar(setStatus, o.v)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium transition-colors",
                status === o.v ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        <Select value={template} onChange={(e) => trocar(setTemplate, e.target.value)} className="h-9 w-auto">
          <option value="">Todos os tipos</option>
          {r?.templates.map((t) => (
            <option key={t.chave} value={t.chave}>
              {t.label}
            </option>
          ))}
        </Select>

        <Select value={String(dias)} onChange={(e) => trocar(setDias, Number(e.target.value))} className="h-9 w-auto">
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="0">Todo o período</option>
        </Select>

        {filtrando && (
          <button
            onClick={limpar}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Limpar filtros"
          >
            <X className="h-4 w-4" />
            Limpar
          </button>
        )}

        <form onSubmit={submeterBusca} className="relative ml-auto min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={buscaInput}
            onChange={(e) => setBuscaInput(e.target.value)}
            placeholder="Buscar por destinatário ou assunto…"
            className="h-9 pl-8"
          />
        </form>
      </div>

      {/* Lista */}
      {lista.isError ? (
        <QueryError onRetry={() => lista.refetch()} />
      ) : lista.isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <EmailsEnviadosList emails={itens} mostrarPara vazio="Nenhum e-mail encontrado com esses filtros." />
          {lista.data?.temMais && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" onClick={() => setLimite((n) => n + 30)} disabled={lista.isFetching}>
                {lista.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Carregar mais
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
