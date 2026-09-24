import { useState, type Dispatch, type SetStateAction } from "react";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { ehServicoDeFaturamento, resumoInvestimentoPersonalizado } from "@app/shared";
import { cn } from "@app/ui";
import { trpc } from "../../lib/trpc";
import { BotaoIA } from "../../components/ia/BotaoIA";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { HintIcon } from "../../components/ui/tooltip";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";
import { MoneyInput } from "../../components/ui/money-input";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { formatBRL, formatPct } from "../../lib/masks";
import {
  mover,
  novaChave,
  novaLinha,
  payloadDaPersonalizada,
  resolverParaPrevia,
  type LinhaForm,
  type PersonalizadaForm,
} from "./proposta-personalizada";

/** Botões ↑ ↓ 🗑 de uma linha — alvo de toque de 44px, com nome para leitor de tela. */
function AcoesDaLinha({
  rotulo,
  primeiro,
  ultimo,
  onSubir,
  onDescer,
  onRemover,
}: {
  rotulo: string;
  primeiro: boolean;
  ultimo: boolean;
  onSubir: () => void;
  onDescer: () => void;
  onRemover: () => void;
}) {
  const cls = "h-11 w-11";
  return (
    <div className="flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cls}
        disabled={primeiro}
        onClick={onSubir}
        aria-label={`Subir ${rotulo}`}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cls}
        disabled={ultimo}
        onClick={onDescer}
        aria-label={`Descer ${rotulo}`}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(cls, "text-destructive")}
        onClick={onRemover}
        aria-label={`Remover ${rotulo}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Uma sugestão da IA esperando a pessoa decidir — nada entra no papel sem o clique dela. */
function Sugestao({
  texto,
  acao,
  onAceitar,
  onDescartar,
}: {
  texto: string;
  acao: string;
  onAceitar: () => void;
  onDescartar: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <Sparkles className="h-3.5 w-3.5" /> Sugestão da IA — revise antes de usar
      </p>
      <p className="whitespace-pre-wrap text-foreground">{texto}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className="min-h-11" onClick={onAceitar}>
          {acao}
        </Button>
        <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={onDescartar}>
          Descartar
        </Button>
      </div>
    </div>
  );
}

/**
 * O EDITOR DA PROPOSTA PERSONALIZADA (ADR-156) — o coringa com tudo livre: serviços do catálogo e
 * linhas avulsas (valor fixo avulso/mensal ou percentual), seções e cláusulas reordenáveis,
 * validade e observações, com a IA ajudando em cada parte. O estado mora no pai
 * (`NovoDocumentoDialog`), que desenha a prévia e envia.
 */
export function PropostaPersonalizadaEditor({
  form,
  setForm,
  clienteId,
  leadId,
  iaDisponivel,
}: {
  form: PersonalizadaForm;
  setForm: Dispatch<SetStateAction<PersonalizadaForm>>;
  clienteId?: string;
  leadId?: string;
  /** `undefined` enquanto a consulta carrega. */
  iaDisponivel: boolean | undefined;
}) {
  const confirm = useConfirm();
  const servicos = trpc.servicos.ativos.useQuery();
  const ia = trpc.documentos.assistentePersonalizado.useMutation();
  // Qual botão de IA disparou — para o carregando e a sugestão aparecerem no lugar certo.
  const [alvoIA, setAlvoIA] = useState<string | null>(null);
  const [sugestaoSecoes, setSugestaoSecoes] = useState<{ titulo: string; corpo: string }[] | null>(null);
  const [revisoes, setRevisoes] = useState<Record<string, string>>({});
  const [resumo, setResumo] = useState("");
  const [pedidoClausula, setPedidoClausula] = useState("");
  const [clausulaSugerida, setClausulaSugerida] = useState<string | null>(null);
  const [resumoInvest, setResumoInvest] = useState<string | null>(null);

  const catalogo = servicos.data ?? [];
  const { itens: resolvidos } = resolverParaPrevia(form, catalogo);
  const totais = resumoInvestimentoPersonalizado(resolvidos);

  const setLinha = (chave: string, patch: Partial<LinhaForm>) =>
    setForm((f) => ({ ...f, itens: f.itens.map((l) => (l.chave === chave ? { ...l, ...patch } : l)) }));

  const pedirIA = async (alvo: string, fn: () => Promise<void>) => {
    setAlvoIA(alvo);
    try {
      await fn();
    } catch {
      /* a mensagem aparece por `ia.error` */
    } finally {
      setAlvoIA(null);
    }
  };
  const pendente = (alvo: string) => ia.isPending && alvoIA === alvo;

  /** Remover pede confirmação quando há texto — é o que a casa faz com toda ação destrutiva. */
  const removerComConfirmacao = async (temTexto: boolean, rotulo: string, remover: () => void) => {
    if (
      temTexto &&
      !(await confirm({
        title: `Remover ${rotulo}?`,
        description: "O texto digitado será perdido.",
        confirmText: "Remover",
        variant: "destructive",
      }))
    )
      return;
    remover();
  };

  return (
    <div className="space-y-5">
      {/* ── Investimento ─────────────────────────────── */}
      <section className="space-y-2">
        <Label hint="Serviços do catálogo viram serviço contratado quando o cliente aceita. A linha avulsa é combinada só neste papel.">
          Itens do investimento
        </Label>
        {form.itens.some((l) => l.servicoId === null) && (
          <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Linha avulsa vale só neste papel: ao aceitar, ela <strong>não vira serviço contratado nem conta a receber</strong>. Lance essa
            cobrança à mão no Financeiro.
          </p>
        )}
        {form.itens.length === 0 && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Nenhum item ainda. Sem itens, a proposta sai só com as seções de texto.
          </p>
        )}
        {form.itens.map((l, i) => {
          const sv = l.servicoId ? catalogo.find((s) => s.id === l.servicoId) : undefined;
          // Percentual só na linha avulsa ou no serviço marcado como faturamento médico (ADR-145):
          // o servidor recusa o resto, e a tela não oferece o que o servidor recusa.
          const podePercentual = !l.servicoId || ehServicoDeFaturamento(sv);
          const r = resolvidos[i];
          const sub = r ? (r.valor || 0) * (r.quantidade || 1) : 0;
          return (
            <div key={l.chave} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  {l.servicoId !== null ? (
                    <>
                      <Select
                        aria-label="Serviço do catálogo"
                        value={l.servicoId}
                        onChange={(e) => {
                          const novo = catalogo.find((s) => s.id === e.target.value);
                          setLinha(l.chave, {
                            servicoId: e.target.value,
                            valor: novo?.valor ?? 0,
                            recorrencia: novo?.valorRecorrencia ?? "AVULSO",
                            cobranca: "FIXO",
                            percentual: null,
                          });
                        }}
                      >
                        {catalogo.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nome}
                          </option>
                        ))}
                      </Select>
                      <Input
                        aria-label="Texto no papel (opcional)"
                        value={l.descricao}
                        onChange={(e) => setLinha(l.chave, { descricao: e.target.value })}
                        placeholder={`Texto no papel (opcional) — em branco usa "${sv?.nome ?? "o nome do catálogo"}"`}
                      />
                    </>
                  ) : (
                    <Input
                      aria-label="Descrição da linha avulsa"
                      value={l.descricao}
                      onChange={(e) => setLinha(l.chave, { descricao: e.target.value })}
                      placeholder="Descrição da linha avulsa (ex.: Treinamento da recepção)"
                    />
                  )}
                </div>
                <AcoesDaLinha
                  rotulo={`o item ${i + 1}`}
                  primeiro={i === 0}
                  ultimo={i === form.itens.length - 1}
                  onSubir={() => setForm((f) => ({ ...f, itens: mover(f.itens, i, -1) }))}
                  onDescer={() => setForm((f) => ({ ...f, itens: mover(f.itens, i, 1) }))}
                  onRemover={() =>
                    void removerComConfirmacao(!!l.descricao.trim(), `o item ${i + 1}`, () =>
                      setForm((f) => ({ ...f, itens: f.itens.filter((x) => x.chave !== l.chave) })),
                    )
                  }
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border bg-muted/40 p-0.5" role="group" aria-label="Como este item é cobrado">
                  {(["FIXO", "PERCENTUAL"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={c === "PERCENTUAL" && !podePercentual}
                      aria-pressed={l.cobranca === c}
                      onClick={() => setLinha(l.chave, { cobranca: c })}
                      title={
                        c === "PERCENTUAL" && !podePercentual ? "Só o serviço de faturamento médico é cobrado por percentual." : undefined
                      }
                      className={cn(
                        "min-h-11 rounded px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        l.cobranca === c ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {c === "FIXO" ? "Valor fixo" : "% do faturamento"}
                    </button>
                  ))}
                </div>
                {l.cobranca === "FIXO" ? (
                  <>
                    <MoneyInput
                      aria-label="Valor"
                      value={l.valor}
                      onChange={(v) => setLinha(l.chave, { valor: v ?? 0 })}
                      className="h-11 w-32"
                    />
                    <span className="text-xs text-muted-foreground">×</span>
                    <Input
                      aria-label="Quantidade"
                      type="number"
                      min="1"
                      step="1"
                      value={String(l.quantidade)}
                      onChange={(e) => setLinha(l.chave, { quantidade: Math.max(1, Number(e.target.value) || 1) })}
                      className="h-11 w-16"
                    />
                    <Select
                      aria-label="Recorrência"
                      value={l.recorrencia}
                      onChange={(e) => setLinha(l.chave, { recorrencia: e.target.value as "AVULSO" | "MENSAL" })}
                      className="h-11 w-auto"
                    >
                      <option value="AVULSO">avulso (1x)</option>
                      <option value="MENSAL">mensal</option>
                    </Select>
                  </>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Input
                      aria-label="Percentual do faturamento"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={l.percentual ?? ""}
                      onChange={(e) => setLinha(l.chave, { percentual: e.target.value === "" ? null : Number(e.target.value) })}
                      className="h-11 w-20"
                    />
                    % ao mês
                  </div>
                )}
                <span className="ml-auto text-sm font-semibold tabular-nums text-primary">
                  {l.cobranca === "PERCENTUAL"
                    ? l.percentual
                      ? `${formatPct(l.percentual)}/mês`
                      : "a combinar"
                    : sub > 0
                      ? `${formatBRL(sub)}${l.recorrencia === "MENSAL" ? "/mês" : ""}`
                      : "a combinar"}
                </span>
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={!catalogo.length}
            onClick={() => {
              const s = catalogo[0];
              if (s) setForm((f) => ({ ...f, itens: [...f.itens, novaLinha(s)] }));
            }}
          >
            <Plus className="h-4 w-4" /> Serviço do catálogo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => setForm((f) => ({ ...f, itens: [...f.itens, novaLinha()] }))}
          >
            <Plus className="h-4 w-4" /> Linha avulsa
          </Button>
        </div>
        {form.itens.length > 0 && (
          <div className="space-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm">
            {totais.avulso > 0 && (
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">À vista (1x)</span>
                <span className="font-semibold tabular-nums">{formatBRL(totais.avulso)}</span>
              </div>
            )}
            {totais.mensal > 0 && (
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Mensal</span>
                <span className="font-semibold tabular-nums">{formatBRL(totais.mensal)}/mês</span>
              </div>
            )}
            {totais.percentuais.map((p, k) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="min-w-0 truncate text-muted-foreground">{p.nome}</span>
                <span className="font-semibold tabular-nums">{formatPct(p.percentual)}/mês</span>
              </div>
            ))}
            {totais.avulso === 0 && totais.mensal === 0 && totais.percentuais.length === 0 && (
              <div className="text-muted-foreground">Valores a combinar</div>
            )}
          </div>
        )}
        <BotaoIA
          ocupado={ia.isPending}
          iaDisponivel={iaDisponivel}
          pendente={pendente("investimento")}
          disabled={!payloadDaPersonalizada(form).itens.length}
          onClick={() =>
            void pedirIA("investimento", async () => {
              const r = await ia.mutateAsync({ acao: "resumirInvestimento", itens: payloadDaPersonalizada(form).itens });
              if (r.acao === "resumirInvestimento") setResumoInvest(r.texto);
            })
          }
        >
          Resumir o investimento com IA
        </BotaoIA>
        {resumoInvest && (
          <Sugestao
            texto={resumoInvest}
            acao="Inserir como seção"
            onAceitar={() => {
              setForm((f) => ({
                ...f,
                secoes: [...f.secoes, { chave: novaChave(), titulo: "Resumo do investimento", corpo: resumoInvest }],
              }));
              setResumoInvest(null);
            }}
            onDescartar={() => setResumoInvest(null)}
          />
        )}
      </section>

      {/* ── Seções ───────────────────────────────────── */}
      <section className="space-y-2">
        <Label hint="Cada seção vira um título com texto no documento, na ordem desta lista. Aceita Markdown (listas com '-', **negrito**). Seção sem texto não aparece.">
          Seções do documento
        </Label>
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <Label htmlFor="pers-resumo" hint="Conte o que o cliente pediu. A IA sugere as seções; você escolhe se entram.">
            Pedido do cliente (para a IA)
          </Label>
          <Textarea
            id="pers-resumo"
            rows={2}
            value={resumo}
            onChange={(e) => setResumo(e.target.value)}
            placeholder="Ex.: clínica de 3 médicos quer organizar a agenda e treinar a recepção em 60 dias."
          />
          <BotaoIA
            ocupado={ia.isPending}
            iaDisponivel={iaDisponivel}
            pendente={pendente("secoes")}
            disabled={!resumo.trim()}
            onClick={() =>
              void pedirIA("secoes", async () => {
                const r = await ia.mutateAsync({ acao: "sugerirSecoes", resumo, clienteId, leadId });
                if (r.acao === "sugerirSecoes") setSugestaoSecoes(r.secoes);
              })
            }
          >
            Sugerir seções com IA
          </BotaoIA>
          {sugestaoSecoes && (
            <Sugestao
              texto={
                sugestaoSecoes.length
                  ? sugestaoSecoes.map((s) => `${s.titulo}\n${s.corpo}`).join("\n\n")
                  : "A IA não devolveu nenhuma seção. Tente descrever o pedido de outro jeito."
              }
              acao={`Adicionar ${sugestaoSecoes.length} ${sugestaoSecoes.length === 1 ? "seção" : "seções"}`}
              onAceitar={() => {
                setForm((f) => ({ ...f, secoes: [...f.secoes, ...sugestaoSecoes.map((s) => ({ chave: novaChave(), ...s }))] }));
                setSugestaoSecoes(null);
              }}
              onDescartar={() => setSugestaoSecoes(null)}
            />
          )}
        </div>
        {form.secoes.map((s, i) => (
          <div key={s.chave} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-start gap-2">
              <Input
                aria-label={`Título da seção ${i + 1}`}
                value={s.titulo}
                onChange={(e) =>
                  setForm((f) => ({ ...f, secoes: f.secoes.map((x) => (x.chave === s.chave ? { ...x, titulo: e.target.value } : x)) }))
                }
                placeholder="Título da seção"
                className="min-w-0 flex-1"
              />
              <AcoesDaLinha
                rotulo={`a seção ${i + 1}`}
                primeiro={i === 0}
                ultimo={i === form.secoes.length - 1}
                onSubir={() => setForm((f) => ({ ...f, secoes: mover(f.secoes, i, -1) }))}
                onDescer={() => setForm((f) => ({ ...f, secoes: mover(f.secoes, i, 1) }))}
                onRemover={() =>
                  void removerComConfirmacao(!!s.corpo.trim(), `a seção "${s.titulo || i + 1}"`, () =>
                    setForm((f) => ({ ...f, secoes: f.secoes.filter((x) => x.chave !== s.chave) })),
                  )
                }
              />
            </div>
            <Textarea
              aria-label={`Texto da seção ${i + 1}`}
              rows={3}
              value={s.corpo}
              onChange={(e) =>
                setForm((f) => ({ ...f, secoes: f.secoes.map((x) => (x.chave === s.chave ? { ...x, corpo: e.target.value } : x)) }))
              }
              placeholder="Texto da seção"
            />
            <BotaoIA
              ocupado={ia.isPending}
              iaDisponivel={iaDisponivel}
              pendente={pendente(s.chave)}
              disabled={!s.corpo.trim()}
              onClick={() =>
                void pedirIA(s.chave, async () => {
                  const r = await ia.mutateAsync({ acao: "revisarTexto", texto: s.corpo });
                  if (r.acao === "revisarTexto") setRevisoes((v) => ({ ...v, [s.chave]: r.texto }));
                })
              }
            >
              Revisar texto com IA
            </BotaoIA>
            {revisoes[s.chave] && (
              <Sugestao
                texto={revisoes[s.chave]!}
                acao="Substituir o texto"
                onAceitar={() => {
                  const novo = revisoes[s.chave]!;
                  setForm((f) => ({ ...f, secoes: f.secoes.map((x) => (x.chave === s.chave ? { ...x, corpo: novo } : x)) }));
                  setRevisoes(({ [s.chave]: _, ...resto }) => resto);
                }}
                onDescartar={() => setRevisoes(({ [s.chave]: _, ...resto }) => resto)}
              />
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => setForm((f) => ({ ...f, secoes: [...f.secoes, { chave: novaChave(), titulo: "", corpo: "" }] }))}
        >
          <Plus className="h-4 w-4" /> Seção
        </Button>
      </section>

      {/* ── Cláusulas ────────────────────────────────── */}
      <section className="space-y-2">
        <Label hint="Saem numeradas, na ordem desta lista, na seção Cláusulas.">Cláusulas</Label>
        {form.clausulas.map((c, i) => (
          <div key={c.chave} className="flex items-start gap-2">
            <span className="mt-3 w-5 shrink-0 text-right text-sm text-muted-foreground">{i + 1}.</span>
            <Textarea
              aria-label={`Cláusula ${i + 1}`}
              rows={2}
              value={c.texto}
              onChange={(e) =>
                setForm((f) => ({ ...f, clausulas: f.clausulas.map((x) => (x.chave === c.chave ? { ...x, texto: e.target.value } : x)) }))
              }
              className="min-w-0 flex-1"
            />
            <AcoesDaLinha
              rotulo={`a cláusula ${i + 1}`}
              primeiro={i === 0}
              ultimo={i === form.clausulas.length - 1}
              onSubir={() => setForm((f) => ({ ...f, clausulas: mover(f.clausulas, i, -1) }))}
              onDescer={() => setForm((f) => ({ ...f, clausulas: mover(f.clausulas, i, 1) }))}
              onRemover={() =>
                void removerComConfirmacao(!!c.texto.trim(), `a cláusula ${i + 1}`, () =>
                  setForm((f) => ({ ...f, clausulas: f.clausulas.filter((x) => x.chave !== c.chave) })),
                )
              }
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => setForm((f) => ({ ...f, clausulas: [...f.clausulas, { chave: novaChave(), texto: "" }] }))}
        >
          <Plus className="h-4 w-4" /> Cláusula
        </Button>
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <Input
            aria-label="O que a cláusula deve garantir"
            value={pedidoClausula}
            onChange={(e) => setPedidoClausula(e.target.value)}
            placeholder="O que a cláusula deve garantir? (ex.: sigilo dos dados da clínica)"
          />
          <BotaoIA
            ocupado={ia.isPending}
            iaDisponivel={iaDisponivel}
            pendente={pendente("clausula")}
            disabled={!pedidoClausula.trim()}
            onClick={() =>
              void pedirIA("clausula", async () => {
                const r = await ia.mutateAsync({ acao: "redigirClausula", pedido: pedidoClausula });
                if (r.acao === "redigirClausula") setClausulaSugerida(r.texto);
              })
            }
          >
            Redigir cláusula com IA
          </BotaoIA>
          {clausulaSugerida && (
            <Sugestao
              texto={clausulaSugerida}
              acao="Adicionar cláusula"
              onAceitar={() => {
                setForm((f) => ({ ...f, clausulas: [...f.clausulas, { chave: novaChave(), texto: clausulaSugerida }] }));
                setClausulaSugerida(null);
                setPedidoClausula("");
              }}
              onDescartar={() => setClausulaSugerida(null)}
            />
          )}
        </div>
      </section>

      {ia.error && <p className="text-sm text-destructive">{ia.error.message}</p>}

      {/* ── Condições ────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="pers-validade" hint="Por quantos dias, a partir de hoje, a proposta vale.">
            Validade (dias)
          </Label>
          <Input
            id="pers-validade"
            type="number"
            min="1"
            max="365"
            value={String(form.validadeDias)}
            onChange={(e) => setForm((f) => ({ ...f, validadeDias: Number(e.target.value) || 0 }))}
            className="h-11"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span id="pers-forma-rotulo" className="text-sm font-medium">
              Forma de pagamento
            </span>
            <HintIcon text="A MedConsultoria recebe somente por PIX. Os dados do PIX saem sozinhos, vindos de Ajustes → Dados da empresa." />
          </div>
          <p aria-labelledby="pers-forma-rotulo" className="flex h-11 items-center rounded-md border bg-muted/40 px-3 text-sm">
            PIX
          </p>
        </div>
      </section>
      <div className="space-y-1">
        <Label htmlFor="pers-obs">Observações</Label>
        <Textarea
          id="pers-obs"
          rows={2}
          value={form.observacoes}
          onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
        />
      </div>
    </div>
  );
}
