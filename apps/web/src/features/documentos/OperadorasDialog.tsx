import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X, Building2, Loader2 } from "lucide-react";
import { cn } from "@app/ui";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";

/** Operadora na tela — existente (id do banco) ou nova ainda não salva (`_novo`). */
type LocalOp = { id: string; nome: string; usoCredenciamento: boolean; usoFaturamento: boolean; _novo?: boolean };

/** Qual lista está sendo olhada. O cadastro é um só; a aba só filtra o que aparece. */
type Aba = "TODAS" | "CREDENCIAMENTO" | "FATURAMENTO";
const ABAS: { chave: Aba; rotulo: string }[] = [
  { chave: "TODAS", rotulo: "Todas" },
  { chave: "CREDENCIAMENTO", rotulo: "Credenciamento" },
  { chave: "FATURAMENTO", rotulo: "Faturamento" },
];

/**
 * Gestão do catálogo de operadoras/convênios com **salvamento explícito**: adicionar/editar/
 * excluir só mexem numa lista LOCAL; nada vai ao banco até **Salvar alterações**.
 *
 * **É UM cadastro só, com duas marcações** (ADR-126). A mesma Unimed que se credencia é a
 * Unimed cujas contas se faturam — manter duas listas faria a Thaís cadastrar o nome duas
 * vezes e deixaria as duas divergirem. As abas separam a VISTA, não o registro.
 */
