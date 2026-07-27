import { useState } from "react";
import {
  Plus, AlertTriangle, Check, Pencil, Trash2, Wallet, Tags, ArrowDownCircle, ArrowUpCircle,
  Building2, User, Layers, CalendarClock, PartyPopper, Repeat,
} from "lucide-react";
import { cn } from "@app/ui";
import { hasRoleLevel, type ContaTipo, type Carteira, type Escopo } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { formatBRL } from "../../lib/masks";
import { dataUTC } from "../../lib/format-date";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { EmptyState } from "../../components/ui/empty-state";
import { TableSkeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { ContaFormDialog, type ContaEditavel } from "./ContaFormDialog";
import { CategoriasDialog } from "./CategoriasDialog";

const hojeInicio = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

type FiltroStatus = "TODAS" | "PENDENTES" | "PAGAS";

function ResumoCard({ titulo, valor, tom, dica }: { titulo: string; valor: number; tom: "verde" | "vermelho" | "neutro"; dica?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="text-xs font-medium uppercase text-muted-foreground">{titulo}</div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tom === "verde" && "text-success",
          tom === "vermelho" && "text-destructive",
          tom === "neutro" && (valor >= 0 ? "text-success" : "text-destructive"),
        )}
      >
        {formatBRL(valor)}
      </div>
      {dica && <div className="mt-0.5 text-[11px] text-muted-foreground">{dica}</div>}
    </div>
  );
}

