import { useState } from "react";
import { hasRoleLevel } from "@app/shared";
import { useAuth } from "../../lib/auth-context";
import { useBuscaAdiada } from "../../lib/use-busca-adiada";
import { Download, FileUp, ListChecks, Lock, Stethoscope, Upload } from "lucide-react";
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
import { data as dataBrasilia, dataUTC } from "../../lib/format-date";
import { formatBRL } from "../../lib/masks";
import {
  baixarTexto,
  ConvenioDaLinha,
  ListaResumo,
  Paginacao,
  ROTULO_RECURSO,
  STATUS_CONCILIACAO,
  type CompetenciaFechada,
  type StatusConciliacao,
} from "./partes";
import { EditarCirurgiaDialog, type CirurgiaConciliada } from "./EditarCirurgiaDialog";
import { RecursoDeGlosaDialog } from "./RecursoDeGlosaDialog";
import { ProcedimentosDialog } from "./ProcedimentosDialog";
import { ImportarRecebidoDialog } from "./ImportarRecebidoDialog";
import { HistoricoFechamento } from "./HistoricoFechamentoDialog";

/**
 * As cirurgias do TASY de um cliente, CONCILIADAS: cada uma com cobrado (do de-para do
 * procedimento), recebido (do repasse ou da planilha), glosa e status. Specs 2026-09-18.
 *
 * ⚠️ SÃO DUAS SOMAS DIFERENTES NA MESMA TELA, e confundi-las é ler dinheiro errado. Os números
 * GRANDES do topo são do MÊS escolhido (ou de todos os meses), e não enxergam os filtros de
 * situação, status, operadora e busca — eles vêm de `resumoCirurgias`, que só recebe cliente e
 * competência. A linha fina "No filtro: …", logo acima da tabela, é que respeita os filtros.
 * Por isso os dois blocos dizem no rótulo de qual conjunto estão falando: sem isso a tela mostra
 * "Glosa R$ A" em cima e "glosa R$ B" logo abaixo, sem nada explicando a diferença.
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

/**
 * O valor do `<select>` de operadora que quer dizer "Particular". ⚠️ Não é um id de operadora
 * e NUNCA vai ao servidor como `operadoraId`: particular ligado tem operadora NULA, igual ao
 * convênio que ninguém ligou — por isso vira o campo próprio `particular: true`.
 */
const OPCAO_PARTICULAR = "__particular__";

/** O pedido de exportação levou algum recorte além do mês? (o mês é o escopo, não filtro) */
function pedidoTemFiltro(p: Record<string, unknown>): boolean {
  return Object.entries(p).some(([k, v]) => k !== "clienteId" && k !== "competencia" && v !== undefined);
}

/** Traduz o valor do `<select>` de operadora para o que o servidor entende. */
function filtroDeOperadora(valor: string): { operadoraId?: string; particular?: true } {
  if (!valor) return {};
  return valor === OPCAO_PARTICULAR ? { particular: true } : { operadoraId: valor };
}

