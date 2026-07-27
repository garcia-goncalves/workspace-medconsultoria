import { RouterProvider } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { trpc } from "./lib/trpc";
import { LoginPage } from "./features/auth/LoginPage";
import { DefinirSenhaPage } from "./features/auth/DefinirSenhaPage";
import { EsqueciSenhaPage } from "./features/auth/EsqueciSenhaPage";
import { RedefinirSenhaPage } from "./features/auth/RedefinirSenhaPage";
import { CapturaLeadPage } from "./features/captura/CapturaLeadPage";
import { AssinarPage } from "./features/assinaturas/AssinarPage";
import { PropostaPublicaPage } from "./features/propostas/PropostaPublicaPage";
import { AuthProvider } from "./lib/auth-context";
import { router } from "./app/router";
import { PortalLayout } from "./features/portal/PortalLayout";
import { PortalHome } from "./features/portal/PortalHome";
import { DialogsProvider } from "./components/ui/confirm-dialog";

/** Gate de autenticação: login OU app interno OU Portal do Cliente (por papel). */
export function App() {
  const me = trpc.auth.me.useQuery(undefined, { staleTime: Infinity });
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.auth.me.invalidate() });

  // Páginas públicas (fora do gate de login).
  const publicPath = window.location.pathname;
  if (publicPath === "/definir-senha") return <DefinirSenhaPage />;
  if (publicPath === "/esqueci-senha") return <EsqueciSenhaPage />;
  if (publicPath === "/redefinir-senha") return <RedefinirSenhaPage />;
  // Caminho amigável para o lead. Nome antigo (`/captura`) foi removido de propósito:
  // "captura" assustava o futuro cliente. Só existe `/comecar`.
  if (publicPath === "/comecar") return <CapturaLeadPage />;
  if (publicPath.startsWith("/assinar/")) return <AssinarPage token={decodeURIComponent(publicPath.slice("/assinar/".length))} />;
  if (publicPath.startsWith("/proposta/")) return <PropostaPublicaPage token={decodeURIComponent(publicPath.slice("/proposta/".length))} />;

  if (me.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!me.data) return <LoginPage />;

  const authValue = {
    user: me.data,
    logout: () => logout.mutate(),
    loggingOut: logout.isPending,
  };

  return (
    <AuthProvider value={authValue}>
      <DialogsProvider>
        {me.data.role === "CLIENTE" ? (
          <PortalLayout>
            <PortalHome />
          </PortalLayout>
        ) : (
          <RouterProvider router={router} />
        )}
      </DialogsProvider>
    </AuthProvider>
  );
}