export function FinanceiroPage() {
  const { user } = useAuth();
  const podeVer = hasRoleLevel(user.role, "ADMIN");

  const [carteira, setCarteira] = useState<Carteira>("EMPRESA");
  const [aba, setAba] = useState<ContaTipo>("RECEBER");
  const [status, setStatus] = useState<FiltroStatus>("PENDENTES");
  const [nova, setNova] = useState<Escopo | null>(null);
  const [editar, setEditar] = useState<ContaEditavel | null>(null);
  const [gerirCategorias, setGerirCategorias] = useState(false);

  const confirm = useConfirm();
  const utils = trpc.useUtils();

  const resumoEmpresa = trpc.financeiro.contas.resumo.useQuery(
    { carteira: "EMPRESA" },
    { enabled: podeVer && carteira !== "PESSOAL" },
  );
  const resumoPessoal = trpc.financeiro.contas.resumo.useQuery(
    { carteira: "PESSOAL" },
    { enabled: podeVer && carteira !== "EMPRESA" },
  );
  const agenda = trpc.financeiro.contas.agenda.useQuery({ carteira }, { enabled: podeVer });
  const porCat = trpc.financeiro.contas.porCategoria.useQuery({ carteira }, { enabled: podeVer });
  const contas = trpc.financeiro.contas.list.useQuery({ carteira, tipo: aba, status }, { enabled: podeVer });

  const invalidate = () => {
    utils.financeiro.contas.list.invalidate();
    utils.financeiro.contas.resumo.invalidate();
    utils.financeiro.contas.agenda.invalidate();
    utils.financeiro.contas.porCategoria.invalidate();
  };
  const marcarPaga = trpc.financeiro.contas.marcarPaga.useMutation({ onSuccess: invalidate });
  const remove = trpc.financeiro.contas.remove.useMutation({ onSuccess: invalidate });

  if (!podeVer) {
    return <EmptyState icon={Wallet} title="Acesso restrito" description="O Financeiro é visível apenas para administradores." />;
  }

  const hoje = hojeInicio();
  const receber = aba === "RECEBER";
  // Carteira em que uma "nova conta" nasce (Tudo → padrão Empresa; o form deixa trocar).
  const escopoNova: Escopo = carteira === "PESSOAL" ? "PESSOAL" : "EMPRESA";

  const CARTEIRAS: { id: Carteira; label: string; icon: typeof Building2 }[] = [
    { id: "EMPRESA", label: "Empresa", icon: Building2 },
    { id: "PESSOAL", label: "Pessoal", icon: User },
    { id: "TUDO", label: "Tudo", icon: Layers },
  ];

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Financeiro"
        subtitle="O que você precisa pagar e receber — separado por carteira, com lembretes e contas recorrentes automáticas."
      >
        <Button variant="ghost" onClick={() => setGerirCategorias(true)} title="Gerenciar categorias">
          <Tags className="h-4 w-4" />
          Categorias
        </Button>
        <Button onClick={() => setNova(escopoNova)}>
          <Plus className="h-4 w-4" />
          Nova conta
        </Button>
      </PageHeader>

      {/* Seletor de carteira: Empresa · Pessoal · Tudo */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-1 shadow-sm">
          {CARTEIRAS.map((c) => {
            const ativa = carteira === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCarteira(c.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  ativa ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <c.icon className="h-4 w-4" />
                {c.label}
              </button>
            );
          })}
        </div>
        {carteira === "PESSOAL" && (
          <span className="text-xs text-muted-foreground">🔒 Só você vê sua carteira pessoal.</span>
        )}
      </div>

      {/* Conteúdo rola por dentro (página rica, como o Dashboard). */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {/* ── PRECISA DE VOCÊ (o herói) ── */}
        <PrecisaDeVoce
          agenda={agenda.data}
          carregando={agenda.isLoading}
          erro={agenda.isError}
          mostrarCarteira={carteira === "TUDO"}
          onRefetch={() => agenda.refetch()}
          onMarcar={(id, pago) => marcarPaga.mutate({ id, pago })}
        />

        {/* ── KPIs por carteira ── */}
        <div className="space-y-2">
          {carteira !== "PESSOAL" && resumoEmpresa.data && (
            <KpiStrip r={resumoEmpresa.data} titulo={carteira === "TUDO" ? "Empresa" : undefined} icon={Building2} />
          )}
          {carteira !== "EMPRESA" && resumoPessoal.data && (
            <KpiStrip r={resumoPessoal.data} titulo={carteira === "TUDO" ? "Pessoal" : undefined} icon={User} />
          )}
        </div>

        {/* ── Para onde vai o dinheiro (categorias do mês) ── */}
        {porCat.data && (porCat.data.despesas.length > 0 || porCat.data.receitas.length > 0) && (
          <ParaOndeVai despesas={porCat.data.despesas} receitas={porCat.data.receitas} />
        )}

        {/* ── Lista completa (abas + filtro) ── */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border p-0.5">
              {(["RECEBER", "PAGAR"] as ContaTipo[]).map((t) => {
                const on = aba === t;
                const verde = t === "RECEBER";
                return (
                  <button
                    key={t}
                    onClick={() => setAba(t)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      on
                        ? verde
                          ? "bg-success/10 text-success"
                          : "bg-destructive/10 text-destructive"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {verde ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                    {verde ? "A receber" : "A pagar"}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(["PENDENTES", "PAGAS", "TODAS"] as FiltroStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    status === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {s === "TODAS" ? "Todas" : s === "PENDENTES" ? "Pendentes" : receber ? "Recebidas" : "Pagas"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            {contas.isError ? (
              <QueryError onRetry={() => contas.refetch()} />
            ) : contas.isLoading ? (
              <TableSkeleton rows={5} cols={5} />
            ) : contas.data && contas.data.length > 0 ? (
              <Table>
                <THead>
                  <tr>
                    <TH>Descrição</TH>
                    <TH>Categoria</TH>
                    <TH>Vencimento</TH>
                    <TH className="text-right">Valor</TH>
                    <TH className="text-center">{receber ? "Recebida" : "Paga"}</TH>
                    <TH />
                  </tr>
                </THead>
                <tbody>
                  {contas.data.map((c) => {
                    const vencida = !c.pago && new Date(c.vencimento) < hoje;
                    return (
                      <TR key={c.id}>
                        <TD>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{c.descricao}</span>
                            {c.recorrencia !== "NENHUMA" && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                <Repeat className="h-2.5 w-2.5" />
                                {c.recorrencia === "MENSAL" ? "Mensal" : c.recorrencia === "SEMANAL" ? "Semanal" : "Diária"}
                              </span>
                            )}
                          </div>
                          {c.cliente && <div className="text-xs text-muted-foreground">{c.cliente.nome}</div>}
                        </TD>
                        <TD>
                          {c.categoria ? (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <span className="h-2 w-2 rounded-full" style={{ background: c.categoria.cor ?? "#94a3b8" }} />
                              {c.categoria.nome}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TD>
                        <TD className={cn(vencida && "font-medium text-destructive")}>{dataUTC(c.vencimento)}</TD>
                        <TD className={cn("text-right font-medium tabular-nums", receber ? "text-success" : "text-destructive")}>
                          {receber ? "+" : "−"} {formatBRL(c.valor)}
                        </TD>
                        <TD className="text-center">
                          <button
                            onClick={() => marcarPaga.mutate({ id: c.id, pago: !c.pago })}
                            className={cn(
                              "inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
                              c.pago
                                ? "border-success bg-success text-success-foreground"
                                : "border-input text-transparent hover:border-success",
                            )}
                            title={c.pago ? "Marcar como pendente" : receber ? "Marcar como recebida" : "Marcar como paga"}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        </TD>
                        <TD>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() =>
                                setEditar({
                                  id: c.id,
                                  tipo: c.tipo,
                                  escopo: c.escopo,
                                  descricao: c.descricao,
                                  valor: c.valor,
                                  vencimento: c.vencimento,
                                  categoriaId: c.categoriaId,
                                  clienteId: c.clienteId,
                                  recorrencia: c.recorrencia,
                                  recorrenciaAte: c.recorrenciaAte,
                                  observacoes: c.observacoes,
                                })
                              }
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              title="Editar"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: "Remover conta",
                                    description: `"${c.descricao}" será removida. ${c.recorrencia !== "NENHUMA" ? "Só esta ocorrência é removida." : "Esta ação não pode ser desfeita."}`,
                                    confirmText: "Remover",
                                    variant: "destructive",
                                  })
                                )
                                  remove.mutate({ id: c.id });
                              }}
                              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="Remover"
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
            ) : (
              <EmptyState
                icon={receber ? ArrowDownCircle : ArrowUpCircle}
                title={`Nenhuma conta ${receber ? "a receber" : "a pagar"} ${status === "PENDENTES" ? "pendente" : status === "PAGAS" ? (receber ? "recebida" : "paga") : ""}`.trim()}
                description="Lance uma nova conta pelo botão acima."
              />
            )}
          </div>
        </div>
      </div>

      <ContaFormDialog open={nova !== null} onClose={() => setNova(null)} tipoPadrao={aba} escopoPadrao={nova ?? "EMPRESA"} />
      <ContaFormDialog open={!!editar} onClose={() => setEditar(null)} conta={editar ?? undefined} />
      <CategoriasDialog open={gerirCategorias} onClose={() => setGerirCategorias(false)} />
    </div>
  );
}

// ── KPIs de uma carteira ─────────────────────────────────
type Resumo = {
  aReceberPendente: number; aPagarPendente: number; saldoPrevisto: number;
  recebidoMes: number; pagoMes: number; resultadoMes: number;
};
function KpiStrip({ r, titulo, icon: Icon }: { r: Resumo; titulo?: string; icon?: typeof Building2 }) {
  return (
    <div>
      {titulo && (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {titulo}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ResumoCard titulo="A receber (pendente)" valor={r.aReceberPendente} tom="verde" />
        <ResumoCard titulo="A pagar (pendente)" valor={r.aPagarPendente} tom="vermelho" />
        <ResumoCard titulo="Saldo previsto" valor={r.saldoPrevisto} tom="neutro" dica="Se tudo entrar e sair" />
        <ResumoCard
          titulo="Resultado do mês"
          valor={r.resultadoMes}
          tom="neutro"
          dica={`Entrou ${formatBRL(r.recebidoMes)} · Saiu ${formatBRL(r.pagoMes)}`}
        />
      </div>
    </div>
  );
}

// ── Para onde vai o dinheiro ─────────────────────────────
type CatItem = { nome: string; cor: string | null; total: number };
function Barras({ titulo, itens, tom }: { titulo: string; itens: CatItem[]; tom: "verde" | "vermelho" }) {
  if (itens.length === 0) return null;
  const total = itens.reduce((s, i) => s + i.total, 0);
  const max = Math.max(...itens.map((i) => i.total), 1);
  return (
    <div className="flex-1">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{titulo}</span>
        <span className={cn("text-sm font-semibold tabular-nums", tom === "verde" ? "text-success" : "text-destructive")}>
          {formatBRL(total)}
        </span>
      </div>
      <div className="space-y-1.5">
        {itens.slice(0, 6).map((i) => (
          <div key={i.nome}>
            <div className="mb-0.5 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: i.cor ?? "#94a3b8" }} />
                {i.nome}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatBRL(i.total)} · {Math.round((i.total / total) * 100)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${(i.total / max) * 100}%`, background: i.cor ?? "#94a3b8" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function ParaOndeVai({ despesas, receitas }: { despesas: CatItem[]; receitas: CatItem[] }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <div className="text-sm font-semibold text-primary">Contas do mês por categoria</div>
        <div className="text-xs text-muted-foreground">Tudo com vencimento neste mês — pago ou a pagar.</div>
      </div>
      <div className="flex flex-col gap-6 sm:flex-row">
        <Barras titulo="Saídas por categoria" itens={despesas} tom="vermelho" />
        <Barras titulo="Entradas por categoria" itens={receitas} tom="verde" />
      </div>
    </div>
  );
}

// ── Precisa de você (o herói) ────────────────────────────
type ContaAgenda = {
  id: string; tipo: ContaTipo; escopo: Escopo; descricao: string; valor: number; vencimento: Date;
  categoria: { nome: string; cor: string | null } | null; cliente: { nome: string } | null;
};
type Agenda = { vencidas: ContaAgenda[]; hoje: ContaAgenda[]; semana: ContaAgenda[]; depois: ContaAgenda[] };

function Linha({ c, mostrarCarteira, onMarcar }: { c: ContaAgenda; mostrarCarteira: boolean; onMarcar: (id: string, pago: boolean) => void }) {
  const receber = c.tipo === "RECEBER";
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <button
        onClick={() => onMarcar(c.id, true)}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-input text-transparent transition-colors hover:border-success hover:text-success"
        title={receber ? "Marcar como recebida" : "Marcar como paga"}
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{c.descricao}</span>
          {mostrarCarteira && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {c.escopo === "PESSOAL" ? "Pessoal" : "Empresa"}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {receber ? "Receber" : "Pagar"} · {dataUTC(c.vencimento)}
          {c.cliente ? ` · ${c.cliente.nome}` : c.categoria ? ` · ${c.categoria.nome}` : ""}
        </div>
      </div>
      <div className={cn("shrink-0 text-sm font-semibold tabular-nums", receber ? "text-success" : "text-destructive")}>
        {receber ? "+" : "−"} {formatBRL(c.valor)}
      </div>
    </div>
  );
}

function Grupo({ titulo, itens, tom, mostrarCarteira, onMarcar }: {
  titulo: string; itens: ContaAgenda[]; tom: "vermelho" | "amarelo" | "azul"; mostrarCarteira: boolean; onMarcar: (id: string, pago: boolean) => void;
}) {
  if (itens.length === 0) return null;
  const soma = itens.reduce((s, i) => s + (i.tipo === "RECEBER" ? i.valor : -i.valor), 0);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
            tom === "vermelho" && "bg-destructive/10 text-destructive",
            tom === "amarelo" && "bg-warning/15 text-warning",
            tom === "azul" && "bg-primary/10 text-primary",
          )}
        >
          {titulo} · {itens.length}
        </span>
        <span className={cn("text-xs font-medium tabular-nums", soma >= 0 ? "text-success" : "text-destructive")}>
          saldo {formatBRL(soma)}
        </span>
      </div>
      <div className="space-y-1.5">
        {itens.map((c) => (
          <Linha key={c.id} c={c} mostrarCarteira={mostrarCarteira} onMarcar={onMarcar} />
        ))}
      </div>
    </div>
  );
}

function PrecisaDeVoce({ agenda, carregando, erro, mostrarCarteira, onRefetch, onMarcar }: {
  agenda?: Agenda; carregando: boolean; erro: boolean; mostrarCarteira: boolean;
  onRefetch: () => void; onMarcar: (id: string, pago: boolean) => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold text-primary">Precisa de você</h2>
      </div>
      {erro ? (
        <QueryError onRetry={onRefetch} />
      ) : carregando || !agenda ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : agenda.vencidas.length + agenda.hoje.length + agenda.semana.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-6 text-center">
          <PartyPopper className="h-8 w-8 text-success" />
          <p className="text-sm font-medium">Tudo em dia! 🎉</p>
          <p className="text-xs text-muted-foreground">Nada vence nos próximos 7 dias.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {agenda.vencidas.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Você tem {agenda.vencidas.length} conta(s) <strong>vencida(s)</strong>. Resolva primeiro estas.</span>
            </div>
          )}
          <Grupo titulo="Vencidas" itens={agenda.vencidas} tom="vermelho" mostrarCarteira={mostrarCarteira} onMarcar={onMarcar} />
          <Grupo titulo="Vence hoje" itens={agenda.hoje} tom="amarelo" mostrarCarteira={mostrarCarteira} onMarcar={onMarcar} />
          <Grupo titulo="Esta semana" itens={agenda.semana} tom="azul" mostrarCarteira={mostrarCarteira} onMarcar={onMarcar} />
        </div>
      )}
    </div>
  );
}