export function OperadorasDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const cat = trpc.documentos.operadoras.list.useQuery(undefined, { enabled: open });

  const [local, setLocal] = useState<LocalOp[]>([]);
  const [removidos, setRemovidos] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("TODAS");

  const [editId, setEditId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [novoCred, setNovoCred] = useState(true);
  const [novoFat, setNovoFat] = useState(true);

  useEffect(() => {
    if (cat.data) {
      setLocal(
        cat.data.map((o) => ({
          id: o.id,
          nome: o.nome,
          usoCredenciamento: o.usoCredenciamento,
          usoFaturamento: o.usoFaturamento,
        })),
      );
      setRemovidos([]);
      setDirty(false);
      setEditId(null);
      setNome("");
      setNovoCred(true);
      setNovoFat(true);
    }
  }, [cat.data]);

  const criar = trpc.documentos.operadoras.criar.useMutation();
  const atualizar = trpc.documentos.operadoras.atualizar.useMutation();
  const remover = trpc.documentos.operadoras.remover.useMutation();

  const limpar = () => {
    setEditId(null);
    setNome("");
    setNovoCred(true);
    setNovoFat(true);
  };

  const aplicarNoLocal = () => {
    const n = nome.trim();
    if (!n) return;
    if (!novoCred && !novoFat) {
      setErro("Marque ao menos um serviço — senão a operadora não aparece em nenhuma proposta.");
      return;
    }
    setErro("");
    if (editId) {
      setLocal((l) =>
        l.map((o) => (o.id === editId ? { ...o, nome: n, usoCredenciamento: novoCred, usoFaturamento: novoFat } : o)),
      );
    } else {
      if (local.some((o) => o.nome.toLowerCase() === n.toLowerCase())) {
        limpar();
        return;
      }
      setLocal((l) => [
        ...l,
        { id: `novo-${Date.now()}-${l.length}`, nome: n, usoCredenciamento: novoCred, usoFaturamento: novoFat, _novo: true },
      ]);
    }
    setDirty(true);
    limpar();
  };

  /** Liga/desliga uma marcação direto na linha — é o gesto mais frequente da tela. */
  const alternarUso = (id: string, campo: "usoCredenciamento" | "usoFaturamento") => {
    setLocal((l) =>
      l.map((o) => {
        if (o.id !== id) return o;
        const proximo = { ...o, [campo]: !o[campo] };
        // Desmarcar as duas some com a operadora de todas as listas — a tela recusa antes de o
        // servidor recusar, para o erro não aparecer só depois de Salvar.
        if (!proximo.usoCredenciamento && !proximo.usoFaturamento) {
          setErro(`"${o.nome}" precisa de ao menos um serviço marcado.`);
          return o;
        }
        setErro("");
        return proximo;
      }),
    );
    setDirty(true);
  };

  const excluirLocal = (id: string) => {
    const o = local.find((x) => x.id === id);
    setLocal((l) => l.filter((x) => x.id !== id));
    if (o && !o._novo) setRemovidos((r) => [...r, id]);
    if (editId === id) limpar();
    setDirty(true);
  };

  const fechar = () => {
    limpar();
    onClose();
  };

  const salvarTudo = async () => {
    setSalvando(true);
    setErro("");
    try {
      for (const id of removidos) await remover.mutateAsync({ id });
      for (const o of local) {
        if (o._novo) {
          await criar.mutateAsync({ nome: o.nome, usoCredenciamento: o.usoCredenciamento, usoFaturamento: o.usoFaturamento });
        } else {
          const orig = cat.data?.find((x) => x.id === o.id);
          if (
            orig &&
            (orig.nome !== o.nome ||
              orig.usoCredenciamento !== o.usoCredenciamento ||
              orig.usoFaturamento !== o.usoFaturamento)
          ) {
            await atualizar.mutateAsync({
              id: o.id,
              nome: o.nome,
              usoCredenciamento: o.usoCredenciamento,
              usoFaturamento: o.usoFaturamento,
            });
          }
        }
      }
      await utils.documentos.operadoras.list.invalidate();
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui salvar. Tente de novo.");
      await utils.documentos.operadoras.list.invalidate();
    } finally {
      setSalvando(false);
    }
  };

  const visiveis = useMemo(
    () =>
      local.filter((o) =>
        aba === "CREDENCIAMENTO" ? o.usoCredenciamento : aba === "FATURAMENTO" ? o.usoFaturamento : true,
      ),
    [local, aba],
  );
  const contar = (campo: "usoCredenciamento" | "usoFaturamento") => local.filter((o) => o[campo]).length;

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Operadoras e convênios"
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
        <p className="text-sm text-muted-foreground">
          Um cadastro só. Marque em quais serviços cada operadora entra: <strong>Credenciamento</strong> (a grade
          médico × operadora e a proposta de credenciamento) e <strong>Faturamento</strong> (os convênios atendidos
          pela clínica).
        </p>

        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
          {ABAS.map((a) => (
            <button
              key={a.chave}
              type="button"
              onClick={() => setAba(a.chave)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                aba === a.chave ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {a.rotulo}
              <span className="ml-1.5 text-xs text-muted-foreground">
                {a.chave === "TODAS"
                  ? local.length
                  : a.chave === "CREDENCIAMENTO"
                    ? contar("usoCredenciamento")
                    : contar("usoFaturamento")}
              </span>
            </button>
          ))}
        </div>

        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {cat.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : visiveis.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {local.length === 0 ? "Nenhuma operadora — adicione abaixo." : "Nenhuma operadora marcada nesta lista."}
            </p>
          ) : (
            visiveis.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{o.nome}</span>
                {o._novo && <Badge variant="warning">novo</Badge>}
                <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={o.usoCredenciamento}
                    onChange={() => alternarUso(o.id, "usoCredenciamento")}
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                  Credenciamento
                </label>
                <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={o.usoFaturamento}
                    onChange={() => alternarUso(o.id, "usoFaturamento")}
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                  Faturamento
                </label>
                <button
                  onClick={() => (
                    setEditId(o.id), setNome(o.nome), setNovoCred(o.usoCredenciamento), setNovoFat(o.usoFaturamento)
                  )}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Editar"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => excluirLocal(o.id)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Remover"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{editId ? "Editar operadora" : "Nova operadora"}</h3>
            {(editId || nome.trim()) && (
              <button onClick={limpar} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
                {editId ? "Cancelar edição" : "Limpar"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), aplicarNoLocal())}
              placeholder="Ex.: Unimed"
              autoComplete="off"
            />
            <Button variant="outline" onClick={aplicarNoLocal} disabled={!nome.trim()}>
              {editId ? "Aplicar" : (<><Plus className="h-4 w-4" /> Adicionar</>)}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={novoCred}
                onChange={(e) => setNovoCred(e.target.checked)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              Credenciamento
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={novoFat}
                onChange={(e) => setNovoFat(e.target.checked)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              Faturamento
            </label>
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
