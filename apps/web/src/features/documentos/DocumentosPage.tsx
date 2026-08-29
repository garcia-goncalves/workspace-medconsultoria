import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FileText, Search, AlertTriangle, ClipboardCheck, Clock, FileClock, X, type LucideIcon } from "lucide-react";
import { cn } from "@app/ui";
import {
  TIPO_MODELO_LABEL,
  SITUACAO_DOC_LABEL,
  situacaoDocumento,
  type SituacaoDocKey,
} from "@app/shared";
import { trpc, type RouterOutputs } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Badge } from "../../components/ui/badge";
import { EmptyState } from "../../components/ui/empty-state";
import { DataTable, type Coluna } from "../../components/ui/data-table";
import { QueryError } from "../../components/ui/query-error";
import { NovoDocumentoDialog } from "./NovoDocumentoDialog";
import { data } from "../../lib/format-date";

type DocRow = RouterOutputs["documentos"]["list"][number];
/** Filtro de situação: uma situação específica OU um grupo de atenção. */
type FiltroSit = "" | SituacaoDocKey | "REVISAR" | "AGUARDANDO_CLIENTE" | "RASCUNHO_PARADO";

const rascunhoParado = (d: DocRow) =>
  situacaoDocumento(d).key === "RASCUNHO" && (Date.now() - new Date(d.createdAt).getTime()) / 86_400_000 > 7;

/**
 * Documentos = o ARQUIVO de todos os documentos, com **situação coerente** (rascunho → revisão
 * → aprovado → enviado → aguardando/aceito/assinado), busca, filtros e uma faixa "Precisa de
 * atenção" persistente. A criação por cliente é na ficha; modelos/briefings ficam no Ajustes.
 */
