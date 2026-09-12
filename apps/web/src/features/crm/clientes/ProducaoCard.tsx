import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, FileSpreadsheet } from "lucide-react";
import { trpc } from "../../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { dataUTC } from "../../../lib/format-date";

/**
 * PRODUÇÃO — o resumo do último mês importado, dentro da ficha do cliente.
 *
 * A tela cheia é `/conciliacao`; aqui a ficha responde de relance a pergunta "este cliente está
 * com a produção em dia?". Segue o mesmo padrão do `CredenciamentoGradeCard`: o dado vive na
 * página dedicada, e a ficha mostra o suficiente para saber se precisa ir até lá.
 *
 * Não aparece quando o cliente nunca teve produção importada — ficha com card vazio é ruído.
 */
export function ProducaoCard({ clienteId }: { clienteId: string }) {
  const competencias = trpc.conciliacao.competencias.useQuery({ clienteId });
  const ultima = competencias.data?.[0];
  const resumo = trpc.conciliacao.resumo.useQuery({ clienteId, competencia: ultima?.competencia ?? "" }, { enabled: !!ultima });
  const pendencias = trpc.conciliacao.pendencias.useQuery({ clienteId }, { enabled: !!ultima });

  if (competencias.isPending) return <Skeleton className="h-28 w-full" />;
  // Erro aqui não derruba a ficha inteira: o resto dela é útil mesmo sem este card.
  if (competencias.error || !ultima) return null;

  const aLigar = (pendencias.data?.convenios.length ?? 0) + (pendencias.data?.profissionais.length ?? 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <FileSpreadsheet className="h-4 w-4 text-primary" /> Produção de consultas
        </CardTitle>
        <Link to="/conciliacao" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Ver tudo <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Competência</p>
            <p className="text-lg font-semibold">{ultima.competencia}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Atendimentos</p>
            <p className="text-lg font-semibold">{resumo.data?.total ?? ultima.linhasImportadas}</p>
          </div>
          {resumo.data && (
            <div>
              <p className="text-xs uppercase text-muted-foreground">De convênio</p>
              {/* Cortesia e particular ficam de fora: não geram recebimento. */}
              <p className="text-lg font-semibold">{resumo.data.faturavel}</p>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Importado em {dataUTC(ultima.createdAt)} por {ultima.importadoPor?.nome ?? "—"} · {ultima.nomeArquivo}
          {competencias.data.length > 1 && ` · ${competencias.data.length} meses importados`}
        </p>

        {aLigar > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>
              {aLigar} convênio(s)/profissional(is) ainda sem ligação — enquanto isso, o resumo por operadora está incompleto.{" "}
              <Link to="/conciliacao" className="font-medium text-primary hover:underline">
                Resolver
              </Link>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
