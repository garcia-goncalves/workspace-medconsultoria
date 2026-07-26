import { Plus, Trash2 } from "lucide-react";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";

export type PostLinha = { data: string; rede: string; formato: string; tema: string };

export const REDES = ["Instagram", "Facebook", "LinkedIn", "TikTok", "YouTube", "Site/Blog"];
export const FORMATOS = ["Post", "Reels", "Stories", "Carrossel", "Vídeo", "Artigo"];

/**
 * Formulário PRÓPRIO da Pauta de postagem (calendário editorial): período + **linhas de post
 * dinâmicas** (data · rede · formato · tema/legenda, adicionar/excluir) + observações. As linhas
 * viram a tabela `{{postagens}}` do modelo ao gerar.
 */
export function PautaPostagemFields({
  periodo,
  setPeriodo,
  posts,
  setPosts,
  observacoes,
  setObservacoes,
}: {
  periodo: string;
  setPeriodo: (v: string) => void;
  posts: PostLinha[];
  setPosts: (v: PostLinha[]) => void;
  observacoes: string;
  setObservacoes: (v: string) => void;
}) {
  const edit = (i: number, campo: keyof PostLinha, v: string) =>
    setPosts(posts.map((p, idx) => (idx === i ? { ...p, [campo]: v } : p)));
  const remove = (i: number) => setPosts(posts.filter((_, idx) => idx !== i));
  const add = () => setPosts([...posts, { data: "", rede: REDES[0]!, formato: FORMATOS[0]!, tema: "" }]);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="post-periodo" hint="Mês ou intervalo que este calendário de postagens cobre. Ex.: Agosto/2026.">Período</Label>
        <Input id="post-periodo" value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="Ex.: Agosto/2026" />
      </div>

      <div className="space-y-1.5">
        <Label hint="Uma linha por post: data, rede social, formato (Reels, Stories…) e tema/legenda.">Postagens</Label>
        <div className="space-y-1.5">
          {posts.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/20 p-1.5">
              <Input
                value={p.data}
                onChange={(e) => edit(i, "data", e.target.value)}
                placeholder="Data"
                className="h-8 w-20"
                aria-label={`Data ${i + 1}`}
              />
              <Select value={p.rede} onChange={(e) => edit(i, "rede", e.target.value)} className="h-8 w-auto" aria-label={`Rede ${i + 1}`}>
                {REDES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
              <Select value={p.formato} onChange={(e) => edit(i, "formato", e.target.value)} className="h-8 w-auto" aria-label={`Formato ${i + 1}`}>
                {FORMATOS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </Select>
              <Input
                value={p.tema}
                onChange={(e) => edit(i, "tema", e.target.value)}
                placeholder="Tema / legenda"
                className="h-8 min-w-[8rem] flex-1"
                aria-label={`Tema ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={posts.length === 1}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                aria-label={`Excluir post ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          <Plus className="h-4 w-4 text-primary" /> Adicionar post
        </button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="post-obs">Observações</Label>
        <Textarea id="post-obs" rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </div>
    </div>
  );
}
