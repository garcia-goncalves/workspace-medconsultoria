import { useState } from "react";
import { Download, FileUp, ListChecks, Stethoscope, Upload } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { EmptyState } from "../../components/ui/empty-state";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { Select } from "../../components/ui/select";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { toast } from "../../components/ui/toast";
import { dataUTC } from "../../lib/format-date";
import { formatBRL } from "../../lib/masks";
import { baixarTexto, ListaResumo, Paginacao, STATUS_CONCILIACAO, type StatusConciliacao } from "./partes";
import { EditarCirurgiaDialog, type CirurgiaConciliada } from "./EditarCirurgiaDialog";
import { ProcedimentosDialog } from "./ProcedimentosDialog";
import { ImportarRecebidoDialog } from "./ImportarRecebidoDialog";

/**
 * As cirurgias do TASY de um cliente, CONCILIADAS: cada uma com cobrado (do de-para do
 * procedimento), recebido (do repasse ou da planilha), glosa e status. Specs 2026-09-18.
 *
 * Os números do topo são do filtro inteiro, não da página — "quanto glosou a Unimed em maio" é
 * uma soma, e é ela que a Thaís leva para a clínica.
 */

const CATEGORIA_LABEL: Record<string, string> = {
  SUS: "SUS",
  CONVENIO: "Convênio",
  AUTOGESTAO: "Autogestão",
  PARTICULAR: "Particular",
  OUTRO: "Outro",
};

type Situacao = "" | "SEM_ATENDIMENTO" | "AUTORIZACAO_PENDENTE" | "NAO_EXECUTADA";
type Dialogo = null | "procedimentos" | "repasse" | "planilha" | "semProducao";

const brl = (v: number | null) => (v === null ? "—" : formatBRL(v));

