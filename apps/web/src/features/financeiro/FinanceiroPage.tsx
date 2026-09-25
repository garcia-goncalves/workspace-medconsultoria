import { useDeferredValue, useEffect, useState } from "react";
import {
  Plus, AlertTriangle, Check, Pencil, Trash2, Wallet, Tags, ArrowDownCircle, ArrowUpCircle,
  Building2, User, Layers, CalendarClock, PartyPopper, Repeat, Download, Search, X,
} from "lucide-react";
import { cn } from "@app/ui";
import { hasRoleLevel, type ContaTipo, type Carteira, type Escopo } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { formatBRL } from "../../lib/masks";
import { dataUTC, hojeEmBrasiliaISO } from "../../lib/format-date";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { PageHeader } from "../../components/ui/page-header";
import { EmptyState } from "../../components/ui/empty-state";
import { QueryError } from "../../components/ui/query-error";
import { toast } from "../../components/ui/toast";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { DataTable, type Coluna } from "../../components/ui/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
// Reuso (sem alterar) das peças da Conciliação: o mesmo download e a mesma paginação.
import { baixarTexto, Paginacao } from "../conciliacao/partes";
import { ContaFormDialog, type ContaEditavel } from "./ContaFormDialog";
import { CategoriasDialog } from "./CategoriasDialog";
import { RelatoriosFinanceiro } from "./RelatoriosFinanceiro";
import { PADRAO_FINANCEIRO, SEM_CATEGORIA_URL, temFiltroExtra, type BuscaFinanceiro } from "./busca-na-url";
import { useBuscaFinanceiro } from "./use-busca-financeiro";
import { diaAnterior, nomeDoArquivo, rotuloExportar } from "./relatorios-formato";
import type { RouterOutputs } from "../../lib/trpc";

type ContaLinha = RouterOutputs["financeiro"]["contas"]["list"]["itens"][number];

