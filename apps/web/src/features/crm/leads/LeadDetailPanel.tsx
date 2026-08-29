import { useState } from "react";
import { formatarCNPJ } from "@app/shared";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import {
  X,
  Mail,
  Phone,
  MessageCircle,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  ArrowRight,
  Clock,
  UserCheck,
  KeyRound,
  Pencil,
  Sparkles,
  Loader2,
  FileText,
  Radar,
  ThumbsDown,
  Building2,
} from "lucide-react";
import { cn } from "@app/ui";
import { trpc, type RouterOutputs } from "../../../lib/trpc";
import { formatBRL } from "../../../lib/masks";
import { haQuanto } from "../../../lib/format-date";
import { Button } from "../../../components/ui/button";
import { toast } from "../../../components/ui/toast";
import { Badge } from "../../../components/ui/badge";
import { Skeleton } from "../../../components/ui/skeleton";
import { useConfirm } from "../../../components/ui/confirm-dialog";
import { AssistenteIADialog } from "../../../components/ui/assistente-ia";
import { EmailsDoLeadLista } from "../clientes/EmailsDoClienteCard";
import { estimativaDoLeadComPreco, sufixoDeRecorrencia } from "./estimativa-do-lead";

type Detalhe = RouterOutputs["leads"]["detalhe"];

const ACAO_LABEL: Record<string, string> = {
  "lead.criado": "Lead criado",
  "lead.capturado": "Recebido pelo site",
  "lead.recapturado": "Novo contato pelo site",
  "lead.convertido": "Convertido em cliente",
  "lead.auto_avancou": "Avançou automaticamente",
  "lead.avancou_etapa": "Avançou de etapa",
  "lead.moveu_etapa": "Movido de etapa",
  "lead.perdido": "Marcado como perdido",
  "lead.reaberto": "Reaberto no funil",
};

export interface LeadAcoes {
  onEditar: (id: string) => void;
  onConverter: (l: { id: string; nome: string }) => void;
  onConvidarPortal: (l: { id: string; nome: string; email: string | null; clienteId: string | null }) => void;
  onPerder: (l: { id: string; nome: string }) => void;
  onRemover: (l: { id: string; nome: string }) => void;
}

