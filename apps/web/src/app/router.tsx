import {
  createRouter,
  createRootRoute,
  createRoute,
  redirect,
  lazyRouteComponent,
  Link,
} from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { AppLayout } from "../components/layout/AppLayout";
import { EmptyState } from "../components/ui/empty-state";
import { buttonVariants } from "../components/ui/button";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { RoleGuard } from "../components/RoleGuard";
import { JaConectadoPage } from "../features/auth/JaConectadoPage";

// Páginas carregadas sob demanda (um chunk por rota) — só o Dashboard (landing) é eager.
const ClientesListPage = lazyRouteComponent(() => import("../features/crm/clientes/ClientesListPage"), "ClientesListPage");
const ClienteDetailPage = lazyRouteComponent(() => import("../features/crm/clientes/ClienteDetailPage"), "ClienteDetailPage");
const LeadsPipelinePage = lazyRouteComponent(() => import("../features/crm/leads/LeadsPipelinePage"), "LeadsPipelinePage");
const ProjetosListPage = lazyRouteComponent(() => import("../features/projetos/ProjetosListPage"), "ProjetosListPage");
const ProjetoDetailPage = lazyRouteComponent(() => import("../features/projetos/ProjetoDetailPage"), "ProjetoDetailPage");
const AgendaPage = lazyRouteComponent(() => import("../features/agenda/AgendaPage"), "AgendaPage");
const TarefasPage = lazyRouteComponent(() => import("../features/tarefas/TarefasPage"), "TarefasPage");
const FinanceiroPage = lazyRouteComponent(() => import("../features/financeiro/FinanceiroPage"), "FinanceiroPage");
const MensagensPage = lazyRouteComponent(() => import("../features/mensagens/MensagensPage"), "MensagensPage");
const DocumentosPage = lazyRouteComponent(() => import("../features/documentos/DocumentosPage"), "DocumentosPage");
const DocumentoDetailPage = lazyRouteComponent(() => import("../features/documentos/DocumentoDetailPage"), "DocumentoDetailPage");
const ModelosPage = lazyRouteComponent(() => import("../features/documentos/ModelosPage"), "ModelosPage");
const ModeloDetailPage = lazyRouteComponent(() => import("../features/documentos/ModeloDetailPage"), "ModeloDetailPage");
const ConfiguracoesPage = lazyRouteComponent(() => import("../features/configuracoes/ConfiguracoesPage"), "ConfiguracoesPage");
const UsuariosPage = lazyRouteComponent(() => import("../features/configuracoes/UsuariosPage"), "UsuariosPage");
const EmailsAdminPage = lazyRouteComponent(() => import("../features/emails/EmailsAdminPage"), "EmailsAdminPage");
const EmailsEnviadosMonitorPage = lazyRouteComponent(() => import("../features/emails/EmailsEnviadosMonitorPage"), "EmailsEnviadosMonitorPage");
const ServicosPage = lazyRouteComponent(() => import("../features/crm/servicos/ServicosPage"), "ServicosPage");
const AjustesPage = lazyRouteComponent(() => import("../features/ajustes/AjustesPage"), "AjustesPage");
const SistemaPage = lazyRouteComponent(() => import("../features/sistema/SistemaPage"), "SistemaPage");

/** Rota inexistente — mostra um estado amigável dentro do shell. */
function NotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Página não encontrada"
      description="O endereço que você tentou abrir não existe ou foi movido."
    >
      <Link to="/" className={buttonVariants({ variant: "outline" })}>
        Voltar ao início
      </Link>
    </EmptyState>
  );
}

const rootRoute = createRootRoute({ component: AppLayout, notFoundComponent: NotFound });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

const clientesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clientes",
  component: ClientesListPage,
});

const clienteDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clientes/$clienteId",
  component: ClienteDetailPage,
});

const leadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leads",
  component: LeadsPipelinePage,
});

const servicosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/servicos",
  component: () => (
    <RoleGuard minRole="ADMIN">
      <ServicosPage />
    </RoleGuard>
  ),
});

const projetosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projetos",
  component: ProjetosListPage,
});

const projetoDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projetos/$projetoId",
  component: ProjetoDetailPage,
});

const agendaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agenda",
  component: AgendaPage,
});

const tarefasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tarefas",
  component: TarefasPage,
});

const financeiroRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/financeiro",
  component: () => (
    <RoleGuard minRole="ADMIN">
      <FinanceiroPage />
    </RoleGuard>
  ),
});

const configuracoesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/configuracoes",
  component: ConfiguracoesPage,
});

const usuariosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/usuarios",
  component: () => (
    <RoleGuard minRole="ADMIN">
      <UsuariosPage />
    </RoleGuard>
  ),
});

const emailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/emails",
  component: () => (
    <RoleGuard minRole="ADMIN">
      <EmailsAdminPage />
    </RoleGuard>
  ),
});

const emailsEnviadosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/emails-enviados",
  component: () => (
    <RoleGuard minRole="ADMIN">
      <EmailsEnviadosMonitorPage />
    </RoleGuard>
  ),
});

const ajustesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ajustes",
  component: () => (
    <RoleGuard minRole="ADMIN">
      <AjustesPage />
    </RoleGuard>
  ),
});

const sistemaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sistema",
  component: () => (
    <RoleGuard minRole="ROOT">
      <SistemaPage />
    </RoleGuard>
  ),
});

const mensagensRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mensagens",
  component: MensagensPage,
});

const documentosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documentos",
  component: DocumentosPage,
});

const documentoDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documentos/$documentoId",
  component: DocumentoDetailPage,
});

const modelosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/modelos",
  component: () => (
    <RoleGuard minRole="ADMIN">
      <ModelosPage />
    </RoleGuard>
  ),
});

const modeloDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/modelos/$modeloId",
  component: () => (
    <RoleGuard minRole="ADMIN">
      <ModeloDetailPage />
    </RoleGuard>
  ),
});

/**
 * `/login` com sessão ativa. NÃO redireciona mais em silêncio: quem queria trocar de conta
 * era devolvido ao painel ainda logado como o usuário anterior e concluía que a outra conta
 * não funcionava. Agora a tela diz quem está conectado e oferece a troca.
 */
const loginRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: JaConectadoPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  agendaRoute,
  tarefasRoute,
  financeiroRoute,
  mensagensRoute,
  documentosRoute,
  documentoDetailRoute,
  modelosRoute,
  modeloDetailRoute,
  leadsRoute,
  servicosRoute,
  projetosRoute,
  projetoDetailRoute,
  clientesRoute,
  clienteDetailRoute,
  configuracoesRoute,
  usuariosRoute,
  emailsRoute,
  emailsEnviadosRoute,
  ajustesRoute,
  sistemaRoute,
  loginRedirectRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
