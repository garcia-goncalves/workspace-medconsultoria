import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Filter,
  FolderKanban,
  Calendar,
  Wallet,
  MessageSquare,
  FileText,
  ListTodo,
  Search,
  Sparkles,
  HelpCircle,
  LogOut,
  Menu,
  X,
  ChevronsUpDown,
  Settings,
  SlidersHorizontal,
  ServerCog,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@app/ui";
import { ROLE_LABEL, hasRoleLevel, type Role } from "@app/shared";
import { useAuth } from "../../lib/auth-context";
import { trpc } from "../../lib/trpc";
import { Avatar } from "../ui/avatar";
import { CommandPalette } from "../CommandPalette";
import { NotificationBell } from "./NotificationBell";
import { GuiaTour } from "../GuiaTour";
import { Breadcrumbs, BreadcrumbProvider } from "./Breadcrumbs";

interface NavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  exact?: boolean;
  minRole: Role;
}

/**
 * Navegação agrupada por USO: "Dia a dia" (o que a equipe usa sempre) e "Configuração"
 * (o que se ajusta uma vez — Ajustes junta os painéis administrativos; Sistema é dos devs).
 */
const NAV_GROUPS: { titulo: string; itens: NavItem[] }[] = [
  {
    titulo: "Dia a dia",
    itens: [
      { label: "Início", icon: LayoutDashboard, to: "/", exact: true, minRole: "FUNCIONARIO" },
      { label: "Vendas", icon: Filter, to: "/leads", minRole: "FUNCIONARIO" },
      { label: "Clientes", icon: Users, to: "/clientes", minRole: "FUNCIONARIO" },
      { label: "Projetos", icon: FolderKanban, to: "/projetos", minRole: "FUNCIONARIO" },
      { label: "Tarefas", icon: ListTodo, to: "/tarefas", minRole: "FUNCIONARIO" },
      { label: "Agenda", icon: Calendar, to: "/agenda", minRole: "FUNCIONARIO" },
      { label: "Mensagens", icon: MessageSquare, to: "/mensagens", minRole: "FUNCIONARIO" },
      { label: "Documentos", icon: FileText, to: "/documentos", minRole: "FUNCIONARIO" },
      { label: "Financeiro", icon: Wallet, to: "/financeiro", minRole: "ADMIN" },
    ],
  },
  {
    titulo: "Configuração",
    itens: [
      { label: "Ajustes", icon: SlidersHorizontal, to: "/ajustes", minRole: "ADMIN" },
      { label: "Sistema", icon: ServerCog, to: "/sistema", minRole: "ROOT" },
    ],
  },
];

/** Títulos de páginas fora da navegação principal (acessadas via Ajustes, ficha ou menu do usuário). */
const EXTRA_TITLES: Record<string, string> = {
  "/configuracoes": "Configurações",
  "/ajustes": "Ajustes",
  "/servicos": "Serviços",
  "/usuarios": "Equipe e acessos",
  "/emails": "Mensagens automáticas",
  "/emails-enviados": "E-mails enviados",
  "/modelos": "Modelos de documento",
};

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.itens);
const COLAPSADA_KEY = "sidebar-colapsada";

/** Páginas que vivem SOB "Ajustes" (abertas por lá) — fazem o item "Ajustes" ficar ativo. */
const AJUSTES_FILHOS = ["/servicos", "/usuarios", "/emails", "/emails-enviados", "/modelos", "/configuracoes"];

/** Um item do menu está ativo na rota atual? (Ajustes também acende nas suas páginas-filhas.) */
function itemAtivo(pathname: string, to: string): boolean {
  const casa = (p: string) => pathname === p || pathname.startsWith(p + "/");
  if (to === "/") return pathname === "/";
  if (to === "/ajustes") return casa("/ajustes") || AJUSTES_FILHOS.some(casa);
  return casa(to);
}

/** Atalho do teclado exibido conforme o sistema (⌘K no Mac, Ctrl K no resto). */
const ATALHO_BUSCA =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘K" : "Ctrl K";

