import { useState } from "react";
import { History, Lock, LockOpen } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { dataHora } from "../../lib/format-date";
import { formatBRL } from "../../lib/masks";

/**
 * "Quem fechou e quem reabriu este mês, e quando."
 *
 * ⚠️ Aparece TAMBÉM com o mês reaberto — é justamente aí que ele mais importa: reaberto, o mês
 * some de `competenciasFechadas` e a faixa verde vai embora, e antes disto não sobrava nada na
 * tela dizendo quem tinha conferido. Some só quando o mês nunca foi fechado (histórico vazio).
 *
 * Só leitura: evento não se edita nem se apaga (append-only, ver `historicoFechamento` na API).
 * As datas são INSTANTES, então vão pelo `dataHora` (fuso de Brasília) — não pelo `dataUTC`, que
 * é para campo "só data" gravado à meia-noite UTC.
 */
export function HistoricoFechamento({ clienteId, competencia }: { clienteId: string; competencia: string }) {
  const [aberto, setAberto] = useState(false);
  const historico = trpc.conciliacao.historicoFechamento.useQuery({ clienteId, competencia });

  // Sem evento nenhum não há o que mostrar — e o link sozinho prometeria um histórico vazio.
  // ⚠️ Mas FALHA não é "vazio": com erro, o link continua, e o modal diz o que houve.
  if (!historico.isError && (historico.data?.length ?? 0) === 0) return null;

  return (
    <>
      <Button variant="ghost" className="min-h-11 self-start" onClick={() => setAberto(true)}>
        <History className="mr-1.5 h-4 w-4" />
        Histórico de {competencia}
      </Button>
      <Modal open={aberto} onClose={() => setAberto(false)} title={`Histórico de ${competencia}`} size="sm">
        {historico.isError ? (
          <QueryError message="Não consegui carregar o histórico deste mês." onRetry={() => void historico.refetch()} />
        ) : historico.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ol className="space-y-3 text-sm">
            {(historico.data ?? []).map((e) => (
              <li key={e.id} className="flex gap-2">
                {e.tipo === "FECHOU" ? (
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <LockOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0">
                  <p>
                    <span className="font-medium">{e.tipo === "FECHOU" ? "Fechado" : "Reaberto"}</span>
                    {e.por ? ` por ${e.por}` : ""} em {dataHora(e.em)}
                  </p>
                  {e.retrato && (
                    // O retrato do que foi conferido NAQUELE momento — memória, não o valor de hoje.
                    <p className="text-xs text-muted-foreground">
                      Conferido com {e.retrato.cirurgias} cirurgia(s): {formatBRL(e.retrato.cobrado)} cobrado,{" "}
                      {formatBRL(e.retrato.glosa)} de glosa.
                    </p>
                  )}
                  {e.observacao && <p className="break-words text-xs text-muted-foreground">{e.observacao}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </>
  );
}
