import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Briefcase,
  ListChecks,
  X,
  ClipboardCheck,
  Sparkles,
  Loader2,
  Settings2,
  FileText,
  Paperclip,
  PenLine,
  FormInput,
  Route,
} from "lucide-react";
import { cn } from "@app/ui";
import {
  createServicoSchema,
  type CreateServicoInput,
  ETAPA_CHAVES,
  ETAPA_CHAVE_LABEL,
  CATEGORIAS_SERVICO,
  ehServicoSomentePercentual,
  type AddServicoPassoInput,
} from "@app/shared";
import { useForm, Controller, useWatch, type Control, type UseFormSetValue } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc, type RouterOutputs } from "../../../lib/trpc";
import { PageHeader } from "../../../components/ui/page-header";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import { Select } from "../../../components/ui/select";
import { MoneyInput } from "../../../components/ui/money-input";
import { formatPreco } from "../../../lib/masks";
import { Badge } from "../../../components/ui/badge";
import { Skeleton } from "../../../components/ui/skeleton";
import { QueryError } from "../../../components/ui/query-error";
import { EmptyState } from "../../../components/ui/empty-state";
import { Modal } from "../../../components/ui/modal";
import { useConfirm } from "../../../components/ui/confirm-dialog";
import { SortableList, SortableItem, DragHandle } from "../../../components/ui/sortable";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs";

type ServicoRow = RouterOutputs["servicos"]["list"][number];
type Tipo = "DOCUMENTO" | "INFORMACAO" | "BRIEFING";

/** Os 3 tipos de exigência, explicados — usados no seletor da aba Exigências. */
const TIPOS_REQUISITO: { valor: Tipo; icon: typeof Paperclip; titulo: string; ajuda: string; placeholder: string }[] = [
  {
    valor: "DOCUMENTO",
    icon: Paperclip,
    titulo: "Documento",
    ajuda: "O cliente envia um arquivo (RG, contrato, logo…).",
    placeholder: "Documento pedido (ex.: RG do médico)…",
  },
  {
    valor: "INFORMACAO",
    icon: PenLine,
    titulo: "Informação",
    ajuda: "O cliente escreve uma resposta na tela — sem anexar arquivo.",
    placeholder: "Pergunta (ex.: Qual seu horário de atendimento?)…",
  },
  {
    valor: "BRIEFING",
    icon: FormInput,
    titulo: "Formulário",
    ajuda: "Várias perguntas de uma vez, a partir de um formulário pronto.",
    placeholder: "Título (ex.: Briefing de logo)…",
  },
];

/** Um seletor Avulso (1x) × Mensal para um campo de recorrência de preço. */
function RecorrenciaSelect({ control, name }: { control: Control<CreateServicoInput>; name: "valorRecorrencia" | "percentualRecorrencia" }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select value={field.value ?? "AVULSO"} onChange={(e) => field.onChange(e.target.value)} className="w-full">
          <option value="AVULSO">Avulso (1x)</option>
          <option value="MENSAL">Mensal</option>
        </Select>
      )}
    />
  );
}

/**
 * Preço de REFERÊNCIA de um serviço (ponto de partida editável na proposta e no contrato).
 *
 * ⚠️ **PERCENTUAL SÓ EXISTE NO FATURAMENTO MÉDICO** — ordem do dono (31/08/2026). Todo o resto
 * do catálogo é valor fixo, avulso ou mensal, **inclusive o credenciamento**, que é valor fixo
 * cobrado só quando a operadora aprova (ADR-104/108). Até aqui a tela oferecia o botão
 * "% do faturamento" nos dez serviços, e trocar a forma de cobrança por engano não dá erro
 * nenhum: muda o preço no papel do cliente, na conta a receber e na estimativa do funil, tudo
 * em silêncio.
 *
 * ⚠️ **QUEM LIBERA O PERCENTUAL É A MARCA `Servico.ehFaturamento`, NUNCA A CATEGORIA.** Aqui
 * morava `categoria === "Faturamento"` — a QUINTA aparição dessa comparação, e a mais a montante
 * de todas: bastava renomear a categoria na tela ao lado para o dinheiro mudar de regra. A marca
 * é o mesmo molde de `ehCredenciamento` (ADR-144), e a caixinha dela mora AQUI DENTRO, colada ao
 * preço, porque é isto que ela decide — e não numa aba distante onde a consequência não se vê.
 *
 * As duas formas são EXCLUDENTES por construção, porque é isso que a régua do resto da
 * aplicação (`ehServicoSomentePercentual`) assume — e o servidor recusa o contrário.
 */
