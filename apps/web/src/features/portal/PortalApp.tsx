import { RouterProvider } from "@tanstack/react-router";
import { portalRouter } from "../../app/portal-router";

/**
 * O Portal inteiro, embrulhado num arquivo fino.
 *
 * Existe por um detalhe do carregamento sob demanda: `React.lazy` recebe um **componente**, e
 * uma instância de roteador não é um componente. O `App.tsx` precisa continuar carregando o
 * Portal sob demanda (é a tela do CLIENTE — sem isto, toda a equipe baixaria o Portal, e o
 * cliente baixaria o app interno), então o que vira `lazy` é este arquivo, e não o roteador.
 */
export function PortalApp() {
  return <RouterProvider router={portalRouter} />;
}
