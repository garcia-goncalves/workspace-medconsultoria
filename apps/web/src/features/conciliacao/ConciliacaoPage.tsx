import { useMemo, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Link2, Upload } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { PageHeader } from "../../components/ui/page-header";
import { EmptyState } from "../../components/ui/empty-state";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { Combobox } from "../../components/ui/combobox";
import { Select } from "../../components/ui/select";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { toast } from "../../components/ui/toast";
import { dataUTC } from "../../lib/format-date";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ImportarProducaoDialog } from "./ImportarProducaoDialog";
import { ImportarCirurgiasDialog } from "./ImportarCirurgiasDialog";
import { CirurgiasPainel } from "./CirurgiasPainel";
import { VisaoGeralConciliacao } from "./VisaoGeralConciliacao";
import { ListaResumo, Paginacao } from "./partes";

/**
 * CONCILIAÇÃO — a produção de consultas do cliente, mês a mês.
 *
 * Primeira metade da pergunta que originou o módulo: *"deveria ter recebido 18 mil, recebeu 800"*.
 * Aqui entra o **produzido**; o recebido depende do relatório de repasse (Fase 2).
 *
 * ⚠️ CPF, telefone e e-mail do paciente **não existem** no que a API devolve — não é a tela que
 * os esconde, é o servidor que não os manda (spec §5). O nome fica, porque é o que identifica o
 * atendimento.
 */

const TIPO_LABEL: Record<string, string> = {
  CONSULTA: "Consulta",
  CORTESIA: "Cortesia",
  SEM_VINCULO_AGENDA: "Sem vínculo",
  OUTRO: "Outro",
};

