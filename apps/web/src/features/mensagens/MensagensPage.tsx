import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Send, MessageSquare, Users, Loader2, Search, UserRound, Info, Building2, MoreVertical,
  Pin, PinOff, BellOff, Bell, Archive, ArchiveRestore, Trash2, Pencil, Check, X, CheckCircle2, RotateCcw, Flag, ChevronLeft,
} from "lucide-react";
import { cn } from "@app/ui";
import { CHAMADO_STATUS_LABEL, CONVERSA_CATEGORIA_LABEL, type ConversaCategoria, type ChamadoStatus } from "@app/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@app/api/router";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { getSocket, POLL, REALTIME_SOCKET_ENABLED } from "../../lib/socket";
import { hora, data } from "../../lib/format-date";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Avatar, avatarSrc } from "../../components/ui/avatar";
import { Skeleton } from "../../components/ui/skeleton";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { NovaConversaDialog } from "./NovaConversaDialog";
import { ConversaInfoDialog } from "./ConversaInfoDialog";

type Conversa = inferRouterOutputs<AppRouter>["mensagens"]["listConversas"][number];
type Mensagem = inferRouterOutputs<AppRouter>["mensagens"]["listMensagens"][number];
type Filtro = "todas" | ConversaCategoria;

const statusDot: Record<ChamadoStatus, string> = { ABERTO: "bg-warning", EM_ANDAMENTO: "bg-brand-blueLight", RESOLVIDO: "bg-success" };
const statusBadge: Record<ChamadoStatus, string> = {
  ABERTO: "bg-warning/15 text-warning",
  EM_ANDAMENTO: "bg-brand-blueLight/15 text-brand-blueText",
  RESOLVIDO: "bg-success/15 text-success",
};

function ConvAvatar({ c, size = "h-9 w-9" }: { c: Conversa; size?: string }) {
  const base = cn("flex shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white", size);
  // Foto/logo (diretas = a pessoa; chamados = a foto/logo do cliente).
  const src = avatarSrc(c.avatarUserId, c.avatarUrl);
  if (src) return <img src={src} alt={c.nome} className={cn("shrink-0 rounded-full bg-muted object-cover", size)} />;
  if (c.categoria === "grupo") return <span className={cn(base, "bg-gradient-to-br from-brand-blueLight to-primary")}><Users className="h-4 w-4" /></span>;
  if (c.categoria === "cliente") return <span className={cn(base, "bg-gradient-to-br from-emerald-400 to-emerald-600")}><Building2 className="h-4 w-4" /></span>;
  if (c.categoria === "lead") return <span className={cn(base, "bg-gradient-to-br from-amber-400 to-amber-600")}><UserRound className="h-4 w-4" /></span>;
  return <span className={cn(base, "bg-gradient-to-br from-brand-blueLight to-primary")}>{c.nome.charAt(0).toUpperCase()}</span>;
}

const quando = (d: Date | string) => {
  const dt = new Date(d);
  return dt.toDateString() === new Date().toDateString() ? hora(dt) : data(dt);
};

/** Rótulo do separador de dia na thread ("Hoje", "Ontem" ou a data). */
const diaLabel = (d: Date | string) => {
  const dd = new Date(d);
  dd.setHours(0, 0, 0, 0);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias = Math.round((hoje.getTime() - dd.getTime()) / 86_400_000);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Ontem";
  return data(dd);
};
const MSG_GAP = 5 * 60 * 1000; // agrupa mensagens do mesmo autor a menos de 5 min

