import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Home, ChevronRight } from "lucide-react";

/**
 * Breadcrumbs (caminho) do workspace — renderizado no cabeçalho do AppLayout.
 * A trilha é derivada da rota; as fichas (cliente/projeto/documento) publicam o nome
 * do registro pelo contexto (`useDynamicCrumb`) para virar o último item da trilha.
 */

interface Crumb {
  label: string;
  to?: string;
}

/** Páginas que vivem sob "Ajustes" (grupo Configuração do menu) — ganham o pai Ajustes. */
const AJUSTES_CHILDREN: Record<string, string> = {
  "/servicos": "Serviços",
  "/usuarios": "Equipe e acessos",
  "/emails": "Mensagens automáticas",
  "/emails-enviados": "E-mails enviados",
  "/modelos": "Modelos de documento",
};

/** Rótulo da seção principal por rota. */
const SECTION_LABEL: Record<string, string> = {
  "/leads": "Vendas",
  "/clientes": "Clientes",
  "/projetos": "Projetos",
  "/agenda": "Agenda",
  "/mensagens": "Mensagens",
  "/email": "E-mail", // sem isto o fallback capitaliza o segmento e escreve "Email", sem hífen
  "/documentos": "Documentos",
  "/financeiro": "Financeiro",
  "/ajustes": "Ajustes",
  "/sistema": "Sistema",
  "/configuracoes": "Configurações",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Monta a trilha estática a partir do pathname; `dynamic` = nome do registro nas fichas. */
export function trailFor(pathname: string, dynamic: string | null): Crumb[] {
  const parts = pathname.split("/").filter(Boolean);
  const seg = parts[0];
  if (!seg) return []; // Início (só o ícone Home, que já é o atual)

  const base = "/" + seg;
  const isDetail = parts.length >= 2;
  const crumbs: Crumb[] = [];

  const ajustesLabel = AJUSTES_CHILDREN[base];
  if (ajustesLabel) {
    crumbs.push({ label: "Ajustes", to: "/ajustes" });
    crumbs.push({ label: ajustesLabel, to: isDetail ? base : undefined });
  } else {
    crumbs.push({ label: SECTION_LABEL[base] ?? cap(seg), to: isDetail ? base : undefined });
  }

  if (isDetail) crumbs.push({ label: dynamic ?? "…" });
  return crumbs;
}

// ── Contexto do crumb dinâmico (nome do registro nas fichas) ──
const DynamicCrumbCtx = createContext<{ label: string | null; setLabel: (l: string | null) => void }>({
  label: null,
  setLabel: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  return <DynamicCrumbCtx.Provider value={{ label, setLabel }}>{children}</DynamicCrumbCtx.Provider>;
}

/** As fichas chamam isto com o nome do registro; limpa ao sair da página. */
export function useDynamicCrumb(label: string | null | undefined) {
  const { setLabel } = useContext(DynamicCrumbCtx);
  useEffect(() => {
    setLabel(label ?? null);
    return () => setLabel(null);
  }, [label, setLabel]);
}

export function Breadcrumbs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { label } = useContext(DynamicCrumbCtx);
  const crumbs = trailFor(pathname, label);

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 shrink md:flex">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        <li className="shrink-0">
          <Link
            to="/"
            aria-label="Início"
            activeOptions={{ exact: true }}
            aria-current={crumbs.length === 0 ? "page" : undefined}
            className="flex items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Home className="h-[18px] w-[18px]" />
          </Link>
        </li>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1">
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/40" />
              {c.to && !last ? (
                <Link
                  to={c.to}
                  activeOptions={{ exact: true }}
                  className="truncate rounded-md px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {c.label}
                </Link>
              ) : (
                <span aria-current="page" className="truncate px-1 font-semibold text-foreground">
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
