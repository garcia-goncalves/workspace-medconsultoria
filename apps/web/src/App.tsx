import { lazy, Suspense, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { precisaTrocarSenha } from "@app/shared";
import { trpc } from "./lib/trpc";
import { LoginPage } from "./features/auth/LoginPage";
/**
 * Estas telas são CARREGADAS SOB DEMANDA (19/08/2026). Estáticas, todas viviam no pacote de
 * entrada e eram baixadas por todo mundo, sempre:
 *  - `AssinarPage`/`PropostaPublicaPage` renderizam o `DocumentoBranded`, que traz `dompurify`
 *    (119 kB) e `marked` (41 kB) — o funcionário baixava o renderizador de documentos público;
 *  - o Portal é a tela do CLIENTE, e ia junto para a equipe (e o contrário também).
 * A `LoginPage` fica estática de propósito: é a primeira tela de quem não entrou, e adiar um
 * round-trip ali piora justamente o caminho mais quente.
 */
const DefinirSenhaPage = lazy(() => import("./features/auth/DefinirSenhaPage").then((m) => ({ default: m.DefinirSenhaPage })));
const EsqueciSenhaPage = lazy(() => import("./features/auth/EsqueciSenhaPage").then((m) => ({ default: m.EsqueciSenhaPage })));
const RedefinirSenhaPage = lazy(() => import("./features/auth/RedefinirSenhaPage").then((m) => ({ default: m.RedefinirSenhaPage })));
const TrocarSenhaPrimeiroAcessoPage = lazy(() => import("./features/auth/TrocarSenhaPrimeiroAcessoPage").then((m) => ({ default: m.TrocarSenhaPrimeiroAcessoPage })));
const CapturaLeadPage = lazy(() => import("./features/captura/CapturaLeadPage").then((m) => ({ default: m.CapturaLeadPage })));
const AssinarPage = lazy(() => import("./features/assinaturas/AssinarPage").then((m) => ({ default: m.AssinarPage })));
const PropostaPublicaPage = lazy(() => import("./features/propostas/PropostaPublicaPage").then((m) => ({ default: m.PropostaPublicaPage })));
const PortalLayout = lazy(() => import("./features/portal/PortalLayout").then((m) => ({ default: m.PortalLayout })));
const PortalHome = lazy(() => import("./features/portal/PortalHome").then((m) => ({ default: m.PortalHome })));
import { AuthProvider } from "./lib/auth-context";
import { router } from "./app/router";
import { DialogsProvider } from "./components/ui/confirm-dialog";

/** Mesmo spinner da espera do `auth.me` — a troca de tela não muda de aparência. */
function Carregando() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

/** Envolve tela carregada sob demanda. Sem isto, o `lazy` estoura sem fallback. */
function SobDemanda({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Carregando />}>{children}</Suspense>;
}

/** Gate de autenticação: login OU app interno OU Portal do Cliente (por papel). */
export function App() {
  const me = trpc.auth.me.useQuery(undefined, { staleTime: Infinity });
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.auth.me.invalidate() });

  // Páginas públicas (fora do gate de login).
  const publicPath = window.location.pathname;
  if (publicPath === "/definir-senha") return <SobDemanda><DefinirSenhaPage /></SobDemanda>;
  if (publicPath === "/esqueci-senha") return <SobDemanda><EsqueciSenhaPage /></SobDemanda>;
  if (publicPath === "/redefinir-senha") return <SobDemanda><RedefinirSenhaPage /></SobDemanda>;
  // Caminho amigável para o lead. Nome antigo (`/captura`) foi removido de propósito:
  // "captura" assustava o futuro cliente. Só existe `/comecar`.
  if (publicPath === "/comecar") return <SobDemanda><CapturaLeadPage /></SobDemanda>;
  if (publicPath.startsWith("/assinar/")) return <SobDemanda><AssinarPage token={decodeURIComponent(publicPath.slice("/assinar/".length))} /></SobDemanda>;
  if (publicPath.startsWith("/proposta/")) return <SobDemanda><PropostaPublicaPage token={decodeURIComponent(publicPath.slice("/proposta/".length))} /></SobDemanda>;

  if (me.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!me.data) return <LoginPage />;

  // Conta interna que nunca definiu a própria senha: define agora, antes de usar a app
  // (ADR-91). Fica ANTES do AuthProvider de propósito — nada da app carrega até resolver.
  if (precisaTrocarSenha(me.data)) {
    return (
      <SobDemanda>
        <TrocarSenhaPrimeiroAcessoPage user={me.data} onSair={() => logout.mutate()} />
      </SobDemanda>
    );
  }

  const authValue = {
    user: me.data,
    logout: () => logout.mutate(),
    loggingOut: logout.isPending,
  };

  return (
    <AuthProvider value={authValue}>
      <DialogsProvider>
        {me.data.role === "CLIENTE" ? (
          <SobDemanda>
            <PortalLayout>
              <PortalHome />
            </PortalLayout>
          </SobDemanda>
        ) : (
          <RouterProvider router={router} />
        )}
      </DialogsProvider>
    </AuthProvider>
  );
}
