import { useState } from "react";
import { Check, Circle, Package, PenLine, Trash2 } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { formatPreco } from "../../lib/masks";
import { Card, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { QueryError } from "../../components/ui/query-error";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useConfirm, usePrompt } from "../../components/ui/confirm-dialog";
import { toast } from "../../components/ui/toast";
import { UploadArquivo, ArquivoLink } from "../../components/ui/upload-arquivo";
import { BriefingDialog } from "./BriefingDialog";
import { usePodeNoPortal } from "./permissoes";
import { recarregarAposEnvio } from "../../lib/recarregar-apos-envio";

/**
 * "Seus serviços" no Portal do Cliente: os serviços contratados, o que ainda falta
 * enviar (documentos) com upload direto, e a opção de cancelar um serviço.
 */
export function PortalServicos() {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const q = trpc.portal.meusServicos.useQuery();
  // Cancelar um serviço contratado é falar PELA clínica (ADR-131) — e a sessão de suporte da
  // Med também não faz (ADR-128). A régua é a mesma função pura que o servidor usa.
  const cancelamento = usePodeNoPortal()("cancelarServico");
  // Achado da auditoria de 04/09/2026: enviar documento, remover documento e responder
  // briefing eram os únicos botões desta tela sem essa mesma checagem — a EQUIPE já podia
  // (ambas ações estão liberadas), mas a sessão de SUPORTE só descobria a recusa depois de
  // escolher arquivo/preencher o formulário e tentar salvar.
  const podeAgirComArquivo = usePodeNoPortal()("removerArquivo");
  const podeResponder = usePodeNoPortal()("briefing.salvar");
  const invalidate = () => {
    // `q` é a lista que ESTA tela desenha (serviços + o que falta enviar): recarregamento
    // duplo, não `invalidate` — senão a exigência recém-atendida continua marcada como
    // pendente e o cliente reenvia achando que falhou. Ver `recarregarAposEnvio`.
    recarregarAposEnvio(q);
    utils.portal.arquivos.invalidate();
  };
  const cancelar = trpc.portal.cancelarServico.useMutation({
    onSuccess: () => {
      invalidate();
      toast("Serviço cancelado. Nossa equipe foi avisada.", "success");
    },
  });
  const removerArquivo = trpc.portal.removerArquivo.useMutation({ onSuccess: invalidate });
  const [briefing, setBriefing] = useState<string | null>(null);

  const servicos = q.data ?? [];

  if (q.isLoading) {
    return (
      <Card>
        <div className="space-y-2 p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-20 w-full" />
        </div>
      </Card>
    );
  }

  // ⚠️ Erro ANTES de vazio: em falha, `servicos` fica vazio e o cliente lia que não tem nada
  // contratado — bem ao lado do catálogo que o convida a contratar de novo.
  if (q.isError) {
    return (
      <QueryError
        onRetry={() => void q.refetch()}
        message="Não conseguimos carregar os seus serviços. Tente de novo — eles continuam ativos."
      />
    );
  }

  /*
   * Vazio com voz, no lugar de um `return null`.
   *
   * Enquanto o Portal era uma página só, sumir era razoável: o cliente rolava e via as outras
   * coisas. Agora isto é uma SEÇÃO com endereço próprio — quem toca em "Serviços" e recebe uma
   * tela em branco não conclui "ainda não contratei nada", conclui que o sistema quebrou.
   * O catálogo do autosserviço vem logo abaixo, na página, e é para lá que o texto aponta.
   */
  if (servicos.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Você ainda não tem serviços ativos"
        description="Veja abaixo o que podemos fazer por você — escolha e a nossa equipe prepara."
      />
    );
  }

  const onCancelar = async (servicoId: string, nome: string) => {
    const motivo = await prompt({
      title: `Cancelar "${nome}"?`,
      description: "Conte o motivo (opcional) — isso nos ajuda a melhorar.",
      placeholder: "Motivo (opcional)",
      confirmText: "Cancelar serviço",
      variant: "destructive",
      multiline: true,
    });
    if (motivo === null) return;
    cancelar.mutate({ servicoId, motivo: motivo || undefined });
  };
  const onRemover = async (id: string, nome: string) => {
    const ok = await confirm({
      title: "Remover documento?",
      description: `"${nome}" será removido.`,
      confirmText: "Remover",
      variant: "destructive",
    });
    if (ok) removerArquivo.mutate({ id });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" /> Seus serviços
        </CardTitle>
      </CardHeader>
      <div className="space-y-3 p-5 pt-0">
        {servicos.map((s) => (
          <div key={s.servico.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{s.servico.nome}</span>
              {/* F20 — quanto está sendo cobrado, sem precisar perguntar. Some quando o preço
                  ainda não foi combinado (ex.: credenciamento "a combinar"). */}
              {formatPreco(s.preco ?? {}) && (
                <span className="text-xs text-muted-foreground">{formatPreco(s.preco ?? {})}</span>
              )}
              {s.pendentes > 0 ? (
                <Badge variant="warning">
                  {/* "Faltam 1 documento" saía errado no singular, e é o cliente quem lê. */}
                  {s.pendentes > 1 ? `Faltam ${s.pendentes} documentos` : "Falta 1 documento"}
                </Badge>
              ) : (
                <Badge variant="success">
                  <Check className="h-3 w-3" /> Tudo enviado
                </Badge>
              )}
              {/* O SERVIÇO CONTINUA VISÍVEL para quem não pode cancelar — a trava é sobre agir,
                  não sobre ver. A secretária precisa saber o que está contratado justamente para
                  avisar quem cancela. O que sai é o botão, e a frase diz por quê. */}
              {cancelamento.pode ? (
                <button
                  onClick={() => onCancelar(s.servico.id, s.servico.nome)}
                  className="ml-auto inline-flex min-h-11 items-center text-xs font-medium text-destructive hover:underline"
                >
                  Cancelar serviço
                </button>
              ) : (
                <span className="ml-auto text-xs text-muted-foreground">{cancelamento.frase}</span>
              )}
            </div>

            {/* Os convênios que combinamos faturar (ADR-126). O cliente precisa poder conferir
                a lista — é sobre ela que a apuração do mês acontece. */}
            {s.convenios.length > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Convênios atendidos:</span>{" "}
                {s.convenios.map((o) => o.nome).join(", ")}
              </p>
            )}

            {s.requisitos.length > 0 && (
              <div className="mt-3 space-y-2 border-t pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  O que precisamos de você
                </p>
                {s.requisitos.map((r) => (
                  <div key={r.id} className="rounded-md border bg-background p-2">
                    <div className="flex items-start gap-2">
                      {r.atendido ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground">{r.titulo}</span>
                          {r.obrigatorio && (
                            <Badge variant="default">Obrigatório</Badge>
                          )}
                        </div>
                        {r.descricao && <p className="text-xs text-muted-foreground">{r.descricao}</p>}
                        {r.tipo !== "DOCUMENTO" ? (
                          <div className="mt-1.5">
                            {podeResponder.pode ? (
                              <Button
                                size="sm"
                                className="min-h-11"
                                variant={r.atendido ? "outline" : "default"}
                                onClick={() => setBriefing(r.id)}
                              >
                                <PenLine className="h-3.5 w-3.5" />
                                {r.atendido ? "Revisar resposta" : r.tipo === "INFORMACAO" ? "Responder na tela" : "Preencher na tela"}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">{podeResponder.frase}</span>
                            )}
                          </div>
                        ) : (
                          <>
                            {r.arquivos.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {r.arquivos.map((a) => (
                                  <li key={a.id} className="flex items-center gap-1.5 text-xs">
                                    <ArquivoLink id={a.id} nome={a.nome} className="flex min-h-11 max-w-[200px] items-center" />
                                    {a.enviadoPorTipo === "CLIENTE" && podeAgirComArquivo.pode && (
                                      <button
                                        onClick={() => onRemover(a.id, a.nome)}
                                        aria-label={`Remover ${a.nome}`}
                                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground/60 hover:text-destructive"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {podeAgirComArquivo.pode ? (
                              <div className="mt-1.5 [&_button]:min-h-11">
                                <UploadArquivo
                                  size="xs"
                                  label={r.atendido ? "Enviar outro" : "Enviar documento"}
                                  campos={{ servicoId: s.servico.id, requisitoId: r.id }}
                                  onDone={invalidate}
                                />
                              </div>
                            ) : (
                              <p className="mt-1.5 text-xs text-muted-foreground">{podeAgirComArquivo.frase}</p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {briefing && <BriefingDialog requisitoId={briefing} onClose={() => setBriefing(null)} onSaved={invalidate} />}
    </Card>
  );
}
