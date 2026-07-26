import { useEffect, useState } from "react";
import { Plus, X, Sparkles, Loader2 } from "lucide-react";
import { CAMPO_TIPO_LABEL, type CampoTipo } from "@app/shared";
import { trpc, type RouterOutputs } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";
import { Modal } from "../../components/ui/modal";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { SortableList, SortableItem, DragHandle } from "../../components/ui/sortable";

/** Construtor de briefings/formulários interativos — vive dentro da página Modelos. */
export type FormRow = RouterOutputs["formularios"]["list"][number];
const TIPOS = Object.keys(CAMPO_TIPO_LABEL) as CampoTipo[];
const comOpcoes = (t: string) => t === "ESCOLHA" || t === "MULTIPLA";

/** Cria/edita o título e a descrição de um formulário. */
export function FormularioDialog({ open, onClose, form }: { open: boolean; onClose: () => void; form?: FormRow }) {
  const utils = trpc.useUtils();
  const isEdit = !!form;
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  useEffect(() => {
    if (open) {
      setTitulo(form?.titulo ?? "");
      setDescricao(form?.descricao ?? "");
    }
  }, [open, form]);
  const inv = () => utils.formularios.list.invalidate();
  const criar = trpc.formularios.criar.useMutation({ onSuccess: () => (inv(), onClose()) });
  const atualizar = trpc.formularios.atualizar.useMutation({ onSuccess: () => (inv(), onClose()) });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar formulário" : "Novo formulário"}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="formulario-form" disabled={!titulo.trim() || criar.isPending || atualizar.isPending}>
            {isEdit ? "Salvar" : "Criar"}
          </Button>
        </>
      }
    >
      <form
        id="formulario-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!titulo.trim()) return;
          if (form) atualizar.mutate({ id: form.id, titulo: titulo.trim(), descricao: descricao.trim() });
          else criar.mutate({ titulo: titulo.trim(), descricao: descricao.trim() });
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="f-tit">Título *</Label>
          <Input id="f-tit" autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Briefing de logotipo" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-desc" hint="Texto de apresentação que o cliente vê antes de responder ao formulário.">
            Descrição (aparece para o cliente)
          </Label>
          <Textarea id="f-desc" rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}

