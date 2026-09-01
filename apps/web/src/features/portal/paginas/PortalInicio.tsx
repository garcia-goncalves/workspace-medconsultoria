import type { MouseEvent } from "react";
import {
  FolderKanban,
  FileText,
  Video,
  CalendarDays,
  Compass,
  PenLine,
  RotateCcw,
  HeartHandshake,
  Hourglass,
  CalendarPlus,
  CheckCircle2,
  MapPin,
  AlertTriangle,
} from "lucide-react";
import { trpc } from "../../../lib/trpc";
import { dataHora, data } from "../../../lib/format-date";
import { Card, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { useConfirm, usePrompt } from "../../../components/ui/confirm-dialog";
import { toast } from "../../../components/ui/toast";
import { usePortalNavegar } from "../navegar";
import { usePodeNoPortal } from "../permissoes";

/**
 * INÍCIO — a fila do que precisa da atenção do cliente.
 *
 * Era o topo da página única do Portal (16 blocos empilhados). Com as seções, ficou com o que
 * responde "o que eu tenho para fazer hoje?".
 *
 * ⚠️ **A ORDEM é a entrega desta tela, não decoração.** Ação primeiro: propostas para
 * responder, documentos para assinar, o que a equipe está esperando. Só depois vem o que é
 * acompanhamento — o andamento do atendimento, as reuniões e os projetos. Na ordem antiga, a
 * barra de progresso do funil (que não pede nada de ninguém) abria a tela, e a proposta
 * aguardando resposta ficava embaixo dela.
 *
 * ⚠️ **O H1 contém a palavra "Portal", e não é preferência de texto.** Quatro asserções de
 * ponta a ponta (`e2e/flows-portal.spec.ts` e `e2e/rbac.spec.ts`) procuram um cabeçalho que
 * case `/Portal/i` — é assim que elas provam que o cliente caiu no Portal e não numa tela
 * interna. Trocar por "Olá, Clínica X" quebraria as quatro; a saudação desce para o subtítulo,
 * onde continua sendo a primeira coisa que o cliente lê.
 */

/** Quando o servidor não manda o token (ADR-137), quem está vendo não pode assinar pela
 *  clínica — é a secretária EQUIPE, ou alguém da Med em sessão de suporte. O item continua
 *  aparecendo, porque a trava é sobre assinar e não sobre ver; o que some é o botão. */
const SO_RESPONSAVEL_RESPONDE = "Só o responsável pela clínica responde";
const SO_RESPONSAVEL_ASSINA = "Só o responsável pela clínica assina";

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
function baixarIcs(ev: {
  id: string;
  titulo: string;
  inicio: string | Date;
  fim?: string | Date | null;
  local?: string | null;
  descricao?: string | null;
  linkReuniao?: string | null;
}) {
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

export function PortalInicio() {
  const resumo = trpc.portal.resumo.useQuery();
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const navegar = usePortalNavegar();
  const podeFazer = usePodeNoPortal();
  // As duas ações desta tela que falam PELA clínica (ADR-131/ADR-128). Quem não pode vê a
  // frase no lugar do botão — nunca um botão que o servidor vai recusar depois do modal.
  const encerrar = podeFazer("desistir");
  const voltarAtras = podeFazer("retomar");

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

  // Silhueta do conteúdo, não uma roda girando: quem espera vendo a forma da tela sabe o que
  // vem, e a página não pula quando o dado chega.
  if (resumo.isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
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

  // Erro com saída, não uma tela em branco. O cliente não tem como saber o que fazer com
  // "algo deu errado" — o que ele pode fazer é tentar de novo, ou falar com a gente.
  if (!resumo.data) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Não conseguimos carregar seus dados"
        description="Pode ter sido a conexão. Tente de novo — se continuar assim, fale com a nossa equipe pelo Suporte."
      >
        <div className="flex flex-wrap justify-center gap-2">
          <Button className="min-h-11" onClick={() => resumo.refetch()} disabled={resumo.isFetching}>
            Tentar de novo
          </Button>
          <Button variant="outline" className="min-h-11" onClick={() => navegar("/portal/suporte")}>
            Falar com o Suporte
          </Button>
        </div>
      </EmptyState>
    );
  }

  const r = resumo.data;
  // Os três blocos de AÇÃO. Vazio aqui é boa notícia — e por isso eles somem em vez de
  // mostrarem "nenhum item": três caixas vazias fariam a tela parecer quebrada.
  const nadaPendente = r.propostas.length === 0 && r.paraAssinar.length === 0 && r.aguardandoVoce.length === 0;

  const irParaOSuporte = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navegar("/portal/suporte");
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-primary">Seu Portal</h1>
        <p className="text-muted-foreground">Olá, {r.clienteNome}. Veja o que precisa da sua atenção hoje.</p>
      </div>

      {/* ── AÇÃO PRIMEIRO ─────────────────────────────────────────────────────────────── */}

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
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 text-sm sm:px-5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 font-medium">{p.titulo}</div>
                {p.token ? (
                  <a
                    href={`/proposta/${p.token}`}
                    className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 sm:w-auto"
                  >
                    <HeartHandshake className="h-3.5 w-3.5" />
                    Ver proposta
                  </a>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">{SO_RESPONSAVEL_RESPONDE}</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Documentos aguardando a assinatura do cliente */}
      {r.paraAssinar.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle>
              <PenLine className="h-4 w-4 text-warning" /> Documentos para assinar
            </CardTitle>
            <span className="text-xs text-muted-foreground">A sua assinatura é necessária</span>
          </CardHeader>
          <div className="divide-y">
            {r.paraAssinar.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 text-sm sm:px-5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 font-medium">{d.titulo}</div>
                {d.token ? (
                  <a
                    href={`/assinar/${d.token}`}
                    className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 sm:w-auto"
                  >
                    <PenLine className="h-3.5 w-3.5" />
                    Assinar
                  </a>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">{SO_RESPONSAVEL_ASSINA}</span>
                )}
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
              <div key={c.id} className="flex items-start gap-3 px-4 py-3.5 text-sm sm:px-5">
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
          {/* O Suporte deixou de ficar "aqui embaixo" nesta página: agora é uma seção com
              endereço próprio, e a frase vira o caminho até ela. */}
          {/* ⚠️ O link é um ALVO DE TOQUE, não um trecho de frase. Enquanto ele viveu no meio do
              parágrafo tinha 31px de altura — abaixo dos 44px que a régua da ADR-143 exige — e no
              celular era preciso mirar numa fita fina de texto. Por isso a pergunta ficou numa
              linha e o link virou uma linha própria, alta o bastante para o dedo. */}
          <div className="px-4 pb-4 pt-1 sm:px-5">
            <p className="text-xs text-muted-foreground">Precisa de ajuda com algum item?</p>
            <a
              href="/portal/suporte"
              onClick={irParaOSuporte}
              className="inline-flex min-h-11 items-center text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              Fale com a gente pelo Suporte
            </a>
          </div>
        </Card>
      )}

      {/* Nada pendente é BOA NOTÍCIA, e a tela precisa dizer isso. Sem este bloco, o cliente
          em dia abriria o Portal e veria o andamento do funil sem entender que está tudo certo. */}
      {nadaPendente && (
        <EmptyState
          icon={CheckCircle2}
          title="Está tudo em dia"
          description="Nada esperando por você agora. Quando precisarmos de algo, aparece aqui."
        />
      )}

      {/* ── ACOMPANHAMENTO ────────────────────────────────────────────────────────────── */}

      {/* Andamento do atendimento (enquanto for um prospect no funil) */}
      {r.atendimento && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Compass className="h-4 w-4 text-muted-foreground" /> Seu atendimento
            </CardTitle>
          </CardHeader>
          <div className="px-4 pb-5 pt-1 sm:px-5">
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
                {encerrar.pode ? (
                  <button
                    type="button"
                    onClick={pedirDesistencia}
                    disabled={desistir.isPending}
                    className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
                  >
                    Não tenho mais interesse
                  </button>
                ) : (
                  <p className="text-xs text-muted-foreground">{encerrar.frase}</p>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Atendimento encerrado (o prospect desistiu ou foi marcado como perdido) — livre para retomar */}
      {r.atendimentoEncerrado && (
        <Card>
          <div className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <HeartHandshake className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Seu atendimento está encerrado</p>
              <p className="text-xs text-muted-foreground">
                Mudou de ideia? É só retomar — sua equipe continua à disposição.
              </p>
            </div>
            {voltarAtras.pode ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 w-full shrink-0 sm:w-auto"
                onClick={pedirRetomada}
                disabled={retomar.isPending}
              >
                <RotateCcw className="h-4 w-4" /> Quero retomar
              </Button>
            ) : (
              <p className="shrink-0 text-xs text-muted-foreground">{voltarAtras.frase}</p>
            )}
          </div>
        </Card>
      )}

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
              <div key={ev.id} className="flex flex-col gap-2 px-4 py-3.5 text-sm sm:flex-row sm:items-center sm:px-5">
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
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-success/40 px-3 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-success/10 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar presença
                    </button>
                  )}
                  <button
                    onClick={() => baixarIcs(ev)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Adicionar ao Google/Apple/Outlook"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" /> Adicionar à agenda
                  </button>
                  {ev.linkReuniao && (
                    <a
                      href={ev.linkReuniao}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-success px-3.5 py-1.5 text-xs font-semibold text-success-foreground shadow-sm transition-colors hover:bg-success/90"
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
              <div key={p.id} className="px-4 py-3.5 text-sm sm:px-5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1 truncate font-medium">{p.nome}</div>
                  <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
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
    </div>
  );
}