export function CirurgiasPainel({ clienteId, clienteNome }: { clienteId: string; clienteNome: string }) {
  const [competencia, setCompetencia] = useState("");
  const [situacao, setSituacao] = useState<Situacao>("");
  const [status, setStatus] = useState<StatusConciliacao | "">("");
  const [operadoraId, setOperadoraId] = useState("");
  const [busca, setBusca, buscaAdiada] = useBuscaAdiada();
  const [soAtrasadas, setSoAtrasadas] = useState(false);
  const [recurso, setRecurso] = useState<"" | "SEM_RECURSO" | "ABERTO" | "SEM_RESPOSTA" | "RESPONDIDO">("");
  const [pagina, setPagina] = useState(1);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [editando, setEditando] = useState<CirurgiaConciliada | null>(null);
  const [recorrendo, setRecorrendo] = useState<CirurgiaConciliada | null>(null);

  const utils = trpc.useUtils();
  const { user } = useAuth();
  // ⚠️ A tela ESCONDE o botão para quem não pode; quem RECUSA é o servidor. Esconder é
  // conveniência, recusar é a regra — e a mesma régua vale nos dois lados (`ADMIN`).
  const podeFechar = hasRoleLevel(user?.role ?? "CLIENTE", "ADMIN");
  const meses = trpc.conciliacao.mesesCirurgias.useQuery({ clienteId });
  const fechadas = trpc.conciliacao.competenciasFechadas.useQuery({ clienteId });
  const resumo = trpc.conciliacao.resumoCirurgias.useQuery({ clienteId, competencia: competencia || undefined });
  const lista = trpc.conciliacao.cirurgias.useQuery(
    {
      clienteId,
      competencia: competencia || undefined,
      situacao: situacao || undefined,
      statusConciliacao: status || undefined,
      ...filtroDeOperadora(operadoraId),
      soAtrasadas: soAtrasadas || undefined,
      recurso: recurso || undefined,
      busca: buscaAdiada.trim() || undefined,
      pagina,
    },
    {
      // ⚠️ Mantém a tabela ANTERIOR na tela enquanto a nova busca vai e volta. Sem isto, mudar
      // filtro ou página joga a lista para o esqueleto e o "nenhum resultado" aparece no meio do
      // caminho — que se lê como "não achei", e não como "ainda estou procurando".
      placeholderData: (anterior) => anterior,
    },
  );

  const fechar = trpc.conciliacao.fecharCompetencia.useMutation({
    onSuccess: (r) => {
      toast(`Competência ${r.competencia} conferida e fechada.`, "success");
      recarregar();
    },
    onError: (e) => toast(e.message),
  });
  const reabrir = trpc.conciliacao.reabrirCompetencia.useMutation({
    onSuccess: () => {
      toast("Competência reaberta — dá para editar de novo.", "success");
      recarregar();
    },
    onError: (e) => toast(e.message),
  });

  const exportar = trpc.conciliacao.exportar.useMutation({
    onSuccess: (r, pedido) => {
      // O arquivo recortado leva "_filtro" no nome: sem isso, a planilha de 2 cirurgias e a do mês
      // inteiro saem com o MESMO nome, e a pasta de Downloads não diz qual é qual.
      const recortado = pedidoTemFiltro(pedido);
      const sufixo = `${clienteNome.replace(/[^\p{L}\p{N}]+/gu, "_").toLowerCase()}${competencia ? `_${competencia}` : ""}${recortado ? "_filtro" : ""}`;
      baixarTexto(r.modelo, `conciliacao_${sufixo}.csv`);
      baixarTexto(r.porConvenio, `resumo_por_convenio_${sufixo}.csv`);
      baixarTexto(r.porMesMedico, `resumo_por_mes_medico_${sufixo}.csv`);
      toast(`${r.linhas} cirurgia(s) exportada(s) em 3 planilhas${recortado ? ", só as do filtro" : ""}.`, "success");
    },
    onError: (e) => toast(e.message),
  });

  /**
   * ⚠️ As três planilhas saem do MESMO recorte da tabela. Com filtro ligado ("glosa sem recurso",
   * por exemplo), exportar entregava 2 cirurgias sem avisar — e quem esperava o mês inteiro
   * mandava à clínica um documento incompleto. Por isso, com filtro, o botão diz QUANTAS vão
   * sair e existe o "Exportar tudo" ao lado. O mês escolhido vale nos dois: ele é o escopo da
   * tela (os totais do topo também são dele), não um filtro.
   */
  const exportarPlanilhas = (comFiltro: boolean) =>
    exportar.mutate({
      clienteId,
      competencia: competencia || undefined,
      ...(comFiltro
        ? {
            ...filtroDeOperadora(operadoraId),
            situacao: situacao || undefined,
            statusConciliacao: status || undefined,
            soAtrasadas: soAtrasadas || undefined,
            recurso: recurso || undefined,
            busca: buscaAdiada.trim() || undefined,
          }
        : {}),
    });

  /** Todo filtro volta para a página 1 — senão a pessoa fica numa página que não existe mais. */
  const filtrar = (f: () => void) => {
    f();
    setPagina(1);
  };
  const recarregar = () => void utils.conciliacao.invalidate();
  const temFiltro = !!(situacao || status || operadoraId || busca || soAtrasadas || recurso);

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
        {temFiltro ? (
          <>
            <Button variant="outline" disabled={exportar.isPending} onClick={() => exportarPlanilhas(true)}>
              <Download className="mr-1.5 h-4 w-4" />
              {exportar.isPending
                ? "Exportando…"
                : // ⚠️ Sem número enquanto a lista do filtro NOVO não chega: o `placeholderData`
                  // ainda mostra a contagem do filtro anterior, e o botão prometeria outra quantidade.
                  lista.data && !lista.isPlaceholderData
                  ? `Exportar ${lista.data.total} cirurgia(s) do filtro`
                  : "Exportar o filtro"}
            </Button>
            <Button variant="ghost" disabled={exportar.isPending} onClick={() => exportarPlanilhas(false)}>
              {competencia ? `Exportar tudo de ${competencia}` : "Exportar tudo"}
            </Button>
          </>
        ) : (
          <Button variant="outline" disabled={exportar.isPending} onClick={() => exportarPlanilhas(false)}>
            <Download className="mr-1.5 h-4 w-4" />
            {exportar.isPending ? "Exportando…" : "Exportar planilhas"}
          </Button>
        )}
      </div>

      {competencia && (
        <FaixaDaCompetencia
          competencia={competencia}
          fechada={fechadas.data?.find((f) => f.competencia === competencia) ?? null}
          podeFechar={podeFechar}
          pendente={fechar.isPending || reabrir.isPending}
          onFechar={(observacao) => fechar.mutate({ clienteId, competencia, observacao })}
          onReabrir={() => reabrir.mutate({ clienteId, competencia })}
        />
      )}
      {/* Fora da faixa de propósito: a faixa some quando o mês é reaberto, e o histórico é
          justamente o que responde "quem tinha fechado?" depois disso. */}
      {competencia && <HistoricoFechamento clienteId={clienteId} competencia={competencia} />}

      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52 space-y-1">
            <Label htmlFor="cir-mes">Mês</Label>
            <Select
              id="cir-mes"
              value={competencia}
              onChange={(e) =>
                filtrar(() => {
                  setCompetencia(e.target.value);
                  // ⚠️ As opções de operadora vêm do RESUMO daquele mês. Trocar de mês sem
                  // limpar a operadora deixava o `<select>` mostrando "Todas" (a operadora sumiu
                  // das opções) enquanto o estado continuava filtrando por ela — a tela afirmava
                  // não ter filtro e mostrava uma operadora só.
                  setOperadoraId("");
                })
              }
            >
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
              Última importação do TASY em {dataBrasilia(ultima.em)} por {ultima.por ?? "—"} · {ultima.nomeArquivo}
              {ultima.periodoInicio && ultima.periodoFim && ` (${dataUTC(ultima.periodoInicio)} a ${dataUTC(ultima.periodoFim)})`}
            </p>
          )}
        </div>

        {resumo.error && (
          // ⚠️ Sem isto, uma falha aqui apaga os quatro números de dinheiro, o aviso de repasse
          // não atribuído e o de repasse sem cirurgia — e a tabela abaixo carrega normalmente,
          // porque é outra consulta. A tela fica com cara de completa e SEM glosa.
          <div className="mt-3">
            <QueryError message={resumo.error.message} onRetry={() => void resumo.refetch()} />
          </div>
        )}

        {d && (
          <>
            <p className="mt-3 text-xs text-muted-foreground">
              {competencia ? `Totais de ${competencia}` : "Totais de todos os meses"} — não seguem os filtros abaixo.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Numero titulo="Cobrado" valor={d.cobrado} dica="Do de-para dos procedimentos, ou digitado" />
              <Numero titulo="Recebido" valor={d.recebido} dica="Do repasse, ou digitado" tom="ok" />
              <Numero titulo="Glosa" valor={d.glosa} dica="Cobrado − recebido do que já foi pago" tom={d.glosa > 0 ? "ruim" : undefined} />
              <Numero titulo="A receber" valor={d.aReceber} dica="Cobrado do que ainda não foi pago" tom="atencao" />
            </div>
          </>
        )}
        {r?.dinheiro && (r.dinheiro.glosaSemRecurso > 0 || r.dinheiro.emRecurso > 0) && (
          <p className="mt-2 flex flex-wrap gap-x-3 text-sm">
            {/* ⚠️ Perdido por OMISSÃO vem primeiro e em vermelho: do resto, pelo menos alguém está
                tentando. Este é o número que ninguém estava vendo. */}
            {r.dinheiro.glosaSemRecurso > 0 && (
              <button
                type="button"
                className="min-h-11 text-left font-medium text-destructive underline-offset-2 hover:underline"
                onClick={() => filtrar(() => setRecurso("SEM_RECURSO"))}
              >
                {formatBRL(r.dinheiro.glosaSemRecurso)} de glosa sem recurso
              </button>
            )}
            {r.dinheiro.emRecurso > 0 && (
              <button
                type="button"
                className="min-h-11 text-left text-primary underline-offset-2 hover:underline"
                onClick={() => filtrar(() => setRecurso("ABERTO"))}
              >
                {formatBRL(r.dinheiro.emRecurso)} em recurso
                {r.dinheiro.recursosSemResposta > 0 && ` · ${r.dinheiro.recursosSemResposta} sem resposta no prazo`}
              </button>
            )}
          </p>
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
              {/* Particular não tem operadora (é nula, como o convênio pendente de ligação), então
                  a lista de ids abaixo nunca o incluiria. Só aparece se o recorte tiver particular. */}
              {r?.porOperadora.some((o) => o.particular) && <option value={OPCAO_PARTICULAR}>Particular</option>}
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
            <Label htmlFor="cir-recurso">Recurso de glosa</Label>
            <Select id="cir-recurso" value={recurso} onChange={(e) => filtrar(() => setRecurso(e.target.value as typeof recurso))}>
              <option value="">Todos</option>
              {/* Primeiro da lista de propósito: é a pergunta que custa dinheiro. */}
              <option value="SEM_RECURSO">Glosa sem recurso (ninguém cuidou)</option>
              <option value="SEM_RESPOSTA">Em recurso, sem resposta no prazo</option>
              <option value="ABERTO">Em recurso</option>
              <option value="RESPONDIDO">Já respondido pela operadora</option>
            </Select>
          </div>

          <div className="w-44 space-y-1">
            <Label htmlFor="cir-atraso">Prazo</Label>
            <Select
              id="cir-atraso"
              value={soAtrasadas ? "sim" : ""}
              onChange={(e) => filtrar(() => setSoAtrasadas(e.target.value === "sim"))}
            >
              <option value="">Todos os prazos</option>
              <option value="sim">Só o que passou do prazo</option>
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
                  setSoAtrasadas(false);
                  setRecurso("");
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
            <Table rotulo="Cirurgias conciliadas">
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
                        {/* ⚠️ Sem esta marca, uma cirurgia de um ano atrás e uma do mês passado
                            dizem a mesma coisa ("a receber") e ninguém sabe qual travou. */}
                        {l.atrasada && <span className="block text-xs font-medium text-destructive">passou do prazo</span>}
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
                        <ConvenioDaLinha operadora={l.operadora} convenioBruto={l.convenioBruto} convenioParticular={l.convenioParticular} />
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
                        {/* ⚠️ Glosa sem recurso é dinheiro perdido por OMISSÃO — o botão precisa
                            estar na própria linha, não escondido num modal que ninguém abre. */}
                        {"glosa" in st || l.recurso ? (
                          <Button
                            variant="ghost"
                            className={`block min-h-11 px-2 text-xs ${l.recurso ? ROTULO_RECURSO[l.recurso.status].cor : "text-muted-foreground"}`}
                            aria-label={
                              l.recurso
                                ? `Recurso da cirurgia ${l.numeroCirurgia} — ${ROTULO_RECURSO[l.recurso.status].rotulo}`
                                : `Abrir recurso da glosa da cirurgia ${l.numeroCirurgia}`
                            }
                            onClick={() => setRecorrendo(l)}
                          >
                            {l.recurso ? ROTULO_RECURSO[l.recurso.status].rotulo : "Recorrer"}
                            {l.recurso?.semResposta && <span className="block text-destructive">sem resposta</span>}
                          </Button>
                        ) : null}
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
        <EditarCirurgiaDialog
          key={editando.id}
          clienteId={clienteId}
          cirurgia={editando}
          onClose={() => setEditando(null)}
          onSalvo={recarregar}
        />
      )}
      {recorrendo && (
        <RecursoDeGlosaDialog
          key={recorrendo.id}
          clienteId={clienteId}
          cirurgia={recorrendo}
          onClose={() => setRecorrendo(null)}
          onSalvo={recarregar}
        />
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
    // Sem `title`: a dica já está escrita logo abaixo, e o atributo num elemento não interativo
    // faz o leitor de tela ler o mesmo texto duas vezes.
    <div className="rounded-lg bg-muted/40 p-3">
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
        <div tabIndex={0} aria-label="Linhas de repasse sem cirurgia" className="max-h-[60vh] overflow-auto rounded-lg border">
          {q.data.length >= 200 && (
            <p className="border-b p-2 text-xs text-muted-foreground">Mostrando as 200 mais recentes — o total acima soma todas.</p>
          )}
          <Table rotulo="Repasse sem cirurgia correspondente">
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

/**
 * O selo do mês conferido — e o aviso de que ele mudou depois.
 *
 * ⚠️ O retrato do fechamento NÃO é exibido como valor corrente em lugar nenhum: ele só aparece
 * aqui, ao lado do valor de hoje, para mostrar a DIFERENÇA. Todo número da tela continua sendo
 * calculado (Fase 2b) — fechar não congela nada, e é por isso que a divergência é possível e
 * precisa ser dita em voz alta.
 */
function FaixaDaCompetencia({
  competencia,
  fechada,
  podeFechar,
  pendente,
  onFechar,
  onReabrir,
}: {
  competencia: string;
  fechada: CompetenciaFechada | null;
  podeFechar: boolean;
  pendente: boolean;
  onFechar: (observacao: string | null) => void;
  onReabrir: () => void;
}) {
  const [observacao, setObservacao] = useState("");

  if (!fechada) {
    if (!podeFechar) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
        <span className="text-muted-foreground">Terminou de conferir {competencia}?</span>
        <Input
          aria-label={`Observação do fechamento de ${competencia}`}
          className="h-9 w-56"
          maxLength={2000}
          placeholder="Observação (opcional)"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />
        <Button variant="outline" disabled={pendente} onClick={() => onFechar(observacao.trim() || null)}>
          {pendente ? "Fechando…" : "Fechar o mês"}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-success/40 bg-success/5 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Lock className="h-4 w-4 shrink-0 text-success" />
        <span className="font-medium">
          {competencia} conferido em {dataBrasilia(fechada.fechadoEm)}
          {fechada.fechadoPor && ` por ${fechada.fechadoPor}`}
        </span>
        <span className="text-muted-foreground">— editar cirurgia ou recurso deste mês está bloqueado.</span>
        {podeFechar && (
          <Button variant="ghost" className="min-h-11" disabled={pendente} onClick={onReabrir}>
            Reabrir
          </Button>
        )}
      </div>
      {fechada.observacao && <p className="mt-1 text-xs text-muted-foreground">{fechada.observacao}</p>}
      {fechada.divergiu && (
        // ⚠️ O mês mudou DEPOIS de conferido — quase sempre porque alguém mexeu no valor de um
        // procedimento, que vale para todas as cirurgias dele, inclusive as de meses antigos.
        <p className="mt-2 text-warning">
          Os números mudaram desde a conferência: fechado com {formatBRL(fechada.retrato.cobrado)} cobrado e{" "}
          {formatBRL(fechada.retrato.glosa)} de glosa; hoje soma {formatBRL(fechada.agora.cobrado)} e {formatBRL(fechada.agora.glosa)}.
        </p>
      )}
    </div>
  );
}
