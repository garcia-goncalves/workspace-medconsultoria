import { useCallback } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

/**
 * NAVEGAR DENTRO DO PORTAL.
 *
 * Existe por um detalhe de tipagem, não de comportamento. O `interface Register` do TanStack
 * Router é declarado **uma vez** por aplicação (`apps/web/src/app/router.tsx`), e aponta para o
 * roteador INTERNO — o da equipe. É ele que dá autocompletar e conferência de rota ao `Link` e
 * ao `useNavigate` de todo o repositório.
 *
 * O Portal tem um roteador PRÓPRIO, de propósito (dois testes-guarda leem o texto de
 * `app/router.tsx` e cobrariam item de menu e guia interno para qualquer rota declarada lá).
 * As rotas do Portal, portanto, não existem para aquela tipagem — e redeclarar `Register` para
 * incluí-las quebraria a conferência do app inteiro.
 *
 * A saída é passar o caminho como texto, com o desvio de tipo **num lugar só e explicado**, em
 * vez de espalhá-lo por cada botão. Quem confere que as rotas existem de verdade é o
 * `secoes.test.ts`, que lê o texto de `app/portal-router.tsx` — conferência de arquivo, no
 * lugar da conferência de tipo que aqui não está disponível.
 *
 * ⚠️ **Por que não importar `portalRouter` e chamar `portalRouter.navigate`** — que daria
 * conferência de rota de verdade, sem cast: isso fecha um ciclo de módulos. `portal-router`
 * importa `PortalLayout`, que importa `PortalTabBar`, que importaria este arquivo, que
 * importaria `portal-router` de volta. Quebrá-lo exigiria carregar o próprio `PortalLayout`
 * sob demanda, trocando um cast documentado por um piscar da casca a cada primeira carga.
 *
 * A função devolvida é MEMORIZADA: ela é usada como dependência de `useEffect` (o guarda de
 * rota dos Convênios, por exemplo). Recriada a cada render, faria o efeito rodar de novo a
 * cada atualização de qualquer consulta — hoje inofensivo, e exatamente o formato que vira
 * laço no dia em que a condição de dentro do efeito também depender de algo instável.
 */
export function usePortalNavegar() {
  const navigate = useNavigate();
  return useCallback(
    (rota: string, opcoes?: { substituir?: boolean }) =>
      (navigate as unknown as (o: { to: string; replace?: boolean }) => void)({
        to: rota,
        replace: opcoes?.substituir,
      }),
    [navigate],
  );
}

/** O caminho da seção aberta agora (ex.: `/portal/documentos`). */
export function usePortalCaminho(): string {
  return useRouterState({ select: (s) => s.location.pathname });
}
