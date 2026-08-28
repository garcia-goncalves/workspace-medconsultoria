import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "../../../lib/trpc";
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

  // Substitui o endereço de propósito: quem cai aqui sem credenciamento não deve poder
  // "voltar" para uma tela que não existe para ele — o botão do navegador viraria um vaivém.
  useEffect(() => {
    if (!q.isLoading && !q.data) navegar("/portal", { substituir: true });
  }, [q.isLoading, q.data, navegar]);

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
        <h1 className="text-2xl font-semibold text-primary">Credenciamento nos convênios</h1>
        <p className="text-muted-foreground">A papelada de cada médico, por convênio.</p>
      </div>
      <PortalCredenciamento />
    </div>
  );
}
