import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, Building2, User, Loader2 } from "lucide-react";
import { cn } from "@app/ui";
import { CATEGORIA_TIPO_LABEL, type CategoriaTipo, type Escopo } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Badge } from "../../components/ui/badge";

const COR_PADRAO = "#30AD73";

/** Categoria na tela — pode ser uma existente (id do banco) ou nova ainda não salva (`_novo`). */
type LocalCat = { id: string; nome: string; tipo: CategoriaTipo; cor: string; _novo?: boolean };

/**
 * Gestão das categorias financeiras com **salvamento explícito**: adicionar/editar/excluir
 * só mexem numa lista LOCAL; nada vai para o banco até clicar em **Salvar alterações**.
 * "Cancelar" descarta tudo. Assim o usuário sempre confirma antes de gravar.
 */
export function CategoriasDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();

  const [escopo, setEscopo] = useState<Escopo>("EMPRESA");
  const categorias = trpc.financeiro.categorias.list.useQuery({ escopo }, { enabled: open });

  // Rascunho local (espelha o servidor; edições ficam aqui até Salvar).
  const [local, setLocal] = useState<LocalCat[]>([]);
  const [removidos, setRemovidos] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Formulário de baixo (adicionar × editar) — também só mexe no rascunho local.
  const [editId, setEditId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<CategoriaTipo>("DESPESA");
  const [cor, setCor] = useState(COR_PADRAO);

  // Ressincroniza o rascunho com o servidor ao carregar / trocar de carteira.
  useEffect(() => {
    if (categorias.data) {
      setLocal(categorias.data.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, cor: c.cor ?? COR_PADRAO })));
      setRemovidos([]);
      setDirty(false);
    }
     
  }, [categorias.data, escopo]);

  const create = trpc.financeiro.categorias.create.useMutation();
  const update = trpc.financeiro.categorias.update.useMutation();
  const remove = trpc.financeiro.categorias.remove.useMutation();

  const limpar = () => {
    setEditId(null);
    setNome("");
    setTipo("DESPESA");
    setCor(COR_PADRAO);
  };

  // "Adicionar" / "Salvar edição" → aplica no RASCUNHO local (ainda não grava).
  const aplicarNoLocal = () => {
    if (!nome.trim()) return;
    if (editId) {
      setLocal((l) => l.map((c) => (c.id === editId ? { ...c, nome: nome.trim(), tipo, cor } : c)));
    } else {
      setLocal((l) => [...l, { id: `novo-${Date.now()}-${l.length}`, nome: nome.trim(), tipo, cor, _novo: true }]);
    }
    setDirty(true);
    limpar();
  };

  const excluirLocal = (id: string) => {
    const c = local.find((x) => x.id === id);
    setLocal((l) => l.filter((x) => x.id !== id));
    if (c && !c._novo) setRemovidos((r) => [...r, id]);
    if (editId === id) limpar();
    setDirty(true);
  };

  const iniciarEdicao = (c: LocalCat) => {
    setEditId(c.id);
    setNome(c.nome);
    setTipo(c.tipo);
    setCor(c.cor);
  };

  const trocarEscopo = (e: Escopo) => {
    setEscopo(e); // o efeito ressincroniza o rascunho da nova carteira
    limpar();
  };

  const fechar = () => {
    limpar();
    onClose();
  };

  // Grava TUDO de uma vez (exclusões, novas, editadas) e fecha.
  const salvarTudo = async () => {
    setSalvando(true);
    setErro("");
    try {
      for (const id of removidos) await remove.mutateAsync({ id });
      for (const c of local) {
        if (c._novo) {
          await create.mutateAsync({ nome: c.nome, tipo: c.tipo, cor: c.cor, escopo });
        } else {
          const orig = categorias.data?.find((o) => o.id === c.id);
          if (orig && (orig.nome !== c.nome || orig.tipo !== c.tipo || (orig.cor ?? COR_PADRAO) !== c.cor)) {
            await update.mutateAsync({ id: c.id, nome: c.nome, tipo: c.tipo, cor: c.cor });
          }
        }
      }
      await utils.financeiro.categorias.list.invalidate();
      // O nome/cor da categoria aparece nas contas e no "por categoria" do Financeiro — atualiza lá também.
      utils.financeiro.contas.list.invalidate();
      utils.financeiro.contas.porCategoria.invalidate();
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui salvar. Tente de novo.");
      await utils.financeiro.categorias.list.invalidate();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Categorias financeiras"
      footer={
        <>
          <Button variant="outline" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvarTudo} disabled={!dirty || salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar alterações
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Carteira: as categorias da Empresa e as Pessoais são separadas */}
        <div className="inline-flex w-full rounded-lg border p-0.5">
          {(["EMPRESA", "PESSOAL"] as Escopo[]).map((e) => {
            const on = escopo === e;
            return (
              <button
                key={e}
                type="button"
                onClick={() => trocarEscopo(e)}
                disabled={salvando}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
                  on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {e === "EMPRESA" ? <Building2 className="h-4 w-4" /> : <User className="h-4 w-4" />}
                {e === "EMPRESA" ? "Empresa" : "Pessoal"}
              </button>
            );
          })}
        </div>

        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {categorias.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : local.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma categoria — adicione abaixo.</p>
          ) : (
            local.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.cor }} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.nome}</span>
                {c._novo && <Badge variant="warning">novo</Badge>}
                <Badge variant={c.tipo === "RECEITA" ? "success" : "default"}>{CATEGORIA_TIPO_LABEL[c.tipo]}</Badge>
                <button
                  onClick={() => iniciarEdicao(c)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Editar"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => excluirLocal(c.id)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Remover"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{editId ? "Editar categoria" : "Nova categoria"}</h3>
            {(editId || nome.trim()) && (
              <button onClick={limpar} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
                {editId ? "Cancelar edição" : "Limpar"}
              </button>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cat-nome">Nome</Label>
            <Input
              id="cat-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), aplicarNoLocal())}
              placeholder="Ex.: Consultoria"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cat-tipo">Tipo</Label>
              <Select id="cat-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as CategoriaTipo)}>
                <option value="RECEITA">Receita</option>
                <option value="DESPESA">Despesa</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cat-cor">Cor</Label>
              <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-card px-2">
                <input
                  id="cat-cor"
                  type="color"
                  value={cor}
                  onChange={(e) => setCor(e.target.value)}
                  className="h-6 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <span className="text-xs uppercase tabular-nums text-muted-foreground">{cor}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={aplicarNoLocal} disabled={!nome.trim()}>
              {editId ? "Aplicar edição" : (<><Plus className="h-4 w-4" /> Adicionar à lista</>)}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          As mudanças só são gravadas ao clicar em <strong>Salvar alterações</strong>.
        </p>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </div>
    </Modal>
  );
}
