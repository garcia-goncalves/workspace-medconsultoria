import { FileUp, Trash2, User, Users } from "lucide-react";
import { LADO_ARQUIVO_LABEL, type LadoArquivo } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { UploadArquivo, ArquivoLink } from "../../components/ui/upload-arquivo";
import { data } from "../../lib/format-date";
import { QueryError } from "../../components/ui/query-error";

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
    utils.portal.arquivos.invalidate();
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
        <UploadArquivo label="Enviar um documento" campos={{}} onDone={invalidate} />

        {/* ⚠️ Erro ANTES de vazio: em falha, a lista dizia "você ainda não enviou nenhum
            documento" e o cliente reenviava tudo o que já tinha mandado. */}
        {q.isError ? (
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
                    <ArquivoLink id={a.id} nome={a.nome} className="block max-w-full font-medium" />
                    <div className="truncate text-xs text-muted-foreground">
                      {contexto} · {data(a.createdAt)}
                    </div>
                  </div>
                  <span
                    className={
                      "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                      (doCliente ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")
                    }
                    title={doCliente ? "Enviado por você" : "Anexado pela equipe MedConsultoria"}
                  >
                    {doCliente ? <User className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                    {doCliente ? "Você" : "MedConsultoria"}
                  </span>
                  {doCliente && (
                    <button
                      onClick={() => onRemover(a.id, a.nome)}
                      title="Remover"
                      className="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
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
