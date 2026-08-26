import { useState } from "react";
import { Check, Circle, Package, PenLine, Trash2 } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Card, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { useConfirm, usePrompt } from "../../components/ui/confirm-dialog";
import { toast } from "../../components/ui/toast";
import { UploadArquivo, ArquivoLink } from "../../components/ui/upload-arquivo";
import { BriefingDialog } from "./BriefingDialog";

/**
 * "Seus serviços" no Portal do Cliente: os serviços contratados, o que ainda falta
 * enviar (documentos) com upload direto, e a opção de cancelar um serviço.
 */
export function PortalServicos() {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const q = trpc.portal.meusServicos.useQuery();
  const invalidate = () => {
    utils.portal.meusServicos.invalidate();
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
  if (servicos.length === 0) return null; // prospect ainda sem serviços contratados

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
              {s.pendentes > 0 ? (
                <span className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[11px] font-semibold text-warning">
                  Faltam {s.pendentes} documento{s.pendentes > 1 ? "s" : ""}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-[11px] font-semibold text-success">
                  <Check className="h-3 w-3" /> Tudo enviado
                </span>
              )}
              <button
                onClick={() => onCancelar(s.servico.id, s.servico.nome)}
                className="ml-auto text-xs font-medium text-destructive hover:underline"
              >
                Cancelar serviço
              </button>
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
                            <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                              Obrigatório
                            </span>
                          )}
                        </div>
                        {r.descricao && <p className="text-xs text-muted-foreground">{r.descricao}</p>}
                        {r.tipo !== "DOCUMENTO" ? (
                          <div className="mt-1.5">
                            <Button size="sm" variant={r.atendido ? "outline" : "default"} onClick={() => setBriefing(r.id)}>
                              <PenLine className="h-3.5 w-3.5" />
                              {r.atendido ? "Revisar resposta" : r.tipo === "INFORMACAO" ? "Responder na tela" : "Preencher na tela"}
                            </Button>
                          </div>
                        ) : (
                          <>
                            {r.arquivos.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {r.arquivos.map((a) => (
                                  <li key={a.id} className="flex items-center gap-1.5 text-xs">
                                    <ArquivoLink id={a.id} nome={a.nome} className="max-w-[200px]" />
                                    {a.enviadoPorTipo === "CLIENTE" && (
                                      <button
                                        onClick={() => onRemover(a.id, a.nome)}
                                        title="Remover"
                                        className="text-muted-foreground/60 hover:text-destructive"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <div className="mt-1.5">
                              <UploadArquivo
                                size="xs"
                                label={r.atendido ? "Enviar outro" : "Enviar documento"}
                                campos={{ servicoId: s.servico.id, requisitoId: r.id }}
                                onDone={invalidate}
                              />
                            </div>
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