export function LeadDetailPanel({
  leadId,
  onClose,
  acoes,
}: {
  leadId: string | null;
  onClose: () => void;
  acoes: LeadAcoes;
}) {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [novoPasso, setNovoPasso] = useState("");
  const ia = trpc.ia.disponivel.useQuery();
  const proximoPasso = trpc.ia.sugerirProximoPassoLead.useMutation();
  const escreverEmail = trpc.ia.escreverMensagem.useMutation();
  const [iaAberto, setIaAberto] = useState<"passo" | "email" | null>(null);
  const q = trpc.leads.detalhe.useQuery({ id: leadId ?? "" }, { enabled: !!leadId });
  // `leads.detalhe` não devolve preço de serviço (só id/nome) — cruzamos com o catálogo para
  // saber se o valor mostrado é mensal (F13). `enabled` só quando o painel está aberto.
  const catalogo = trpc.servicos.ativos.useQuery(undefined, { enabled: !!leadId });
  const gerarDoc = trpc.documentos.gerarParaLead.useMutation({
    onSuccess: (r) => {
      utils.leads.detalhe.invalidate();
      navigate({ to: "/documentos/$documentoId", params: { documentoId: r.documentoId } });
    },
  });

  const invalidate = () => {
    utils.leads.detalhe.invalidate();
    utils.leads.list.invalidate();
    // Avançar de etapa pode mudar a situação comercial do cliente (placar do funil).
    utils.clientes.list.invalidate();
    utils.clientes.resumo.invalidate();
    utils.clientes.get.invalidate();
  };
  const toggle = trpc.leads.togglePasso.useMutation({
    onSuccess: (r) => {
      invalidate();
      // O card pode ter andado sozinho (todas as tarefas obrigatórias concluídas).
      if (r?.avancou) toast(`Card movido para “${r.avancou.nome}” 🎉`, "success");
    },
  });
  const add = trpc.leads.addPasso.useMutation({
    onSuccess: () => {
      utils.leads.detalhe.invalidate();
      setNovoPasso("");
    },
  });
  const removePasso = trpc.leads.removePasso.useMutation({ onSuccess: () => utils.leads.detalhe.invalidate() });
  const avancar = trpc.leads.avancarEtapa.useMutation({ onSuccess: invalidate });

  if (!leadId) return null;
  const d: Detalhe | undefined = q.data;
  const telDigits = d?.telefone?.replace(/\D/g, "") ?? "";
  const waNumero = telDigits.length >= 10 ? (telDigits.startsWith("55") ? telDigits : `55${telDigits}`) : "";

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-background shadow-2xl animate-slide-in-panel">
        {/* Cabeçalho */}
        <div className="flex items-start gap-3 border-b p-5">
          {q.isLoading || !d ? (
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                  style={{ background: d.stage.cor ?? "#64748b" }}
                >
                  {d.stage.nome}
                </span>
                {d.valorEstimado != null && (
                  <Badge variant="success">
                    {formatBRL(d.valorEstimado)}
                    {sufixoDeRecorrencia(
                      estimativaDoLeadComPreco(d.servicos, catalogo.data ?? [], d.valorEstimado),
                    )}
                  </Badge>
                )}
              </div>
              <h2 className="mt-2 truncate text-xl font-semibold">{d.nome}</h2>
              {d.empresa && <p className="truncate text-sm text-muted-foreground">{d.empresa}</p>}
              {d.cnpj && <p className="truncate text-xs text-muted-foreground">CNPJ {formatarCNPJ(d.cnpj)}</p>}
              {d.responsavel && <p className="mt-1 text-xs text-muted-foreground">Responsável: {d.responsavel.nome}</p>}
            </div>
          )}
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {q.isError ? (
          <div className="p-5 text-sm text-destructive">Não foi possível carregar o lead.</div>
        ) : (
          <div className="flex-1 space-y-6 overflow-y-auto p-5">
            {d && (
              <>
                {/* Contato rápido */}
                {(d.email || d.telefone) && (
                  <div className="flex flex-wrap gap-2">
                    {d.email && (
                      <a
                        href={`mailto:${d.email}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
                      >
                        <Mail className="h-4 w-4 text-primary" /> E-mail
                      </a>
                    )}
                    {waNumero && (
                      <a
                        href={`https://wa.me/${waNumero}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-success transition-colors hover:bg-success/10"
                      >
                        <MessageCircle className="h-4 w-4" /> WhatsApp
                      </a>
                    )}
                    {d.telefone && (
                      <a
                        // Só dígitos: `tel:(11) 98765-4321` faz discador de celular e de
                        // softphone engasgar com os parênteses e o espaço.
                        href={`tel:+${telDigits.startsWith("55") ? telDigits : `55${telDigits}`}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
                      >
                        <Phone className="h-4 w-4 text-muted-foreground" /> Ligar
                      </a>
                    )}
                  </div>
                )}

                {/* Vínculo com a ficha do cliente (quando já existe um cadastro ligado) */}
                {d.clienteId && (
                  <button
                    onClick={() => navigate({ to: "/clientes/$clienteId", params: { clienteId: d.clienteId! } })}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:underline"
                  >
                    <Building2 className="h-4 w-4" /> Ver ficha do cliente →
                  </button>
                )}

                {/* O que precisa */}
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    O que o lead precisa
                  </h3>
                  {d.servicos.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {d.servicos.map((s) => (
                        <span key={s.id} className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                          {s.nome}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum serviço informado ainda.</p>
                  )}
                  {d.observacoes && (
                    <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                      {d.observacoes}
                    </p>
                  )}
                </section>

                {/* Rastreio de origem (atribuição automática da captação) */}
                {d.rastreio && (
                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Radar className="h-3.5 w-3.5" />
                      De onde veio (detectado)
                    </h3>
                    <p className="whitespace-pre-wrap rounded-lg border border-primary/15 bg-primary/[0.03] p-3 text-xs leading-relaxed text-muted-foreground">
                      {d.rastreio}
                    </p>
                  </section>
                )}

                {/* Próximos passos (checklist da etapa) */}
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Próximos passos · {d.stage.nome}
                    </h3>
                    <div className="flex items-center gap-2">
                      {/* Quantos passos estão parados na clínica. É a pergunta que se faz toda
                          manhã olhando o funil — antes só dava para responder abrindo lead a lead. */}
                      {(() => {
                        const naClinica = d.passos.filter((p) => p.quemFaz === "CLIENTE" && !p.concluido).length;
                        return naClinica > 0 ? (
                          <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning ring-1 ring-inset ring-warning/20">
                            {naClinica} com a clínica
                          </span>
                        ) : null;
                      })()}
                      {d.faltamObrig > 0 && (
                        <span className="text-[11px] text-muted-foreground">{d.faltamObrig} obrigatório(s) restante(s)</span>
                      )}
                    </div>
                  </div>
                  {d.passos.length === 0 ? (
                    <p className="px-1.5 py-2 text-sm text-muted-foreground">Sem passos nesta etapa. Adicione abaixo.</p>
                  ) : (
                    (() => {
                      const grupos: { nome: string; itens: typeof d.passos }[] = [];
                      for (const p of d.passos) {
                        let g = grupos.find((x) => x.nome === p.grupo);
                        if (!g) {
                          g = { nome: p.grupo, itens: [] };
                          grupos.push(g);
                        }
                        g.itens.push(p);
                      }
                      return grupos.map((g) => (
                        <div key={g.nome} className="mb-2.5">
                          <div className="mb-0.5 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                            {g.nome}
                          </div>
                          <div className="space-y-1">
                            {g.itens.map((p) => (
                              <div key={p.id} className="group flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-accent/40">
                                <button
                                  onClick={() => !p.auto && toggle.mutate({ passoId: p.id })}
                                  disabled={toggle.isPending || p.auto}
                                  aria-label={p.auto ? `"${p.titulo}" é automático` : (p.concluido ? `Reabrir "${p.titulo}"` : `Concluir "${p.titulo}"`)}
                                  className={cn("flex min-h-11 min-w-11 items-center justify-center", p.auto && "cursor-default")}
                                  title={
                                    p.auto
                                      ? "Automático — o sistema conclui e reabre sozinho conforme os dados do lead"
                                      : "Concluir/reabrir"
                                  }
                                >
                                  {p.concluido ? (
                                    <CheckCircle2 className="h-5 w-5 text-success" />
                                  ) : (
                                    <Circle className="h-5 w-5 text-muted-foreground/50" />
                                  )}
                                </button>
                                <span className={cn("flex-1 text-sm", p.concluido && "text-muted-foreground line-through")}>
                                  {p.titulo}
                                  {p.quemFaz === "CLIENTE" && !p.concluido && (
                                    <span className="ml-1.5 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning ring-1 ring-inset ring-warning/20">
                                      com a clínica
                                    </span>
                                  )}
                                  {p.obrigatorio && !p.concluido && (
                                    <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                      obrigatório
                                    </span>
                                  )}
                                  {p.auto && (
                                    <span
                                      className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-semibold text-muted-foreground"
                                      title="Automático — o sistema conclui/reabre sozinho"
                                    >
                                      <Sparkles className="h-2.5 w-2.5" /> automático
                                    </span>
                                  )}
                                </span>
                                {p.acaoDoc &&
                                  (p.documentoId ? (
                                    <button
                                      onClick={() => navigate({ to: "/documentos/$documentoId", params: { documentoId: p.documentoId! } })}
                                      className={cn(
                                        "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors hover:opacity-80",
                                        {
                                          success: "bg-success/10 text-success",
                                          warning: "bg-warning/10 text-warning",
                                          primary: "bg-primary/10 text-primary",
                                          danger: "bg-destructive/10 text-destructive",
                                          default: "bg-muted text-muted-foreground",
                                        }[p.docSituacao?.variant ?? "primary"],
                                      )}
                                      title="Abrir documento"
                                    >
                                      {p.docSituacao?.label ?? "abrir doc"}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => gerarDoc.mutate({ leadId, tipo: p.acaoDoc as "briefing" | "proposta" | "contrato" })}
                                      disabled={gerarDoc.isPending}
                                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
                                      title="Gerar o documento do modelo com os dados do lead"
                                    >
                                      <FileText className="h-3 w-3" /> Gerar {p.acaoDoc}
                                    </button>
                                  ))}
                                {!p.auto && !p.obrigatorio && (
                                  <button
                                    onClick={async () => {
                                      if (
                                        await confirm({
                                          title: "Remover passo",
                                          description: `Remover o passo "${p.titulo}"?`,
                                          confirmText: "Remover",
                                          variant: "destructive",
                                        })
                                      )
                                        removePasso.mutate({ passoId: p.id });
                                    }}
                                    aria-label={`Remover passo "${p.titulo}"`}
                                    className="flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                                    title="Remover passo"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (novoPasso.trim()) add.mutate({ leadId, titulo: novoPasso.trim() });
                    }}
                    className="mt-2 flex items-center gap-2"
                  >
                    <input
                      value={novoPasso}
                      onChange={(e) => setNovoPasso(e.target.value)}
                      placeholder="Adicionar um passo…"
                      className="h-9 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
                    />
                    <Button type="submit" variant="outline" size="sm" disabled={!novoPasso.trim() || add.isPending}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </form>

                  {d.proxima && (
                    <Button
                      onClick={() => avancar.mutate({ id: leadId })}
                      disabled={!d.prontoParaAvancar || avancar.isPending}
                      className="mt-3 w-full"
                      title={d.prontoParaAvancar ? "" : "Conclua os passos obrigatórios primeiro"}
                    >
                      {avancar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                      Avançar para {d.proxima.nome}
                    </Button>
                  )}
                  {avancar.error && <p className="mt-2 text-xs text-destructive">{avancar.error.message}</p>}
                </section>

                {/* Documentos emitidos para este lead (27/08/2026) — proposta, escopo, ata… */}
                {d.documentos.length > 0 && (
                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" /> Documentos
                    </h3>
                    <ul className="space-y-1.5">
                      {d.documentos.map((doc) => (
                        <li key={doc.id}>
                          <button
                            type="button"
                            onClick={() => navigate({ to: "/documentos/$documentoId", params: { documentoId: doc.id } })}
                            className="flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
                          >
                            <span className="min-w-0 flex-1 truncate text-sm">{doc.titulo}</span>
                            <Badge variant={doc.situacao.variant}>{doc.situacao.label}</Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* A conversa com o lead: envios automáticos + o que a equipe trocou pela caixa (ADR-97) */}
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" /> E-mails
                  </h3>
                  <EmailsDoLeadLista leadId={leadId ?? ""} />
                </section>

                {/* Linha do tempo */}
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Linha do tempo</h3>
                  {d.timeline.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem histórico ainda.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {d.timeline.map((t) => {
                        const auto = t.acao.startsWith("lead.auto");
                        const dados = t.dados as { de?: string; para?: string } | null;
                        return (
                          <div key={t.id} className="flex items-start gap-2.5 text-sm">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                              {auto ? <Sparkles className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-foreground">
                                {ACAO_LABEL[t.acao] ?? t.acao.replace(/[._]/g, " ")}
                                {dados?.de && dados?.para && (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    · {dados.de} → {dados.para}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {auto ? "Automação" : t.usuario ?? "Sistema"} · {haQuanto(t.createdAt)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        )}

        {/* Ações */}
        {d && (
          <div className="flex flex-wrap gap-2 border-t p-4">
            <Button variant="outline" size="sm" onClick={() => acoes.onEditar(d.id)}>
              <Pencil className="h-4 w-4" /> Editar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => acoes.onConvidarPortal({ id: d.id, nome: d.nome, email: d.email, clienteId: d.clienteId })}
              title="Enviar (ou reenviar) o acesso ao Portal do Cliente"
            >
              <KeyRound className="h-4 w-4" /> Enviar acesso
            </Button>
            <Button variant="outline" size="sm" className="text-success" onClick={() => acoes.onConverter({ id: d.id, nome: d.nome })}>
              <UserCheck className="h-4 w-4" /> Converter
            </Button>
            {ia.data?.disponivel && (
              <>
                <Button variant="outline" size="sm" className="text-primary" onClick={() => setIaAberto("passo")} title="Sugerir o próximo passo com IA">
                  <Sparkles className="h-4 w-4" /> Próximo passo
                </Button>
                <Button variant="outline" size="sm" className="text-primary" onClick={() => setIaAberto("email")} title="Escrever um e-mail para o lead com IA">
                  <Sparkles className="h-4 w-4" /> Escrever e-mail
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground hover:text-warning"
              onClick={() => acoes.onPerder({ id: d.id, nome: d.nome })}
              title="Marcar como perdido (sai do funil, entra no relatório de ganho/perda)"
            >
              <ThumbsDown className="h-4 w-4" /> Perdido
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => acoes.onRemover({ id: d.id, nome: d.nome })}
            >
              <Trash2 className="h-4 w-4" /> Remover
            </Button>
          </div>
        )}
      </aside>

      {iaAberto && d && (
        <AssistenteIADialog
          title={iaAberto === "passo" ? `Próximo passo — ${d.nome}` : `E-mail para ${d.nome}`}
          run={
            iaAberto === "passo"
              ? () => proximoPasso.mutateAsync({ leadId: d.id })
              : async () => {
                  const r = await escreverEmail.mutateAsync({ leadId: d.id });
                  return `Assunto: ${r.assunto}\n\n${r.corpo}`;
                }
          }
          onClose={() => setIaAberto(null)}
        />
      )}
    </div>,
    document.body,
  );
}