export function DocumentosPage() {
  const [novoDoc, setNovoDoc] = useState(false);
  const [busca, setBusca] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fSit, setFSit] = useState<FiltroSit>("");

  const docs = trpc.documentos.list.useQuery();
  // Referência estável (senão `?? []` gera novo array a cada render e derrota os useMemo abaixo).
  const lista = useMemo(() => docs.data ?? [], [docs.data]);

  const clientes = useMemo(() => {
    const set = new Set<string>();
    for (const d of lista) if (d.cliente) set.add(d.cliente.nome);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [lista]);

  // Faixa de atenção — PERSISTENTE (estados estáveis, não some ao editar): precisa de revisão
  // da Med, aguardando o cliente, ou rascunho parado.
  const atencao = useMemo(() => {
    let revisar = 0;
    let aguardando = 0;
    let parados = 0;
    for (const d of lista) {
      const s = situacaoDocumento(d);
      if (s.atencao === "REVISAR") revisar++;
      else if (s.atencao === "AGUARDANDO_CLIENTE") aguardando++;
      if (rascunhoParado(d)) parados++;
    }
    const pills: { key: FiltroSit; label: string; count: number; icon: LucideIcon }[] = [
      { key: "REVISAR", label: "para revisar", count: revisar, icon: ClipboardCheck },
      { key: "AGUARDANDO_CLIENTE", label: "aguardando o cliente", count: aguardando, icon: Clock },
      { key: "RASCUNHO_PARADO", label: "rascunhos parados", count: parados, icon: FileClock },
    ];
    return pills.filter((p) => p.count > 0);
  }, [lista]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lista.filter((d) => {
      if (q && !(d.titulo.toLowerCase().includes(q) || (d.cliente?.nome ?? "").toLowerCase().includes(q))) return false;
      if (fCliente && d.cliente?.nome !== fCliente) return false;
      if (fTipo && d.modelo?.tipo !== fTipo) return false;
      if (fSit) {
        const s = situacaoDocumento(d);
        if (fSit === "REVISAR") return s.atencao === "REVISAR";
        if (fSit === "AGUARDANDO_CLIENTE") return s.atencao === "AGUARDANDO_CLIENTE";
        if (fSit === "RASCUNHO_PARADO") return rascunhoParado(d);
        if (s.key !== fSit) return false;
      }
      return true;
    });
  }, [lista, busca, fCliente, fTipo, fSit]);

  const semNenhum = lista.length === 0;
  const colunas: Coluna<DocRow>[] = [
    {
      chave: "titulo",
      cabecalho: "Documento",
      principal: true,
      valorOrdenacao: (d) => d.titulo,
      render: (d) => (
        <Link
          to="/documentos/$documentoId"
          params={{ documentoId: d.id }}
          className="font-medium text-primary hover:underline"
        >
          {d.titulo}
        </Link>
      ),
    },
    {
      chave: "cliente",
      cabecalho: "Cliente",
      valorOrdenacao: (d) => d.cliente?.nome ?? null,
      render: (d) => <span className="text-muted-foreground">{d.cliente?.nome ?? "—"}</span>,
    },
    {
      chave: "tipo",
      cabecalho: "Tipo",
      ocultaEmCelular: true,
      valorOrdenacao: (d) => (d.modelo ? TIPO_MODELO_LABEL[d.modelo.tipo] : null),
      render: (d) => <span className="text-muted-foreground">{d.modelo ? TIPO_MODELO_LABEL[d.modelo.tipo] : "—"}</span>,
    },
    {
      chave: "situacao",
      cabecalho: "Situação",
      render: (d) => {
        const s = situacaoDocumento(d);
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
    {
      chave: "atualizado",
      cabecalho: "Atualizado",
      ocultaEmCelular: true,
      valorOrdenacao: (d) => new Date(d.updatedAt),
      render: (d) => <span className="text-muted-foreground">{data(d.updatedAt)}</span>,
    },
  ];
  // Valor do dropdown de situação: só reflete situações granulares (grupos vêm dos pills).
  const dropdownSit = fSit === "REVISAR" || fSit === "AGUARDANDO_CLIENTE" || fSit === "RASCUNHO_PARADO" ? "" : fSit;
  const filtrando = !!busca.trim() || !!fCliente || !!fTipo || !!fSit;
  const limpar = () => {
    setBusca("");
    setFCliente("");
    setFTipo("");
    setFSit("");
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Documentos"
        subtitle="O arquivo de todos os documentos (propostas, contratos, atas…), com a situação de cada um. Para gerar um novo para um cliente, use a ficha dele."
      >
        <Button onClick={() => setNovoDoc(true)}>
          <FileText className="h-4 w-4" />
          Novo documento
        </Button>
      </PageHeader>

      {/* Precisa de atenção — resumo compacto e persistente (contadores clicáveis por motivo) */}
      {atencao.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/5 px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4" />
            Precisa de atenção
          </span>
          {atencao.map((p) => {
            const ativo = fSit === p.key;
            return (
              <button
                key={p.key}
                onClick={() => setFSit(ativo ? "" : p.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  ativo
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-warning/40 bg-card text-foreground hover:bg-accent",
                )}
              >
                <p.icon className="h-3.5 w-3.5" />
                <span className="tabular-nums">{p.count}</span> {p.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Busca + filtros */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título ou cliente…"
            className="pl-9"
          />
        </div>
        <div className="w-full sm:w-44">
          <Select aria-label="Filtrar por cliente" value={fCliente} onChange={(e) => setFCliente(e.target.value)}>
            <option value="">Todos os clientes</option>
            {clientes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-40">
          <Select aria-label="Filtrar por tipo" value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
            <option value="">Todos os tipos</option>
            {Object.entries(TIPO_MODELO_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select aria-label="Filtrar por situação" value={dropdownSit} onChange={(e) => setFSit(e.target.value as FiltroSit)}>
            <option value="">Todas as situações</option>
            {Object.entries(SITUACAO_DOC_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        {filtrando && (
          <button
            onClick={limpar}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Limpar busca e filtros"
          >
            <X className="h-4 w-4" />
            Limpar
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {docs.isError ? (
          <QueryError onRetry={() => docs.refetch()} />
        ) : (
          <DataTable
            dados={filtrados}
            colunas={colunas}
            chaveLinha={(d) => d.id}
            carregando={docs.isLoading}
            linhasEsqueleto={6}
            vazio={
              semNenhum ? (
                <EmptyState
                  icon={FileText}
                  title="Nenhum documento ainda"
                  description="Gere propostas e documentos na ficha de cada cliente — eles aparecem aqui."
                />
              ) : (
                <EmptyState icon={Search} title="Nenhum documento encontrado" description="Ajuste a busca ou os filtros acima.">
                  <Button variant="outline" onClick={limpar}>
                    <X className="h-4 w-4" />
                    Limpar filtros
                  </Button>
                </EmptyState>
              )
            }
          />
        )}
      </div>

      <NovoDocumentoDialog open={novoDoc} onClose={() => setNovoDoc(false)} />
    </div>
  );
}
