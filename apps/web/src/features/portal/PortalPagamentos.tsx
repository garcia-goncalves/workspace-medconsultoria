import { useState } from "react";
import { AlertTriangle, Wallet, CheckCircle2, Copy } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { dataUTC, data } from "../../lib/format-date";
import { formatBRL } from "../../lib/masks";
import { Card, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { Button } from "../../components/ui/button";
import { toast } from "../../components/ui/toast";

/**
 * "QUANTO EU DEVO E QUANDO VENCE?" — o cartão de pagamentos do Portal (Onda 3B).
 *
 * Mora em "Meus serviços" de propósito, e não numa seção nova da barra: a barra tem 4 coringas e
 * uma vaga (ADR-139), e o que o cliente paga é a outra face do que ele contratou — é ali que ele
 * já vai conferir o preço. O Início ganha só um lembrete curto (próximo vencimento / vencidas) que
 * aponta para cá.
 *
 * ⚠️ Estado de ERRO antes do vazio: "Nada em aberto" dito durante uma falha de rede é o cliente
 * concluindo que está em dia — e deixando de pagar.
 */
export function PortalPagamentos() {
  const q = trpc.portal.pagamentos.useQuery();
  const [verPagas, setVerPagas] = useState(false);

  if (q.isLoading) {
    return (
      <Card>
        <div className="space-y-3 p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-11 w-full" />
        </div>
      </Card>
    );
  }

  if (q.isError || !q.data) {
    return (
      <Card>
        <div className="flex flex-col items-start gap-2 p-4 sm:p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> Não conseguimos carregar seus pagamentos
          </p>
          <p className="text-xs text-muted-foreground">Pode ter sido a conexão — isso não quer dizer que não há nada em aberto.</p>
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => q.refetch()} disabled={q.isFetching}>
            Tentar de novo
          </Button>
        </div>
      </Card>
    );
  }

  const r = q.data;
  const copiarPix = async (chave: string) => {
    try {
      await navigator.clipboard.writeText(chave);
      toast("Chave PIX copiada.", "success");
    } catch {
      toast("Não deu para copiar — selecione a chave e copie à mão.", "error");
    }
  };
  const pix = r.dadosPagamento.find((l) => l.rotulo === "Chave PIX");

  return (
    <Card id="pagamentos">
      <CardHeader>
        <CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" /> Pagamentos
        </CardTitle>
        {r.totalEmAberto > 0 && <span className="text-xs text-muted-foreground">Em aberto: {formatBRL(r.totalEmAberto)}</span>}
      </CardHeader>
      <div className="space-y-4 px-4 pb-5 pt-1 sm:px-5">
        {r.quantidadeVencidas > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span className="min-w-0 text-foreground">
              {r.quantidadeVencidas === 1 ? "1 pagamento vencido" : `${r.quantidadeVencidas} pagamentos vencidos`}, somando{" "}
              <strong>{formatBRL(r.totalVencido)}</strong>.
            </span>
          </div>
        )}

        {r.emAberto.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> Nada em aberto. Obrigado!
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {r.emAberto.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium text-foreground">{c.descricao}</p>
                  <p className={`text-xs ${c.vencida ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                    {c.vencida ? "Venceu em " : "Vence em "}
                    {dataUTC(c.vencimento)}
                    {c.mensal ? " · mensal" : ""}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-foreground">{formatBRL(c.valor)}</span>
              </li>
            ))}
          </ul>
        )}

        {r.dadosPagamento.length > 0 && r.emAberto.length > 0 && (
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Como pagar (PIX)</p>
            <dl className="mt-1 space-y-0.5 text-sm">
              {r.dadosPagamento.map((l) => (
                <div key={l.rotulo} className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">{l.rotulo}:</dt>
                  <dd className="min-w-0 break-all font-medium text-foreground">{l.valor}</dd>
                </div>
              ))}
            </dl>
            {pix && (
              <Button size="sm" variant="outline" className="mt-2 min-h-11" onClick={() => copiarPix(pix.valor)}>
                <Copy className="h-4 w-4" /> Copiar chave PIX
              </Button>
            )}
          </div>
        )}

        {r.pagas.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setVerPagas((v) => !v)}
              aria-expanded={verPagas}
              className="inline-flex min-h-11 items-center text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {verPagas ? "Esconder pagos" : `Ver pagos nos últimos 6 meses (${r.pagas.length})`}
            </button>
            {verPagas && (
              <ul className="divide-y rounded-lg border">
                {r.pagas.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-foreground">{c.descricao}</p>
                      <p className="text-xs text-muted-foreground">
                        Pago{c.pagoEm ? ` em ${data(c.pagoEm)}` : ""} · vencimento {dataUTC(c.vencimento)}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatBRL(c.valor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
