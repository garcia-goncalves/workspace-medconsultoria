import { cn } from "@app/ui";

export interface ServicoOpcao {
  id: string;
  nome: string;
  descricao?: string | null;
}

/**
 * Seleção múltipla de serviços em "pills" toggle — reaproveitado no cadastro de lead,
 * na captação pública, na "Nova oportunidade" e no autosserviço do Portal.
 */
export function ServicosPicker({
  servicos,
  value,
  onChange,
}: {
  servicos: ServicoOpcao[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap gap-2">
      {servicos.map((s) => {
        const on = value.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            title={s.descricao ?? undefined}
            className={cn(
              "rounded-full border px-3 py-3 text-sm font-medium transition-colors",
              on ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-accent",
            )}
          >
            {on ? "✓ " : ""}
            {s.nome}
          </button>
        );
      })}
    </div>
  );
}