function PrecoFields({
  control,
  setValue,
}: {
  control: Control<CreateServicoInput>;
  setValue: UseFormSetValue<CreateServicoInput>;
}) {
  const valor = useWatch({ control, name: "valor" });
  const percentual = useWatch({ control, name: "percentual" });
  const ehFaturamento = useWatch({ control, name: "ehFaturamento" }) === true;
  // Sem a marca, não há escolha a fazer: o serviço é valor fixo, e é só isso que a tela mostra.
  const mostrarPercentual = ehFaturamento && ehServicoSomentePercentual({ valor, percentual });
  // Trocar de forma LIMPA a outra: sem isso o campo escondido continuaria gravado, e o serviço
  // ficaria com as duas cobranças — exatamente o estado que a trava do servidor recusa.
  // Marcar/desmarcar a marca do faturamento. Desmarcar LIMPA o percentual pelo mesmo motivo que
  // `trocarPara` limpa a outra forma: campo escondido que continua gravado é um preço que a tela
  // não mostra e o servidor recusa.
  const marcarFaturamento = (marcado: boolean) => {
    setValue("ehFaturamento", marcado, { shouldDirty: true });
    if (!marcado) setValue("percentual", null, { shouldDirty: true });
  };
  const trocarPara = (pct: boolean) => {
    if (pct) {
      setValue("valor", null, { shouldDirty: true });
      setValue("percentual", percentual ?? 0, { shouldDirty: true });
    } else {
      setValue("percentual", null, { shouldDirty: true });
    }
  };
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preço de referência</p>

      {/*
        A MARCA DO FATURAMENTO. Está aqui, colada ao preço, porque é exatamente isto que ela
        decide: sem ela, o serviço é valor fixo e não há botão nenhum a apertar. Desmarcá-la
        limpa o percentual — deixá-lo gravado num serviço que a tela mostra como "valor fixo"
        prenderia o dado num estado que o servidor recusa editar.
      */}
      <div className="space-y-1.5">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={ehFaturamento}
            onChange={(e) => marcarFaturamento(e.target.checked)}
          />
          <span>
            <span className="font-medium text-foreground">Este é o serviço de faturamento médico</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              É o único que pode ser cobrado por <strong>percentual</strong> do que a clínica fatura. Todos os
              outros serviços têm valor fixo, avulso ou mensal. Só um serviço do catálogo pode estar marcado.
            </span>
          </span>
        </label>
      </div>

      {ehFaturamento ? (
        <div className="space-y-1.5">
          <Label
            className="text-xs font-normal text-muted-foreground"
            hint="Valor fixo: um preço em reais, avulso ou mensal. Percentual: uma fatia do que o cliente fatura, cobrada todo mês. Um serviço é de um jeito ou do outro, nunca dos dois."
          >
            Como este serviço é cobrado
          </Label>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mostrarPercentual ? "outline" : "default"} onClick={() => trocarPara(false)}>
              Valor fixo
            </Button>
            <Button type="button" size="sm" variant={mostrarPercentual ? "default" : "outline"} onClick={() => trocarPara(true)}>
              % do faturamento
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Cobrado por <strong className="text-foreground">valor fixo</strong> — avulso (1x) ou mensal.
        </p>
      )}

      {!mostrarPercentual && (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label
            className="text-xs font-normal text-muted-foreground"
            hint="O preço sugerido para este serviço; pode ser ajustado depois em cada proposta ou contrato."
          >
            Valor
          </Label>
          <Controller
            control={control}
            name="valor"
            render={({ field }) => <MoneyInput value={field.value} onChange={(v) => field.onChange(v ?? null)} />}
          />
        </div>
        <div className="space-y-1.5">
          <Label
            className="text-xs font-normal text-muted-foreground"
            hint="Avulso: cobrado uma vez. Mensal: cobrado todo mês enquanto o serviço estiver ativo."
          >
            Cobrança padrão
          </Label>
          <RecorrenciaSelect control={control} name="valorRecorrencia" />
        </div>
      </div>
      )}
      {!mostrarPercentual && (
        <p className="text-xs text-muted-foreground">
          Uma sugestão — o valor e se é avulso (1x) ou mensal você define ao gerar a proposta e no contrato de cada cliente.
        </p>
      )}

      {mostrarPercentual && (
        <div className="space-y-1.5 border-t pt-3">
          <Label
            className="text-xs font-normal text-muted-foreground"
            hint="A fatia que a Med recebe sobre o que o cliente faturar no mês. É o preço inteiro deste serviço — não existe valor fixo junto."
          >
            % do faturamento do cliente (mensal)
          </Label>
          <Controller
            control={control}
            name="percentual"
            render={({ field }) => (
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  placeholder="0"
                  className="pr-7"
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            )}
          />
        </div>
      )}
    </div>
  );
}

// ── Novo serviço (criação rápida) ──
function NovoServicoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const {
    register,
    control,
    setValue,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateServicoInput>({ resolver: zodResolver(createServicoSchema), defaultValues: { nome: "" } });

  useEffect(() => {
    if (open)
      reset({ nome: "", descricao: "", categoria: "", valor: undefined, valorRecorrencia: "AVULSO", percentual: undefined, percentualRecorrencia: "MENSAL", ehFaturamento: false });
  }, [open, reset]);

  const criar = trpc.servicos.criar.useMutation({ onSuccess: () => (utils.servicos.list.invalidate(), onClose()) });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Novo serviço"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="novo-servico-form" disabled={criar.isPending}>
            Criar serviço
          </Button>
        </>
      }
    >
      <form id="novo-servico-form" onSubmit={handleSubmit((d) => criar.mutate(d))} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="s-nome">Nome *</Label>
          <Input id="s-nome" autoFocus placeholder="Ex.: Credenciamento" {...register("nome")} />
          {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-cat" hint="Agrupa o serviço no catálogo, e só isso — quem decide a forma de cobrança é o botão 'Como este serviço é cobrado', logo abaixo.">
            Categoria
          </Label>
          <Select id="s-cat" {...register("categoria")}>
            <option value="">Sem categoria</option>
            {CATEGORIAS_SERVICO.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <PrecoFields control={control} setValue={setValue} />
        <div className="space-y-1.5">
          <Label htmlFor="s-desc">Descrição</Label>
          <Textarea id="s-desc" rows={3} placeholder="O que este serviço inclui…" {...register("descricao")} />
        </div>
        {criar.error && <p className="text-sm text-destructive">{criar.error.message}</p>}
      </form>
    </Modal>
  );
}