export function CirurgiasPainel({ clienteId, clienteNome }: { clienteId: string; clienteNome: string }) {
  const [competencia, setCompetencia] = useState("");
  const [situacao, setSituacao] = useState<Situacao>("");
  const [status, setStatus] = useState<StatusConciliacao | "">("");
  const [operadoraId, setOperadoraId] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [editando, setEditando] = useState<CirurgiaConciliada | null>(null);

  const utils = trpc.useUtils();
  const meses = trpc.conciliacao.mesesCirurgias.useQuery({ clienteId });
  const resumo = trpc.conciliacao.resumoCirurgias.useQuery({ clienteId, competencia: competencia || undefined });
  const lista = trpc.conciliacao.cirurgias.useQuery({
    clienteId,
    competencia: competencia || undefined,
    situacao: situacao || undefined,
    statusConciliacao: status || undefined,
    operadoraId: operadoraId || undefined,
    busca: busca.trim() || undefined,
    pagina,
  });

  const exportar = trpc.conciliacao.exportar.useMutation({
    onSuccess: (r) => {
      const sufixo = `${clienteNome.replace(/[^\p{L}\p{N}]+/gu, "_").toLowerCase()}${competencia ? `_${competencia}` : ""}`;
      baixarTexto(r.modelo, `conciliacao_${sufixo}.csv`);
      baixarTexto(r.porConvenio, `resumo_por_convenio_${sufixo}.csv`);
      baixarTexto(r.porMesMedico, `resumo_por_mes_medico_${sufixo}.csv`);
      toast(`${r.linhas} cirurgia(s) exportada(s) em 3 planilhas.`, "success");
    },
    onError: (e) => toast(e.message),
  });

  /** Todo filtro volta para a página 1 — senão a pessoa fica numa página que não existe mais. */
  const filtrar = (f: () => void) => {
    f();
    setPagina(1);
  };
  const recarregar = () => void utils.conciliacao.invalidate();
  const temFiltro = !!(situacao || status || operadoraId || busca);

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
  const d = r?.dinheiro;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setDialogo("procedimentos")}>
          <ListChecks className="mr-1.5 h-4 w-4" />
          Procedimentos e valores
        </Button>
        <Button variant="outline" onClick={() => setDialogo("repasse")}>
          <Upload className="mr-1.5 h-4 w-4" />
          Importar repasse
        </Button>
        <Button variant="outline" onClick={() => setDialogo("planilha")}>
          <FileUp className="mr-1.5 h-4 w-4" />
          Importar planilha preenchida
        </Button>
        <Button
          variant="outline"
          disabled={exportar.isPending}
          onClick={() => exportar.mutate({ clienteId, competencia: competencia || undefined, statusConciliacao: status || undefined })}
        >
          <Download className="mr-1.5 h-4 w-4" />
          {exportar.isPending ? "Exportando…" : "Exportar planilhas"}
        </Button>
      </div>

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
              Última importação do TASY em {dataUTC(ultima.em)} por {ultima.por ?? "—"} · {ultima.nomeArquivo}
              {ultima.periodoInicio && ultima.periodoFim && ` (${dataUTC(ultima.periodoInicio)} a ${dataUTC(ultima.periodoFim)})`}
            </p>
          )}
        </div>

        {d && (
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Numero titulo="Cobrado" valor={d.cobrado} dica="Do de-para dos procedimentos, ou digitado" />
            <Numero titulo="Recebido" valor={d.recebido} dica="Do repasse, ou digitado" tom="ok" />
            <Numero titulo="Glosa" valor={d.glosa} dica="Cobrado − recebido do que já foi pago" tom={d.glosa > 0 ? "ruim" : undefined} />
            <Numero titulo="A receber" valor={d.aReceber} dica="Cobrado do que ainda não foi pago" tom="atencao" />
          </div>
        )}
        {r && r.recebidoSemProducao.naoAtribuido !== 0 && (
          <p className="mt-2 text-sm text-warning">
            {formatBRL(r.recebidoSemProducao.naoAtribuido)} de repasse não atribuído — de atendimentos cujas cirurgias estão marcadas "não
            cobrar", não foram realizadas, ou já têm recebido digitado menor que o repasse.
          </p>
        )}
        {r && r.recebidoSemProducao.total !== 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-warning">
              {formatBRL(r.recebidoSemProducao.total)} de repasse sem cirurgia correspondente ({r.recebidoSemProducao.linhas} linha(s)) —
              incrementos, acordos ou atendimentos fora do mapa.
            </span>
            <Button variant="ghost" size="sm" onClick={() => setDialogo("semProducao")}>
              Ver linhas
            </Button>
          </div>
        )}

        {r && (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Cirurgias executadas</p>
              <p className="text-2xl font-semibold">{r.executadas}</p>
              {/* O que ainda impede conciliar. Os filtros abaixo listam cada grupo. */}
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                <li className={r.semAtendimento > 0 ? "text-warning" : ""}>{r.semAtendimento} sem número de atendimento</li>
                <li>{r.autorizacaoPendente} com autorização pendente no TASY</li>
                {(d?.porStatus.SEM_VALOR ?? 0) > 0 && <li className="text-warning">{d!.porStatus.SEM_VALOR} sem valor de referência</li>}
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
            <Label htmlFor="cir-status">Conciliação</Label>
            <Select id="cir-status" value={status} onChange={(e) => filtrar(() => setStatus(e.target.value as StatusConciliacao | ""))}>
              <option value="">Todas</option>
              {(Object.keys(STATUS_CONCILIACAO) as StatusConciliacao[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_CONCILIACAO[s].rotulo}
                  {d?.porStatus[s] ? ` (${d.porStatus[s]})` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-56 space-y-1">
            <Label htmlFor="cir-situacao">Situação no TASY</Label>
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
                  setStatus("");
                  setOperadoraId("");
                  setBusca("");
                })
              }
            >
              Limpar
            </Button>
          )}
        </div>

        {lista.data && temFiltro && (
          <p className="border-b px-3 py-2 text-xs text-muted-foreground">
            No filtro: {lista.data.total} cirurgia(s) · cobrado {formatBRL(lista.data.totais.cobrado)} · recebido{" "}
            {formatBRL(lista.data.totais.recebido)} · glosa {formatBRL(lista.data.totais.glosa)}
          </p>
        )}

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
                  <TH className="text-right">Cobrado</TH>
                  <TH className="text-right">Recebido</TH>
                  <TH className="text-right">Glosa</TH>
                  <TH>Conciliação</TH>
                </TR>
              </THead>
              <tbody>
                {lista.data.linhas.map((l) => {
                  const st = STATUS_CONCILIACAO[l.statusConciliacao];
                  return (
                    <TR key={l.id}>
                      <TD>
                        {dataUTC(l.dataCirurgia)}
                        {l.status !== "EXECUTADA" && <span className="block text-xs text-warning">{l.statusBruto}</span>}
                      </TD>
                      <TD>
                        {l.atendimento ?? <span className="text-warning">sem número</span>}
                        <span className="block text-xs text-muted-foreground">cir. {l.numeroCirurgia}</span>
                      </TD>
                      <TD>
                        <span className="font-medium">{l.pacienteNome}</span>
                        <span className="block text-xs text-muted-foreground">
                          {l.profissional?.nome ?? (
                            <span className="text-warning">
                              {l.profissionalBruto} <span className="text-xs">(a ligar)</span>
                            </span>
                          )}
                        </span>
                      </TD>
                      <TD>
                        {l.procedimento}
                        {l.codigo && <span className="block text-xs text-muted-foreground">{l.codigo}</span>}
                      </TD>
                      <TD>
                        {l.operadora ? (
                          l.operadora.nome
                        ) : (
                          <span className="text-warning">
                            {l.convenioBruto} <span className="text-xs">(a ligar)</span>
                          </span>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-right">
                        {brl(l.cobrado)}
                        {l.cobradoOrigem === "MANUAL" && <span className="block text-xs text-muted-foreground">digitado</span>}
                      </TD>
                      <TD className="whitespace-nowrap text-right">
                        {brl(l.recebido)}
                        {l.dataPagamento && <span className="block text-xs text-muted-foreground">{dataUTC(l.dataPagamento)}</span>}
                      </TD>
                      <TD className={`whitespace-nowrap text-right ${l.glosa ? "text-destructive" : ""}`}>{brl(l.glosa)}</TD>
                      <TD>
                        <Button
                          variant="ghost"
                          className={`min-h-11 px-2 ${st.cor}`}
                          aria-label={`Conciliar a cirurgia ${l.numeroCirurgia} — ${st.rotulo}`}
                          onClick={() => setEditando(l)}
                        >
                          {st.rotulo}
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
            <Paginacao pagina={lista.data.pagina} porPagina={lista.data.porPagina} total={lista.data.total} onPagina={setPagina} />
          </>
        )}
      </div>

      {editando && (
        <EditarCirurgiaDialog clienteId={clienteId} cirurgia={editando} onClose={() => setEditando(null)} onSalvo={recarregar} />
      )}
      {dialogo === "procedimentos" && <ProcedimentosDialog clienteId={clienteId} onClose={() => setDialogo(null)} onSalvo={recarregar} />}
      {(dialogo === "repasse" || dialogo === "planilha") && (
        <ImportarRecebidoDialog
          tipo={dialogo}
          clienteId={clienteId}
          clienteNome={clienteNome}
          onClose={() => setDialogo(null)}
          onImportado={recarregar}
        />
      )}
      {dialogo === "semProducao" && <RecebidoSemProducaoDialog clienteId={clienteId} onClose={() => setDialogo(null)} />}
    </div>
  );
}

function Numero({ titulo, valor, dica, tom }: { titulo: string; valor: number; dica: string; tom?: "ok" | "ruim" | "atencao" }) {
  const cor = tom === "ok" ? "text-success" : tom === "ruim" ? "text-destructive" : tom === "atencao" ? "text-warning" : "";
  return (
    <div className="rounded-lg bg-muted/40 p-3" title={dica}>
      <p className="text-xs font-medium uppercase text-muted-foreground">{titulo}</p>
      <p className={`text-xl font-semibold ${cor}`}>{formatBRL(valor)}</p>
      <p className="text-xs text-muted-foreground">{dica}</p>
    </div>
  );
}

/** O dinheiro que entrou e não casa com cirurgia — nunca some; aparece aqui para alguém explicar. */
function RecebidoSemProducaoDialog({ clienteId, onClose }: { clienteId: string; onClose: () => void }) {
  const q = trpc.conciliacao.recebidoSemProducao.useQuery({ clienteId });
  return (
    <Modal
      open
      onClose={onClose}
      title="Repasse sem cirurgia correspondente"
      size="xl"
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      }
    >
      {q.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : q.error ? (
        <QueryError message={q.error.message} onRetry={() => void q.refetch()} />
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-lg border">
          {q.data.length >= 200 && (
            <p className="border-b p-2 text-xs text-muted-foreground">Mostrando as 200 mais recentes — o total acima soma todas.</p>
          )}
          <Table>
            <THead>
              <TR>
                <TH>Pagamento</TH>
                <TH>Repasse</TH>
                <TH>Atendimento</TH>
                <TH>Descrição</TH>
                <TH>Executor</TH>
                <TH className="text-right">Valor</TH>
              </TR>
            </THead>
            <tbody>
              {q.data.map((l) => (
                <TR key={l.id}>
                  <TD>{l.dataPagamento ? dataUTC(l.dataPagamento) : "—"}</TD>
                  <TD>{l.repasseNumero ?? "—"}</TD>
                  <TD>{l.atendimento ?? "—"}</TD>
                  <TD>{l.descricao ?? l.codigo ?? "—"}</TD>
                  <TD>{l.executor || "—"}</TD>
                  <TD className="whitespace-nowrap text-right">{formatBRL(l.valor)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Modal>
  );
}
