import { useState } from "react";
import { FolderKanban, FileText, Video, CalendarDays, Mail, Compass, PenLine, RotateCcw, HeartHandshake, Sparkles, Send, Hourglass, CalendarPlus, CheckCircle2, MapPin } from "lucide-react";
import { situacaoDocumento } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { dataHora, data } from "../../lib/format-date";
import { Card, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { useConfirm, usePrompt } from "../../components/ui/confirm-dialog";
import { toast } from "../../components/ui/toast";
import { PortalDocumentoModal } from "./PortalDocumentoModal";
import { PortalSuporte } from "./PortalSuporte";
import { EmailsEnviadosList } from "../../components/EmailsEnviadosList";
import { ServicosPicker } from "../crm/leads/ServicosPicker";
import { PortalServicos } from "./PortalServicos";
import { PortalCredenciamento } from "./PortalCredenciamento";
import { PortalMeusDocumentos } from "./PortalMeusDocumentos";
import { PortalMinhaEquipe } from "./PortalMinhaEquipe";

const statusLabel: Record<string, string> = {
  ATIVO: "Em andamento",
  PAUSADO: "Pausado",
  CONCLUIDO: "Concluído",
};
// Etapa do funil traduzida para uma linguagem amigável ao cliente/prospect.
const faseLabel: Record<string, string> = {
  novo: "Recebemos seu contato",
  qualificacao: "Entendendo a sua necessidade",
  proposta: "Preparando a sua proposta",
  negociacao: "Alinhando os detalhes finais",
  fechado: "Tudo pronto!",
};
/** Gera e baixa um arquivo .ics (Google/Apple/Outlook) da reunião — 100% no navegador. */
function baixarIcs(ev: { id: string; titulo: string; inicio: string | Date; fim?: string | Date | null; local?: string | null; descricao?: string | null; linkReuniao?: string | null }) {
  const fmt = (d: string | Date) => new Date(d).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const fim = ev.fim ? ev.fim : new Date(new Date(ev.inicio).getTime() + 30 * 60000);
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const desc = [ev.descricao, ev.linkReuniao].filter(Boolean).join("\n");
  const linhas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MedConsultoria//Portal//PT-BR",
    "BEGIN:VEVENT",
    `UID:${ev.id}@medconsultoria`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(ev.inicio)}`,
    `DTEND:${fmt(fim)}`,
    `SUMMARY:${esc(ev.titulo)}`,
    ev.local ? `LOCATION:${esc(ev.local)}` : "",
    desc ? `DESCRIPTION:${esc(desc)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  const blob = new Blob([linhas.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${ev.titulo.replace(/[^\w\s-]/g, "").trim() || "reuniao"}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export function PortalHome() {
  const resumo = trpc.portal.resumo.useQuery();
  const [docId, setDocId] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const emails = trpc.portal.emails.useQuery();
  const desistir = trpc.portal.desistir.useMutation({
    onSuccess: () => {
      utils.portal.resumo.invalidate();
      toast("Tudo certo — encerramos seu atendimento. Você pode retomar quando quiser.", "success");
    },
  });
  const retomar = trpc.portal.retomar.useMutation({
    onSuccess: () => {
      utils.portal.resumo.invalidate();
      toast("Que bom ter você de volta! Retomamos seu atendimento. 🙌", "success");
    },
  });
  const confirmarReuniao = trpc.portal.confirmarReuniao.useMutation({
    onSuccess: () => {
      utils.portal.resumo.invalidate();
      toast("Presença confirmada! Avisamos a equipe. 🎉", "success");
    },
  });
  const catalogo = trpc.portal.servicosDisponiveis.useQuery();
  const [pedidos, setPedidos] = useState<string[]>([]);
  const [msgServico, setMsgServico] = useState("");
  const solicitar = trpc.portal.solicitarServicos.useMutation({
    onSuccess: () => {
      utils.portal.resumo.invalidate();
      setPedidos([]);
      setMsgServico("");
      toast("Recebemos seu pedido! Nossa equipe já vai preparar tudo para você. 🎯", "success");
    },
  });

  const pedirDesistencia = async () => {
    const motivo = await prompt({
      title: "Não deseja mais seguir?",
      icon: HeartHandshake,
      description:
        "Sem problemas — você tem total liberdade. Vamos encerrar seu atendimento e você poderá retomar a qualquer momento. Se quiser, conte o motivo (opcional); isso nos ajuda a melhorar.",
      placeholder: "Motivo (opcional)",
      confirmText: "Confirmar",
      cancelText: "Voltar",
      multiline: true,
    });
    if (motivo !== null) desistir.mutate({ motivo: motivo.trim() || undefined });
  };

  const pedirRetomada = async () => {
    if (
      await confirm({
        title: "Retomar o atendimento?",
        icon: RotateCcw,
        description: "Vamos avisar nossa equipe para dar sequência ao seu atendimento. Deseja retomar?",
        confirmText: "Sim, quero retomar",
      })
    )
      retomar.mutate();
  };


  if (resumo.isLoading || !resumo.data) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
      </div>
    );
  }
  const r = resumo.data;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-primary">Bem-vindo(a) ao seu Portal 👋</h1>
        <p className="text-muted-foreground">
          {r.clienteNome} — acompanhe seus projetos e documentos, envie o que precisamos e fale com a nossa equipe.
        </p>
      </div>

      {/* Andamento do atendimento (enquanto for um prospect no funil) */}
      {r.atendimento && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Compass className="h-4 w-4 text-muted-foreground" /> Seu atendimento
            </CardTitle>
          </CardHeader>
          <div className="px-5 pb-5 pt-1">
            <p className="text-sm font-medium text-foreground">
              {faseLabel[r.atendimento.chave ?? ""] ?? r.atendimento.etapa}
            </p>
            <p className="mb-2 text-xs text-muted-foreground">
              Etapa {r.atendimento.passo} de {r.atendimento.total}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.round((r.atendimento.passo / r.atendimento.total) * 100)}%` }}
              />
            </div>
            {r.podeDesistir && (
              <div className="mt-4 border-t pt-3">
                <button
                  type="button"
                  onClick={pedirDesistencia}
                  disabled={desistir.isPending}
                  className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
                >
                  Não tenho mais interesse
                </button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Atendimento encerrado (o prospect desistiu ou foi marcado como perdido) — livre para retomar */}
      {r.atendimentoEncerrado && (
        <Card>
          <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <HeartHandshake className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Seu atendimento está encerrado</p>
              <p className="text-xs text-muted-foreground">
                Mudou de ideia? É só retomar — sua equipe continua à disposição.
              </p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={pedirRetomada} disabled={retomar.isPending}>
              <RotateCcw className="h-4 w-4" /> Quero retomar
            </Button>
          </div>
        </Card>
      )}

      {/* Suporte em destaque — canal direto com a equipe, logo no topo */}
      <PortalSuporte />

      {/* Seus serviços contratados + documentos que precisamos de você */}
      <PortalServicos />

      {/* A papelada do credenciamento tem tela própria porque REPETE por médico — ver
          `PortalCredenciamento`. Some sozinha quando não há credenciamento em curso. */}
      <PortalCredenciamento />

      {/* Autosserviço: o cliente escolhe os serviços que precisa → vira oportunidade no funil */}
      {catalogo.data &&
        catalogo.data.length > 0 &&
        (() => {
          const jaPedidos = new Set(r.servicosAtuais.map((s) => s.id));
          const disponiveis = catalogo.data.filter((s) => !jaPedidos.has(s.id));
          return (
            <Card>
              <CardHeader>
                <CardTitle>
                  <Sparkles className="h-4 w-4 text-primary" /> O que você precisa?
                </CardTitle>
                <span className="text-xs text-muted-foreground">Escolha e nós preparamos</span>
              </CardHeader>
              <div className="space-y-3 p-5 pt-1">
                {r.servicosAtuais.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Você já pediu: <span className="font-medium text-foreground">{r.servicosAtuais.map((s) => s.nome).join(", ")}</span>.
                  </p>
                )}
                {disponiveis.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Você já solicitou todos os nossos serviços. 🎉</p>
                ) : (
                  <>
                    <ServicosPicker servicos={disponiveis} value={pedidos} onChange={setPedidos} />
                    <Textarea
                      value={msgServico}
                      onChange={(e) => setMsgServico(e.target.value)}
                      placeholder="Quer contar algo sobre o que precisa? (opcional)"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        disabled={pedidos.length === 0 || solicitar.isPending}
                        onClick={() => solicitar.mutate({ servicoIds: pedidos, mensagem: msgServico.trim() || undefined })}
                      >
                        <Send className="h-4 w-4" /> Solicitar
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          );
        })()}

      {/* Propostas aguardando o aceite/recusa do cliente */}
      {r.propostas.length > 0 && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>
              <HeartHandshake className="h-4 w-4 text-primary" /> Propostas para você
            </CardTitle>
            <span className="text-xs text-muted-foreground">Revise e responda com um clique</span>
          </CardHeader>
          <div className="divide-y">
            {r.propostas.map((p) => (
              <div key={p.token} className="flex items-center gap-3 px-5 py-3.5 text-sm">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="flex-1 font-medium">{p.titulo}</div>
                <a
                  href={`/proposta/${p.token}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                >
                  <HeartHandshake className="h-3.5 w-3.5" />
                  Ver proposta
                </a>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Documentos aguardando a assinatura do cliente */}
      {r.paraAssinar.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <PenLine className="h-4 w-4 text-warning" /> Documentos para assinar
            </CardTitle>
            <span className="text-xs text-muted-foreground">A sua assinatura é necessária</span>
          </CardHeader>
          <div className="divide-y">
            {r.paraAssinar.map((d) => (
              <div key={d.token} className="flex items-center gap-3 px-5 py-3.5 text-sm">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="flex-1 font-medium">{d.titulo}</div>
                <a
                  href={`/assinar/${d.token}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                >
                  <PenLine className="h-3.5 w-3.5" />
                  Assinar
                </a>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* O que depende de você — cartões aguardando o cliente (ação clara) */}
      {r.aguardandoVoce.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle>
              <Hourglass className="h-4 w-4 text-warning" /> O que depende de você
            </CardTitle>
          </CardHeader>
          <div className="divide-y">
            {r.aguardandoVoce.map((c) => (
              <div key={c.id} className="flex items-start gap-3 px-5 py-3.5 text-sm">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
                  <Hourglass className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{c.titulo}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.projeto}
                    {c.prazo ? ` · até ${data(c.prazo)}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="px-5 pb-4 pt-1 text-xs text-muted-foreground">
            Precisa de ajuda com algum item? Fale com a gente pelo Suporte, aqui embaixo.
          </p>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" /> Seus projetos
          </CardTitle>
        </CardHeader>
        {r.projetos.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <FolderKanban className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Nenhum projeto no momento.</p>
          </div>
        ) : (
          <div className="divide-y">
            {r.projetos.map((p) => (
              <div key={p.id} className="px-5 py-3.5 text-sm">
                <div className="flex items-center gap-3">
                  <div className="flex-1 font-medium">{p.nome}</div>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {statusLabel[p.status] ?? p.status}
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{p.total === 0 ? "Organizando as tarefas" : `${p.concluidos} de ${p.total} etapas concluídas`}</span>
                    {p.total > 0 && <span className="font-medium text-foreground">{p.progresso}%</span>}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={"h-full rounded-full " + (p.progresso === 100 ? "bg-success" : "bg-primary")}
                      style={{ width: `${p.progresso}%` }}
                    />
                  </div>
                </div>
                {(p.previsaoFim || p.proximaReuniao) && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {p.previsaoFim && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" /> Previsão de entrega: {data(p.previsaoFim)}
                      </span>
                    )}
                    {p.proximaReuniao && (
                      <span className="inline-flex items-center gap-1">
                        <Video className="h-3.5 w-3.5" /> Próxima reunião: {data(p.proximaReuniao.inicio)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" /> Documentos da MedConsultoria
            </CardTitle>
            <span className="text-xs text-muted-foreground">Propostas, contratos e atas que preparamos para você</span>
          </div>
        </CardHeader>
        {r.documentos.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Ainda não preparamos nenhum documento para você.</p>
          </div>
        ) : (
          <div className="divide-y">
            {r.documentos.map((d) => (
              <button
                key={d.id}
                onClick={() => setDocId(d.id)}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left text-sm transition-colors hover:bg-accent/40"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/5 text-primary ring-1 ring-inset ring-primary/10">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="font-medium">{d.titulo}</div>
                  <div className="text-xs text-muted-foreground">
                    Disponível desde {dataHora(d.updatedAt)}
                  </div>
                </div>
                {(() => {
                  const k = situacaoDocumento(d).key;
                  const selo =
                    k === "ACEITA" || k === "ASSINADO"
                      ? { l: k === "ACEITA" ? "Aceita" : "Assinado", c: "bg-success/10 text-success" }
                      : k === "RECUSADA"
                        ? { l: "Recusada", c: "bg-muted text-muted-foreground" }
                        : null;
                  return selo ? (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${selo.c}`}>{selo.l}</span>
                  ) : null;
                })()}
                <span className="text-xs font-medium text-primary">Abrir</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Seus documentos (o CLIENTE envia: RG, CPF, CRM…) — separado dos documentos da Med acima */}
      <PortalMeusDocumentos />

      {/* Quem da clínica entra aqui (ADR-131). Fica DEPOIS do trabalho do dia a dia porque é
          configuração: quem entra aqui mexe nisso uma vez e volta ao que veio fazer. */}
      <PortalMinhaEquipe />

      <Card>
        <CardHeader>
          <CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" /> Seus e-mails
          </CardTitle>
          <span className="text-xs text-muted-foreground">Tudo que enviamos para você</span>
        </CardHeader>
        <div className="p-4 pt-1">
          <EmailsEnviadosList emails={emails.data ?? []} mostrarStatus={false} vazio="Você ainda não recebeu e-mails." />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" /> Próximas reuniões
          </CardTitle>
        </CardHeader>
        {r.reunioes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Nenhuma reunião agendada.</p>
          </div>
        ) : (
          <div className="divide-y">
            {r.reunioes.map((ev) => (
              <div key={ev.id} className="flex flex-col gap-2 px-5 py-3.5 text-sm sm:flex-row sm:items-center">
                <span className="w-28 shrink-0 text-xs font-medium tabular-nums">{dataHora(ev.inicio)}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{ev.titulo}</div>
                  {ev.local && (
                    <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" /> {ev.local}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {ev.clienteConfirmadoEm ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Presença confirmada
                    </span>
                  ) : (
                    <button
                      onClick={() => confirmarReuniao.mutate({ eventoId: ev.id })}
                      disabled={confirmarReuniao.isPending}
                      className="inline-flex items-center gap-1.5 rounded-full border border-success/40 px-3 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-success/10 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar presença
                    </button>
                  )}
                  <button
                    onClick={() => baixarIcs(ev)}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Adicionar ao Google/Apple/Outlook"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" /> Adicionar à agenda
                  </button>
                  {ev.linkReuniao && (
                    <a
                      href={ev.linkReuniao}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full bg-success px-3.5 py-1.5 text-xs font-semibold text-success-foreground shadow-sm transition-colors hover:bg-success/90"
                    >
                      <Video className="h-3.5 w-3.5" /> Entrar
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {docId && <PortalDocumentoModal id={docId} onClose={() => setDocId(null)} />}
    </div>
  );
}
