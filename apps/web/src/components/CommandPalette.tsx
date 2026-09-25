import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
import {
  Users,
  Filter,
  FolderKanban,
  FileText,
  ClipboardList,
  CalendarDays,
  MessageSquare,
  Sparkles,
  Loader2,
  Search,
  SendHorizontal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@app/ui";
import { hasRoleLevel } from "@app/shared";
import { trpc, type RouterOutputs } from "../lib/trpc";
import { useAuth } from "../lib/auth-context";
import { PAGINAS, paginaCasa } from "../lib/paginas";

type Hit = RouterOutputs["busca"]["global"][number];

interface Msg {
  autor: "user" | "ia";
  texto: string;
}

const TIPO_META: Record<Hit["tipo"], { icon: LucideIcon; grupo: string }> = {
  cliente: { icon: Users, grupo: "Clientes" },
  lead: { icon: Filter, grupo: "Leads" },
  projeto: { icon: FolderKanban, grupo: "Projetos" },
  documento: { icon: FileText, grupo: "Documentos" },
  tarefa: { icon: ClipboardList, grupo: "Tarefas" },
  evento: { icon: CalendarDays, grupo: "Agenda" },
  conversa: { icon: MessageSquare, grupo: "Conversas" },
};
const ORDEM_GRUPOS: Hit["tipo"][] = ["cliente", "lead", "tarefa", "evento", "projeto", "documento", "conversa"];

const SUGESTOES_IA = [
  "Como converto um lead em cliente?",
  "Como lanço uma conta a pagar?",
  "Como gero uma proposta com IA?",
  "Como dou acesso ao Portal para um cliente?",
];

/** Paleta de comandos (Ctrl/Cmd-K) com duas abas: Buscar (dados reais) e Assistente IA. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const ia = trpc.ia.disponivel.useQuery(undefined, { enabled: open, staleTime: 60_000 });
  const iaAtiva = !!ia.data?.disponivel;

  const [aba, setAba] = useState<"buscar" | "ia">("buscar");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pergunta, setPergunta] = useState("");
  const [conversa, setConversa] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fecha no Esc; reinicia estado a cada abertura.
  useEffect(() => {
    if (!open) return;
    setAba("buscar");
    setQ("");
    setDebounced("");
    setPergunta("");
    setConversa([]);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 220);
    return () => clearTimeout(t);
  }, [q]);

  const termo = debounced.trim();
  const busca = trpc.busca.global.useQuery(
    { termo },
    { enabled: open && aba === "buscar" && termo.length >= 2, staleTime: 10_000 },
  );
  const perguntar = trpc.ia.perguntar.useMutation();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [conversa, perguntar.isPending]);

  const paginas = PAGINAS.filter((p) => hasRoleLevel(user.role, p.minRole)).filter((p) => paginaCasa(p, q));

  const irPara = (hit: Hit) => {
    onOpenChange(false);
    if (hit.tipo === "cliente") navigate({ to: "/clientes/$clienteId", params: { clienteId: hit.id } });
    else if (hit.tipo === "projeto") navigate({ to: "/projetos/$projetoId", params: { projetoId: hit.id } });
    else if (hit.tipo === "documento")
      navigate({ to: "/documentos/$documentoId", params: { documentoId: hit.id } });
    else if (hit.tipo === "tarefa") navigate({ to: "/tarefas", search: { aba: hit.aba, abrir: hit.id } });
    else if (hit.tipo === "evento") navigate({ to: "/agenda", search: { data: hit.data, abrir: hit.id } });
    else if (hit.tipo === "conversa") {
      // Mesmo deep-link que a ficha do cliente usa ("Abrir no Mensagens").
      try {
        sessionStorage.setItem("abrirConversa", hit.id);
      } catch {
        /* sem sessionStorage a página só abre a lista */
      }
      navigate({ to: "/mensagens" });
    } else navigate({ to: "/funil-de-vendas" });
  };

  const enviarIA = (texto: string) => {
    const p = texto.trim();
    if (!p || perguntar.isPending) return;
    setConversa((c) => [...c, { autor: "user", texto: p }]);
    setPergunta("");
    perguntar.mutate(
      { pergunta: p },
      {
        onSuccess: (resp) => setConversa((c) => [...c, { autor: "ia", texto: resp }]),
        onError: (e) => setConversa((c) => [...c, { autor: "ia", texto: `⚠️ ${e.message}` }]),
      },
    );
  };

  const hits = busca.data ?? [];
  const grupos = ORDEM_GRUPOS.map((tipo) => ({ tipo, itens: hits.filter((h) => h.tipo === tipo) })).filter((g) => g.itens.length > 0);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-foreground/30 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="flex max-h-[72vh] w-full max-w-xl animate-scale-in flex-col overflow-hidden rounded-xl border bg-popover shadow-lg">
        {/* Abas — deixam a IA visível e óbvia */}
        <div className="flex items-center gap-1 border-b p-2">
          <button
            onClick={() => setAba("buscar")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              aba === "buscar"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Search className="h-4 w-4" />
            Buscar
          </button>
          {iaAtiva && (
            <button
              onClick={() => setAba("ia")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                aba === "ia"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Sparkles className="h-4 w-4" />
              Assistente IA
            </button>
          )}
        </div>

        {aba === "buscar" ? (
          <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Command.Input
                autoFocus
                value={q}
                onValueChange={setQ}
                placeholder="Buscar clientes, leads, tarefas, agenda, conversas…"
                className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Command.List className="min-h-0 flex-1 overflow-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                {termo.length >= 2 && !busca.isFetching ? "Nenhum resultado." : "Digite para buscar."}
              </Command.Empty>

              {iaAtiva && q.trim().length >= 2 && (
                <Command.Item
                  value={`__ia__${q}`}
                  onSelect={() => {
                    setAba("ia");
                    enviarIA(q);
                  }}
                  className="mb-1 flex cursor-pointer items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm aria-selected:bg-primary/10"
                >
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    Perguntar à IA: <span className="font-medium">“{q.trim()}”</span>
                  </span>
                </Command.Item>
              )}

              {paginas.length > 0 && (
                <Command.Group
                  heading="Ir para"
                  className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  {paginas.map((p) => (
                    <Command.Item
                      key={p.to}
                      value={`pagina-${p.label}`}
                      onSelect={() => {
                        onOpenChange(false);
                        navigate({ to: p.to });
                      }}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
                    >
                      <p.icon className="h-4 w-4 text-muted-foreground" />
                      {p.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {grupos.map((g) => {
                const Icon = TIPO_META[g.tipo].icon;
                return (
                  <Command.Group
                    key={g.tipo}
                    heading={TIPO_META[g.tipo].grupo}
                    className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {g.itens.map((hit) => (
                      <Command.Item
                        key={hit.id}
                        value={`${hit.tipo}-${hit.id}`}
                        onSelect={() => irPara(hit)}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{hit.titulo}</span>
                        {hit.subtitulo && (
                          <span className="shrink-0 truncate text-xs text-muted-foreground">
                            {hit.subtitulo}
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}
            </Command.List>
          </Command>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {conversa.length === 0 && !perguntar.isPending ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <p className="pt-1 text-sm text-muted-foreground">
                      Olá! Sou a assistente do Workspace. Pergunte como usar o sistema ou escolha uma
                      sugestão:
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 pl-9">
                    {SUGESTOES_IA.map((s) => (
                      <button
                        key={s}
                        onClick={() => enviarIA(s)}
                        className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {conversa.map((m, i) =>
                    m.autor === "user" ? (
                      <div key={i} className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                          {m.texto}
                        </div>
                      </div>
                    ) : (
                      <div key={i} className="flex items-start gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Sparkles className="h-4 w-4" />
                        </span>
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted/60 px-3.5 py-2 text-sm leading-6">
                          {m.texto}
                        </div>
                      </div>
                    ),
                  )}
                  {perguntar.isPending && (
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Sparkles className="h-4 w-4" />
                      </span>
                      <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-muted/60 px-3.5 py-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Pensando…
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                enviarIA(pergunta);
              }}
              className="flex items-center gap-2 border-t p-3"
            >
              <input
                autoFocus
                value={pergunta}
                onChange={(e) => setPergunta(e.target.value)}
                placeholder="Escreva sua pergunta…"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              />
              <button
                type="submit"
                disabled={!pergunta.trim() || perguntar.isPending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                aria-label="Enviar"
              >
                <SendHorizontal className="h-4 w-4" />
              </button>
            </form>
            <p className="border-t px-4 py-1.5 text-center text-[11px] text-muted-foreground">
              Respostas de IA podem conter erros — confira antes de agir.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
