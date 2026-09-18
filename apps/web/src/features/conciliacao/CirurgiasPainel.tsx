import { useState } from "react";
import { Stethoscope } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { EmptyState } from "../../components/ui/empty-state";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { Select } from "../../components/ui/select";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { dataUTC } from "../../lib/format-date";
import { ListaResumo, Paginacao } from "./partes";

/**
 * As cirurgias do TASY de um cliente (spec 2026-09-18). Contagens, não dinheiro: o valor de cada
 * cirurgia depende dos pacotes de códigos, que ainda não chegaram.
 */

const CATEGORIA_LABEL: Record<string, string> = {
  SUS: "SUS",
  CONVENIO: "Convênio",
  AUTOGESTAO: "Autogestão",
  PARTICULAR: "Particular",
  OUTRO: "Outro",
};

const AUTORIZACAO_LABEL: Record<string, string> = {
  AUTORIZADO: "Autorizado",
  PARCIAL: "Parcial",
  PENDENTE: "Pendente",
  NAO_NECESSITA: "Não necessita",
  OUTRO: "—",
};

type Situacao = "" | "SEM_ATENDIMENTO" | "AUTORIZACAO_PENDENTE" | "NAO_EXECUTADA";

export function CirurgiasPainel({ clienteId }: { clienteId: string }) {
  const [competencia, setCompetencia] = useState("");
  const [situacao, setSituacao] = useState<Situacao>("");
  const [operadoraId, setOperadoraId] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);

  const meses = trpc.conciliacao.mesesCirurgias.useQuery({ clienteId });
  const resumo = trpc.conciliacao.resumoCirurgias.useQuery({ clienteId, competencia: competencia || undefined });
  const lista = trpc.conciliacao.cirurgias.useQuery({
    clienteId,
    competencia: competencia || undefined,
    situacao: situacao || undefined,
    operadoraId: operadoraId || undefined,
    busca: busca.trim() || undefined,
    pagina,
  });

  /** Todo filtro volta para a página 1 — senão a pessoa fica numa página que não existe mais. */
  const filtrar = (f: () => void) => {
    f();
    setPagina(1);
  };
  const temFiltro = !!(situacao || operadoraId || busca);

  if (meses.isPending) return <Skeleton className="h-24 w-full" />;
  if (meses.error) return <QueryError message={meses.error.message} onRetry={() => void meses.refetch()} />;
  if (meses.data.meses.length === 0) {
    return (
      <EmptyState
        icon={Stethoscope}
        title="Nenhuma cirurgia importada"
        description="Use “Importar cirurgias” para trazer o mapa cirúrgico exportado do TASY."
      />
    );
  }

  const ultima = meses.data.ultimaImportacao;
  const r = resumo.data;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52 space-y-1">
            <Label htmlFor="cir-mes">Mês</Label>
            <Select id="cir-mes" value={competencia} onChange={(e) => filtrar(() => setCompetencia(e.target.value))}>
              <option value="">Todo o período</option>
              {meses.data.meses.map((m) => (
                <option key={m.competencia} value={m.competencia}>
                  {m.competencia} — {m.cirurgias} cirurgia(s)
                </option>
              ))}
            </Select>
          </div>
          {ultima && (
            <p className="pb-2 text-xs text-muted-foreground">
              Última importação em {dataUTC(ultima.em)} por {ultima.por ?? "—"} · {ultima.nomeArquivo}
              {ultima.periodoInicio && ultima.periodoFim && ` (${dataUTC(ultima.periodoInicio)} a ${dataUTC(ultima.periodoFim)})`}
            </p>
          )}
        </div>

        {r && (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Cirurgias executadas</p>
              <p className="text-2xl font-semibold">{r.executadas}</p>
              {/* O que ainda impede conciliar com o repasse. O filtro "Situação" abaixo lista cada grupo. */}
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                <li className={r.semAtendimento > 0 ? "text-warning" : ""}>{r.semAtendimento} sem número de atendimento</li>
                <li>{r.autorizacaoPendente} com autorização pendente no TASY</li>
                {r.naoExecutadas > 0 && <li>{r.naoExecutadas} não executada(s), fora do total</li>}
              </ul>
            </div>
            <ListaResumo
              titulo="Por tipo de convênio"
              itens={Object.entries(r.porCategoria)
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([c, n]) => ({ rotulo: CATEGORIA_LABEL[c] ?? c, atendimentos: n, pendente: false }))}
            />
            <ListaResumo titulo="Por operadora" itens={r.porOperadora} />
            <ListaResumo
              titulo="Procedimentos mais frequentes"
              itens={r.porProcedimento.map((p) => ({ rotulo: p.procedimento, atendimentos: p.cirurgias, pendente: false }))}
            />
          </div>
        )}
      </div>

      <div className="rounded-lg border">
        <div className="flex flex-wrap items-end gap-3 border-b p-3">
          <div className="w-56 space-y-1">
            <Label htmlFor="cir-situacao">Situação</Label>
            <Select id="cir-situacao" value={situacao} onChange={(e) => filtrar(() => setSituacao(e.target.value as Situacao))}>
              <option value="">Todas</option>
              <option value="SEM_ATENDIMENTO">Sem número de atendimento</option>
              <option value="AUTORIZACAO_PENDENTE">Autorização pendente</option>
              <option value="NAO_EXECUTADA">Não executada</option>
            </Select>
          </div>
          <div className="w-56 space-y-1">
            <Label htmlFor="cir-operadora">Operadora</Label>
            <Select id="cir-operadora" value={operadoraId} onChange={(e) => filtrar(() => setOperadoraId(e.target.value))}>
              <option value="">Todas</option>
              {(r?.porOperadora ?? [])
                .filter((o) => o.operadoraId)
                .map((o) => (
                  <option key={o.operadoraId!} value={o.operadoraId!}>
                    {o.rotulo}
                  </option>
                ))}
            </Select>
          </div>
          <div className="w-56 space-y-1">
            <Label htmlFor="cir-busca">Paciente</Label>
            <Input id="cir-busca" value={busca} placeholder="Buscar pelo nome…" onChange={(e) => filtrar(() => setBusca(e.target.value))} />
          </div>
          {temFiltro && (
            <Button
              variant="ghost"
              onClick={() =>
                filtrar(() => {
                  setSituacao("");
                  setOperadoraId("");
                  setBusca("");
                })
              }
            >
              Limpar
            </Button>
          )}
        </div>

        {lista.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : lista.error ? (
          <QueryError message={lista.error.message} onRetry={() => void lista.refetch()} />
        ) : lista.data.total === 0 ? (
          <EmptyState icon={Stethoscope} title="Nenhuma cirurgia" description="Nenhuma cirurgia com esses filtros." />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Data</TH>
                  <TH>Atendimento</TH>
                  <TH>Paciente</TH>
                  <TH>Procedimento</TH>
                  <TH>Convênio</TH>
                  <TH>Médico</TH>
                  <TH>Autorização</TH>
                </TR>
              </THead>
              <tbody>
                {lista.data.linhas.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      {dataUTC(l.dataCirurgia)}
                      {l.status !== "EXECUTADA" && <span className="block text-xs text-warning">{l.statusBruto}</span>}
                    </TD>
                    <TD>
                      {l.atendimento ?? <span className="text-warning">sem número</span>}
                      <span className="block text-xs text-muted-foreground">cir. {l.numeroCirurgia}</span>
                    </TD>
                    <TD className="font-medium">{l.pacienteNome}</TD>
                    <TD>{l.procedimento}</TD>
                    <TD>
                      {l.operadora ? (
                        l.operadora.nome
                      ) : (
                        <span className="text-warning">
                          {l.convenioBruto} <span className="text-xs">(a ligar)</span>
                        </span>
                      )}
                    </TD>
                    <TD>
                      {l.profissional?.nome ?? (
                        <span className="text-warning">
                          {l.profissionalBruto} <span className="text-xs">(a ligar)</span>
                        </span>
                      )}
                    </TD>
                    <TD className={l.autorizacao === "AUTORIZADO" ? "" : "text-muted-foreground"}>
                      {AUTORIZACAO_LABEL[l.autorizacao] ?? l.autorizacaoBruto}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Paginacao pagina={lista.data.pagina} porPagina={lista.data.porPagina} total={lista.data.total} onPagina={setPagina} />
          </>
        )}
      </div>
    </div>
  );
}
