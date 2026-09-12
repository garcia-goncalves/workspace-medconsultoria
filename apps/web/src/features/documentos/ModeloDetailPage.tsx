import { useEffect, useState } from "react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Pencil, Trash2, CheckCircle2, FileSignature, HeartHandshake, ClipboardList, FileText } from "lucide-react";
import { TIPO_MODELO_LABEL, DOC_INTERACAO, type TipoModelo } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Badge } from "../../components/ui/badge";
import { QueryError } from "../../components/ui/query-error";
import { isNotFoundError } from "../../lib/trpc-error";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { DocumentoBranded, previewModelo } from "./DocumentoBranded";
import { DocumentoEditor } from "./DocumentoEditor";
import { useDynamicCrumb } from "../../components/layout/Breadcrumbs";

const route = getRouteApi("/modelos/$modeloId");

/** O que o modelo faz na prática (a partir da matriz de interação). */
function papel(tipo: TipoModelo): { texto: string; icon: typeof FileSignature } {
  const i = DOC_INTERACAO[tipo];
  if (i === "assinatura") return { texto: "O cliente assina (assinatura eletrônica)", icon: FileSignature };
  if (i === "aceite") return { texto: "O cliente aceita ou recusa online", icon: HeartHandshake };
  if (tipo === "BRIEFING") return { texto: "O cliente preenche online", icon: ClipboardList };
  return { texto: "Leitura / entrega (o cliente recebe)", icon: FileText };
}

export function ModeloDetailPage() {
  const { modeloId } = route.useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const q = trpc.documentos.modelos.get.useQuery({ id: modeloId });

  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<TipoModelo>("PROPOSTA");
  const [corpo, setCorpo] = useState("");

  useEffect(() => {
    if (q.data && !editando) {
      setNome(q.data.nome);
      setTipo(q.data.tipo);
      setCorpo(q.data.corpo);
    }
  }, [q.data, editando]);

  useDynamicCrumb(q.data?.nome);

  const invalidate = () => {
    utils.documentos.modelos.get.invalidate({ id: modeloId });
    utils.documentos.modelos.list.invalidate();
  };
  const salvar = trpc.documentos.modelos.update.useMutation({ onSuccess: () => (invalidate(), setEditando(false)) });
  const remove = trpc.documentos.modelos.remove.useMutation({
    onSuccess: () => {
      utils.documentos.modelos.list.invalidate();
      navigate({ to: "/modelos" });
    },
  });

  if (q.isError && !isNotFoundError(q.error)) return <QueryError onRetry={() => q.refetch()} />;
  if (q.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Modelo não encontrado.</p>
        <Link to="/modelos" className="text-primary hover:underline">← Voltar</Link>
      </div>
    );
  }

  const m = q.data;
  const p = papel(editando ? tipo : m.tipo);
  const previewBranded = {
    tipo: TIPO_MODELO_LABEL[editando ? tipo : m.tipo],
    titulo: (editando ? nome : m.nome) || "Modelo",
    conteudoMarkdown: previewModelo(editando ? corpo : m.corpo),
  };

  return (
    <div className="space-y-6">
      <Link to="/modelos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Modelos
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-primary">{m.nome}</h1>
            <Badge variant="default">{TIPO_MODELO_LABEL[m.tipo]}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <p.icon className="h-4 w-4" /> {p.texto}
            {m.editadoManualmente && <span className="ml-1 text-xs">· editado por você</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!editando && (
            <>
              <Button size="sm" onClick={() => setEditando(true)}>
                <Pencil className="h-4 w-4" />
                Editar modelo
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11 hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remover modelo"
                title="Remover"
                onClick={async () => {
                  if (
                    await confirm({
                      title: "Remover modelo",
                      description: `O modelo "${m.nome}" será removido. Documentos já gerados a partir dele não são afetados.`,
                      confirmText: "Remover",
                      variant: "destructive",
                    })
                  )
                    remove.mutate({ id: m.id });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {editando ? (
        <div className="space-y-3">
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-4 py-2.5 shadow-sm">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Pencil className="h-4 w-4 text-primary" />
              Editando o modelo · a prévia atualiza ao lado
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditando(false)} disabled={salvar.isPending}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={() => salvar.mutate({ id: m.id, nome: nome.trim(), tipo, corpo })}
                disabled={salvar.isPending || !nome.trim() || !corpo.trim()}
              >
                {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Salvar modelo
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-nome">Nome *</Label>
              <Input id="m-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-tipo">Tipo</Label>
              <Select id="m-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoModelo)}>
                {(Object.keys(TIPO_MODELO_LABEL) as TipoModelo[])
                  .filter((t) => t !== "BRIEFING")
                  .map((t) => (
                    <option key={t} value={t}>
                      {TIPO_MODELO_LABEL[t]}
                    </option>
                  ))}
              </Select>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <DocumentoEditor value={corpo} onChange={setCorpo} className="lg:sticky lg:top-16" />
            <div className="rounded-xl border bg-muted/30 p-4 sm:p-6">
              <p className="mb-2 text-xs text-muted-foreground">
                Prévia — os <code>{"{{campos}}"}</code> aparecem como <strong>[nome do campo]</strong> e são preenchidos ao gerar o documento.
              </p>
              <DocumentoBranded {...previewBranded} />
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-1 border-b bg-muted/30 px-5 py-3">
            <span className="text-sm font-medium">Como este modelo fica</span>
            <span className="text-xs text-muted-foreground">
              Os <code>{"{{campos}}"}</code> são preenchidos ao gerar o documento
            </span>
          </div>
          <div className="bg-muted/30 p-4 sm:p-8">
            <DocumentoBranded {...previewBranded} />
          </div>
        </div>
      )}
    </div>
  );
}
