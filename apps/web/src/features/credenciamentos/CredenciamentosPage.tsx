import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Stethoscope } from "lucide-react";
import {
  STATUS_CREDENCIAMENTO,
  STATUS_CREDENCIAMENTO_FINAIS as FINAIS,
  STATUS_CREDENCIAMENTO_LABEL,
  type StatusCredenciamento,
} from "@app/shared";
import { trpc } from "../../lib/trpc";
import { PageHeader } from "../../components/ui/page-header";
import { EmptyState } from "../../components/ui/empty-state";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { Select } from "../../components/ui/select";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { formatBRL } from "../../lib/masks";
import { data as formatarData } from "../../lib/format-date";
import { MudarStatusDialog } from "../crm/clientes/CredenciamentoGradeCard";

/**
 * PAINEL DE CREDENCIAMENTOS — todos os cruzamentos médico × operadora, de todos os clientes.
 *
 * Existe porque o andamento só vivia dentro da ficha de cada cliente: para saber o que estava
 * travado, a Thaís abria cliente por cliente e somava de cabeça — e, enquanto fosse assim,
 * mantinha a planilha paralela. A tela responde a pergunta que ela faz de manhã: **o que
 * travou e eu preciso cobrar hoje?**
 *
 * Por isso abre ordenada pelo que está parado há mais tempo (e não pelo mais recente, padrão
 * de quase toda listagem daqui), e por isso o alerta vem antes de qualquer filtro.
 *
 * Complementa o `CredenciamentoGradeCard`, que mostra o mesmo dado por cliente, dentro da
 * ficha — e de quem este painel reusa o diálogo de mudança de situação, para as travas de
 * dinheiro viverem num lugar só.
 */

const COR: Record<StatusCredenciamento, string> = {
  A_PROTOCOLAR: "bg-muted text-muted-foreground",
  PROTOCOLADO: "bg-primary/10 text-primary",
  EM_ANALISE: "bg-warning/10 text-warning",
  APROVADO: "bg-success/10 text-success",
  NEGADO: "bg-destructive/10 text-destructive",
  ENCERRADO: "bg-muted text-muted-foreground",
};

type LinhaPainel = {
  id: string;
  status: StatusCredenciamento;
  desde: string | Date;
  valor: number;
  tentativa: number;
  diasParados: number;
  precisaAtencao: boolean;
  motivoNegativa: string | null;
  observacoes: string | null;
  temConta: boolean;
  clienteId: string;
  clienteNome: string;
  profissionalNome: string;
  profissionalEspecialidade: string | null;
  profissionalAtivo: boolean;
  operadoraNome: string;
};

/** "há 3 dias" / "hoje" — o tempo em português, sem a pessoa fazer conta de data. */
function tempoParado(dias: number): string {
  if (dias <= 0) return "hoje";
  if (dias === 1) return "há 1 dia";
  return `há ${dias} dias`;
}

