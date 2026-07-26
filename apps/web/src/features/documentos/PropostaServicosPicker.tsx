import { useMemo, type Dispatch, type SetStateAction } from "react";
import { trpc } from "../../lib/trpc";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { MoneyInput } from "../../components/ui/money-input";
import { formatBRL, formatPct } from "../../lib/masks";

export type PropostaSel = {
  valor: number;
  qtd: number;
  recorrencia: "AVULSO" | "MENSAL";
  percentual: number | null;
  categoria: string | null;
};

/**
 * Seletor de serviços da proposta (catálogo com preços editáveis + total inteligente).
 * O estado (`sel`) fica no pai, que monta o payload de `criarProposta`.
 */
export function PropostaServicosPicker({
  sel,
  setSel,
  titulo = "Serviços da proposta",
}: {
  sel: Record<string, PropostaSel>;
  setSel: Dispatch<SetStateAction<Record<string, PropostaSel>>>;
  titulo?: string;
}) {
  const servicos = trpc.servicos.ativos.useQuery();

  const toggle = (s: NonNullable<typeof servicos.data>[number]) =>
    setSel((prev) => {
      const n = { ...prev };
      if (n[s.id]) delete n[s.id];
      else
        n[s.id] = {
          valor: s.valor ?? 0,
          qtd: 1,
          recorrencia: s.valorRecorrencia ?? "AVULSO",
          percentual: s.categoria === "Faturamento" ? s.percentual ?? null : null,
          categoria: s.categoria,
        };
      return n;
    });

  const totais = useMemo(() => {
    let avulso = 0;
    let mensal = 0;
    const percentuais: number[] = [];
    for (const i of Object.values(sel)) {
      const sub = i.valor * i.qtd;
      if (i.recorrencia === "MENSAL") mensal += sub;
      else avulso += sub;
      if (i.percentual != null && i.percentual > 0) percentuais.push(i.percentual);
    }
    return { avulso, mensal, percentuais };
  }, [sel]);
  const nSel = Object.keys(sel).length;

  return (
    <div className="space-y-1">
      <Label hint="Marque os serviços que entram neste documento e ajuste valor, quantidade e recorrência de cada um.">{titulo}</Label>
      <div className="max-h-[26vh] space-y-1 overflow-y-auto rounded-lg border p-2">
        {(servicos.data ?? []).map((s) => {
          const marcado = !!sel[s.id];
          const item = sel[s.id];
          return (
            <div key={s.id} className={"rounded-md p-2 " + (marcado ? "bg-primary/5" : "hover:bg-accent/40")}>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() => toggle(s)}
                  className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">{s.nome}</span>
                  {s.categoria && <span className="ml-1.5 text-[11px] text-muted-foreground">· {s.categoria}</span>}
                  {s.descricao && <p className="text-xs text-muted-foreground">{s.descricao}</p>}
                </div>
              </label>
              {marcado && item && (
                <div className="mt-2 space-y-1.5 pl-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <MoneyInput
                      value={item.valor}
                      onChange={(v) => setSel((st) => ({ ...st, [s.id]: { ...item, valor: v ?? 0 } }))}
                      className="h-8 w-28"
                    />
                    <span className="text-xs text-muted-foreground">×</span>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={String(item.qtd)}
                      onChange={(e) =>
                        setSel((st) => ({ ...st, [s.id]: { ...item, qtd: Math.max(1, Number(e.target.value) || 1) } }))
                      }
                      className="h-8 w-14"
                    />
                    <select
                      value={item.recorrencia}
                      onChange={(e) =>
                        setSel((st) => ({ ...st, [s.id]: { ...item, recorrencia: e.target.value as "AVULSO" | "MENSAL" } }))
                      }
                      className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:border-primary"
                    >
                      <option value="AVULSO">avulso (1x)</option>
                      <option value="MENSAL">mensal</option>
                    </select>
                    <span className="ml-auto text-sm font-semibold text-primary tabular-nums">
                      {item.valor * item.qtd > 0
                        ? `${formatBRL(item.valor * item.qtd)}${item.recorrencia === "MENSAL" ? "/mês" : ""}`
                        : item.percentual
                          ? `${formatPct(item.percentual)}/mês`
                          : "—"}
                    </span>
                  </div>
                  {s.categoria === "Faturamento" && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>+ % do faturamento:</span>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          placeholder="0"
                          value={item.percentual ?? ""}
                          onChange={(e) =>
                            setSel((st) => ({
                              ...st,
                              [s.id]: { ...item, percentual: e.target.value === "" ? null : Number(e.target.value) },
                            }))
                          }
                          className="h-8 w-20 rounded-md border bg-background px-2 pr-6 text-sm text-foreground outline-none focus:border-primary"
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">%</span>
                      </div>
                      <span>/mês</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {servicos.data && servicos.data.length === 0 && (
          <p className="p-2 text-sm text-muted-foreground">Nenhum serviço no catálogo.</p>
        )}
      </div>
      {nSel > 0 && (
        <div className="space-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm">
          <div className="text-xs text-muted-foreground">
            {nSel} serviço{nSel > 1 ? "s" : ""} — investimento:
          </div>
          {totais.avulso > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">À vista (1x)</span>
              <span className="font-semibold text-foreground">{formatBRL(totais.avulso)}</span>
            </div>
          )}
          {totais.mensal > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Mensal</span>
              <span className="font-semibold text-foreground">{formatBRL(totais.mensal)}/mês</span>
            </div>
          )}
          {totais.percentuais.map((p, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-muted-foreground">% do faturamento</span>
              <span className="font-semibold text-foreground">{formatPct(p)}/mês</span>
            </div>
          ))}
          {totais.avulso === 0 && totais.mensal === 0 && totais.percentuais.length === 0 && (
            <div className="text-muted-foreground">Valores a combinar</div>
          )}
        </div>
      )}
    </div>
  );
}
