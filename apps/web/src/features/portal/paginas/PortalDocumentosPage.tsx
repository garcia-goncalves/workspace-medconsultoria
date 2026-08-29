import { useState } from "react";
import { FileText } from "lucide-react";
import { situacaoDocumento } from "@app/shared";
import { trpc } from "../../../lib/trpc";
import { dataHora } from "../../../lib/format-date";
import { Card, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { QueryError } from "../../../components/ui/query-error";
import { Badge } from "../../../components/ui/badge";
import { PortalDocumentoModal } from "../PortalDocumentoModal";
import { PortalMeusDocumentos } from "../PortalMeusDocumentos";
import { ExigenciasPendentes } from "../ExigenciasPendentes";

/**
 * DOCUMENTOS — e são DOIS ACERVOS, não um (ordem do dono).
 *
 * De um lado, o que a **MedConsultoria** preparou para o cliente: briefing, proposta, contrato,
 * ata. Ele lê, aceita, assina — e não apaga. Do outro, o que o **cliente** enviou para nós: RG,
 * alvará, CRM, mini currículo. Ele envia e remove — e não assina.
 *
 * ⚠️ **Os dois nunca viram uma lista só ordenada por data.** A distinção é de FONTE e as ações
 * são OPOSTAS: com o mesmo peso visual, assinar um contrato e apagar o próprio RG ficam a um
 * clique de distância um do outro, e é assim que o cliente apaga o que não devia.
 */
export function PortalDocumentosPage() {
  const resumo = trpc.portal.resumo.useQuery();
  const [docId, setDocId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-primary">Documentos</h1>
        <p className="text-muted-foreground">O que preparamos para você e o que você já nos enviou.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" /> Documentos da MedConsultoria
            </CardTitle>
            <span className="text-xs text-muted-foreground">Propostas, contratos e atas que preparamos para você</span>
          </div>
        </CardHeader>
        {resumo.isLoading ? (
          <div className="space-y-2 p-5 pt-1">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : resumo.isError ? (
          /* ⚠️ Erro ANTES de vazio. Com `portal.resumo` em falha, este card dizia "ainda não
             preparamos nenhum documento" — e um contrato esperando assinatura simplesmente não
             existia para o cliente naquela carga. */
          <div className="p-2">
            <QueryError
              onRetry={() => void resumo.refetch()}
              message="Não conseguimos carregar os documentos que preparamos para você. Tente de novo."
            />
          </div>
        ) : (resumo.data?.documentos.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Ainda não preparamos nenhum documento para você.</p>
          </div>
        ) : (
          <div className="divide-y">
            {(resumo.data?.documentos ?? []).map((d) => {
              const { key: situacao } = situacaoDocumento(d);
              const selo =
                situacao === "ACEITA" || situacao === "ASSINADO"
                  ? { l: situacao === "ACEITA" ? "Aceita" : "Assinado", v: "success" as const }
                  : situacao === "RECUSADA"
                    ? { l: "Recusada", v: "default" as const }
                    : null;
              return (
                <button
                  key={d.id}
                  onClick={() => setDocId(d.id)}
                  className="flex min-h-11 w-full items-center gap-3 px-5 py-3.5 text-left text-sm transition-colors hover:bg-accent/40"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/5 text-primary ring-1 ring-inset ring-primary/10">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{d.titulo}</div>
                    <div className="text-xs text-muted-foreground">Disponível desde {dataHora(d.updatedAt)}</div>
                  </div>
                  {selo && <Badge variant={selo.v} className="shrink-0">{selo.l}</Badge>}
                  <span className="text-xs font-medium text-primary">Abrir</span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* O ÚNICO bloco acionável dos três, e por isso ele fica no MEIO — entre o que a Med
          preparou e o que o cliente já mandou. No fim da página, ele seria lido depois da
          lista do que já foi enviado, e é aí que o cliente conclui que entregou tudo. */}
      <ExigenciasPendentes />

      {/* Os documentos que o CLIENTE envia. Card próprio, com ações próprias. */}
      <PortalMeusDocumentos />

      {docId && <PortalDocumentoModal id={docId} onClose={() => setDocId(null)} />}
    </div>
  );
}