export function CredenciamentosPage() {
  const utils = trpc.useUtils();
  const [clienteId, setClienteId] = useState("");
  const [operadoraId, setOperadoraId] = useState("");
  const [status, setStatus] = useState<"" | StatusCredenciamento>("");
  const [somenteAtencao, setSomenteAtencao] = useState(false);
  const [mudando, setMudando] = useState<LinhaPainel | null>(null);

  const opcoes = trpc.credenciamento.painelOpcoes.useQuery();
  const q = trpc.credenciamento.painel.useQuery({
    clienteId: clienteId || null,
    operadoraId: operadoraId || null,
    status: status ? [status] : null,
    somenteAtencao,
  });

  const temFiltro = Boolean(clienteId || operadoraId || status || somenteAtencao);
  const limpar = () => {
    setClienteId("");
    setOperadoraId("");
    setStatus("");
    setSomenteAtencao(false);
  };

  if (q.error) return <QueryError message={q.error.message} onRetry={() => q.refetch()} />;

  const dados = q.data;
  const linhas = (dados?.linhas ?? []) as LinhaPainel[];
  const resumo = dados?.resumo;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Credenciamentos"
        subtitle="Todos os médicos, em todas as operadoras. O que está parado há mais tempo aparece primeiro."
      />

      {/* O alerta vem antes dos filtros: é a razão de a tela existir. */}
      {resumo && resumo.precisamAtencao > 0 && (
        <button
          onClick={() => setSomenteAtencao(true)}
          className="flex w-full items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-left transition-colors hover:bg-warning/10"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {resumo.precisamAtencao === 1
                ? "1 credenciamento parado há tempo demais"
                : `${resumo.precisamAtencao} credenciamentos parados há tempo demais`}
            </p>
            <p className="text-xs text-muted-foreground">
              Sem andar há {dados?.prazoDias} dias ou mais. Clique para ver só eles — o prazo se ajusta em Ajustes →
              Dados da empresa.
            </p>
          </div>
        </button>
      )}

      {resumo && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">Credenciamentos</p>
            <p className="text-xl font-semibold">{resumo.total}</p>
          </div>
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">Precisam de atenção</p>
            <p className={`text-xl font-semibold ${resumo.precisamAtencao > 0 ? "text-warning" : ""}`}>
              {resumo.precisamAtencao}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">Em curso</p>
            <p className="text-xl font-semibold">{formatBRL(resumo.valorEmCurso)}</p>
            <p className="text-[11px] text-muted-foreground">honorário ainda não aprovado</p>
          </div>
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">Aprovado</p>
            <p className="text-xl font-semibold text-success">{formatBRL(resumo.valorAprovado)}</p>
            <p className="text-[11px] text-muted-foreground">já virou conta a receber</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 shadow-sm">
        <div className="min-w-[10rem] flex-1 space-y-1">
          <Label htmlFor="filtro-cliente">Cliente</Label>
          <Select id="filtro-cliente" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">Todos</option>
            {(opcoes.data?.clientes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1">
          <Label htmlFor="filtro-operadora">Operadora</Label>
          <Select id="filtro-operadora" value={operadoraId} onChange={(e) => setOperadoraId(e.target.value)}>
            <option value="">Todas</option>
            {(opcoes.data?.operadoras ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1">
          <Label htmlFor="filtro-situacao">Situação</Label>
          <Select
            id="filtro-situacao"
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | StatusCredenciamento)}
          >
            <option value="">Todas</option>
            {STATUS_CREDENCIAMENTO.map((s) => (
              <option key={s} value={s}>
                {STATUS_CREDENCIAMENTO_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant={somenteAtencao ? "default" : "outline"}
          onClick={() => setSomenteAtencao((v) => !v)}
          title="Mostra só o que passou do prazo"
        >
          <AlertTriangle className="h-4 w-4" /> Só os parados
        </Button>
        {temFiltro && (
          <Button variant="ghost" onClick={limpar}>
            Limpar filtros
          </Button>
        )}
      </div>

      {q.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : linhas.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          title={temFiltro ? "Nada com esses filtros" : "Nenhum credenciamento ainda"}
          description={
            temFiltro
              ? "Tente afrouxar os filtros — ou limpe todos para ver a lista inteira."
              : "Os credenciamentos aparecem aqui assim que uma proposta com a grade médico × operadora for criada na ficha de um cliente."
          }
        >
          {temFiltro && (
            <Button variant="outline" onClick={limpar}>
              Limpar filtros
            </Button>
          )}
        </EmptyState>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Médico</TH>
              <TH>Operadora</TH>
              <TH>Cliente</TH>
              <TH>Situação</TH>
              <TH>Nesta situação</TH>
              <TH className="text-right">Valor</TH>
              <TH className="text-right">Ação</TH>
            </tr>
          </THead>
          <tbody>
            {linhas.map((l) => (
              <TR key={l.id} className={l.precisaAtencao ? "bg-warning/5" : undefined}>
                <TD>
                  <div className="flex items-start gap-2">
                    {l.precisaAtencao && (
                      <AlertTriangle
                        className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                        aria-label="Parado há tempo demais"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium">{l.profissionalNome}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.profissionalEspecialidade}
                        {l.tentativa > 1 && ` · ${l.tentativa}ª tentativa`}
                      </p>
                      {/* Médico desativado NÃO some daqui: ele foi desativado para preservar o
                          processo em curso (e a cobrança que ele sustenta) — ADR-105. */}
                      {!l.profissionalAtivo && (
                        <span className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          fora da lista
                        </span>
                      )}
                    </div>
                  </div>
                </TD>
                <TD>{l.operadoraNome}</TD>
                <TD>
                  <Link
                    to="/clientes/$clienteId"
                    params={{ clienteId: l.clienteId }}
                    className="text-primary hover:underline"
                  >
                    {l.clienteNome}
                  </Link>
                </TD>
                <TD>
                  <span className={`rounded px-2 py-1 text-xs font-semibold ${COR[l.status]}`}>
                    {STATUS_CREDENCIAMENTO_LABEL[l.status]}
                  </span>
                  {l.motivoNegativa && (
                    <p className="mt-1 max-w-[16rem] text-xs text-destructive">Motivo: {l.motivoNegativa}</p>
                  )}
                  {l.observacoes && (
                    <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground">{l.observacoes}</p>
                  )}
                </TD>
                <TD className={l.precisaAtencao ? "font-semibold text-warning" : "text-muted-foreground"}>
                  {/* Processo terminado mostra QUANDO terminou; processo em curso mostra há
                      quanto tempo espera. "Parado há 3 dias" num aprovado seria falso. */}
                  {FINAIS.includes(l.status) ? formatarData(l.desde) : tempoParado(l.diasParados)}
                </TD>
                <TD className="text-right">
                  {formatBRL(l.valor)}
                  {l.temConta && <p className="text-[11px] text-success">conta criada</p>}
                </TD>
                <TD className="text-right">
                  {l.status === "NEGADO" || l.status === "ENCERRADO" ? (
                    <Link
                      to="/clientes/$clienteId"
                      params={{ clienteId: l.clienteId }}
                      className="text-xs text-primary hover:underline"
                    >
                      Ver na ficha
                    </Link>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setMudando(l)}>
                      Atualizar
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}

      {mudando && (
        <MudarStatusDialog
          celula={mudando}
          titulo={`${mudando.profissionalNome} · ${mudando.operadoraNome} · ${mudando.clienteNome}`}
          onClose={() => setMudando(null)}
          onSaved={() => {
            // Aprovar cria conta a receber: o Financeiro (página) e o card Financeiro da ficha
            // (que lê de `clientes.relacionados`) precisam saber agora — ADR-105, defeito 2.
            utils.credenciamento.painel.invalidate();
            utils.credenciamento.grade.invalidate({ clienteId: mudando.clienteId });
            utils.financeiro.invalidate();
            utils.clientes.relacionados.invalidate({ id: mudando.clienteId });
            setMudando(null);
          }}
        />
      )}
    </div>
  );
}
