import { createRouter, createRootRoute, createRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { PortalLayout } from "../features/portal/PortalLayout";
import { usePortalNavegar } from "../features/portal/navegar";

/**
 * O ROTEADOR DO PORTAL DO CLIENTE — separado do roteador da equipe, de propósito.
 *
 * Poderia ser tentador declarar `/portal/...` em `app/router.tsx`, junto com o resto. Não dá,
 * e o motivo é concreto: **dois testes-guarda leem o TEXTO daquele arquivo** por expressão
 * regular — `lib/paginas.test.ts` (toda rota precisa de lugar no menu lateral ou de exceção
 * declarada) e `components/GuiaTour.test.ts` (toda rota precisa de guia próprio no catálogo
 * interno). Uma rota do Portal ali reprovaria os dois, cobrando item de menu da equipe e guia
 * interno para uma tela que é do cliente. Aqui, `lib/paginas.ts` não muda uma linha.
 *
 * ⚠️ **O redirecionamento de `/` para `/portal` vive AQUI dentro, e não pode vazar.** Quem sai
 * de uma sessão de suporte (ADR-128) volta por `window.location.href = "/"`
 * (`FaixaDeSuporte.tsx`) e, a partir dali, é FUNCIONARIO — para quem `/` é o Dashboard interno.
 * Se este redirecionamento existisse em `App.tsx` ou no roteador interno, a pessoa seria jogada
 * de volta ao Portal e ficaria em laço, sem saída.
 */

const PortalInicio = lazyRouteComponent(() => import("../features/portal/paginas/PortalInicio"), "PortalInicio");
const PortalDocumentosPage = lazyRouteComponent(() => import("../features/portal/paginas/PortalDocumentosPage"), "PortalDocumentosPage");
const PortalCredenciamentoPage = lazyRouteComponent(() => import("../features/portal/paginas/PortalCredenciamentoPage"), "PortalCredenciamentoPage");
const PortalServicosPage = lazyRouteComponent(() => import("../features/portal/paginas/PortalServicosPage"), "PortalServicosPage");
const PortalSuportePage = lazyRouteComponent(() => import("../features/portal/paginas/PortalSuportePage"), "PortalSuportePage");
const PortalEquipePage = lazyRouteComponent(() => import("../features/portal/paginas/PortalEquipePage"), "PortalEquipePage");

/**
 * O desvio de tipo tem a mesma causa de `features/portal/navegar.ts`: `interface Register` é
 * declarado uma vez por aplicação e aponta para o roteador interno, que não conhece `/portal`.
 * Fica num lugar só, explicado, em vez de espalhado por cada rota.
 */
function paraOInicioDoPortal(): never {
  throw redirect({ to: "/portal" } as unknown as Parameters<typeof redirect>[0]);
}

const rootRoute = createRootRoute({ component: PortalLayout });

const raizRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: paraOInicioDoPortal,
});

const inicioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portal",
  component: PortalInicio,
});

const documentosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portal/documentos",
  component: PortalDocumentosPage,
});

const credenciamentoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portal/credenciamento",
  component: PortalCredenciamentoPage,
});

const servicosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portal/servicos",
  component: PortalServicosPage,
});

const suporteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portal/suporte",
  component: PortalSuportePage,
});

const equipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portal/equipe",
  component: PortalEquipePage,
});

/**
 * QUALQUER OUTRO CAMINHO CAI NO PORTAL — e isto é contrato testado, não conveniência.
 *
 * `e2e/flows-portal.spec.ts` abre `/financeiro` e `e2e/rbac.spec.ts` abre `/clientes` com a
 * sessão do cliente, e as duas exigem o cabeçalho do Portal. Antes, o Portal era escolhido por
 * PAPEL e ignorava o caminho; com rotas, quem garante o mesmo comportamento é esta rota curinga.
 */
const curingaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  beforeLoad: paraOInicioDoPortal,
});

/** Cinto de segurança: se algum caminho escapar do curinga, ele também volta ao Início. */
function NadaAqui() {
  const navegar = usePortalNavegar();
  useEffect(() => {
    navegar("/portal", { substituir: true });
  }, [navegar]);
  return null;
}

const routeTree = rootRoute.addChildren([
  raizRoute,
  inicioRoute,
  documentosRoute,
  credenciamentoRoute,
  servicosRoute,
  suporteRoute,
  equipeRoute,
  curingaRoute,
]);

export const portalRouter = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultNotFoundComponent: NadaAqui,
});
