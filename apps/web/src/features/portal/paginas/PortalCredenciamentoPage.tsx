import { useEffect } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { trpc } from "../../../lib/trpc";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { PortalCredenciamento } from "../PortalCredenciamento";
import { usePortalNavegar } from "../navegar";

/**
 * CONVÊNIOS — a papelada do credenciamento, por médico e por convênio.
 *
 * ⚠️ **A guarda desta rota é obrigatória e não pode ser removida ao refinar a tela.** Quem não
 * tem processo de credenciamento não vê o item na barra (a vaga fica com outra candidata, ou a
 * barra tem quatro itens) — mas o endereço continua digitável, e um link de e-mail antigo
 * continua clicável. Sem a guarda, essas duas portas levam a uma tela em branco, que se lê como
 * defeito. Com ela, levam ao Início.
 *
 * O rótulo na barra é "Convênios" porque é assim que o médico chama isto — e porque a palavra
 * "Credenciamento" não cabe num item de barra a 360px de largura.
 */
export function PortalCredenciamentoPage() {
  const q = trpc.portal.credenciamento.useQuery();
  const navegar = usePortalNavegar();

  /*
   * ⚠️ "SEM DADO" E "DEU ERRO" NÃO SÃO A MESMA COISA, e tratá-los junto era um defeito de
   * verdade: quando a consulta FALHA, `isLoading` também fica falso e `data` também fica
   * indefinido. O cliente que tocou em "Convênios" durante uma falha de rede seria devolvido
   * ao Início em silêncio — e concluiria que perdeu o processo de credenciamento.
   *
   * Redirecionar, portanto, só quando o servidor respondeu e disse que não há processo.
   * `substituir` de propósito: quem não tem credenciamento não deve poder "voltar" para uma
   * tela que não existe para ele, senão o botão do navegador vira um vaivém.
   */
  useEffect(() => {
    if (!q.isLoading && !q.isError && !q.data) navegar("/portal", { substituir: true });
  }, [q.isLoading, q.isError, q.data, navegar]);

  if (q.isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Não conseguimos carregar a sua papelada"
        description="Pode ter sido a conexão. Tente de novo — se continuar assim, fale com a nossa equipe pelo Suporte."
      >
        <div className="flex flex-wrap justify-center gap-2">
          <Button className="min-h-11" onClick={() => q.refetch()} disabled={q.isFetching}>
            Tentar de novo
          </Button>
          <Button variant="outline" className="min-h-11" onClick={() => navegar("/portal/suporte")}>
            Falar com o Suporte
          </Button>
        </div>
      </EmptyState>
    );
  }

  if (q.isLoading || !q.data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-primary">Convênios</h1>
        <p className="text-muted-foreground">A papelada de credenciamento de cada médico.</p>
      </div>
      <PortalCredenciamento />
    </div>
  );
}
