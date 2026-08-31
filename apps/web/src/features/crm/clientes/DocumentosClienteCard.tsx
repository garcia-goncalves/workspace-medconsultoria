import { FileUp, Paperclip, Trash2, User, Users } from "lucide-react";
import { hasRoleLevel, LADO_ARQUIVO_LABEL, type LadoArquivo } from "@app/shared";
import { trpc } from "../../../lib/trpc";
import { Card, CardHeader, CardTitle, CardContent } from "../../../components/ui/card";
import { useConfirm } from "../../../components/ui/confirm-dialog";
import { UploadArquivo, ArquivoLink } from "../../../components/ui/upload-arquivo";
import { useAuth } from "../../../lib/auth-context";
import { data } from "../../../lib/format-date";

/**
 * Documentos DO CLIENTE (arquivos): os que o próprio cliente enviou pelo Portal e os que
 * a equipe anexou manualmente. Diferente de "Documentos da MedConsultoria" (propostas,
 * contratos, atas — o modelo Documento).
 */
export function DocumentosClienteCard({ clienteId }: { clienteId: string }) {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const q = trpc.clientes.arquivos.useQuery({ id: clienteId });
  // ⚠️ `cancelRefetch: true` NÃO É DETALHE — é o que faz o arquivo recém-enviado aparecer.
  //
  // A ficha carrega tudo num lote só de tRPC. Anexar um documento logo depois de abrir a página
  // termina o upload com esse lote AINDA NO AR (medido: 117 ms depois de ele começar), e o
  // `invalidate` do React Query, no padrão, **não reinicia uma busca em andamento**: a resposta
  // antiga — de antes do upload — chega e é aceita como boa. O arquivo some da lista até alguém
  // recarregar a página, e nada indica erro.
  //
  // Foi assim que o e2e `flows-documentos-ui` passou a reprovar: o upload respondeu 200, e a
  // única releitura da página era anterior ao envio.
  const invalidate = () => {
    // `refetch()` DIRETO, não `invalidate()` — e a diferença é o arquivo aparecer ou não.
    // `invalidate` marca a consulta como velha e deixa o React Query decidir; com a carga
    // inicial da ficha AINDA NO AR (medido: o upload termina 117 ms depois de ela começar),
    // ele reaproveita a busca em andamento e aceita a resposta ANTERIOR ao envio. O arquivo
    // some da lista até alguém recarregar a página, sem nenhum sinal de erro.
    void (async () => {
      // A PRIMEIRA espera o que já estava no ar; a SEGUNDA é a que traz o arquivo novo.
      // Parece redundante e não é: se a carga inicial da ficha ainda não terminou (o upload
      // costuma acabar ~120 ms depois de ela começar), o React Query REAPROVEITA a busca em
      // andamento — pedir "busque de novo" ali devolve a resposta ANTERIOR ao envio, e nem
      // chega a sair uma requisição. Medido no trace do Playwright: depois do upload não havia
      // nenhuma leitura da lista. Sem isto o arquivo só aparece recarregando a página, e nada
      // indica erro.
      await q.refetch().catch(() => {});
      await q.refetch().catch(() => {});
    })();
    utils.clientes.servicos.invalidate({ id: clienteId });
  };
  const remover = trpc.clientes.removerArquivo.useMutation({ onSuccess: invalidate });
  const { user } = useAuth();
  // Excluir arquivo é ADMIN+ (RBAC). FUNCIONARIO envia/atualiza, mas não exclui.
  const podeExcluirArquivo = hasRoleLevel(user.role, "ADMIN");

  const arquivos = q.data ?? [];

  const onRemover = async (id: string, nome: string) => {
    if (
      await confirm({
        title: "Remover documento?",
        description: `"${nome}" será removido. Esta ação não pode ser desfeita.`,
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
          <Paperclip className="h-4 w-4 text-muted-foreground" /> Documentos do cliente
        </CardTitle>
        <span className="text-xs text-muted-foreground">Enviados pelo cliente ou anexados por você</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <UploadArquivo label="Anexar documento" campos={{ clienteId }} onDone={invalidate} />

        {arquivos.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhum documento do cliente ainda. O cliente pode enviar pelo Portal, ou você anexa aqui.
          </p>
        ) : (
          <div className="space-y-1.5">
            {arquivos.map((a) => {
              // Documento de credenciamento repete por médico e por lado (ADR-103): sem o nome
              // de quem é, o acervo mostra seis "Diploma" idênticos e ninguém sabe qual é qual.
              const contexto = [
                a.requisito?.titulo ?? a.servico?.nome ?? "Geral",
                a.lado ? LADO_ARQUIVO_LABEL[a.lado as LadoArquivo] : null,
                a.profissional?.nome ?? null,
              ]
                .filter(Boolean)
                .join(" · ");
              const doCliente = a.enviadoPorTipo === "CLIENTE";
              return (
                <div key={a.id} className="flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm">
                  <FileUp className="h-4 w-4 shrink-0 text-primary" />
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
                    title={doCliente ? "Enviado pelo cliente no Portal" : "Anexado pela equipe"}
                  >
                    {doCliente ? <User className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                    {doCliente ? "Cliente" : "Equipe"}
                  </span>
                  {podeExcluirArquivo && (
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
