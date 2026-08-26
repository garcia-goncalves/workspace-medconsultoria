import { useState } from "react";
import { Building2, Loader2, Settings2 } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Label } from "../../components/ui/label";
import { OperadorasDialog } from "./OperadorasDialog";

/**
 * Os CONVÊNIOS que a clínica atende — a lista que entra na proposta de faturamento (ADR-126).
 *
 * Não é cobrança e não é o mesmo que credenciar: aqui o cliente já atende aqueles convênios, e
 * a lista existe para ele conferir que estamos falando dos mesmos. Vem do **mesmo cadastro** de
 * operadoras, filtrado pela marcação `Faturamento` — duas listas separadas divergiriam.
 *
 * Guarda **ids**, não nomes: esta lista fica com o cliente depois do aceite, e nome copiado não
 * sobrevive a um "renomear" no catálogo.
 */
export function ConveniosPicker({
  selecionados,
  setSelecionados,
}: {
  selecionados: string[];
  setSelecionados: (v: string[]) => void;
}) {
  const catalogo = trpc.documentos.operadoras.list.useQuery({ uso: "FATURAMENTO" });
  const [gerir, setGerir] = useState(false);

  const marcado = (id: string) => selecionados.includes(id);
  const alternar = (id: string) =>
    setSelecionados(marcado(id) ? selecionados.filter((x) => x !== id) : [...selecionados, id]);
  const lista = catalogo.data ?? [];
  const todos = () => setSelecionados(selecionados.length === lista.length ? [] : lista.map((o) => o.id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label
          className="flex items-center gap-1.5"
          hint="Os convênios cujas contas nós vamos faturar para esta clínica. Convênio novo pode ser incluído depois, sem nova proposta."
        >
          <Building2 className="h-4 w-4 text-primary" /> Convênios atendidos pela clínica
        </Label>
        <div className="flex items-center gap-1.5">
          {lista.length > 0 && (
            <button
              type="button"
              onClick={todos}
              className="rounded-md border px-2 py-0.5 text-xs font-medium transition-colors hover:bg-accent"
            >
              {selecionados.length === lista.length ? "Nenhum" : "Todos"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setGerir(true)}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Settings2 className="h-3.5 w-3.5" /> Gerenciar
          </button>
        </div>
      </div>

      <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border p-1.5">
        {catalogo.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : lista.length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">
            Nenhuma operadora marcada como <strong>Faturamento</strong> — use “Gerenciar” para marcar.
          </p>
        ) : (
          lista.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <input
                type="checkbox"
                checked={marcado(o.id)}
                onChange={() => alternar(o.id)}
                className="h-4 w-4 shrink-0 accent-[var(--primary)]"
              />
              <span className={marcado(o.id) ? "font-medium" : ""}>{o.nome}</span>
            </label>
          ))
        )}
      </div>
      <p className="text-xs text-muted-foreground">{selecionados.length} convênio(s) selecionado(s).</p>

      <OperadorasDialog open={gerir} onClose={() => setGerir(false)} />
    </div>
  );
}