/** Deriva o título da página atual a partir da rota, para o cabeçalho. */
function usePageTitle(): string {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/") return "Início";
  const match = ALL_ITEMS.filter((i) => i.to !== "/")
    .filter((i) => pathname.startsWith(i.to))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (match) return match.label;
  // Páginas fora do menu (via Ajustes/ficha): casa por prefixo — cobre detalhes como /documentos/$id.
  const extra = Object.keys(EXTRA_TITLES)
    .filter((k) => pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return (extra ? EXTRA_TITLES[extra] : undefined) ?? "MedConsultoria";
}

/** Tooltip flutuante para o modo recolhido (só-ícones). */
function RailTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md group-hover:block">
      {label}
    </span>
  );
}

/** Menu do usuário — abre acima do bloco de perfil no rodapé da sidebar. */
function UserMenu({ colapsada, onNavigate }: { colapsada: boolean; onNavigate?: () => void }) {
  const { user, logout, loggingOut } = useAuth();
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [aberto]);

  return (
    <div className="relative" ref={ref}>
      {aberto && (
        <div
          className={cn(
            "absolute bottom-full z-50 mb-2 min-w-[220px] origin-bottom animate-scale-in overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg",
            colapsada ? "left-0" : "left-0 right-0",
          )}
        >
          <div className="border-b px-3 py-2.5">
            <div className="truncate text-sm font-medium">{user.nome}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          </div>
          <div className="p-1">
            <Link
              to="/configuracoes"
              onClick={() => {
                setAberto(false);
                onNavigate?.();
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-accent"
            >
              <Settings className="h-4 w-4 text-muted-foreground" />
              Configurações
            </Link>
            <button
              onClick={logout}
              disabled={loggingOut}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
              Sair da conta
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setAberto((v) => !v)}
        aria-label={colapsada ? user.nome : undefined}
        className={cn(
          "group flex w-full items-center rounded-xl border border-white/10 bg-white/5 text-left transition-colors hover:bg-white/10",
          colapsada ? "justify-center p-1.5" : "gap-3 px-2.5 py-2",
        )}
      >
        <Avatar id={user.id} nome={user.nome} avatarUrl={user.avatarUrl} className="h-9 w-9 shadow-sm" />
        {!colapsada && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{user.nome}</span>
              <span className="block truncate text-[11px] text-white/70">{ROLE_LABEL[user.role]}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-white/40" />
          </>
        )}
        {colapsada && <RailTooltip label={user.nome} />}
      </button>
    </div>
  );
}

/** Conteúdo da barra lateral — reutilizado no desktop (recolhível) e no drawer mobile. */
function SidebarConteudo({
  colapsada,
  grupos,
  pathname,
  onNavigate,
  onToggle,
}: {
  colapsada: boolean;
  grupos: { titulo: string; itens: NavItem[] }[];
  pathname: string;
  onNavigate?: () => void;
  onToggle?: () => void;
}) {
  // Tooltip do modo recolhido via portal (posição fixa) — não vaza no <nav> que rola,
  // evitando a barra de scroll horizontal indesejada.
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const mostrarTip = (e: ReactMouseEvent<HTMLElement>, label: string) => {
    if (!colapsada) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 12 });
  };
  const esconderTip = () => setTip(null);

  return (
    <>
      <div className={cn("flex h-16 items-center gap-3", colapsada ? "justify-center px-2" : "px-5")}>
        {colapsada ? (
          <button
            onClick={onToggle}
            title="Expandir menu"
            className="group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
          >
            <img src="/simbolo.png" alt="Expandir menu" className="h-9 w-9 group-hover:opacity-0" />
            <PanelLeftOpen className="absolute h-5 w-5 text-white/80 opacity-0 group-hover:opacity-100" />
          </button>
        ) : (
          <>
            <img src="/simbolo.png" alt="" className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[15px] font-semibold tracking-tight text-white">
                MedConsultoria
              </div>
              <div className="truncate text-[11px] font-medium text-white/70">Workspace</div>
            </div>
            {onToggle && (
              <button
                onClick={onToggle}
                title="Recolher menu"
                className="hidden shrink-0 rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white md:block"
              >
                <PanelLeftClose className="h-[18px] w-[18px]" />
              </button>
            )}
          </>
        )}
      </div>

      <nav className={cn("flex-1 space-y-4 overflow-y-auto py-4", colapsada ? "px-2" : "px-3")}>
        {grupos.map((grupo) => (
          <div key={grupo.titulo} className="space-y-1">
            {colapsada ? (
              <div className="mx-2 mb-1 border-t border-white/10 first:border-0" />
            ) : (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/70">
                {grupo.titulo}
              </p>
            )}
            {grupo.itens.map((item) => {
              const ativo = itemAtivo(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => {
                    esconderTip();
                    onNavigate?.();
                  }}
                  onMouseEnter={(e) => mostrarTip(e, item.label)}
                  onMouseLeave={esconderTip}
                  aria-label={colapsada ? item.label : undefined}
                  aria-current={ativo ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center rounded-lg text-[0.9rem] text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-blueLight",
                    colapsada ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
                    ativo &&
                      "bg-white/10 font-semibold !text-white before:absolute before:left-0 before:top-1/2 before:h-6 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-brand-blueLight",
                  )}
                >
                  <item.icon className="h-[19px] w-[19px] shrink-0" />
                  {!colapsada && item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className={cn("border-t border-white/10", colapsada ? "p-2" : "p-3")}>
        <UserMenu colapsada={colapsada} onNavigate={onNavigate} />
      </div>

      {tip &&
        createPortal(
          <div
            style={{ position: "fixed", top: tip.top, left: tip.left, transform: "translateY(-50%)" }}
            className="pointer-events-none z-[60] whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md"
          >
            {tip.label}
          </div>,
          document.body,
        )}
    </>
  );
}

export function AppLayout() {
  const { user } = useAuth();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [guiaAberto, setGuiaAberto] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [colapsada, setColapsada] = useState(() => {
    try {
      return localStorage.getItem(COLAPSADA_KEY) === "1";
    } catch {
      return false;
    }
  });
  const pageTitle = usePageTitle();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Título da aba do navegador acompanha a página. O Início e as rotas sem título próprio
  // (ex.: 404, cujo fallback já é "MedConsultoria") ficam só com a marca — senão a aba
  // mostrava "MedConsultoria · MedConsultoria".
  useEffect(() => {
    const semTituloProprio = pageTitle === "Início" || pageTitle === "MedConsultoria";
    document.title = semTituloProprio ? "MedConsultoria" : `${pageTitle} · MedConsultoria`;
  }, [pageTitle]);
  const ia = trpc.ia.disponivel.useQuery(undefined, { staleTime: 60_000 });
  const buscaPlaceholder = ia.data?.disponivel
    ? "Buscar ou perguntar à IA…"
    : "Buscar clientes, projetos, documentos…";

  const toggleColapsada = () =>
    setColapsada((v) => {
      const proximo = !v;
      try {
        localStorage.setItem(COLAPSADA_KEY, proximo ? "1" : "0");
      } catch {
        /* ignora indisponibilidade do storage */
      }
      return proximo;
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const grupos = NAV_GROUPS.map((g) => ({
    ...g,
    itens: g.itens.filter((i) => hasRoleLevel(user.role, i.minRole)),
  })).filter((g) => g.itens.length > 0);

  // Telas "app" com painéis de altura fixa + scroll interno (não usam o scroll de janela): o chat
  // das Mensagens rola por dentro e a grade da Agenda cabe na tela. Ver ADR-83.
  const telaCheia = pathname.startsWith("/mensagens") || pathname.startsWith("/agenda");

  return (
    <BreadcrumbProvider>
    <div className="flex min-h-screen bg-background">
      {/* Sidebar fixa (desktop) — sticky em tela cheia: acompanha a rolagem normal da janela. */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col self-start border-r border-white/5 bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out md:flex",
          colapsada ? "w-[76px]" : "w-[264px]",
        )}
      >
        <SidebarConteudo colapsada={colapsada} grupos={grupos} pathname={pathname} onToggle={toggleColapsada} />
      </aside>

      {/* Sidebar drawer (mobile) — sempre expandida */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-foreground/40 backdrop-blur-sm"
            onClick={() => setMobileNav(false)}
          />
          <aside className="relative flex h-full w-[280px] animate-slide-in-right flex-col bg-sidebar text-sidebar-foreground shadow-lg">
            <button
              onClick={() => setMobileNav(false)}
              className="absolute right-3 top-5 z-10 rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarConteudo colapsada={false} grupos={grupos} pathname={pathname} onNavigate={() => setMobileNav(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur-md md:px-6">
          <button
            onClick={() => setMobileNav(true)}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Zona ESQUERDA (desktop): contexto/breadcrumb. `flex-1` para equilibrar a direita e
              manter a busca no CENTRO EXATO — antes a busca deslizava conforme o tamanho do
              breadcrumb (curto no Início, longo nas fichas), parecendo desalinhada. */}
          <div className="hidden min-w-0 flex-1 md:flex">
            <Breadcrumbs />
          </div>

          {/* Mobile: título da página (referência de onde o usuário está — breadcrumb some no celular). */}
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground md:hidden">{pageTitle}</span>

          {/* Zona CENTRAL (desktop): as três zonas são `flex-1`, então a busca fica no centro
              exato. O botão é capado em `max-w-md` mas ENCOLHE quando o espaço aperta (tablet),
              evitando overflow — todas as zonas têm `min-w-0`. */}
          <div className="hidden min-w-0 flex-1 justify-center md:flex">
            <button
              onClick={() => setCmdkOpen(true)}
              aria-label="Buscar"
              aria-keyshortcuts="Control+K Meta+K"
              className="group flex w-full max-w-md items-center gap-2.5 rounded-lg border bg-background px-3.5 py-2 text-sm text-muted-foreground shadow-sm outline-none transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {ia.data?.disponivel ? (
                <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Search className="h-4 w-4 shrink-0 transition-colors group-hover:text-foreground" />
              )}
              <span className="truncate">{buscaPlaceholder}</span>
              <kbd className="ml-auto hidden shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium sm:inline-block">
                {ATALHO_BUSCA}
              </kbd>
            </button>
          </div>

          {/* Zona DIREITA: ações. `md:flex-1 md:justify-end` fecha o equilíbrio com a esquerda. */}
          <div className="flex shrink-0 items-center gap-1 md:flex-1 md:justify-end">
            {/* Mobile: busca vira ícone (o título ocupa o espaço). */}
            <button
              onClick={() => setCmdkOpen(true)}
              className="rounded-md p-2 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 md:hidden"
              aria-label="Buscar"
            >
              {ia.data?.disponivel ? <Sparkles className="h-5 w-5 text-primary" /> : <Search className="h-5 w-5" />}
            </button>
            <button
              onClick={() => setGuiaAberto(true)}
              className="rounded-md p-2 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
              title="Guia de instruções"
              aria-label="Guia de instruções"
            >
              <HelpCircle className="h-5 w-5" />
            </button>
            <NotificationBell />
          </div>
        </header>

        {/* Padrão: scroll NORMAL da janela (conteúdo flui, o navegador rola; sidebar/cabeçalho
            fixos via sticky). EXCEÇÃO — telas "app" (Mensagens/Agenda) que precisam de painéis de
            altura fixa com scroll INTERNO (chat que rola, grade da agenda): o <main> vira o viewport
            e o container preenche a tela; a própria página (h-full) gerencia o scroll por dentro. */}
        {telaCheia ? (
          // Altura FIXA = viewport − cabeçalho (h-16=4rem): como a raiz é min-h-screen, sem isto a
          // coluna cresceria com o conteúdo e a janela rolaria. Assim o main capa e a página rola por dentro.
          <main className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden">
            <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col overflow-hidden p-4 md:p-6 lg:px-10 lg:py-8">
              <Outlet />
            </div>
          </main>
        ) : (
          <main className="flex-1">
            <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6 lg:px-10 lg:py-8">
              <Outlet />
            </div>
          </main>
        )}
      </div>

      <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} />
      <GuiaTour open={guiaAberto} onClose={() => setGuiaAberto(false)} />
    </div>
    </BreadcrumbProvider>
  );
}