/** Contas por página. A recorrência faz a lista crescer sozinha; o servidor pagina. */
const POR_PAGINA = 50;

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

  // Carteira, aba, lado, situação e filtros moram na URL (ver `busca-na-url.ts`).
  const [url, atualizar] = useBuscaFinanceiro();
  const carteira: Carteira = url.carteira ?? PADRAO_FINANCEIRO.carteira;
  const abaPagina = url.aba ?? PADRAO_FINANCEIRO.aba;
  const aba: ContaTipo = url.tipo ?? PADRAO_FINANCEIRO.tipo;
  const status: FiltroStatus = url.status ?? PADRAO_FINANCEIRO.status;
  const pagina = url.pagina ?? 1;

  /** Todo filtro volta para a página 1 — senão a pessoa fica numa página que não existe mais. */
  const filtrar = (mudancas: BuscaFinanceiro) => atualizar({ ...mudancas, pagina: undefined });

  // A busca tem texto LOCAL (o campo não pode pular o cursor esperando a URL) e vai para a URL a
  // cada tecla; a consulta usa o valor ADIADO, para não disparar uma ida ao servidor por letra.
  const [buscaTexto, setBuscaTexto] = useState(url.busca ?? "");
  useEffect(() => setBuscaTexto(url.busca ?? ""), [url.busca]);
  const buscaAdiada = useDeferredValue(url.busca);

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

  /** O recorte da lista — o MESMO objeto vai para a exportação (sem a paginação). */
  const filtro = {
    carteira,
    tipo: aba,
    status,
    clienteId: url.cliente,
    categoriaId: url.categoria,
    vencimentoDe: url.de,
    vencimentoAte: url.ate,
    busca: buscaAdiada,
  };
  const contas = trpc.financeiro.contas.list.useQuery(
    { ...filtro, pagina, porPagina: POR_PAGINA },
    // Mantém a página anterior enquanto a nova chega: a tabela não pisca a cada filtro.
    { enabled: podeVer, placeholderData: (anterior) => anterior },
  );

  // Opções dos filtros. Categoria é por carteira — em "Tudo", as duas listas juntas.
  const clientes = trpc.clientes.list.useQuery(undefined, { enabled: podeVer && carteira !== "PESSOAL" });
  const catEmpresa = trpc.financeiro.categorias.list.useQuery({ escopo: "EMPRESA" }, { enabled: podeVer && carteira !== "PESSOAL" });
  const catPessoal = trpc.financeiro.categorias.list.useQuery({ escopo: "PESSOAL" }, { enabled: podeVer && carteira !== "EMPRESA" });
  const categorias = [
    ...(carteira !== "PESSOAL" ? (catEmpresa.data ?? []).map((c) => ({ ...c, rotulo: carteira === "TUDO" ? `${c.nome} (Empresa)` : c.nome })) : []),
    ...(carteira !== "EMPRESA" ? (catPessoal.data ?? []).map((c) => ({ ...c, rotulo: carteira === "TUDO" ? `${c.nome} (Pessoal)` : c.nome })) : []),
  ];

  const invalidate = () => {
    utils.financeiro.contas.list.invalidate();
    utils.financeiro.contas.resumo.invalidate();
    utils.financeiro.contas.agenda.invalidate();
    utils.financeiro.contas.porCategoria.invalidate();
    utils.financeiro.relatorios.invalidate();
  };
  const marcarPaga = trpc.financeiro.contas.marcarPaga.useMutation({ onSuccess: invalidate });
  const remove = trpc.financeiro.contas.remove.useMutation({ onSuccess: invalidate });

  const recortado = temFiltroExtra(url);
  const exportar = trpc.financeiro.contas.exportar.useMutation({
    onSuccess: (r, pedido) => {
      const hoje = hojeEmBrasiliaISO();
      baixarTexto(
        r.csv,
        nomeDoArquivo({ carteira, de: pedido.vencimentoDe, ate: pedido.vencimentoAte, recortado, hoje }),
      );
      toast(`${r.linhas} conta(s) exportada(s) para o contador.`, "success");
    },
    onError: (e) => toast(e.message),
  });

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

  /**
   * Trocar de carteira limpa cliente e categoria: categoria é POR carteira (a "Aluguel" da empresa
   * não existe na pessoal), e manter o filtro faria a lista nova abrir vazia sem explicar por quê.
   */
  const trocarCarteira = (c: Carteira) => filtrar({ carteira: c, cliente: undefined, categoria: undefined });

  /** Da lista de inadimplência para as contas vencidas daquele cliente, já filtradas. */
  const verContasDoCliente = (clienteId: string) =>
    atualizar(
      {
        aba: undefined,
        tipo: undefined, // padrão = a receber
        status: undefined, // padrão = pendentes
        cliente: clienteId,
        categoria: undefined,
        de: undefined,
        ate: diaAnterior(hojeEmBrasiliaISO()),
        busca: undefined,
        pagina: undefined,
      },
      { novaEntrada: true },
    );

  const limparFiltros = () =>
    filtrar({ cliente: undefined, categoria: undefined, de: undefined, ate: undefined, busca: undefined });

  // ⚠️ Sem número enquanto a lista do filtro NOVO não chega: o `placeholderData` ainda mostra a
  // contagem do filtro anterior, e o botão prometeria outra quantidade.
  const totalConfiavel = contas.data && !contas.isPlaceholderData ? contas.data.total : null;

  const abrirEdicao = (c: ContaLinha) =>
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
    });

  const confirmarRemover = async (c: ContaLinha) => {
    if (
      await confirm({
        title: "Remover conta",
        description: `"${c.descricao}" será removida. ${c.recorrencia !== "NENHUMA" ? "Só esta ocorrência é removida." : "Esta ação não pode ser desfeita."}`,
        confirmText: "Remover",
        variant: "destructive",
      })
    )
      remove.mutate({ id: c.id });
  };

  const colunas: Coluna<ContaLinha>[] = [
    {
      chave: "descricao",
      cabecalho: "Descrição",
      principal: true,
      valorOrdenacao: (c) => c.descricao,
      render: (c) => (
        <div>
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
        </div>
      ),
    },
    {
      chave: "categoria",
      cabecalho: "Categoria",
      ocultaEmCelular: true,
      valorOrdenacao: (c) => c.categoria?.nome ?? null,
      render: (c) =>
        c.categoria ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: c.categoria.cor ?? "#94a3b8" }} />
            {c.categoria.nome}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      chave: "vencimento",
      cabecalho: "Vencimento",
      valorOrdenacao: (c) => new Date(c.vencimento),
      render: (c) => {
        const vencida = !c.pago && new Date(c.vencimento) < hoje;
        return <span className={cn(vencida && "font-medium text-destructive")}>{dataUTC(c.vencimento)}</span>;
      },
    },
    {
      chave: "valor",
      cabecalho: "Valor",
      alinhamento: "direita",
      valorOrdenacao: (c) => c.valor,
      render: (c) => (
        <span className={cn("font-medium tabular-nums", receber ? "text-success" : "text-destructive")}>
          {receber ? "+" : "−"} {formatBRL(c.valor)}
        </span>
      ),
    },
    {
      chave: "pago",
      cabecalho: receber ? "Recebida" : "Paga",
      alinhamento: "centro",
      render: (c) => (
        <button
          onClick={() => marcarPaga.mutate({ id: c.id, pago: !c.pago })}
          aria-label={c.pago ? "Marcar como pendente" : receber ? "Marcar como recebida" : "Marcar como paga"}
          className={cn(
            "inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors md:h-6 md:w-6",
            c.pago
              ? "border-success bg-success text-success-foreground"
              : "border-input text-transparent hover:border-success",
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Financeiro"
        subtitle="O que você precisa pagar e receber — separado por carteira, com lembretes e contas recorrentes automáticas."
      >
        <Button variant="ghost" onClick={() => setGerirCategorias(true)}>
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
                onClick={() => trocarCarteira(c.id)}
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
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <Tabs
          value={abaPagina}
          onValueChange={(v) => atualizar({ aba: v as BuscaFinanceiro["aba"] }, { novaEntrada: true })}
          className="space-y-4"
        >
          <TabsList aria-label="Seções do Financeiro">
            <TabsTrigger value="contas">Contas</TabsTrigger>
            <TabsTrigger value="relatorios">Relatórios</TabsTrigger>
          </TabsList>

          <TabsContent value="relatorios">
            <RelatoriosFinanceiro carteira={carteira} onVerContasDoCliente={verContasDoCliente} />
          </TabsContent>

          <TabsContent value="contas" className="space-y-4">
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
                        onClick={() => filtrar({ tipo: t })}
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
                      onClick={() => filtrar({ status: s })}
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

              {/* ── Filtros do recorte ── */}
              <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <div className="relative lg:col-span-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Buscar na descrição"
                    placeholder="Buscar na descrição"
                    className="pl-9"
                    value={buscaTexto}
                    maxLength={120}
                    onChange={(e) => {
                      setBuscaTexto(e.target.value);
                      filtrar({ busca: e.target.value });
                    }}
                  />
                </div>
                {carteira !== "PESSOAL" && (
                  <Select
                    aria-label="Cliente"
                    value={url.cliente ?? ""}
                    onChange={(e) => filtrar({ cliente: e.target.value || undefined })}
                  >
                    <option value="">Todos os clientes</option>
                    {/* O cliente do link pode não estar na lista (ex.: prospect): sem esta opção, o
                        seletor mostraria "Todos" enquanto a lista filtra por ele. */}
                    {url.cliente && !clientes.data?.some((c) => c.id === url.cliente) && (
                      <option value={url.cliente}>Cliente selecionado</option>
                    )}
                    {(clientes.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                )}
                <Select
                  aria-label="Categoria"
                  value={url.categoria ?? ""}
                  onChange={(e) => filtrar({ categoria: e.target.value || undefined })}
                >
                  <option value="">Todas as categorias</option>
                  <option value={SEM_CATEGORIA_URL}>Sem categoria</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.rotulo}
                    </option>
                  ))}
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="date"
                    aria-label="Vencimento de"
                    title="Vencimento de"
                    value={url.de ?? ""}
                    onChange={(e) => filtrar({ de: e.target.value || undefined })}
                  />
                  <Input
                    type="date"
                    aria-label="Vencimento até"
                    title="Vencimento até"
                    value={url.ate ?? ""}
                    onChange={(e) => filtrar({ ate: e.target.value || undefined })}
                  />
                </div>
              </div>

              {/* ── O que o recorte soma, e a saída para o contador ── */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="text-muted-foreground">
                  {contas.data ? (
                    <>
                      {contas.data.total === 1 ? "1 conta" : `${contas.data.total} contas`} ·{" "}
                      <span className={cn("font-semibold tabular-nums", receber ? "text-success" : "text-destructive")}>
                        {formatBRL(contas.data.somaValor)}
                      </span>
                    </>
                  ) : null}
                  {recortado && (
                    <Button variant="ghost" className="ml-1 min-h-11 md:min-h-0" onClick={limparFiltros}>
                      <X className="h-3.5 w-3.5" />
                      Limpar filtros
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={exportar.isPending || totalConfiavel === 0}
                    onClick={() => exportar.mutate(filtro)}
                  >
                    <Download className="h-4 w-4" />
                    {exportar.isPending ? "Exportando…" : rotuloExportar(totalConfiavel)}
                  </Button>
                  {/* O contador costuma querer os DOIS lados do período; a lista mostra um de cada vez. */}
                  <Button
                    variant="ghost"
                    disabled={exportar.isPending}
                    onClick={() => exportar.mutate({ ...filtro, tipo: undefined })}
                  >
                    A receber e a pagar
                  </Button>
                </div>
              </div>

              <div className="mt-3">
                {contas.isError ? (
                  <QueryError onRetry={() => contas.refetch()} />
                ) : (
                  <>
                    <DataTable
                      dados={contas.data?.itens ?? []}
                      colunas={colunas}
                      chaveLinha={(c) => c.id}
                      carregando={contas.isLoading}
                      linhasEsqueleto={5}
                      vazio={
                        <EmptyState
                          icon={receber ? ArrowDownCircle : ArrowUpCircle}
                          title={`Nenhuma conta ${receber ? "a receber" : "a pagar"} ${status === "PENDENTES" ? "pendente" : status === "PAGAS" ? (receber ? "recebida" : "paga") : ""}`.trim()}
                          description={recortado ? "Nenhuma conta neste filtro. Limpe os filtros para ver todas." : "Lance uma nova conta pelo botão acima."}
                        />
                      }
                      acoes={(c) => (
                        <>
                          <Button variant="ghost" size="icon" aria-label={`Editar conta "${c.descricao}"`} onClick={() => abrirEdicao(c)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remover conta "${c.descricao}"`}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => confirmarRemover(c)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    />
                    {contas.data && (
                      <Paginacao
                        pagina={pagina}
                        porPagina={POR_PAGINA}
                        total={contas.data.total}
                        onPagina={(p) => atualizar({ pagina: p })}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
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
        aria-label={receber ? "Marcar como recebida" : "Marcar como paga"}
        className="-m-2.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-input text-transparent transition-colors hover:border-success hover:text-success"
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
