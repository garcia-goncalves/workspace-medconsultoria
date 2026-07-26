import { useState } from "react";
import { Building2, Loader2, Settings2 } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Label } from "../../components/ui/label";
import { MoneyInput } from "../../components/ui/money-input";
import { formatBRL } from "../../lib/masks";
import { OperadorasDialog } from "./OperadorasDialog";

/**
 * Formulário PRÓPRIO da Proposta de credenciamento (≠ Proposta comercial): **seleciona** as
 * operadoras (do catálogo persistente) que entram NESTA proposta e define o **investimento por
 * operadora** (total ao vivo). O catálogo (adicionar/renomear/excluir) é gerido no diálogo
 * dedicado "Gerenciar operadoras" (com salvamento explícito).
 */
export function CredenciamentoPicker({
  operadoras,
  setOperadoras,
  valorOperadora,
  setValorOperadora,
}: {
  operadoras: string[];
  setOperadoras: (v: string[]) => void;
  valorOperadora: number;
  setValorOperadora: (v: number) => void;
}) {
  const cat = trpc.documentos.operadoras.list.useQuery();
  const [gerir, setGerir] = useState(false);

  const marcada = (nome: string) => operadoras.includes(nome);
  const toggle = (nome: string) =>
    setOperadoras(marcada(nome) ? operadoras.filter((n) => n !== nome) : [...operadoras, nome]);

  const total = valorOperadora * operadoras.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5" hint="Marque os convênios/operadoras para os quais este cliente será credenciado.">
          <Building2 className="h-4 w-4 text-primary" /> Operadoras a credenciar *
        </Label>
        <button
          type="button"
          onClick={() => setGerir(true)}
          className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Settings2 className="h-3.5 w-3.5" /> Gerenciar operadoras
        </button>
      </div>

      <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-1.5">
        {cat.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (cat.data ?? []).length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">
            Catálogo vazio — use “Gerenciar operadoras” para adicionar.
          </p>
        ) : (
          (cat.data ?? []).map((op) => (
            <label key={op.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
              <input
                type="checkbox"
                checked={marcada(op.nome)}
                onChange={() => toggle(op.nome)}
                className="h-4 w-4 shrink-0 accent-[var(--primary)]"
              />
              <span className={marcada(op.nome) ? "font-medium" : ""}>{op.nome}</span>
            </label>
          ))
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cred-valor" hint="Valor cobrado do cliente por cada operadora selecionada acima.">Investimento por operadora</Label>
          <MoneyInput id="cred-valor" value={valorOperadora} onChange={(v) => setValorOperadora(v ?? 0)} className="h-9" />
        </div>
        <div className="flex flex-col justify-end">
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {operadoras.length} selecionada(s){valorOperadora > 0 ? " · total" : ""}
            </span>
            {valorOperadora > 0 && <span className="ml-1 font-semibold text-primary">{formatBRL(total)}</span>}
          </div>
        </div>
      </div>

      <OperadorasDialog open={gerir} onClose={() => setGerir(false)} />
    </div>
  );
}
