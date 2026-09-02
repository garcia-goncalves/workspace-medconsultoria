import { FileUp, Trash2, User, Users } from "lucide-react";
import { LADO_ARQUIVO_LABEL, type LadoArquivo } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { UploadArquivo, ArquivoLink } from "../../components/ui/upload-arquivo";
import { Badge } from "../../components/ui/badge";
import { data } from "../../lib/format-date";
import { QueryError } from "../../components/ui/query-error";
import { recarregarAposEnvio } from "../../lib/recarregar-apos-envio";
import { Skeleton } from "../../components/ui/skeleton";

/**
 * "Seus documentos" no Portal: os arquivos que o CLIENTE envia (RG, CPF, CRM, comprovantes…)
 * — os documentos DELE. Diferente de "Documentos da MedConsultoria" (proposta, contrato,
 * briefing) que a equipe prepara. Upload geral (sem serviço específico) + tudo que ele já
 * enviou; os pedidos por serviço também aparecem em "Seus serviços", com o contexto.
 */
export function PortalMeusDocumentos() {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const q = trpc.portal.arquivos.useQuery();
  const invalidate = () => {
    // `q` é a lista que ESTA tela desenha: ela precisa do recarregamento duplo, não de um
    // `invalidate` (ver `recarregarAposEnvio`). As outras consultas são de telas vizinhas e
    // não estão no ar agora, então marcar como velha basta.
    recarregarAposEnvio(q);
    utils.portal.meusServicos.invalidate();
  };
  const remover = trpc.portal.removerArquivo.useMutation({ onSuccess: invalidate });
  const arquivos = q.data ?? [];

  const onRemover = async (id: string, nome: string) => {
    if (
      await confirm({
        title: "Remover documento?",
        description: `"${nome}" será removido.`,
        confirmText: "Remover",
        variant: "destructive",
      })
    )
      remover.mutate({ id });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <FileUp className="h-4 w-4 text-primary" /> Seus documentos
        </CardTitle>
        <span className="text-xs text-muted-foreground">Os documentos que você envia para nós — RG, CPF, CRM, comprovantes…</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="[&_button]:min-h-11">
          <UploadArquivo label="Enviar um documento" campos={{}} onDone={invalidate} />
        </div>

        {/* ⚠️ Erro ANTES de vazio: em falha, a lista dizia "você ainda não enviou nenhum
            documento" e o cliente reenviava tudo o que já tinha mandado. */}
        {/* ⚠️ CARREGANDO vem antes de VAZIO pelo mesmo motivo do erro: enquanto a lista não
            chega, `arquivos` é `[]` — e a tela afirmava "você ainda não enviou nenhum
            documento" a quem tinha enviado. É uma fração de segundo, mas é a frase que faz o
            cliente reenviar tudo. */}
        {q.isLoading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : q.isError ? (
          <QueryError
            onRetry={() => void q.refetch()}
            message="Não conseguimos carregar os seus documentos. Tente de novo — nada do que você enviou se perdeu."
          />
        ) : arquivos.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Você ainda não enviou nenhum documento. Envie aqui os arquivos que precisamos de você.
          </p>
        ) : (
          <div className="space-y-1.5">
            {arquivos.map((a) => {
              // Documento do credenciamento repete por médico e por lado: sem dizer de quem é
              // (e se é frente ou verso), a lista vira seis "Diploma" iguais e o cliente não
              // sabe qual já mandou nem qual está removendo.
              const base = a.requisito?.titulo ?? a.servico?.nome ?? "Documento avulso";
              const contexto = [
                base,
                a.lado ? LADO_ARQUIVO_LABEL[a.lado as LadoArquivo] : null,
                a.profissional?.nome ?? null,
              ]
                .filter(Boolean)
                .join(" · ");
              const doCliente = a.enviadoPorTipo === "CLIENTE";
              return (
                <div key={a.id} className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/5 text-primary ring-1 ring-inset ring-primary/10">
                    <FileUp className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* `min-h-11`: no Portal o nome do arquivo é um LINK de download, e um link de 20px de
                        altura não se acerta com o dedo — a régua de toque de 44px reprovava aqui. */}
                    <ArquivoLink id={a.id} nome={a.nome} className="flex min-h-11 max-w-full items-center font-medium" />
                    <div className="truncate text-xs text-muted-foreground">
                      {contexto} · {data(a.createdAt)}
                    </div>
                  </div>
                  <Badge
                    variant={doCliente ? "primary" : "default"}
                    className="shrink-0"
                    title={doCliente ? "Enviado por você" : "Anexado pela equipe MedConsultoria"}
                  >
                    {doCliente ? <User className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                    {doCliente ? "Você" : "MedConsultoria"}
                  </Badge>
                  {doCliente && (
                    <button
                      onClick={() => onRemover(a.id, a.nome)}
                      aria-label={`Remover ${a.nome}`}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
