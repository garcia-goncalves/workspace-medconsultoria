import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Circle, Loader2, Package, Pencil, PenLine, Plus, Trash2, X } from "lucide-react";
import { hasRoleLevel, ehServicoSomentePercentual, ehServicoDeFaturamento } from "@app/shared";
import { useAuth } from "../../../lib/auth-context";
import { trpc, type RouterOutputs } from "../../../lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { useConfirm, useConfirmar } from "../../../components/ui/confirm-dialog";
import { UploadArquivo, ArquivoLink } from "../../../components/ui/upload-arquivo";
import { Modal } from "../../../components/ui/modal";
import { Button } from "../../../components/ui/button";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { MoneyInput } from "../../../components/ui/money-input";
import { formatPreco, formatBRL, formatPct } from "../../../lib/masks";
import { ConveniosPicker } from "../../documentos/ConveniosPicker";
import { RespostaBriefingDialog } from "./RespostaBriefingDialog";
import { recarregarAposEnvio } from "../../../lib/recarregar-apos-envio";

type ServicoContratado = RouterOutputs["clientes"]["servicos"][number];

/** Edita o que o cliente paga por um serviço contratado: valor fixo OU percentual do faturamento. */
function EditarPrecoDialog({ clienteId, item, onClose }: { clienteId: string; item: ServicoContratado; onClose: () => void }) {
  const utils = trpc.useUtils();
  const c = item.contratacao;
  // ⚠️ **QUEM DECIDE É O PREÇO, NUNCA A CATEGORIA (ADR-125/137).** A comparação com
  // "Faturamento" sobrevivia aqui como um dos três ramos do OU — e bastava ela para o editor
  // oferecer Valor e Avulso/Mensal a um serviço que só cobra percentual. Gravar um valor fixo
  // ali faz `ehServicoSomentePercentual` virar false e reconfigura a cobrança em cadeia, em
  // silêncio. Agora as duas formas são EXCLUDENTES, como o servidor exige.
  const [valor, setValor] = useState<number | undefined>(c?.valor ?? undefined);
  const [valorRecorrencia, setValorRecorrencia] = useState<"AVULSO" | "MENSAL">(c?.valorRecorrencia ?? "AVULSO");
  const [percentual, setPercentual] = useState<number | undefined>(c?.percentual ?? undefined);
  // O que vale HOJE decide como o modal abre; o botão decide daí em diante.
  // ⚠️ **QUEM PODE SER PERCENTUAL É A MARCA `Servico.ehFaturamento`** (ordem do dono, 31/08/2026):
  // só o faturamento médico. Sem a marca não há escolha a oferecer — e oferecê-la aqui seria a
  // SEGUNDA PORTA para o mesmo estado que a tela de Serviços passou a recusar (ADR-140): a ficha
  // faria, cliente por cliente, o que o catálogo já não deixa fazer.
  const podeSerPercentual = ehServicoDeFaturamento(item.servico);
  /**
   * ⚠️ O CLIENTE QUE PAGA PERCENTUAL NUM SERVIÇO QUE DEIXOU DE SER PERCENTUAL.
   *
   * A migração marca o CATÁLOGO; ela nunca olha o que cada cliente já contratou. Então pode
   * existir `ClienteServico.percentual > 0` num serviço sem a marca — foi gravado quando a tela
   * oferecia os dois botões a todo mundo.
   *
   * Sem este tratamento, abrir este modal só para CONFERIR o preço e clicar em Salvar mandava
   * `percentual: null` e apagava a cobrança daquele cliente: sem erro, sem aviso, e o servidor
   * aceita, porque REMOVER percentual não viola trava nenhuma. Um cliente que rendia todo mês
   * simplesmente ficaria sem preço.
   */
  const percentualOrfao = !podeSerPercentual && (c?.percentual ?? 0) > 0;
  // Só dá para sair do órfão informando o valor fixo que o substitui — e aí a troca é uma
  // decisão explícita de quem clicou, dita na faixa amarela, não um efeito de salvar.
  const bloqueadoPeloOrfao = percentualOrfao && !(valor && valor > 0);
  const [porPercentual, setPorPercentual] = useState(
    podeSerPercentual &&
      ehServicoSomentePercentual({ valor: c?.valor, percentual: c?.percentual ?? item.servico.percentual }),
  );
  const trocarPara = (pct: boolean) => {
    setPorPercentual(pct);
    // Limpa a outra forma: deixar as duas gravadas é exatamente o que o servidor recusa.
    if (pct) setValor(undefined);
    else setPercentual(undefined);
  };
  // Os convênios que o cliente atende NESTE serviço (ADR-126). Chegam pela proposta aceita e
  // continuam editáveis aqui — a lista muda com o tempo e é dado do cliente, não do documento.
  const [conveniosIds, setConveniosIds] = useState<string[]>((c?.convenios ?? []).map((o) => o.id));
  const salvar = trpc.clientes.atualizarContratacao.useMutation({
    onSuccess: () => (utils.clientes.servicos.invalidate({ id: clienteId }), onClose()),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`${porPercentual ? "Preço e convênios" : "Preço"} · ${item.servico.nome}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={salvar.isPending || bloqueadoPeloOrfao}
            onClick={() =>
              salvar.mutate({
                clienteId,
                servicoId: item.servico.id,
                valor: porPercentual ? null : valor ?? null,
                valorRecorrencia,
                // `percentual: null` só sai quando ELE é o que está sendo trocado. No caso órfão,
                // sair daqui é o que apagava a cobrança em silêncio — e agora o botão só libera
                // depois de a pessoa informar o valor que entra no lugar.
                percentual: porPercentual ? percentual ?? null : null,
                // Só manda a lista quando o campo aparece — proposta/serviço sem convênio não
                // pode zerar de passagem o que já estava gravado.
                ...(porPercentual ? { conveniosIds } : {}),
              })
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">O que este cliente paga por este serviço. Começa com o valor de referência; ajuste como quiser.</p>
        {podeSerPercentual ? (
          <div className="space-y-1.5">
            <Label hint="Valor fixo: um preço em reais, avulso ou mensal. Percentual: uma fatia do que o cliente fatura, cobrada todo mês. Um serviço é de um jeito ou do outro, nunca dos dois.">
              Como este cliente paga
            </Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={porPercentual ? "outline" : "default"} onClick={() => trocarPara(false)}>
                Valor fixo
              </Button>
              <Button type="button" size="sm" variant={porPercentual ? "default" : "outline"} onClick={() => trocarPara(true)}>
                % do faturamento
              </Button>
            </div>
          </div>
        ) : percentualOrfao ? (
          <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-medium">
              Este cliente paga {formatPct(c?.percentual ?? 0)} do faturamento neste serviço.
            </p>
            <p>
              Mas <strong>{item.servico.nome}</strong> não é o serviço de faturamento médico, e só ele é cobrado por
              percentual. Informe abaixo o <strong>valor fixo</strong> que passa a valer: ao salvar, ele substitui o
              percentual atual. Enquanto o valor estiver em branco, não dá para salvar — para o percentual não ser
              apagado sem alguém decidir isso.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Cobrado por <strong className="text-foreground">valor fixo</strong> — avulso (1x) ou mensal. Só o serviço
            de faturamento médico é cobrado por percentual.
          </p>
        )}
        {!porPercentual && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label hint="O que este cliente paga por este serviço.">Valor</Label>
            <MoneyInput value={valor} onChange={setValor} />
          </div>
          <div className="space-y-1.5">
            <Label hint="Avulso: cobrado uma vez. Mensal: cobrado todo mês enquanto o serviço estiver ativo.">Cobrança</Label>
            <Select value={valorRecorrencia} onChange={(e) => setValorRecorrencia(e.target.value as "AVULSO" | "MENSAL")}>
              <option value="AVULSO">Avulso (1x)</option>
              <option value="MENSAL">Mensal</option>
            </Select>
          </div>
        </div>
        )}
        {porPercentual && (
          <div className="space-y-1.5">
            <Label hint="A fatia que a Med recebe sobre o que este cliente faturar no mês. É o preço inteiro deste serviço — não existe valor fixo junto.">
              % do faturamento do cliente (mensal)
            </Label>
            <div className="relative">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                placeholder="0"
                className="h-9 w-full rounded-md border bg-background px-3 pr-7 text-sm outline-none focus:border-primary"
                value={percentual ?? ""}
                onChange={(e) => setPercentual(e.target.value === "" ? undefined : Number(e.target.value))}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </div>
        )}
        {porPercentual && <ConveniosPicker selecionados={conveniosIds} setSelecionados={setConveniosIds} />}
      </div>
    </Modal>
  );
}

/**
 * Serviços que a MedConsultoria oferece, com os CONTRATADOS ligados para este cliente.
 * A equipe liga/desliga; por serviço contratado, mostra as exigências (documentos) e o
 * que já foi enviado, com upload direto na ficha.
 */
export function ServicosContratadosCard({ clienteId }: { clienteId: string }) {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const confirmar = useConfirmar();
  const q = trpc.clientes.servicos.useQuery({ id: clienteId });
  const invalidate = () => utils.clientes.servicos.invalidate({ id: clienteId });
  // ⚠️ UPLOAD é outro caso, e a diferença é o arquivo aparecer ou não. A ficha carrega tudo
  // num lote só e o upload termina ~120 ms depois de esse lote começar; `invalidate` sobre uma
  // consulta EM ANDAMENTO é deduplicado e aceita a resposta anterior ao envio. A correção
  // existia só no card de documentos ao lado e não tinha chegado aqui: anexar um documento de
  // exigência logo depois de abrir a ficha sumia da lista até recarregar. Ver
  // `recarregarAposEnvio`.
  const aposUpload = () => recarregarAposEnvio(q);
  // Contratar/cancelar serviço muda o nº de serviços do cliente → atualiza também a listagem
  // (contador "servicosContratados" e o selo "sem serviço" na ClientesListPage).
  const invalidateComLista = () => {
    invalidate();
    utils.clientes.list.invalidate();
  };
  const ativar = trpc.clientes.ativarServico.useMutation({ onSuccess: invalidateComLista });
  const cancelar = trpc.clientes.cancelarServico.useMutation({ onSuccess: invalidateComLista });
  const removerArquivo = trpc.clientes.removerArquivo.useMutation({ onSuccess: invalidate });
  const { user } = useAuth();
  // Excluir arquivo é ADMIN+ (RBAC). FUNCIONARIO envia/atualiza, mas não exclui.
  const podeExcluirArquivo = hasRoleLevel(user.role, "ADMIN");
  const [respostaAberta, setRespostaAberta] = useState<string | null>(null);
  const [editandoPreco, setEditandoPreco] = useState<ServicoContratado | null>(null);

  const onAtivar = async (servicoId: string, nome: string) => {
    const { confirmado, marcado } = await confirmar({
      title: `Contratar "${nome}" para este cliente?`,
      description: "O serviço passa a constar como contratado na ficha e no Portal do cliente.",
      confirmText: "Contratar",
      icon: Package,
      checkbox: {
        label: "Avisar o cliente por e-mail",
        hint: "O cliente recebe um aviso de que o serviço foi ativado e do que precisamos dele.",
        default: false,
      },
    });
    if (confirmado) ativar.mutate({ clienteId, servicoId, avisarCliente: marcado });
  };
  const onCancelar = async (servicoId: string, nome: string) => {
    // ⚠️ CONFIRMAÇÃO QUE ESCONDE CONSEQUÊNCIA DE DINHEIRO INSTALA DESCONFIANÇA NO SISTEMA.
    // Cancelar encerra a mensalidade (decisão do dono, 28/08/2026), e quem clica precisa ver
    // quantas parcelas param e que as vencidas continuam — antes, não depois. O número vem do
    // servidor, da MESMA função que o cancelamento executa.
    const previa = await utils.clientes.previaCancelamento
      .fetch({ clienteId, servicoId })
      .catch(() => null);
    const sobreODinheiro = !previa
      ? ""
      : previa.parcelasFuturas > 0
        ? ` As cobranças futuras são encerradas: ${previa.parcelasFuturas} ${
            previa.parcelasFuturas === 1 ? "parcela" : "parcelas"
          } de ${formatBRL(previa.valorFuturo)} no total.${
            previa.parcelasVencidas > 0
              ? ` O que já venceu continua a receber (${previa.parcelasVencidas} ${
                  previa.parcelasVencidas === 1 ? "cobrança" : "cobranças"
                }) — o serviço foi prestado.`
              : ""
          }`
        : " Não há cobrança futura a encerrar.";
    const ok = await confirm({
      title: `Cancelar "${nome}"?`,
      description: `O serviço deixa de constar como contratado para este cliente e o trabalho é pausado.${sobreODinheiro}`,
      confirmText: "Cancelar serviço",
      variant: "destructive",
    });
    if (ok) cancelar.mutate({ clienteId, servicoId });
  };
  const onRemoverArquivo = async (id: string, nome: string) => {
    const ok = await confirm({
      title: "Remover documento?",
      description: `"${nome}" será removido. Esta ação não pode ser desfeita.`,
      confirmText: "Remover",
      variant: "destructive",
    });
    if (ok) removerArquivo.mutate({ id });
  };

  const itens = q.data ?? [];
  const contratados = itens.filter((s) => s.contratado).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" /> Serviços contratados
          {itens.length > 0 && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {contratados} de {itens.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando serviços…
          </div>
        ) : itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum serviço no catálogo. Cadastre em{" "}
            <Link to="/servicos" className="text-primary hover:underline">
              Serviços
            </Link>
            .
          </p>
        ) : (
          itens.map((item) => (
            <div
              key={item.servico.id}
              className={
                "rounded-lg border p-3 " + (item.contratado ? "border-primary/30 bg-primary/[0.03]" : "bg-muted/20")
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{item.servico.nome}</span>
                {item.contratado ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-[11px] font-semibold text-success">
                      <Check className="h-3 w-3" /> Contratado
                    </span>
                    {formatPreco(item.contratacao ?? {}) && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                        {formatPreco(item.contratacao ?? {})}
                      </span>
                    )}
                    <button
                      onClick={() => setEditandoPreco(item)}
                      title="Editar preço/cobrança"
                      className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    {item.contratacao?.origem === "FUNIL" && (
                      <span className="text-[11px] text-muted-foreground">(veio do funil)</span>
                    )}
                    {item.pendentes > 0 && (
                      <span className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[11px] font-semibold text-warning">
                        {item.pendentes} doc. pendente{item.pendentes > 1 ? "s" : ""}
                      </span>
                    )}
                    <button
                      onClick={() => onCancelar(item.servico.id, item.servico.nome)}
                      className="ml-auto text-xs font-medium text-destructive hover:underline"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => onAtivar(item.servico.id, item.servico.nome)}
                    className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" /> Contratar
                  </button>
                )}
              </div>

              {/* Os convênios atendidos neste serviço (ADR-126) — à vista na ficha, não só
                  dentro do editor: é a lista sobre a qual o faturamento é apurado. */}
              {item.contratado && (item.contratacao?.convenios?.length ?? 0) > 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Convênios atendidos:</span>{" "}
                  {(item.contratacao?.convenios ?? []).map((o) => o.nome).join(", ")}
                </p>
              )}

              {item.contratado && (
                <div className="mt-3 space-y-2 border-t pt-3">
                  {item.requisitos.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nenhuma exigência configurada.{" "}
                      <Link to="/servicos" className="text-primary hover:underline">
                        Configurar em Serviços
                      </Link>
                    </p>
                  ) : (
                    item.requisitos.map((r) => (
                      <div key={r.id} className="rounded-md border bg-background p-2">
                        <div className="flex items-start gap-2">
                          {r.atendido ? (
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                          ) : (
                            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium text-foreground">{r.titulo}</span>
                              {r.obrigatorio && (
                                <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                                  Obrigatório
                                </span>
                              )}
                              {r.tipo === "INFORMACAO" && (
                                <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-semibold text-primary">
                                  Informação
                                </span>
                              )}
                              {r.tipo === "BRIEFING" && (
                                <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-semibold text-primary">
                                  Formulário
                                </span>
                              )}
                            </div>
                            {r.descricao && <p className="text-xs text-muted-foreground">{r.descricao}</p>}
                            {r.arquivos.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {r.arquivos.map((a) => (
                                  <li key={a.id} className="flex items-center gap-1.5 text-xs">
                                    <ArquivoLink id={a.id} nome={a.nome} className="max-w-[220px]" />
                                    <span className="text-muted-foreground">
                                      · {a.enviadoPorTipo === "CLIENTE" ? "cliente" : "equipe"}
                                    </span>
                                    {podeExcluirArquivo && (
                                      <button
                                        onClick={() => onRemoverArquivo(a.id, a.nome)}
                                        title="Remover"
                                        className="text-muted-foreground/60 hover:text-destructive"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {r.tipo === "DOCUMENTO" ? (
                              <div className="mt-1.5">
                                <UploadArquivo
                                  size="xs"
                                  label={r.atendido ? "Enviar outro" : "Anexar"}
                                  campos={{ clienteId, servicoId: item.servico.id, requisitoId: r.id }}
                                  onDone={aposUpload}
                                />
                              </div>
                            ) : r.respostaId ? (
                              <button
                                onClick={() => setRespostaAberta(r.respostaId!)}
                                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                              >
                                <PenLine className="h-3.5 w-3.5" />
                                {r.respostaStatus === "ENVIADO" ? "Ver respostas" : "Ver rascunho do cliente"}
                              </button>
                            ) : (
                              <p className="mt-1 text-xs text-muted-foreground">Aguardando o cliente preencher.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}

                  {/* Documentos avulsos deste serviço */}
                  {item.arquivosAvulsos.length > 0 && (
                    <ul className="space-y-0.5 pt-1">
                      {item.arquivosAvulsos.map((a) => (
                        <li key={a.id} className="flex items-center gap-1.5 text-xs">
                          <ArquivoLink id={a.id} nome={a.nome} className="max-w-[220px]" />
                          <span className="text-muted-foreground">
                            · {a.enviadoPorTipo === "CLIENTE" ? "cliente" : "equipe"}
                          </span>
                          {podeExcluirArquivo && (
                            <button
                              onClick={() => onRemoverArquivo(a.id, a.nome)}
                              title="Remover"
                              className="text-muted-foreground/60 hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <UploadArquivo
                    size="xs"
                    label="Anexar outro documento"
                    campos={{ clienteId, servicoId: item.servico.id }}
                    onDone={aposUpload}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
      {respostaAberta && <RespostaBriefingDialog respostaId={respostaAberta} onClose={() => setRespostaAberta(null)} />}
      {editandoPreco && <EditarPrecoDialog clienteId={clienteId} item={editandoPreco} onClose={() => setEditandoPreco(null)} />}
    </Card>
  );
}
