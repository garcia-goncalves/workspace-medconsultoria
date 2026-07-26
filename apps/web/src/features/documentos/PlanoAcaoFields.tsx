import { Plus, Trash2 } from "lucide-react";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";

export type AcaoLinha = { acao: string; resp: string; prazo: string };

/**
 * Formulário PRÓPRIO do Plano de ação: objetivo + **linhas de ação dinâmicas** (ação ·
 * responsável · prazo, adicionar/remover) + como medir o sucesso. As linhas viram a tabela
 * `{{acoes}}` do modelo ao gerar.
 */
export function PlanoAcaoFields({
  objetivo,
  setObjetivo,
  acoes,
  setAcoes,
  indicadores,
  setIndicadores,
}: {
  objetivo: string;
  setObjetivo: (v: string) => void;
  acoes: AcaoLinha[];
  setAcoes: (v: AcaoLinha[]) => void;
  indicadores: string;
  setIndicadores: (v: string) => void;
}) {
  const edit = (i: number, campo: keyof AcaoLinha, v: string) =>
    setAcoes(acoes.map((a, idx) => (idx === i ? { ...a, [campo]: v } : a)));
  const remove = (i: number) => setAcoes(acoes.filter((_, idx) => idx !== i));
  const add = () => setAcoes([...acoes, { acao: "", resp: "", prazo: "" }]);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="plano-obj" hint="O resultado que este plano de ação pretende alcançar.">Objetivo do plano *</Label>
        <Textarea
          id="plano-obj"
          rows={2}
          value={objetivo}
          onChange={(e) => setObjetivo(e.target.value)}
          placeholder="Ex.: reduzir a glosa de convênios para menos de 3% em 90 dias."
        />
      </div>

      <div className="space-y-1.5">
        <Label hint="Uma linha por ação: o que fazer, quem é o responsável e o prazo.">Ações</Label>
        <div className="space-y-1.5">
          {acoes.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={a.acao}
                onChange={(e) => edit(i, "acao", e.target.value)}
                placeholder="O que fazer"
                className="h-9 flex-[2]"
                aria-label={`Ação ${i + 1}`}
              />
              <Input
                value={a.resp}
                onChange={(e) => edit(i, "resp", e.target.value)}
                placeholder="Responsável"
                className="h-9 flex-1"
                aria-label={`Responsável ${i + 1}`}
              />
              <Input
                value={a.prazo}
                onChange={(e) => edit(i, "prazo", e.target.value)}
                placeholder="Prazo"
                className="h-9 w-24"
                aria-label={`Prazo ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={acoes.length === 1}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                aria-label={`Excluir ação ${i + 1}`}
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
          <Plus className="h-4 w-4 text-primary" /> Adicionar ação
        </button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="plano-ind" hint="Os números ou indicadores que mostram se o plano deu certo.">Como mediremos o sucesso</Label>
        <Textarea
          id="plano-ind"
          rows={2}
          value={indicadores}
          onChange={(e) => setIndicadores(e.target.value)}
          placeholder="Ex.: % de glosa mensal, número de recursos ganhos, prazo médio de recebimento."
        />
      </div>
    </div>
  );
}
