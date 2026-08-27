import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import { ehServicoDeCredenciamento, ehServicoSomentePercentual, temPercentual } from "@app/shared";
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
 *
 * **Serviço cobrado só por percentual não mostra valor, quantidade nem avulso/mensal** — não
 * existe valor fixo no Faturamento de contas médicas, não existe quantidade, e é sempre mensal.
 * Quem decide isso é o PREÇO do serviço (`ehServicoSomentePercentual`), nunca o nome da
 * categoria: a checagem por `categoria === "Faturamento"` que morava aqui quebraria no dia em
 * que a Thaís criasse outro serviço percentual ou renomeasse a categoria. Ver ADR-125/126.
 */
export function PropostaServicosPicker({
  sel,
  setSel,
  titulo = "Serviços da proposta",
  escopo = "TUDO",
}: {
  sel: Record<string, PropostaSel>;
  setSel: Dispatch<SetStateAction<Record<string, PropostaSel>>>;
  titulo?: string;
  /**
   * QUAIS serviços este documento pode oferecer (decisão de produto de 27/08):
   *
   * - `COMERCIAL` — a proposta padrão, que junta os serviços numa proposta só. **Credenciamento
   *   e Faturamento ficam de fora**: cada um tem proposta própria, com regra de cobrança própria
   *   (o credenciamento só é cobrado no sucesso da operadora — ADR-104; o faturamento é só
   *   percentual — ADR-127). Oferecê-los aqui produziria dois papéis dizendo o mesmo com
   *   números diferentes.
   * - `FATURAMENTO` — a proposta de faturamento tem UM serviço, sempre o mesmo. Não há o que
   *   escolher: o serviço entra sozinho e a tela pergunta só o percentual, que varia por cliente.
   * - `TUDO` — o contrato, que lista o que o cliente contratou de fato, seja qual for.
   *
   * ⚠️ Quem separa é o PREÇO (`ehServicoSomentePercentual`) e o NOME canônico do credenciamento
   * (`ehServicoDeCredenciamento`), NUNCA a comparação `categoria === "Faturamento"` — que já
   * precisou ser removida quatro vezes deste código (ADR-125/126/127).
   */
  escopo?: "COMERCIAL" | "FATURAMENTO" | "TUDO";
}) {
  const servicos = trpc.servicos.ativos.useQuery();

  const doEscopo = useMemo(() => {
    const todos = servicos.data ?? [];
    if (escopo === "FATURAMENTO") return todos.filter((s) => ehServicoSomentePercentual(s));
    if (escopo === "COMERCIAL")
      return todos.filter((s) => !ehServicoSomentePercentual(s) && !ehServicoDeCredenciamento(s.nome));
    return todos;
  }, [servicos.data, escopo]);

  // Proposta de faturamento com UM serviço possível: ele entra marcado, sem pedir clique. Com
  // mais de um (a Thaís pode criar outro serviço percentual), a lista aparece e ela escolhe —
  // é o que impede a tela de adivinhar errado em silêncio.
  const unico = escopo === "FATURAMENTO" && doEscopo.length === 1 ? doEscopo[0] : null;
  useEffect(() => {
    if (!unico) return;
    setSel((prev) =>
      prev[unico.id]
        ? prev
        : { [unico.id]: { valor: 0, qtd: 1, recorrencia: "MENSAL", percentual: unico.percentual ?? null, categoria: unico.categoria } },
    );
  }, [unico, setSel]);

  const toggle = (s: NonNullable<typeof servicos.data>[number]) =>
    setSel((prev) => {
      const n = { ...prev };
      if (n[s.id]) delete n[s.id];
      else if (ehServicoSomentePercentual(s))
        // Percentual puro: nasce sem valor, sem quantidade e MENSAL — e assim fica, porque a
        // tela nem oferece esses campos.
        n[s.id] = { valor: 0, qtd: 1, recorrencia: "MENSAL", percentual: s.percentual ?? null, categoria: s.categoria };
      else
        n[s.id] = {
          valor: s.valor ?? 0,
          qtd: 1,
          recorrencia: s.valorRecorrencia ?? "AVULSO",
          // O % acompanha o serviço que TEM % no catálogo, seja ele qual for.
          percentual: temPercentual(s) ? s.percentual ?? null : null,
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
      <Label hint="Marque os serviços que entram neste documento e ajuste valor, quantidade e recorrência de cada um. Serviço cobrado por percentual não tem valor nem quantidade — é sempre mensal.">
        {titulo}
      </Label>
      <div className="max-h-[26vh] space-y-1 overflow-y-auto rounded-lg border p-2">
        {doEscopo.map((s) => {
          const marcado = !!sel[s.id];
          const item = sel[s.id];
          const soPercentual = ehServicoSomentePercentual(s);
          const aceitaPercentual = temPercentual(s);
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
                  {!soPercentual && (
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
                          setSel((st) => ({
                            ...st,
                            [s.id]: { ...item, recorrencia: e.target.value as "AVULSO" | "MENSAL" },
                          }))
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
                  )}
                  {aceitaPercentual && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{soPercentual ? "% do faturamento:" : "+ % do faturamento:"}</span>
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
                      {soPercentual && (
                        <span className="ml-auto text-sm font-semibold text-primary tabular-nums">
                          {item.percentual ? `${formatPct(item.percentual)}/mês` : "—"}
                        </span>
                      )}
                    </div>
                  )}
                  {soPercentual && (
                    <p className="text-[11px] text-muted-foreground">
                      Sem valor fixo e sem quantidade — a cobrança é o percentual sobre o que a clínica fatura, todo mês.
                    </p>
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