// ── Aba "Detalhes": editar nome/categoria/valor/descrição + ativar/remover ──
function DetalhesPanel({
  servico,
  onClose,
  onDirtyChange,
}: {
  servico: ServicoRow;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const {
    register,
    control,
    setValue,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<CreateServicoInput>({ resolver: zodResolver(createServicoSchema), defaultValues: { nome: "" } });

  // (Re)inicializa o form só ao ABRIR um serviço diferente — não a cada refetch/toggle,
  // para não apagar edições em andamento (ex.: ao clicar Desativar com texto não salvo).
  useEffect(() => {
    reset({
      nome: servico.nome,
      descricao: servico.descricao ?? "",
      categoria: servico.categoria ?? "",
      valor: servico.valor ?? undefined,
      valorRecorrencia: servico.valorRecorrencia,
      percentual: servico.percentual ?? undefined,
      percentualRecorrencia: servico.percentualRecorrencia,
      clausulasContrato: servico.clausulasContrato ?? "",
      condicaoPagamento: servico.condicaoPagamento ?? "",
      ehCredenciamento: servico.ehCredenciamento,
      ehFaturamento: servico.ehFaturamento,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servico.id, reset]);

  // Informa o diálogo se há edição pendente (para avisar antes de trocar de aba/fechar).
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const invalidate = () => utils.servicos.list.invalidate();
  const atualizar = trpc.servicos.atualizar.useMutation({ onSuccess: invalidate });
  const remover = trpc.servicos.remover.useMutation({ onSuccess: () => (invalidate(), onClose()) });

  return (
    <form
      onSubmit={handleSubmit((d) => atualizar.mutate({ id: servico.id, ...d }, { onSuccess: () => reset(d) }))}
      className="space-y-4"
      noValidate
    >
      <div className="space-y-1.5">
        <Label htmlFor="d-nome">Nome *</Label>
        <Input id="d-nome" placeholder="Ex.: Credenciamento" {...register("nome")} />
        {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="d-cat" hint="Agrupa o serviço no catálogo, e só isso — quem decide a forma de cobrança é o botão 'Como este serviço é cobrado', logo abaixo.">
          Categoria
        </Label>
        <Select id="d-cat" {...register("categoria")}>
          <option value="">Sem categoria</option>
          {CATEGORIAS_SERVICO.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <PrecoFields control={control} setValue={setValue} />
      <div className="space-y-1.5">
        <Label htmlFor="d-desc">Descrição</Label>
        <Textarea id="d-desc" rows={3} placeholder="O que este serviço inclui…" {...register("descricao")} />
      </div>
      <div className="space-y-1.5">
        <Label
          htmlFor="d-condicao"
          hint="Preenche sozinha o campo &quot;Condições de pagamento&quot; da proposta quando este serviço é escolhido. Ainda dá para editar na hora de montar a proposta."
        >
          Condição de pagamento
        </Label>
        <Textarea
          id="d-condicao"
          rows={2}
          placeholder="Ex.: O recebimento do Repasse será sempre feito após o crédito na conta da Clínica."
          {...register("condicaoPagamento")}
        />
      </div>
      {/*
        A MARCA DO CREDENCIAMENTO. Ela decide QUANDO este serviço vira dinheiro, e por isso está
        aqui, à vista, e não escondida no banco: se ficar errada, o conserto tem de caber num
        clique de quem administra — antes disso, a única saída era mexer no banco de produção.
      */}
      <div className="space-y-1.5">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" {...register("ehCredenciamento")} />
          <span>
            <span className="font-medium text-foreground">Este é o serviço de credenciamento</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              O honorário dele só vira conta a receber quando a operadora aprova — nunca ao contratar nem ao
              converter o lead. Só um serviço do catálogo pode estar marcado.
            </span>
          </span>
        </label>
      </div>
      <div className="space-y-1.5">
        <Label
          htmlFor="d-clausulas"
          hint="Entram automaticamente no contrato quando o cliente aceita a proposta, junto com as cláusulas dos outros serviços contratados."
        >
          Cláusulas do contrato
        </Label>
        <Textarea
          id="d-clausulas"
          rows={5}
          placeholder="Condições deste serviço que entram no contrato…"
          {...register("clausulasContrato")}
        />
      </div>
      {atualizar.error && <p className="text-sm text-destructive">{atualizar.error.message}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            if (
              servico.ativo &&
              !(await confirm({
                title: "Desativar serviço",
                description: `"${servico.nome}" deixará de aparecer no cadastro de leads e nas propostas. Você pode reativá-lo depois.`,
                confirmText: "Desativar",
                variant: "destructive",
              }))
            )
              return;
            atualizar.mutate({ id: servico.id, ativo: !servico.ativo });
          }}
          title={servico.ativo ? "Ocultar do cadastro de leads" : "Voltar a oferecer"}
        >
          {servico.ativo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {servico.ativo ? "Desativar" : "Ativar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="text-destructive hover:bg-destructive/10"
          onClick={async () => {
            if (
              await confirm({
                title: "Remover serviço",
                description: `"${servico.nome}" será removido do catálogo. Leads que já o tinham deixam de exibi-lo.`,
                confirmText: "Remover",
                variant: "destructive",
              })
            )
              remover.mutate({ id: servico.id });
          }}
        >
          <Trash2 className="h-4 w-4" /> Remover
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto"
          disabled={!isDirty || atualizar.isPending}
          onClick={() => reset()}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={!isDirty || atualizar.isPending}>
          {atualizar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </form>
  );
}

// ── Aba "Exigências": o que o cliente precisa entregar (3 tipos) ──
function ExigenciasPanel({ servico }: { servico: ServicoRow }) {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const q = trpc.servicos.requisitos.useQuery({ servicoId: servico.id });
  const inv = () => {
    utils.servicos.requisitos.invalidate({ servicoId: servico.id });
    utils.servicos.list.invalidate();
  };
  const add = trpc.servicos.addRequisito.useMutation({ onSuccess: () => (inv(), setTitulo(""), setDescricao("")) });
  const atualizar = trpc.servicos.atualizarRequisito.useMutation({ onSuccess: inv });
  const remover = trpc.servicos.removerRequisito.useMutation({ onSuccess: inv });
  const reordenar = trpc.servicos.reordenarRequisitos.useMutation({ onSettled: inv });
  const formularios = trpc.formularios.list.useQuery();
  const ia = trpc.ia.disponivel.useQuery();
  const [sugestoes, setSugestoes] = useState<{ titulo: string; descricao?: string; obrigatorio?: boolean }[]>([]);
  const sugerir = trpc.ia.sugerirRequisitos.useMutation({ onSuccess: (r) => setSugestoes(r) });
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [obrig, setObrig] = useState(true);
  const [tipo, setTipo] = useState<Tipo>("DOCUMENTO");
  const [formularioId, setFormularioId] = useState("");
  const [items, setItems] = useState<NonNullable<typeof q.data>>([]);
  useEffect(() => {
    if (q.data) setItems(q.data);
  }, [q.data]);

  const reqs = items;
  const forms = formularios.data ?? [];
  const tipoAtual = TIPOS_REQUISITO.find((t) => t.valor === tipo)!;

  if (q.isError) return <QueryError onRetry={() => q.refetch()} message="Não deu para carregar o que o cliente precisa entregar." />;
  if (q.isLoading) return <Skeleton className="h-40 rounded-lg" />;

  const adicionar = () => {
    if (!titulo.trim()) return;
    add.mutate({
      servicoId: servico.id,
      titulo: titulo.trim(),
      descricao: descricao.trim() || undefined,
      obrigatorio: obrig,
      tipo,
      formularioId: tipo === "BRIEFING" ? formularioId || undefined : undefined,
    });
  };

  const iconeDoTipo = (t: string) => TIPOS_REQUISITO.find((x) => x.valor === t)?.icon ?? Paperclip;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">
<strong>O cliente envia:</strong> o que o cliente precisa entregar para este serviço. Tudo aparece no Portal do Cliente e chega na ficha.
        </p>
        {ia.data?.disponivel && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-primary"
            disabled={sugerir.isPending}
            onClick={() => sugerir.mutate({ servicoId: servico.id })}
          >
            {sugerir.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Sugerir com IA
          </Button>
        )}
      </div>

      {sugestoes.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/[0.03] p-3">
          <p className="text-xs font-semibold text-primary">Sugestões da IA — clique para adicionar:</p>
          {sugestoes.map((s, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md border bg-background p-2 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{s.titulo}</span>
                {s.descricao && <p className="text-xs text-muted-foreground">{s.descricao}</p>}
              </div>
              <button
                onClick={() => {
                  add.mutate({
                    servicoId: servico.id,
                    titulo: s.titulo,
                    descricao: s.descricao || undefined,
                    obrigatorio: s.obrigatorio ?? true,
                    tipo: "DOCUMENTO",
                  });
                  setSugestoes((prev) => prev.filter((_, j) => j !== i));
                }}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold text-primary hover:bg-primary/10"
              >
                + Adicionar
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          adicionar();
        }}
        className="space-y-2 rounded-lg border bg-muted/20 p-3"
      >
        {/* Seletor de tipo em botões, com explicação */}
        <div className="grid grid-cols-3 gap-2">
          {TIPOS_REQUISITO.map((t) => {
            const Icon = t.icon;
            const ativo = tipo === t.valor;
            return (
              <button
                key={t.valor}
                type="button"
                onClick={() => setTipo(t.valor)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-colors",
                  ativo ? "border-primary bg-primary/[0.06] text-primary" : "hover:bg-accent",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="text-xs font-semibold">{t.titulo}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{tipoAtual.ajuda}</p>

        <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={tipoAtual.placeholder} />
        {tipo === "BRIEFING" && (
          <Select value={formularioId} onChange={(e) => setFormularioId(e.target.value)}>
            <option value="">Escolha o formulário…</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.titulo} ({f._count.campos} perguntas)
              </option>
            ))}
          </Select>
        )}
        <Input
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder={tipo === "INFORMACAO" ? "Ajuda para o cliente (opcional)" : "Explicação para o cliente (opcional)"}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input type="checkbox" checked={obrig} onChange={(e) => setObrig(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            Obrigatório
          </label>
          <Button
            type="submit"
            size="sm"
            className="ml-auto"
            disabled={!titulo.trim() || (tipo === "BRIEFING" && !formularioId) || add.isPending}
          >
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
        {tipo === "BRIEFING" && (
          <p className="text-xs text-muted-foreground">
            Os formulários são gerenciados em{" "}
            <Link to="/documentos" className="text-primary hover:underline">
              Documentos → Formulários
            </Link>
            .
          </p>
        )}
      </form>

      <div className="max-h-[40vh] space-y-1 overflow-y-auto">
        <SortableList
          ids={reqs.map((r) => r.id)}
          onReorder={(ids) => {
            setItems((prev) => ids.map((id) => prev.find((r) => r.id === id)!).filter(Boolean));
            reordenar.mutate({ ids });
          }}
        >
          {reqs.map((r) => {
            const Icon = iconeDoTipo(r.tipo);
            return (
              <SortableItem key={r.id} id={r.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <DragHandle className="-ml-1 mt-0.5 shrink-0" />
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{r.titulo}</span>
                  {r.descricao && <p className="text-xs text-muted-foreground">{r.descricao}</p>}
                </div>
                <button
                  onClick={() => atualizar.mutate({ id: r.id, obrigatorio: !r.obrigatorio })}
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
                    r.obrigatorio ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:bg-muted/70",
                  )}
                  title="Alternar obrigatório"
                >
                  {r.obrigatorio ? "obrigatório" : "opcional"}
                </button>
                <button
                  onClick={async () => {
                    if (
                      await confirm({
                        title: "Remover exigência",
                        description: `Remover "${r.titulo}" deste serviço?`,
                        confirmText: "Remover",
                        variant: "destructive",
                      })
                    )
                      remover.mutate({ id: r.id });
                  }}
                  className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded p-1 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Remover"
                  aria-label={`Remover exigência "${r.titulo}"`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </SortableItem>
            );
          })}
        </SortableList>
        {reqs.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma exigência cadastrada ainda.</p>}
      </div>
    </div>
  );
}

// ── Aba "Passos": checklist do funil por etapa ──
function PassosPanel({ servico }: { servico: ServicoRow }) {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const q = trpc.servicos.passos.useQuery({ servicoId: servico.id });
  const inv = () => {
    utils.servicos.passos.invalidate({ servicoId: servico.id });
    utils.servicos.list.invalidate();
  };
  const add = trpc.servicos.addPasso.useMutation({ onSuccess: () => (inv(), setTitulo("")) });
  const atualizar = trpc.servicos.atualizarPasso.useMutation({ onSuccess: inv });
  const remover = trpc.servicos.removerPasso.useMutation({ onSuccess: inv });
  const reordenar = trpc.servicos.reordenarPassos.useMutation({ onSettled: inv });
  const [titulo, setTitulo] = useState("");
  const [etapa, setEtapa] = useState<AddServicoPassoInput["etapaChave"]>("qualificacao");
  const [obrig, setObrig] = useState(true);
  const [items, setItems] = useState<NonNullable<typeof q.data>>([]);
  useEffect(() => {
    if (q.data) setItems(q.data);
  }, [q.data]);

  const reordenarGrupo = (etapaChave: string, ids: string[]) => {
    setItems((prev) => {
      const map = new Map(prev.map((p) => [p.id, p]));
      const reordenados = ids.map((id) => map.get(id)!);
      let gi = 0;
      return prev.map((p) => (p.etapaChave === etapaChave ? reordenados[gi++]! : p));
    });
    reordenar.mutate({ ids });
  };

  const passos = items;

  if (q.isError) return <QueryError onRetry={() => q.refetch()} message="Não deu para carregar os passos da venda." />;
  if (q.isLoading) return <Skeleton className="h-40 rounded-lg" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <strong>Para vender:</strong> estes passos entram no checklist do lead que escolher este serviço, na etapa indicada
        do funil. Os <strong>obrigatórios</strong> são critério para avançar de etapa; os marcados{" "}
        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning ring-1 ring-inset ring-warning/20">
          com a clínica
        </span>{" "}
        esperam uma resposta do cliente, não da equipe.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (titulo.trim()) add.mutate({ servicoId: servico.id, titulo: titulo.trim(), etapaChave: etapa, obrigatorio: obrig });
        }}
        className="space-y-2 rounded-lg border bg-muted/20 p-3"
      >
        <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Novo passo…" />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={etapa}
            onChange={(e) => setEtapa(e.target.value as AddServicoPassoInput["etapaChave"])}
            className="h-9 rounded-md border bg-background px-2 text-sm outline-none focus:border-primary"
          >
            {ETAPA_CHAVES.map((k) => (
              <option key={k} value={k}>
                {ETAPA_CHAVE_LABEL[k]}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input type="checkbox" checked={obrig} onChange={(e) => setObrig(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            Obrigatório
          </label>
          <Button type="submit" size="sm" className="ml-auto" disabled={!titulo.trim() || add.isPending}>
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
      </form>

      <div className="max-h-[40vh] space-y-3 overflow-y-auto">
        {ETAPA_CHAVES.map((k) => {
          const doGrupo = passos.filter((p) => p.etapaChave === k);
          if (!doGrupo.length) return null;
          return (
            <div key={k}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {ETAPA_CHAVE_LABEL[k]}
              </div>
              <div className="space-y-1">
                <SortableList ids={doGrupo.map((p) => p.id)} onReorder={(ids) => reordenarGrupo(k, ids)}>
                  {doGrupo.map((p) => (
                    <SortableItem key={p.id} id={p.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                      <DragHandle className="-ml-1 shrink-0" />
                      <span className="min-w-0 flex-1 break-words">
                        {p.titulo}
                        {p.quemFaz === "CLIENTE" && (
                          <span className="ml-1.5 whitespace-nowrap rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning ring-1 ring-inset ring-warning/20">
                            com a clínica
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() => atualizar.mutate({ id: p.id, obrigatorio: !p.obrigatorio })}
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
                          p.obrigatorio ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:bg-muted/70",
                        )}
                        title="Alternar obrigatório"
                      >
                        {p.obrigatorio ? "obrigatório" : "opcional"}
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Remover passo",
                              description: `Remover o passo "${p.titulo}" deste serviço?`,
                              confirmText: "Remover",
                              variant: "destructive",
                            })
                          )
                            remover.mutate({ id: p.id });
                        }}
                        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded p-1 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        title="Remover"
                        aria-label={`Remover passo "${p.titulo}"`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </SortableItem>
                  ))}
                </SortableList>
              </div>
            </div>
          );
        })}
        {passos.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nenhum passo cadastrado ainda.</p>}
      </div>
    </div>
  );
}

// ── Aba "Roteiro": as tarefas (cartões) do projeto + o checklist de cada uma ──
type RoteiroTarefa = { titulo: string; itens: string[] };

function RoteiroPanel({ servico, onDirtyChange }: { servico: ServicoRow; onDirtyChange?: (dirty: boolean) => void }) {
  const utils = trpc.useUtils();
  const leituraInicial = (): RoteiroTarefa[] =>
    Array.isArray(servico.roteiro)
      ? (servico.roteiro as RoteiroTarefa[]).map((t) => ({ titulo: String(t?.titulo ?? ""), itens: Array.isArray(t?.itens) ? t.itens.map(String) : [] }))
      : [];
  // Forma normalizada (o que de fato é salvo) — usada para comparar "há mudança pendente?".
  const normalizar = (ts: RoteiroTarefa[]) =>
    JSON.stringify(ts.map((t) => ({ titulo: t.titulo.trim(), itens: t.itens.map((i) => i.trim()).filter(Boolean) })).filter((t) => t.titulo));
  const [tarefas, setTarefas] = useState<RoteiroTarefa[]>(leituraInicial);
  const [baseline, setBaseline] = useState<string>(() => normalizar(leituraInicial()));
  useEffect(() => {
    const inicial = leituraInicial();
    setTarefas(inicial);
    setBaseline(normalizar(inicial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servico.id]);

  const dirty = normalizar(tarefas) !== baseline;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const salvar = trpc.servicos.setRoteiro.useMutation();

  const setTarefa = (ti: number, patch: Partial<RoteiroTarefa>) => setTarefas((ts) => ts.map((t, i) => (i === ti ? { ...t, ...patch } : t)));
  const setItem = (ti: number, ii: number, valor: string) =>
    setTarefa(ti, { itens: tarefas[ti]!.itens.map((it, i) => (i === ii ? valor : it)) });

  const onSalvar = () => {
    const limpo = tarefas
      .map((t) => ({ titulo: t.titulo.trim(), itens: t.itens.map((i) => i.trim()).filter(Boolean) }))
      .filter((t) => t.titulo);
    salvar.mutate(
      { servicoId: servico.id, roteiro: limpo },
      {
        onSuccess: () => {
          utils.servicos.list.invalidate();
          setBaseline(JSON.stringify(limpo)); // o que acabou de ser salvo vira a nova base (dirty→false)
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        <strong>A equipe faz:</strong> as tarefas deste serviço — ao contratar, cada uma vira um <strong>cartão</strong> no projeto,
        com o seu próprio checklist. (As entregas do cliente viram um cartão à parte, a partir de <em>O cliente envia</em>.)
      </p>

      <div className="max-h-[46vh] space-y-2 overflow-y-auto">
        {tarefas.map((t, ti) => (
          <div key={ti} className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {ti + 1}
              </span>
              <Input
                value={t.titulo}
                onChange={(e) => setTarefa(ti, { titulo: e.target.value })}
                placeholder="Nome da tarefa (ex.: Planejamento)"
                className="font-medium"
              />
              <button
                onClick={() => setTarefas((ts) => ts.filter((_, i) => i !== ti))}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                title="Remover tarefa"
                aria-label={`Remover tarefa "${t.titulo || `#${ti + 1}`}"`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1 pl-8">
              {t.itens.map((it, ii) => (
                <div key={ii} className="flex items-center gap-2">
                  <span className="text-muted-foreground">•</span>
                  <Input value={it} onChange={(e) => setItem(ti, ii, e.target.value)} placeholder="Item do checklist" className="h-8" />
                  <button
                    onClick={() => setTarefa(ti, { itens: t.itens.filter((_, i) => i !== ii) })}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded p-1 text-muted-foreground/50 transition-colors hover:text-destructive"
                    title="Remover item"
                    aria-label={`Remover item "${it || `#${ii + 1}`}" da tarefa`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setTarefa(ti, { itens: [...t.itens, ""] })}
                className="ml-4 text-xs font-medium text-primary hover:underline"
              >
                + Adicionar item
              </button>
            </div>
          </div>
        ))}
        {tarefas.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma tarefa no roteiro ainda.</p>}
      </div>

      <button
        onClick={() => setTarefas((ts) => [...ts, { titulo: "", itens: [] }])}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <Plus className="h-4 w-4" /> Adicionar tarefa
      </button>

      <div className="flex items-center justify-end gap-2">
        {salvar.isSuccess && !dirty && <span className="text-xs text-success">Roteiro salvo ✓</span>}
        <Button type="button" variant="ghost" disabled={!dirty || salvar.isPending} onClick={() => setTarefas(leituraInicial())}>
          Cancelar
        </Button>
        <Button onClick={onSalvar} disabled={!dirty || salvar.isPending}>
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar roteiro
        </Button>
      </div>
    </div>
  );
}

// ── Diálogo único de configuração (abas) ──
// Abas na ordem da história do serviço: configurar → vender → o cliente entrega → a equipe executa.
// (As `chave` internas seguem as mesmas; só o rótulo e a ordem mudaram para ficar claro ao leigo.)
const ABAS = [
  { chave: "detalhes", label: "Detalhes", icon: FileText },
  { chave: "passos", label: "Para vender", icon: ListChecks },
  { chave: "exigencias", label: "O cliente envia", icon: ClipboardCheck },
  { chave: "roteiro", label: "A equipe faz", icon: Route },
] as const;
type Aba = (typeof ABAS)[number]["chave"];

function ServicoConfigDialog({
  servico,
  abaInicial,
  onClose,
}: {
  servico: ServicoRow | null;
  abaInicial: Aba;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const [aba, setAba] = useState<Aba>(abaInicial);
  // Só (re)define a aba ao ABRIR um serviço diferente — não a cada refetch da lista
  // (invalidar `servicos.list` troca a referência de `servico` e não deve trocar de aba).
  const idAberto = useRef<string | null>(null);
  useEffect(() => {
    if (!servico) {
      idAberto.current = null;
    } else if (servico.id !== idAberto.current) {
      idAberto.current = servico.id;
      setAba(abaInicial);
    }
  }, [servico, abaInicial]);

  // A aba ativa (Detalhes/Roteiro) avisa se há edição pendente. As abas de auto-save
  // (Para vender / O cliente envia) nunca ficam "sujas". Guardamos a troca de aba e o
  // fechamento para não perder texto digitado sem o usuário confirmar.
  const dirtyRef = useRef(false);
  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);

  const confirmarDescarte = () =>
    confirm({
      title: "Descartar alterações?",
      description: `Você tem alterações não salvas em "${ABAS.find((a) => a.chave === aba)?.label}". Se sair agora sem salvar, elas serão perdidas.`,
      confirmText: "Descartar",
      cancelText: "Continuar editando",
      variant: "destructive",
    });

  const pedirTroca = async (nova: Aba) => {
    if (nova === aba) return;
    if (dirtyRef.current && !(await confirmarDescarte())) return;
    dirtyRef.current = false;
    setAba(nova);
  };

  const pedirFechar = async () => {
    if (dirtyRef.current && !(await confirmarDescarte())) return;
    dirtyRef.current = false;
    onClose();
  };

  if (!servico) return null;

  return (
    <Modal
      open={!!servico}
      onClose={pedirFechar}
      title={`Configurar · ${servico.nome}`}
      size="lg"
      footer={
        <Button variant="outline" onClick={pedirFechar}>
          Fechar
        </Button>
      }
    >
      <div className="space-y-4">
        <Tabs value={aba} onValueChange={(v) => pedirTroca(v as Aba)}>
          <TabsList aria-label="Configuração do serviço">
            {ABAS.map((a) => {
              const Icon = a.icon;
              return (
                <TabsTrigger key={a.chave} value={a.chave}>
                  <Icon className="h-4 w-4" /> {a.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {aba === "detalhes" && <DetalhesPanel servico={servico} onClose={onClose} onDirtyChange={setDirty} />}
        {aba === "roteiro" && <RoteiroPanel servico={servico} onDirtyChange={setDirty} />}
        {aba === "exigencias" && <ExigenciasPanel servico={servico} />}
        {aba === "passos" && <PassosPanel servico={servico} />}
      </div>
    </Modal>
  );
}

export function ServicosPage() {
  const utils = trpc.useUtils();
  const lista = trpc.servicos.list.useQuery();
  const [novo, setNovo] = useState(false);
  const [config, setConfig] = useState<{ servico: ServicoRow; aba: Aba } | null>(null);

  const invalidate = () => utils.servicos.list.invalidate();
  const reordenar = trpc.servicos.reordenar.useMutation({ onSettled: invalidate });
  const [items, setItems] = useState<NonNullable<typeof lista.data>>([]);
  useEffect(() => {
    if (lista.data) setItems(lista.data);
  }, [lista.data]);

  // Mantém o serviço aberto no diálogo em sincronia com a lista (após salvar/ativar).
  const servicoAberto = config ? items.find((s) => s.id === config.servico.id) ?? config.servico : null;

  const reordenarCategoria = (categoria: string, ids: string[]) => {
    setItems((prev) => {
      const map = new Map(prev.map((s) => [s.id, s]));
      const reordenados = ids.map((id) => map.get(id)!);
      let gi = 0;
      return prev.map((s) => ((s.categoria || "Outros") === categoria ? reordenados[gi++]! : s));
    });
    reordenar.mutate({ ids });
  };
  const grupos = [...CATEGORIAS_SERVICO, "Outros"]
    .map((cat) => ({ cat, servicos: items.filter((s) => (s.categoria || "Outros") === cat) }))
    .filter((g) => g.servicos.length > 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Serviços"
        subtitle="Os serviços que a MedConsultoria oferece. Ao configurar cada um, você define, em ordem: Para vender, O cliente envia e A equipe faz. Arraste pela alça para ordenar."
      >
        <Button onClick={() => setNovo(true)}>
          <Plus className="h-4 w-4" />
          Novo serviço
        </Button>
      </PageHeader>

      {lista.isError ? (
        <QueryError onRetry={() => lista.refetch()} />
      ) : lista.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="space-y-5">
          {grupos.map((g) => (
            <div key={g.cat} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.cat}</h2>
              <SortableList ids={g.servicos.map((s) => s.id)} onReorder={(ids) => reordenarCategoria(g.cat, ids)}>
                {g.servicos.map((s) => (
                  <SortableItem
                    key={s.id}
                    id={s.id}
                    className={cn("mb-2 flex items-start gap-3 rounded-xl border bg-card p-4", !s.ativo && "opacity-60")}
                  >
                    <DragHandle className="mt-1 shrink-0" />
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Briefcase className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{s.nome}</span>
                        {formatPreco(s) && (
                          <span className="rounded bg-success/10 px-1.5 py-0.5 text-xs font-semibold text-success">
                            {formatPreco(s)}
                          </span>
                        )}
                        {!s.ativo && <Badge>Inativo</Badge>}
                      </div>
                      {s.descricao && <p className="mt-0.5 text-sm text-muted-foreground">{s.descricao}</p>}
                      <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <button
                          onClick={() => setConfig({ servico: s, aba: "passos" })}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          title="Para vender"
                        >
                          <ListChecks className="h-3.5 w-3.5" />
                          {s._count.passos} {s._count.passos === 1 ? "passo da venda" : "passos da venda"}
                        </button>
                        <button
                          onClick={() => setConfig({ servico: s, aba: "exigencias" })}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          title="O cliente envia"
                        >
                          <ClipboardCheck className="h-3.5 w-3.5" />
                          {s._count.requisitos} {s._count.requisitos === 1 ? "pedido ao cliente" : "pedidos ao cliente"}
                        </button>
                        {(() => {
                          const nTarefas = Array.isArray(s.roteiro) ? s.roteiro.length : 0;
                          return (
                            <button
                              onClick={() => setConfig({ servico: s, aba: "roteiro" })}
                              className="inline-flex items-center gap-1 hover:text-foreground"
                              title="A equipe faz"
                            >
                              <Route className="h-3.5 w-3.5" />
                              {nTarefas} {nTarefas === 1 ? "tarefa da equipe" : "tarefas da equipe"}
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setConfig({ servico: s, aba: "detalhes" })}
                    >
                      <Settings2 className="h-4 w-4" /> Configurar
                    </Button>
                  </SortableItem>
                ))}
              </SortableList>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Briefcase}
          title="Nenhum serviço cadastrado ainda"
          description="Cadastre o primeiro serviço do catálogo para começar a vender."
        >
          <Button onClick={() => setNovo(true)}>
            <Plus className="h-4 w-4" />
            Novo serviço
          </Button>
        </EmptyState>
      )}

      <NovoServicoDialog open={novo} onClose={() => setNovo(false)} />
      <ServicoConfigDialog servico={servicoAberto} abaInicial={config?.aba ?? "detalhes"} onClose={() => setConfig(null)} />
    </div>
  );
}