export function ConciliacaoPage() {
  const [clienteId, setClienteId] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [tipo, setTipo] = useState("");
  const [operadoraId, setOperadoraId] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [importando, setImportando] = useState(false);
  const [aba, setAba] = useState<"consultas" | "cirurgias">("consultas");

  const utils = trpc.useUtils();
  const disponivel = trpc.conciliacao.disponivel.useQuery();
  // ⚠️ `conciliacao.clientes`, e não `clientes.list`: aquela devolve a base inteira a qualquer
  // funcionário, e o seletor passaria a oferecer justamente os clientes que o servidor recusa
  // dois cliques depois. A lista tem de ser a mesma que a trava do servidor aceita.
  const clientes = trpc.conciliacao.clientes.useQuery();

  const habilitado = !!clienteId;
  // As consultas da aba Consultas só rodam com ela aberta; as pendências valem para as duas.
  const naAbaConsultas = habilitado && aba === "consultas";
  const competencias = trpc.conciliacao.competencias.useQuery({ clienteId }, { enabled: naAbaConsultas });
  const pendencias = trpc.conciliacao.pendencias.useQuery({ clienteId }, { enabled: habilitado });
  const resumo = trpc.conciliacao.resumo.useQuery({ clienteId, competencia }, { enabled: naAbaConsultas && !!competencia });
  const producao = trpc.conciliacao.producao.useQuery(
    {
      clienteId,
      competencia: competencia || undefined,
      tipoAtendimento: (tipo || undefined) as "CONSULTA" | "CORTESIA" | "SEM_VINCULO_AGENDA" | "OUTRO" | undefined,
      operadoraId: operadoraId || undefined,
      busca: busca.trim() || undefined,
      pagina,
    },
    { enabled: naAbaConsultas },
  );

  const opcoesCliente = useMemo(() => (clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome })), [clientes.data]);

  function trocarCliente(id: string) {
    setClienteId(id);
    // Filtros de um cliente não fazem sentido no outro — zerar evita a tela dizer "nenhum
    // resultado" por causa de um filtro invisível herdado.
    setCompetencia("");
    setTipo("");
    setOperadoraId("");
    setBusca("");
    setPagina(1);
  }

  function recarregar() {
    void utils.conciliacao.invalidate();
  }

  const totalPendencias = (pendencias.data?.convenios.length ?? 0) + (pendencias.data?.profissionais.length ?? 0);

  /**
   * ⚠️ O nome existe para o diálogo de importação dizer PARA QUEM está importando — importar o
   * mapa de um médico na ficha de outra clínica não tem desfazer. Vazio (lista ainda não chegou,
   * ou falhou) o diálogo abria dizendo "Cliente: —" e importava assim mesmo; hoje o botão de
   * importar só aparece com o nome resolvido.
   */
  const nomeDoCliente = opcoesCliente.find((c) => c.value === clienteId)?.label ?? "";

  return (
    <div className="space-y-4">
      <PageHeader title="Conciliação" subtitle="A produção do cliente — consultas e cirurgias — que entra todo mês.">
        {habilitado && !!nomeDoCliente && disponivel.data?.ligado && (
          <Button onClick={() => setImportando(true)}>
            <Upload className="mr-1.5 h-4 w-4" />
            {aba === "cirurgias" ? "Importar cirurgias" : "Importar produção"}
          </Button>
        )}
      </PageHeader>

      {disponivel.error && <QueryError message={disponivel.error.message} onRetry={() => void disponivel.refetch()} />}

      {disponivel.data && !disponivel.data.ligado && (
        <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            O módulo está <strong>desligado</strong>: falta a <code>PACIENTE_CRYPTO_KEY</code> no servidor. Sem ela o dado do paciente
            entraria sem cifra, então a importação fica bloqueada de propósito.
          </div>
        </div>
      )}

      {/* ⚠️ TRÊS ESTADOS, e confundi-los é o defeito clássico desta casa. Combo vazio por FALHA
          de rede fica idêntico a "você não tem cliente nenhum": a pessoa conclui que perdeu o
          acesso e não tenta de novo. E o vazio LEGÍTIMO (funcionário sem cliente sob a sua
          responsabilidade) precisa dizer isso, senão a tela manda "escolha um cliente acima"
          para quem não tem nenhum para escolher. */}
      {clientes.isPending ? (
        <Skeleton className="h-16 max-w-md" />
      ) : clientes.error ? (
        <QueryError message={clientes.error.message} onRetry={() => void clientes.refetch()} />
      ) : opcoesCliente.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="Nenhum cliente sob a sua responsabilidade"
          description="A conciliação de um cliente só abre para quem responde por ele (ou para um administrador). Peça a um administrador que atribua o cliente a você."
        />
      ) : (
        <div className="max-w-md space-y-1">
          <Label htmlFor="cliente">Cliente</Label>
          <Combobox id="cliente" value={clienteId} onChange={trocarCliente} options={opcoesCliente} placeholder="Escolha o cliente…" />
        </div>
      )}

      {opcoesCliente.length === 0 ? null : !habilitado ? (
        // Sem cliente escolhido, a tela mostra todos — e escolher é clicar no nome.
        <VisaoGeralConciliacao
          onEscolher={(id, temCirurgia) => {
            trocarCliente(id);
            // Cliente que só tem consultas importadas caía em "Nenhuma cirurgia importada" — e
            // isso se lê como "esse cliente não tem nada". A linha clicada já sabe o que existe.
            setAba(temCirurgia ? "cirurgias" : "consultas");
          }}
        />
      ) : (
        <>
          {/* As pendências ficam FORA das abas: o de-para é o mesmo para consultas e cirurgias. */}
          {totalPendencias > 0 && <CardPendencias clienteId={clienteId} aoLigar={recarregar} />}

          <Tabs value={aba} onValueChange={(v) => setAba(v as "consultas" | "cirurgias")} className="space-y-4">
            <TabsList aria-label="Tipo de produção">
              <TabsTrigger value="consultas">Consultas</TabsTrigger>
              <TabsTrigger value="cirurgias">Cirurgias (TASY)</TabsTrigger>
            </TabsList>

            <TabsContent value="cirurgias">
              {/* `key`: trocar de cliente recria o painel e zera os filtros — filtro herdado de outra
                  clínica faria a tela dizer "nenhuma cirurgia" sem motivo visível. */}
              <CirurgiasPainel key={clienteId} clienteId={clienteId} clienteNome={nomeDoCliente} />
            </TabsContent>

            <TabsContent value="consultas" className="space-y-4">
              {competencias.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : competencias.error ? (
                <QueryError message={competencias.error.message} onRetry={() => void competencias.refetch()} />
              ) : (
                <ResumoDoMes
                  lotes={competencias.data}
                  competencia={competencia}
                  setCompetencia={(c) => {
                    setCompetencia(c);
                    // ⚠️ A lista de operadoras do filtro vem do RESUMO, que depende da
                    // competência. Trocar de mês sem limpar a operadora escolhida deixava o
                    // `<select>` mostrando "Todas" (a operadora sumiu das opções) enquanto o
                    // estado continuava filtrando por ela — a tela dizia "sem filtro" e mostrava
                    // uma operadora só. Números parciais lidos como o mês inteiro.
                    setOperadoraId("");
                    setPagina(1);
                  }}
                  resumo={resumo.data ?? null}
                  erroDoResumo={resumo.error ? resumo.error.message : null}
                  recarregarResumo={() => void resumo.refetch()}
                />
              )}

              <div className="rounded-lg border">
                <div className="flex flex-wrap items-end gap-3 border-b p-3">
                  <div className="w-44 space-y-1">
                    <Label htmlFor="f-tipo">Tipo</Label>
                    <Select
                      id="f-tipo"
                      value={tipo}
                      onChange={(e) => {
                        setTipo(e.target.value);
                        setPagina(1);
                      }}
                    >
                      <option value="">Todos</option>
                      {Object.entries(TIPO_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-56 space-y-1">
                    <Label htmlFor="f-operadora">Operadora</Label>
                    <Select
                      id="f-operadora"
                      value={operadoraId}
                      onChange={(e) => {
                        setOperadoraId(e.target.value);
                        setPagina(1);
                      }}
                    >
                      <option value="">Todas</option>
                      {(resumo.data?.porOperadora ?? [])
                        .filter((o) => o.operadoraId)
                        .map((o) => (
                          <option key={o.operadoraId!} value={o.operadoraId!}>
                            {o.rotulo}
                          </option>
                        ))}
                    </Select>
                  </div>
                  <div className="w-56 space-y-1">
                    <Label htmlFor="f-busca">Paciente</Label>
                    <Input
                      id="f-busca"
                      value={busca}
                      placeholder="Buscar pelo nome…"
                      onChange={(e) => {
                        setBusca(e.target.value);
                        setPagina(1);
                      }}
                    />
                  </div>
                  {(tipo || operadoraId || busca) && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setTipo("");
                        setOperadoraId("");
                        setBusca("");
                        setPagina(1);
                      }}
                    >
                      Limpar
                    </Button>
                  )}
                </div>

                {producao.isPending ? (
                  <div className="space-y-2 p-3">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : producao.error ? (
                  <QueryError message={producao.error.message} onRetry={() => void producao.refetch()} />
                ) : producao.data.total === 0 ? (
                  <EmptyState
                    icon={FileSpreadsheet}
                    title="Nenhum atendimento"
                    description={
                      tipo || operadoraId || busca
                        ? "Nenhum atendimento com esses filtros."
                        : "Este cliente ainda não tem produção importada. Use “Importar produção”."
                    }
                  />
                ) : (
                  <>
                    <Table>
                      <THead>
                        <TR>
                          <TH>Agenda</TH>
                          <TH>Atendimento</TH>
                          <TH>Paciente</TH>
                          <TH>Tipo</TH>
                          <TH>Convênio</TH>
                          <TH>Profissional</TH>
                        </TR>
                      </THead>
                      <tbody>
                        {producao.data.linhas.map((l) => (
                          <TR key={l.id}>
                            <TD className="text-muted-foreground">{l.dataAgenda ? dataUTC(l.dataAgenda) : "—"}</TD>
                            <TD>{dataUTC(l.dataAtendimento)}</TD>
                            <TD className="font-medium">{l.pacienteNome}</TD>
                            <TD>{TIPO_LABEL[l.tipoAtendimento] ?? l.tipoAtendimentoBruto}</TD>
                            <TD>
                              {l.operadora ? (
                                <>
                                  {l.operadora.nome}
                                  {l.plano && <span className="text-muted-foreground"> · {l.plano}</span>}
                                </>
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
                          </TR>
                        ))}
                      </tbody>
                    </Table>
                    <Paginacao
                      pagina={producao.data.pagina}
                      porPagina={producao.data.porPagina}
                      total={producao.data.total}
                      onPagina={setPagina}
                    />
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      {importando && aba === "consultas" && (
        <ImportarProducaoDialog clienteId={clienteId} open onClose={() => setImportando(false)} onImportado={recarregar} />
      )}
      {importando && aba === "cirurgias" && (
        <ImportarCirurgiasDialog
          clienteId={clienteId}
          clienteNome={opcoesCliente.find((c) => c.value === clienteId)?.label ?? ""}
          open
          onClose={() => setImportando(false)}
          onImportado={recarregar}
        />
      )}
    </div>
  );
}

type Lote = {
  id: string;
  competencia: string;
  nomeArquivo: string;
  formato: string;
  linhasImportadas: number;
  linhasIgnoradas: number;
  createdAt: Date;
  importadoPor: { id: string; nome: string } | null;
};

type Resumo = {
  total: number;
  faturavel: number;
  porTipo: { CONSULTA: number; CORTESIA: number; SEM_VINCULO_AGENDA: number; OUTRO: number };
  porOperadora: { rotulo: string; atendimentos: number; pendente: boolean }[];
  porProfissional: { rotulo: string; atendimentos: number; pendente: boolean }[];
};

function ResumoDoMes({
  lotes,
  competencia,
  setCompetencia,
  resumo,
  erroDoResumo,
  recarregarResumo,
}: {
  lotes: Lote[];
  competencia: string;
  setCompetencia: (c: string) => void;
  resumo: Resumo | null;
  erroDoResumo: string | null;
  recarregarResumo: () => void;
}) {
  if (lotes.length === 0) return null;
  const lote = lotes.find((l) => l.competencia === competencia);

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52 space-y-1">
          <Label htmlFor="competencia">Competência</Label>
          <Select id="competencia" value={competencia} onChange={(e) => setCompetencia(e.target.value)}>
            <option value="">Todas</option>
            {lotes.map((c) => (
              <option key={c.id} value={c.competencia}>
                {c.competencia} — {c.linhasImportadas} atendimento(s)
              </option>
            ))}
          </Select>
        </div>
        {lote && (
          <p className="pb-2 text-xs text-muted-foreground">
            Importado em {dataUTC(lote.createdAt)} por {lote.importadoPor?.nome ?? "—"} · {lote.nomeArquivo} ({lote.formato})
            {lote.linhasIgnoradas > 0 && ` · ${lote.linhasIgnoradas} linha(s) ignorada(s)`}
          </p>
        )}
      </div>

      {competencia && erroDoResumo && (
        // ⚠️ Falha de consulta NÃO pode virar "esse mês não tem nada importado" — é a leitura
        // natural quando o painel de atendimentos/operadora/profissional simplesmente some.
        <div className="mt-3">
          <QueryError message={erroDoResumo} onRetry={recarregarResumo} />
        </div>
      )}

      {competencia && resumo && (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Atendimentos</p>
            <p className="text-2xl font-semibold">{resumo.total}</p>
            {/* Cortesia e particular não geram recebimento — separá-los evita inflar a
                expectativa de receita, que é o número que este módulo existe para acertar. */}
            <p className="mt-1 text-xs text-muted-foreground">
              {resumo.faturavel} de convênio · {resumo.porTipo.CORTESIA} cortesia(s)
            </p>
          </div>
          <ListaResumo titulo="Por operadora" itens={resumo.porOperadora} />
          <ListaResumo titulo="Por profissional" itens={resumo.porProfissional} />
        </div>
      )}
    </div>
  );
}

/**
 * As pendências de de-para. Enquanto houver uma, o resumo por operadora está incompleto — e é
 * por isso que este card fica ACIMA dos números, não escondido numa aba.
 */
function CardPendencias({ clienteId, aoLigar }: { clienteId: string; aoLigar: () => void }) {
  const pendencias = trpc.conciliacao.pendencias.useQuery({ clienteId });
  const operadoras = trpc.documentos.operadoras.list.useQuery();
  const profissionais = trpc.credenciamento.profissionais.useQuery({ clienteId });

  const ligarConvenio = trpc.conciliacao.ligarConvenio.useMutation({
    onSuccess: (r) => {
      toast(`Convênio ligado — ${r.linhasAtualizadas} atendimento(s) atualizado(s).`, "success");
      aoLigar();
    },
    onError: (e) => toast(e.message),
  });
  const ligarProfissional = trpc.conciliacao.ligarProfissional.useMutation({
    onSuccess: (r) => {
      toast(`Profissional ligado — ${r.linhasAtualizadas} atendimento(s) atualizado(s).`, "success");
      aoLigar();
    },
    onError: (e) => toast(e.message),
  });

  // ⚠️ Enquanto o de-para não é ligado, o resumo por operadora fica INCOMPLETO — é o que este
  // próprio card diz mais abaixo. Sumir numa falha de consulta faz a pessoa ler um resumo
  // incompleto como completo, e é esse resumo que vai para a clínica.
  if (pendencias.error) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
        <QueryError message={pendencias.error.message} onRetry={() => void pendencias.refetch()} />
      </div>
    );
  }
  if (!pendencias.data) return null;
  const { convenios, profissionais: profPendentes } = pendencias.data;
  if (convenios.length === 0 && profPendentes.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Link2 className="h-4 w-4 text-warning" />
        <h2 className="text-sm font-semibold">Pendências de ligação</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Enquanto isto não for ligado, o resumo por operadora fica incompleto — a produção aparece pelo texto cru do relatório, sem somar os
        planos da mesma operadora.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {convenios.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Convênios</p>
            <ul className="space-y-2">
              {convenios.map((c) => (
                <li key={c.textoBruto} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{c.textoBruto}</span>
                  <span className="text-xs text-muted-foreground">({c.atendimentos})</span>
                  <Select
                    aria-label={`Operadora de ${c.textoBruto}`}
                    className="h-8 w-48 text-xs"
                    defaultValue=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      ligarConvenio.mutate(
                        v === "__particular__"
                          ? { clienteId, textoBruto: c.textoBruto, operadoraId: null, particular: true }
                          : { clienteId, textoBruto: c.textoBruto, operadoraId: v },
                      );
                    }}
                  >
                    <option value="">Ligar a…</option>
                    <option value="__particular__">Particular (não é convênio)</option>
                    {(operadoras.data ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nome}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        )}

        {profPendentes.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Profissionais</p>
            <ul className="space-y-2">
              {profPendentes.map((p) => (
                <li key={p.textoBruto} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{p.textoBruto}</span>
                  <span className="text-xs text-muted-foreground">({p.atendimentos})</span>
                  <Select
                    aria-label={`Profissional de ${p.textoBruto}`}
                    className="h-8 w-48 text-xs"
                    defaultValue=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) ligarProfissional.mutate({ clienteId, textoBruto: p.textoBruto, profissionalId: v });
                    }}
                  >
                    <option value="">Ligar a…</option>
                    {(profissionais.data ?? []).map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.nome}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