/** Editor dos campos (perguntas) de um formulário — o cliente responde na tela. */
export function CamposDialog({ form, onClose }: { form: FormRow | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const q = trpc.formularios.get.useQuery({ id: form?.id ?? "" }, { enabled: !!form });
  const inv = () => form && utils.formularios.get.invalidate({ id: form.id });
  const add = trpc.formularios.addCampo.useMutation({ onSuccess: () => (inv(), setRotulo(""), setOpcoes("")) });
  const atualizar = trpc.formularios.atualizarCampo.useMutation({ onSuccess: inv });
  const remover = trpc.formularios.removerCampo.useMutation({ onSuccess: inv });
  const reordenar = trpc.formularios.reordenarCampos.useMutation({ onSettled: inv });
  const ia = trpc.ia.disponivel.useQuery();
  const [sugestoes, setSugestoes] = useState<{ rotulo: string; tipo: string; obrigatorio: boolean; opcoes: string[] }[]>([]);
  const sugerir = trpc.ia.sugerirCampos.useMutation({ onSuccess: (r) => setSugestoes(r) });

  const [rotulo, setRotulo] = useState("");
  const [tipo, setTipo] = useState<CampoTipo>("TEXTO_CURTO");
  const [obrig, setObrig] = useState(false);
  const [opcoes, setOpcoes] = useState("");
  const [ajuda, setAjuda] = useState("");
  const [items, setItems] = useState<NonNullable<typeof q.data>["campos"]>([]);
  useEffect(() => {
    if (q.data) setItems(q.data.campos);
  }, [q.data]);

  if (!form) return null;

  const adicionar = () => {
    if (!rotulo.trim()) return;
    add.mutate({
      formularioId: form.id,
      rotulo: rotulo.trim(),
      tipo,
      obrigatorio: obrig,
      ajuda: ajuda.trim() || undefined,
      opcoes: comOpcoes(tipo) ? opcoes.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    });
  };

  return (
    <Modal
      open={!!form}
      onClose={onClose}
      title={`Perguntas · ${form.titulo}`}
      size="lg"
      footer={
        <Button variant="outline" onClick={onClose}>
          Concluído
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            As perguntas que o cliente responde na tela. Arraste pela alça para ordenar.
          </p>
          {ia.data?.disponivel && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-primary"
              disabled={sugerir.isPending}
              onClick={() => sugerir.mutate({ titulo: form.titulo, descricao: form.descricao ?? undefined })}
            >
              {sugerir.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Sugerir perguntas
            </Button>
          )}
        </div>

        {sugestoes.length > 0 && (
          <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/[0.03] p-3">
            <p className="text-xs font-semibold text-primary">Sugestões da IA — clique para adicionar:</p>
            {sugestoes.map((s, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border bg-background p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{s.rotulo}</span>
                  <span className="ml-1.5 text-[11px] text-muted-foreground">· {CAMPO_TIPO_LABEL[s.tipo as CampoTipo] ?? s.tipo}</span>
                  {s.opcoes.length > 0 && <p className="text-xs text-muted-foreground">Opções: {s.opcoes.join(", ")}</p>}
                </div>
                <button
                  onClick={() => {
                    add.mutate({
                      formularioId: form.id,
                      rotulo: s.rotulo,
                      tipo: s.tipo as CampoTipo,
                      obrigatorio: s.obrigatorio,
                      opcoes: s.opcoes.length ? s.opcoes : undefined,
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
          <Input value={rotulo} onChange={(e) => setRotulo(e.target.value)} placeholder="Pergunta (ex.: Qual o nome da marca?)" />
          <div className="flex flex-wrap gap-2">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as CampoTipo)} className="w-44 shrink-0">
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {CAMPO_TIPO_LABEL[t]}
                </option>
              ))}
            </Select>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input type="checkbox" checked={obrig} onChange={(e) => setObrig(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
              Obrigatório
            </label>
          </div>
          {comOpcoes(tipo) && (
            <Input value={opcoes} onChange={(e) => setOpcoes(e.target.value)} placeholder="Opções separadas por vírgula (ex.: Sim, Não, Talvez)" />
          )}
          <Input value={ajuda} onChange={(e) => setAjuda(e.target.value)} placeholder="Dica para o cliente (opcional)" />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!rotulo.trim() || add.isPending}>
              <Plus className="h-4 w-4" /> Adicionar pergunta
            </Button>
          </div>
        </form>

        <div className="max-h-[42vh] space-y-1 overflow-y-auto">
          <SortableList
            ids={items.map((c) => c.id)}
            onReorder={(ids) => {
              setItems((prev) => ids.map((id) => prev.find((c) => c.id === id)!).filter(Boolean));
              reordenar.mutate({ ids });
            }}
          >
            {items.map((c) => (
              <SortableItem key={c.id} id={c.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <DragHandle className="-ml-1 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{c.rotulo}</span>
                  <span className="ml-1.5 text-[11px] text-muted-foreground">· {CAMPO_TIPO_LABEL[c.tipo as CampoTipo]}</span>
                  {c.opcoes.length > 0 && <p className="text-xs text-muted-foreground">Opções: {c.opcoes.join(", ")}</p>}
                </div>
                <button
                  onClick={() => atualizar.mutate({ id: c.id, obrigatorio: !c.obrigatorio })}
                  className={
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                    (c.obrigatorio ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:bg-muted/70")
                  }
                  title="Alternar obrigatório"
                >
                  {c.obrigatorio ? "obrigatório" : "opcional"}
                </button>
                <button
                  onClick={async () => {
                    if (await confirm({ title: "Remover pergunta", description: `Remover "${c.rotulo}"?`, confirmText: "Remover", variant: "destructive" }))
                      remover.mutate({ id: c.id });
                  }}
                  className="shrink-0 rounded p-1 text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                  title="Remover"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </SortableItem>
            ))}
          </SortableList>
          {items.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma pergunta ainda.</p>}
        </div>
      </div>
    </Modal>
  );
}

