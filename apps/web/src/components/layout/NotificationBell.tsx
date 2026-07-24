import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Calendar,
  CalendarClock,
  Clock,
  AlertTriangle,
  Wallet,
  FileText,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  UserPlus,
  LifeBuoy,
  Siren,
  Bug,
  Target,
  TrendingUp,
  ThumbsDown,
  RotateCcw,
  XCircle,
  Paperclip,
  FolderKanban,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@app/ui";
import { trpc } from "../../lib/trpc";
import { getSocket, POLL, REALTIME_SOCKET_ENABLED } from "../../lib/socket";
import { haQuanto } from "../../lib/format-date";

interface Notif {
  id: string;
  tipo: string;
  titulo: string;
  corpo: string | null;
  entidadeTipo: string | null;
  entidadeId: string | null;
  lida: boolean;
  createdAt: Date;
}

const META: Record<string, { icon: LucideIcon; tom: string }> = {
  lembrete: { icon: Calendar, tom: "bg-primary/10 text-primary" },
  conflito_agenda: { icon: CalendarClock, tom: "bg-destructive/10 text-destructive" },
  tarefa_atribuida: { icon: ClipboardList, tom: "bg-brand-blueLight/10 text-brand-blueLight" },
  projeto_participante: { icon: UserPlus, tom: "bg-brand-blueLight/10 text-brand-blueLight" },
  tarefa_atrasada: { icon: AlertTriangle, tom: "bg-destructive/10 text-destructive" },
  projeto_parado: { icon: FolderKanban, tom: "bg-warning/10 text-warning" },
  projeto_sem_responsavel: { icon: FolderKanban, tom: "bg-warning/10 text-warning" },
  conta_vencida: { icon: Wallet, tom: "bg-warning/10 text-warning" },
  conta_a_vencer: { icon: Clock, tom: "bg-warning/10 text-warning" },
  documento_revisao: { icon: FileText, tom: "bg-primary/10 text-primary" },
  documento_cliente_enviado: { icon: Paperclip, tom: "bg-primary/10 text-primary" },
  suporte: { icon: LifeBuoy, tom: "bg-success/10 text-success" },
  lead_novo: { icon: UserPlus, tom: "bg-brand-blueLight/10 text-brand-blueLight" },
  lead_atribuido: { icon: UserPlus, tom: "bg-brand-blueLight/10 text-brand-blueLight" },
  lead_convertido: { icon: TrendingUp, tom: "bg-success/10 text-success" },
  lead_desistiu: { icon: ThumbsDown, tom: "bg-warning/10 text-warning" },
  lead_retomou: { icon: RotateCcw, tom: "bg-success/10 text-success" },
  servico_solicitado: { icon: Target, tom: "bg-primary/10 text-primary" },
  servico_cancelado: { icon: XCircle, tom: "bg-warning/10 text-warning" },
  upsell_oportunidade: { icon: Target, tom: "bg-warning/10 text-warning" },
  proposta_aceita: { icon: CheckCircle2, tom: "bg-success/10 text-success" },
  proposta_recusada: { icon: XCircle, tom: "bg-warning/10 text-warning" },
  presenca_confirmada: { icon: CheckCircle2, tom: "bg-success/10 text-success" },
  incidente: { icon: Siren, tom: "bg-destructive/10 text-destructive" },
  erro: { icon: Bug, tom: "bg-destructive/10 text-destructive" },
};
const fallback = { icon: Bell, tom: "bg-muted text-muted-foreground" };

export function NotificationBell() {
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const notificacoes = trpc.notificacoes.list.useQuery(undefined, { staleTime: 30_000, refetchInterval: POLL.notificacoes });
  const invalidate = () => utils.notificacoes.list.invalidate();
  const markAll = trpc.notificacoes.markAllRead.useMutation({ onSuccess: invalidate });
  const markRead = trpc.notificacoes.markRead.useMutation({ onSuccess: invalidate });

  const lista = (notificacoes.data ?? []) as Notif[];
  const naoLidas = lista.filter((n) => !n.lida).length;

  // Recebe push em tempo real e refaz a busca.
  useEffect(() => {
    if (!REALTIME_SOCKET_ENABLED) return; // polling acima entrega em produção
    const socket = getSocket();
    const onNotif = () => invalidate();
    socket.on("notificacao", onNotif);
    return () => {
      socket.off("notificacao", onNotif);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [aberto]);

  const abrirNotif = (n: Notif) => {
    if (!n.lida) markRead.mutate({ id: n.id });
    setAberto(false);
    const { entidadeTipo: t, entidadeId: id } = n;
    if (t === "projeto" && id) navigate({ to: "/projetos/$projetoId", params: { projetoId: id } });
    else if (t === "documento" && id)
      navigate({ to: "/documentos/$documentoId", params: { documentoId: id } });
    else if (t === "cliente" && id) navigate({ to: "/clientes/$clienteId", params: { clienteId: id } });
    else if (t === "evento") navigate({ to: "/agenda" });
    else if (t === "conta") navigate({ to: "/financeiro" });
    else if (t === "lead") navigate({ to: "/leads" });
    else if (t === "incidente" || t === "erro") navigate({ to: "/sistema" });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAberto((v) => !v)}
        className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="Notificações"
      >
        <Bell className="h-5 w-5" />
        {naoLidas > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {naoLidas > 9 ? "9+" : naoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 z-50 mt-2 w-96 origin-top-right animate-scale-in overflow-hidden rounded-xl border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-semibold">
              Notificações
              {naoLidas > 0 && (
                <span className="ml-1.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                  {naoLidas}
                </span>
              )}
            </span>
            {naoLidas > 0 && (
              <button
                onClick={() => markAll.mutate()}
                className="flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-[26rem] overflow-auto">
            {lista.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <Bell className="h-6 w-6 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Tudo em dia. Nenhuma notificação.</p>
              </div>
            ) : (
              lista.map((n) => {
                const meta = META[n.tipo] ?? fallback;
                const Icon = meta.icon;
                const clicavel = !!n.entidadeTipo;
                return (
                  <button
                    key={n.id}
                    onClick={() => abrirNotif(n)}
                    disabled={!clicavel && n.lida}
                    className={cn(
                      "flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-0",
                      clicavel ? "cursor-pointer hover:bg-accent/50" : "cursor-default",
                      !n.lida && "bg-primary/[0.04]",
                    )}
                  >
                    <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", meta.tom)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("text-sm", !n.lida ? "font-semibold" : "font-medium")}>
                          {n.titulo}
                        </span>
                        {!n.lida && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                      </div>
                      {n.corpo && <div className="truncate text-xs text-muted-foreground">{n.corpo}</div>}
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{haQuanto(n.createdAt)}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
