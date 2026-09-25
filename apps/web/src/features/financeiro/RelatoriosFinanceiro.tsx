import { Link } from "@tanstack/react-router";
import { AlertTriangle, BarChart3, TrendingUp, UserX } from "lucide-react";
import { cn } from "@app/ui";
import type { Carteira } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { formatBRL } from "../../lib/masks";
import { dataUTC } from "../../lib/format-date";
import { Button } from "../../components/ui/button";
import { QueryError } from "../../components/ui/query-error";
import { Skeleton } from "../../components/ui/skeleton";
import { larguraRelativa, rotuloDoMes, textoAtraso } from "./relatorios-formato";

/**
 * A ABA "RELATÓRIOS" DO FINANCEIRO — as três perguntas que a lista de contas não responde:
 * como foi cada mês, como vão ser os próximos, e quem está devendo.
 *
 * ⚠️ Cada bloco tem o PRÓPRIO estado de erro. Falha de consulta lida como "não há nada" é o modo
 * de falha que esta casa mais repete: aqui, "ninguém está devendo" com a consulta caída seria a
 * frase mais cara possível.
 */
export function RelatoriosFinanceiro({
  carteira,
  onVerContasDoCliente,
}: {
  carteira: Carteira;
  onVerContasDoCliente: (clienteId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <MesAMes carteira={carteira} />
      <Projecao carteira={carteira} />
      <Inadimplencia carteira={carteira} onVerContas={onVerContasDoCliente} />
    </div>
  );
}

function Bloco({ icone: Icone, titulo, subtitulo, children }: {
  icone: typeof BarChart3;
  titulo: string;
  subtitulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start gap-2">
        <Icone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-primary">{titulo}</h2>
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

// ── Mês a mês ────────────────────────────────────────────
function MesAMes({ carteira }: { carteira: Carteira }) {
  const q = trpc.financeiro.relatorios.mensal.useQuery({ carteira });
  const meses = q.data?.meses ?? [];
  const maximo = Math.max(0, ...meses.map((m) => Math.max(m.recebido, m.pago)));

  return (
    <Bloco
      icone={BarChart3}
      titulo="Mês a mês — últimos 12 meses"
      subtitulo="Regime de caixa: vale o mês em que o dinheiro entrou ou saiu, não o do vencimento. “A receber vencido” é o que venceu naquele mês e ainda não entrou."
    >
      {q.isError ? (
        <QueryError onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="overflow-x-auto" data-rolagem-horizontal>
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Mês</th>
                <th className="py-2 pr-2 text-right font-medium">Entrou</th>
                <th className="py-2 pr-2 text-right font-medium">Saiu</th>
                <th className="py-2 pr-2 text-right font-medium">Resultado</th>
                <th className="py-2 pr-2 text-right font-medium">A receber vencido</th>
                <th className="w-32 py-2 font-medium" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {/* Do mais recente para o mais antigo: o mês corrente é o que se olha primeiro. */}
              {[...meses].reverse().map((m) => (
                <tr key={m.mes} className="border-b last:border-0">
                  <td className="py-2 pr-2 font-medium">{rotuloDoMes(m.mes)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-success">{formatBRL(m.recebido)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-destructive">{formatBRL(m.pago)}</td>
                  <td
                    className={cn(
                      "py-2 pr-2 text-right font-semibold tabular-nums",
                      m.resultado >= 0 ? "text-success" : "text-destructive",
                    )}
                  >
                    {formatBRL(m.resultado)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {m.vencidoAReceber > 0 ? (
                      <span className="text-warning">
                        {formatBRL(m.vencidoAReceber)}{" "}
                        <span className="text-xs text-muted-foreground">({m.qtdVencidoAReceber})</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {/* Barras simples (sem biblioteca de gráfico): entrou em cima, saiu embaixo. */}
                  <td className="py-2" aria-hidden>
                    <div className="space-y-0.5">
                      <div className="h-1.5 rounded-full bg-success" style={{ width: `${larguraRelativa(m.recebido, maximo)}%` }} />
                      <div className="h-1.5 rounded-full bg-destructive" style={{ width: `${larguraRelativa(m.pago, maximo)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Bloco>
  );
}

// ── Projeção ─────────────────────────────────────────────
function Projecao({ carteira }: { carteira: Carteira }) {
  const q = trpc.financeiro.relatorios.projecao.useQuery({ carteira });

  return (
    <Bloco
      icone={TrendingUp}
      titulo="Projeção de caixa — próximos 3 meses"
      subtitulo="Contas em aberto que vencem em cada mês (o atual, de hoje em diante), mais as parcelas que as contas recorrentes ainda vão gerar. Não conta o saldo do banco."
    >
      {q.isError ? (
        <QueryError onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {q.data.meses.map((m) => {
              const projetado = m.receberProjetado + m.pagarProjetado;
              return (
                <div key={m.mes} className="rounded-lg border p-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">{rotuloDoMes(m.mes)}</div>
                  <div className={cn("mt-1 text-xl font-semibold tabular-nums", m.saldo >= 0 ? "text-success" : "text-destructive")}>
                    {formatBRL(m.saldo)}
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    <div>
                      A receber <span className="tabular-nums text-success">{formatBRL(m.receber)}</span>
                    </div>
                    <div>
                      A pagar <span className="tabular-nums text-destructive">{formatBRL(m.pagar)}</span>
                    </div>
                    {projetado > 0 && (
                      <div className="pt-1 italic">
                        inclui {formatBRL(projetado)} de parcelas recorrentes ainda não lançadas
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {(q.data.vencido.qtdReceber > 0 || q.data.vencido.qtdPagar > 0) && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                <strong>Fora da projeção, já vencido:</strong>{" "}
                {formatBRL(q.data.vencido.receber)} a receber ({q.data.vencido.qtdReceber}) ·{" "}
                {formatBRL(q.data.vencido.pagar)} a pagar ({q.data.vencido.qtdPagar}).
              </span>
            </div>
          )}
        </div>
      )}
    </Bloco>
  );
}

// ── Inadimplência ────────────────────────────────────────
function Inadimplencia({ carteira, onVerContas }: { carteira: Carteira; onVerContas: (clienteId: string) => void }) {
  const q = trpc.financeiro.relatorios.inadimplencia.useQuery({ carteira });

  return (
    <Bloco
      icone={UserX}
      titulo="Quem está devendo"
      subtitulo="Clientes com contas a receber vencidas e não recebidas, do maior valor para o menor."
    >
      {q.isError ? (
        <QueryError onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : q.data.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma conta a receber vencida. 🎉</p>
      ) : (
        <ul className="divide-y">
          {q.data.map((i) => (
            <li key={i.clienteId ?? "sem-cliente"} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 flex-1">
                {i.clienteId ? (
                  <Link
                    to="/clientes/$clienteId"
                    params={{ clienteId: i.clienteId }}
                    className="inline-flex min-h-11 items-center font-medium text-primary hover:underline md:min-h-0"
                  >
                    {i.clienteNome}
                  </Link>
                ) : (
                  <span className="font-medium text-muted-foreground">{i.clienteNome}</span>
                )}
                <div className="text-xs text-muted-foreground">
                  {i.quantidade === 1 ? "1 conta" : `${i.quantidade} contas`} · mais antiga vencida em{" "}
                  {dataUTC(i.maisAntiga)} ({textoAtraso(i.diasEmAtraso)})
                </div>
              </div>
              <div className="font-semibold tabular-nums text-destructive">{formatBRL(i.total)}</div>
              {i.clienteId && (
                <Button
                  variant="ghost"
                  className="min-h-11 md:min-h-0"
                  aria-label={`Ver as contas vencidas de ${i.clienteNome}`}
                  onClick={() => onVerContas(i.clienteId!)}
                >
                  Ver contas
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}
