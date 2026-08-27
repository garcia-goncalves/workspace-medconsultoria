import { Eye, LogOut, Loader2 } from "lucide-react";
import { useAuth } from "../../lib/auth-context";
import { trpc } from "../../lib/trpc";

/**
 * A faixa de "você está vendo como <cliente>" (ADR-128).
 *
 * Existe por um motivo simples: quem esquece que está no painel de outra pessoa acha que está
 * no próprio. A faixa fica no topo, em cor que não se confunde com o resto da interface, e o
 * caminho de volta é o botão dela — não um menu escondido.
 *
 * ⚠️ Só aparece em sessão de suporte. Para o cliente de verdade, `operador` é nulo e a faixa
 * não existe: ele nunca vê nada disto.
 */
export function FaixaDeSuporte() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const voltar = trpc.auth.voltarDoPainelDoCliente.useMutation({
    onSuccess: async () => {
      // Recarrega a página inteira de propósito: a sessão mudou de dono, e todo cache do
      // TanStack Query em memória é do cliente. Limpar item a item deixaria sobra.
      await utils.invalidate();
      window.location.href = "/";
    },
  });

  if (!user.operador) return null;

  return (
    <div className="sticky top-0 z-40 border-b border-warning/40 bg-warning/15 print:hidden">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <Eye className="h-4 w-4 shrink-0 text-warning" />
        <span className="min-w-0">
          Você está vendo o Portal como <strong className="text-foreground">{user.nome}</strong>, em modo de
          suporte — <strong className="text-foreground">só leitura</strong>.
        </span>
        <button
          onClick={() => voltar.mutate()}
          disabled={voltar.isPending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-warning/50 bg-card px-2.5 py-1 text-xs font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
        >
          {voltar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
          Voltar ao meu acesso
        </button>
      </div>
    </div>
  );
}