export function MensagensPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const [selId, setSelId] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [info, setInfo] = useState(false);
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [verArquivadas, setVerArquivadas] = useState(false);
  const [verResolvidos, setVerResolvidos] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Largura da lista de conversas (divisor arrastável, estilo WhatsApp) — persistida por usuário.
  const [larguraLista, setLarguraLista] = useState(() => {
    const v = Number(localStorage.getItem("mensagens:larguraLista"));
    return v >= 240 && v <= 560 ? v : 320;
  });
  useEffect(() => {
    localStorage.setItem("mensagens:larguraLista", String(larguraLista));
  }, [larguraLista]);
  const iniciarRedimensionar = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = larguraLista;
    const onMove = (ev: PointerEvent) => setLarguraLista(Math.min(560, Math.max(240, w0 + ev.clientX - x0)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Deep-link vindo da ficha do cliente ("Abrir no Mensagens").
  useEffect(() => {
    const id = sessionStorage.getItem("abrirConversa");
    if (id) {
      setSelId(id);
      sessionStorage.removeItem("abrirConversa");
    }
  }, []);

  const conversas = trpc.mensagens.listConversas.useQuery({ arquivadas: verArquivadas }, { refetchInterval: POLL.listaConversas });
  const mensagens = trpc.mensagens.listMensagens.useQuery(
    { conversaId: selId ?? "" },
    { enabled: !!selId, refetchInterval: selId ? POLL.conversaAberta : false },
  );
  const invalida = () => {
    if (selId) utils.mensagens.listMensagens.invalidate({ conversaId: selId });
    utils.mensagens.listConversas.invalidate();
  };
  const send = trpc.mensagens.send.useMutation({ onSuccess: () => (setTexto(""), invalida()) });
  const editar = trpc.mensagens.editar.useMutation({ onSuccess: () => (setEditId(null), invalida()) });
  const apagarMsg = trpc.mensagens.apagarMensagem.useMutation({ onSuccess: invalida });
  const markRead = trpc.mensagens.markRead.useMutation({ onSuccess: () => utils.mensagens.listConversas.invalidate() });
  const fixar = trpc.mensagens.fixar.useMutation({ onSuccess: () => utils.mensagens.listConversas.invalidate() });
  const silenciar = trpc.mensagens.silenciar.useMutation({ onSuccess: () => utils.mensagens.listConversas.invalidate() });
  const arquivar = trpc.mensagens.arquivar.useMutation({ onSuccess: () => utils.mensagens.listConversas.invalidate() });
  const apagarConversa = trpc.mensagens.apagar.useMutation({ onSuccess: () => (setSelId(null), utils.mensagens.listConversas.invalidate()) });
  const resolver = trpc.mensagens.resolver.useMutation({ onSuccess: invalida });
  const reabrir = trpc.mensagens.reabrir.useMutation({ onSuccess: invalida });

  useEffect(() => {
    if (!REALTIME_SOCKET_ENABLED) return; // em produção o polling acima entrega; socket ficaria pendurado no LiteSpeed
    const socket = getSocket();
    const onMsg = (payload: { conversaId: string }) => {
      utils.mensagens.listConversas.invalidate();
      if (payload.conversaId === selId) utils.mensagens.listMensagens.invalidate({ conversaId: selId });
    };
    socket.on("mensagem", onMsg);
    return () => {
      socket.off("mensagem", onMsg);
    };
  }, [utils, selId]);

  useEffect(() => {
    if (selId) markRead.mutate({ conversaId: selId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens.data]);

  const resolvidosCount = useMemo(
    () => (conversas.data ?? []).filter((c) => c.tipo === "CLIENTE" && c.status === "RESOLVIDO").length,
    [conversas.data],
  );
  const contagens = useMemo(() => {
    const c: Record<Filtro, number> = { todas: 0, direta: 0, grupo: 0, cliente: 0, lead: 0 };
    for (const conv of conversas.data ?? []) {
      const resolvido = conv.tipo === "CLIENTE" && conv.status === "RESOLVIDO";
      if (verResolvidos ? !resolvido : resolvido) continue; // Ativas escondem resolvidos; Histórico mostra só resolvidos
      c.todas++;
      c[conv.categoria]++;
    }
    return c;
  }, [conversas.data, verResolvidos]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (conversas.data ?? []).filter((c) => {
      const resolvido = c.tipo === "CLIENTE" && c.status === "RESOLVIDO";
      // Histórico = só chamados resolvidos; Ativas = todo o resto (esconde resolvidos, exceto o aberto agora).
      if (verResolvidos ? !resolvido : resolvido && c.id !== selId) return false;
      if (filtro !== "todas" && c.categoria !== filtro) return false;
      if (q && !c.nome.toLowerCase().includes(q) && !(c.assunto?.toLowerCase().includes(q)) && !(c.ultimaMensagem?.conteudo.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [conversas.data, filtro, busca, verResolvidos, selId]);

  const selecionada = conversas.data?.find((c) => c.id === selId);
  const enviar = () => {
    if (texto.trim() && selId) send.mutate({ conversaId: selId, conteudo: texto });
  };
  const salvarEdicao = () => {
    if (editTexto.trim() && editId) editar.mutate({ mensagemId: editId, conteudo: editTexto });
  };
  const confirmarApagarMsg = async (m: Mensagem) => {
    if (await confirm({ title: "Apagar mensagem", description: "A mensagem será apagada para todos.", confirmText: "Apagar", variant: "destructive" })) apagarMsg.mutate({ mensagemId: m.id });
  };
  const confirmarApagarConversa = async (c: Conversa) => {
    setMenuId(null);
    const msg = c.tipo === "INDIVIDUAL" ? "A conversa será removida da sua lista." : c.tipo === "GRUPO" ? "O grupo será apagado para todos." : "O chamado será removido.";
    if (await confirm({ title: "Apagar conversa", description: msg, confirmText: "Apagar", variant: "destructive" })) apagarConversa.mutate({ conversaId: c.id });
  };

  const TABS: Filtro[] = ["todas", "direta", "grupo", "cliente", "lead"];
  const tabLabel = (f: Filtro) => (f === "todas" ? "Todas" : CONVERSA_CATEGORIA_LABEL[f]);

  return (
    <div className="flex h-full overflow-hidden rounded-xl border bg-card shadow-sm" onClick={() => setMenuId(null)}>
      {/* Sidebar (largura ajustável pelo divisor no desktop) */}
      <div
        style={{ ["--lista-w" as string]: `${larguraLista}px` }}
        className={cn("w-full shrink-0 flex-col border-r md:flex md:w-[var(--lista-w)]", selId ? "hidden md:flex" : "flex")}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="font-semibold text-primary">{verArquivadas ? "Arquivadas" : "Mensagens"}</h1>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={() => setVerArquivadas((v) => !v)} title={verArquivadas ? "Voltar" : "Arquivadas"}>
              {verArquivadas ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setNova(true)} title="Nova conversa">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conversa…" className="h-9 pl-8" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {TABS.map((f) => (
              <button key={f} onClick={() => setFiltro(f)} className={cn("rounded-full px-2.5 py-1 text-xs font-medium transition-colors", filtro === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent")}>
                {tabLabel(f)}
                {contagens[f] > 0 && <span className="ml-1 tabular-nums">{contagens[f]}</span>}
              </button>
            ))}
          </div>
          {/* Estado do chamado: Ativas × Histórico (resolvidos) — eixo separado das categorias */}
          <div className="mt-2 inline-flex w-full gap-0.5 rounded-lg border bg-muted/40 p-0.5 text-xs">
            <button onClick={() => setVerResolvidos(false)} className={cn("flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium transition-colors", !verResolvidos ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <MessageSquare className="h-3.5 w-3.5" /> Ativas
            </button>
            <button onClick={() => setVerResolvidos(true)} className={cn("flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium transition-colors", verResolvidos ? "bg-card text-success shadow-sm" : "text-muted-foreground hover:text-foreground")} title="Chamados resolvidos">
              <CheckCircle2 className="h-3.5 w-3.5" /> Histórico{resolvidosCount > 0 && <span className="tabular-nums">{resolvidosCount}</span>}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {conversas.isLoading ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2.5">
                  <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/5" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : lista.length > 0 ? (
            lista.map((c) => (
              <div key={c.id} className={cn("group relative flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-accent/40", selId === c.id && "bg-accent/60")}>
                <button onClick={() => setSelId(c.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <ConvAvatar c={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {c.fixado && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span className="truncate text-sm font-medium">{c.nome}</span>
                      {c.categoria === "lead" && <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold uppercase text-amber-700">lead</span>}
                      {c.tipo === "CLIENTE" && c.prioridade === "ALTA" && <Flag className="h-3 w-3 shrink-0 text-destructive" />}
                      {c.tipo === "CLIENTE" && c.status && <span className={cn("h-1.5 w-1.5 rounded-full", statusDot[c.status])} />}
                      {c.silenciado && <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.tipo === "CLIENTE" && c.numero ? <span className="text-muted-foreground">#{c.numero} </span> : null}
                      {c.assunto ? <span className="font-medium">{c.assunto}: </span> : null}
                      {c.ultimaMensagem?.conteudo ?? "Sem mensagens"}
                    </div>
                  </div>
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {c.ultimaMensagem && <span className="text-[10px] tabular-nums text-muted-foreground">{quando(c.ultimaMensagem.createdAt)}</span>}
                  {c.naoLidas > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">{c.naoLidas}</span>}
                </div>
                {/* Menu (⋮) */}
                <button onClick={(e) => (e.stopPropagation(), setMenuId(menuId === c.id ? null : c.id))} className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100" title="Opções">
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
                {menuId === c.id && (
                  <div className="absolute right-2 top-8 z-30 w-44 overflow-hidden rounded-lg border bg-card py-1 text-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
                    <MenuItem icon={c.fixado ? PinOff : Pin} label={c.fixado ? "Desafixar" : "Fixar"} onClick={() => (setMenuId(null), fixar.mutate({ conversaId: c.id, ligar: !c.fixado }))} />
                    <MenuItem icon={c.silenciado ? Bell : BellOff} label={c.silenciado ? "Reativar som" : "Silenciar"} onClick={() => (setMenuId(null), silenciar.mutate({ conversaId: c.id, ligar: !c.silenciado }))} />
                    <MenuItem icon={c.arquivado ? ArchiveRestore : Archive} label={c.arquivado ? "Desarquivar" : "Arquivar"} onClick={() => (setMenuId(null), arquivar.mutate({ conversaId: c.id, ligar: !c.arquivado }))} />
                    <MenuItem icon={Trash2} label="Apagar" danger onClick={() => confirmarApagarConversa(c)} />
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/5 text-primary ring-1 ring-inset ring-primary/10">
                <MessageSquare className="h-6 w-6" />
              </span>
              <p className="text-sm text-muted-foreground">
                {verArquivadas ? "Nenhuma conversa arquivada." : verResolvidos ? "Nenhum chamado resolvido ainda." : busca || filtro !== "todas" ? "Nenhuma conversa aqui." : "Nenhuma conversa ainda."}
                {!verArquivadas && !verResolvidos && !busca && filtro === "todas" && <><br />Clique em + para começar.</>}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Divisor arrastável (só desktop) — arraste para deixar a lista mais estreita ou larga. */}
      <div
        onPointerDown={iniciarRedimensionar}
        onDoubleClick={() => setLarguraLista(320)}
        title="Arraste para redimensionar (duplo-clique para o padrão)"
        className="relative hidden w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40 active:bg-primary/60 md:block"
      >
        {/* área de clique um pouco maior que a linha visível */}
        <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </div>

      {/* Thread */}
      <div className={cn("min-w-0 flex-1 flex-col", selId ? "flex" : "hidden md:flex")}>
        {!selId || !selecionada ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-muted/20 p-6 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/5 text-primary ring-1 ring-inset ring-primary/10">
              <MessageSquare className="h-10 w-10" />
            </span>
            <div className="max-w-sm">
              <h2 className="text-lg font-semibold text-foreground">Suas conversas</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Fale com a equipe, atenda clientes e leads — tudo em um só lugar. Escolha uma conversa ao lado ou comece uma nova.
              </p>
            </div>
            <Button onClick={() => setNova(true)}>
              <Plus className="h-4 w-4" /> Nova conversa
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b px-5 py-2.5">
              <button onClick={() => setSelId(null)} className="-ml-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden" title="Voltar">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <ConvAvatar c={selecionada} size="h-8 w-8" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{selecionada.nome}</span>
                  {selecionada.tipo === "CLIENTE" && selecionada.numero && <span className="text-xs text-muted-foreground">#{selecionada.numero}</span>}
                  {selecionada.tipo === "CLIENTE" && selecionada.status && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", statusBadge[selecionada.status])}>{CHAMADO_STATUS_LABEL[selecionada.status]}</span>}
                  {selecionada.tipo === "CLIENTE" && selecionada.prioridade === "ALTA" && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-destructive"><Flag className="h-3 w-3" /> Alta</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {selecionada.tipo === "GRUPO" ? `${selecionada.membros} participantes` : selecionada.tipo === "CLIENTE" ? selecionada.assunto || (selecionada.categoria === "lead" ? "Chamado — lead" : "Chamado — cliente") : "Conversa direta"}
                </div>
              </div>
              {selecionada.tipo === "CLIENTE" && (
                selecionada.status === "RESOLVIDO" ? (
                  <Button size="sm" variant="outline" onClick={() => reabrir.mutate({ conversaId: selecionada.id })}>
                    <RotateCcw className="h-4 w-4" /> Reabrir
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => resolver.mutate({ conversaId: selecionada.id })} className="text-success">
                    <CheckCircle2 className="h-4 w-4" /> Resolver
                  </Button>
                )
              )}
              {selecionada.tipo !== "INDIVIDUAL" && (
                <Button size="icon" variant="ghost" onClick={() => setInfo(true)} title="Detalhes">
                  <Info className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-auto bg-muted/30 p-4">
              {mensagens.isLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : mensagens.data && mensagens.data.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma mensagem ainda. Diga olá! 👋</p>
              ) : null}
              {mensagens.data?.map((m, i) => {
                const msgs = mensagens.data!;
                const prev = msgs[i - 1];
                const next = msgs[i + 1];
                const minha = m.autor.id === user.id;
                const doCliente = m.autor.role === "CLIENTE";
                const apagada = !!m.deletedAt;
                const editando = editId === m.id;
                const emGrupo = selecionada.tipo !== "INDIVIDUAL";
                const novoDia = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                const agrupaPrev = !novoDia && !!prev && prev.autor.id === m.autor.id && +new Date(m.createdAt) - +new Date(prev.createdAt) < MSG_GAP;
                const agrupaNext =
                  !!next &&
                  new Date(next.createdAt).toDateString() === new Date(m.createdAt).toDateString() &&
                  next.autor.id === m.autor.id &&
                  +new Date(next.createdAt) - +new Date(m.createdAt) < MSG_GAP;
                const mostrarAutor = !minha && emGrupo && !agrupaPrev;
                const mostrarAvatar = !minha && emGrupo && !agrupaNext;
                return (
                  <Fragment key={m.id}>
                    {novoDia && (
                      <div className="flex justify-center py-3">
                        <span className="rounded-full border bg-card px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm">{diaLabel(m.createdAt)}</span>
                      </div>
                    )}
                    <div className={cn("group/msg flex items-end gap-2", minha ? "justify-end" : "justify-start", agrupaPrev ? "mt-0.5" : "mt-2")}>
                      {minha && !apagada && !editando && (
                        <div className="flex gap-0.5 self-center opacity-0 transition-opacity group-hover/msg:opacity-100">
                          <button onClick={() => (setEditId(m.id), setEditTexto(m.conteudo))} className="rounded p-1 text-muted-foreground hover:bg-accent" title="Editar"><Pencil className="h-3 w-3" /></button>
                          <button onClick={() => confirmarApagarMsg(m)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Apagar"><Trash2 className="h-3 w-3" /></button>
                        </div>
                      )}
                      {!minha && emGrupo && (mostrarAvatar ? <Avatar id={m.autor.id} nome={m.autor.nome} avatarUrl={m.autor.avatarUrl} className="h-6 w-6" text="text-[10px]" /> : <span className="w-6 shrink-0" />)}
                      <div
                        className={cn(
                          "max-w-[72%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                          apagada
                            ? "border border-border/50 bg-muted/60 italic text-muted-foreground"
                            : minha
                              ? "bg-primary text-primary-foreground"
                              : doCliente
                                ? "border border-brand-blueText/20 bg-brand-blueText/10 text-foreground"
                                : "border border-border/60 bg-card text-foreground",
                          !apagada && (minha ? (!agrupaNext ? "rounded-br-md" : "") : (!agrupaNext ? "rounded-bl-md" : "")),
                        )}
                      >
                        {mostrarAutor && !apagada && <div className={cn("mb-0.5 text-xs font-semibold", doCliente ? "text-brand-blueText" : "text-primary")}>{m.autor.nome}{doCliente && " · cliente"}</div>}
                        {apagada ? (
                          <p>🚫 mensagem apagada</p>
                        ) : editando ? (
                          <div className="flex items-center gap-1">
                            <Input value={editTexto} onChange={(e) => setEditTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") salvarEdicao(); if (e.key === "Escape") setEditId(null); }} className="h-8 min-w-48 bg-card text-foreground" autoFocus />
                            <button onClick={salvarEdicao} className="rounded p-1 hover:bg-black/10" title="Salvar"><Check className="h-4 w-4" /></button>
                            <button onClick={() => setEditId(null)} className="rounded p-1 hover:bg-black/10" title="Cancelar"><X className="h-4 w-4" /></button>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap">{m.conteudo}</p>
                        )}
                        {!apagada && !editando && (
                          <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-[10px]", minha ? "text-primary-foreground/70" : "text-muted-foreground")}>
                            {m.editadoEm && <span className="italic">editada</span>}
                            {hora(m.createdAt)}
                          </div>
                        )}
                      </div>
                    </div>
                  </Fragment>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {send.error && <p className="border-t bg-destructive/5 px-4 py-1.5 text-xs text-destructive">Não foi possível enviar a mensagem. Tente de novo.</p>}
            <div className="flex items-center gap-2 border-t bg-muted/20 p-3">
              <Input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }} placeholder="Escreva uma mensagem…" className="rounded-full bg-card" />
              <Button size="icon" onClick={enviar} disabled={send.isPending || !texto.trim()} className="shrink-0 rounded-full shadow-sm">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>

      <NovaConversaDialog open={nova} onClose={() => setNova(false)} onCreated={(id) => setSelId(id)} />
      {info && selId && <ConversaInfoDialog conversaId={selId} onClose={() => setInfo(false)} onSaiu={() => (setInfo(false), setSelId(null))} />}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Pin; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent", danger && "text-destructive hover:bg-destructive/10")}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
