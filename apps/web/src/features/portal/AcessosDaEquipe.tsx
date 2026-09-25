import { Eye } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { dataHora } from "../../lib/format-date";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";

/**
 * "Acessos da equipe MedConsultoria ao seu Portal" (onda 4C) — as sessões de suporte (ADR-128)
 * dos últimos 90 dias, para o dono do dado saber quem olhou e quando.
 *
 * Só para o RESPONSÁVEL (o servidor recusa o resto; quem chama esconde antes). Mostra o NOME de
 * quem entrou e nada mais da pessoa: o cliente precisa reconhecer "a Thaís entrou", não ganhar o
 * diretório da equipe.
 *
 * ⚠️ Falha de consulta NÃO vira "nenhum acesso" — a lição que a casa já pagou em várias telas
 * (ADR-140): aqui, dizer "ninguém entrou" quando não se sabe seria justamente a informação errada.
 */
export function AcessosDaEquipe() {
  const q = trpc.portal.acessosDaEquipe.useQuery();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Eye className="h-4 w-4 text-muted-foreground" />
          Acessos da equipe MedConsultoria ao seu Portal
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Quando alguém da MedConsultoria abre o seu Portal para ajudar, fica registrado aqui. Nesses acessos a equipe só vê —
          não assina nem altera nada em seu nome. Últimos 90 dias.
        </p>
        {q.isError ? (
          <QueryError onRetry={() => q.refetch()} />
        ) : q.isLoading || !q.data ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : q.data.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Ninguém da equipe acessou o seu Portal nos últimos 90 dias.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {q.data.map((a) => (
              <li
                key={`${a.quem}-${String(a.entrouEm)}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2.5 text-sm"
              >
                <span className="min-w-0 font-medium">{a.quem}</span>
                <span className="text-muted-foreground">
                  {dataHora(a.entrouEm)}
                  {" · "}
                  {a.emAndamento ? "acesso em andamento" : a.duracaoMinutos != null ? `${a.duracaoMinutos} min` : "até 30 min"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
