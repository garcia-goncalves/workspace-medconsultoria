import { Users } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { toast } from "../../components/ui/toast";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { PessoasDoPortal } from "./PessoasDoPortal";

/**
 * "Quem da clínica entra aqui" — a seção do Portal onde o responsável cuida da própria equipe
 * (ADR-131).
 *
 * Existe para a clínica não depender da Med para uma coisa que é dela: dar acesso a um médico
 * novo ou tirar o da secretária que saiu. Enquanto isso precisasse de um chamado, o caminho
 * curto continuaria sendo passar a senha adiante — que é exatamente o que esta entrega veio
 * acabar.
 *
 * Quem é `EQUIPE` VÊ a lista e não mexe nela: saber com quem se divide o Portal é informação
 * legítima, e a trava de verdade está no servidor de qualquer forma.
 */
export function PortalMinhaEquipe() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const q = trpc.portal.pessoas.list.useQuery();

  const recarregar = () => utils.portal.pessoas.list.invalidate();
  const aoFalhar = (e: { message: string }) => toast(e.message);

  const convidar = trpc.portal.pessoas.convidar.useMutation({
    onSuccess: (r) => {
      recarregar();
      toast(
        r.emailEnviado
          ? "Convite enviado. A pessoa recebe um e-mail com o link para criar a senha."
          : "Pessoa cadastrada, mas o e-mail não saiu. Fale com a nossa equipe.",
      );
    },
    onError: aoFalhar,
  });
  const alterarPapel = trpc.portal.pessoas.alterarPapel.useMutation({
    onSuccess: recarregar,
    onError: aoFalhar,
  });
  const revogar = trpc.portal.pessoas.revogar.useMutation({ onSuccess: recarregar, onError: aoFalhar });
  const devolver = trpc.portal.pessoas.devolver.useMutation({ onSuccess: recarregar, onError: aoFalhar });
  const reenviar = trpc.portal.pessoas.reenviarConvite.useMutation({
    onSuccess: () => {
      recarregar();
      toast("Convite reenviado.");
    },
    onError: aoFalhar,
  });

  // O papel vem da SESSÃO. Papel nulo é conta antiga, que sempre pôde tudo — a mesma regra do
  // `podeNoPortal` no servidor, e ela precisa ser a mesma aqui, senão a tela esconde um botão
  // que o servidor aceitaria (ou pior, mostra um que ele vai recusar).
  const souResponsavel = user.papelPortal !== "EQUIPE";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Users className="h-4 w-4 text-primary" /> Quem da clínica entra aqui
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          Cada médico e cada secretária com o próprio e-mail e a própria senha — ninguém precisa
          dividir acesso.
        </span>
      </CardHeader>
      <CardContent>
        <PessoasDoPortal
          pessoas={q.data ?? []}
          carregando={q.isLoading}
          meuUserId={user.id}
          podeEditar={souResponsavel}
          vazio="Por enquanto só você entra aqui. Convide os médicos e as secretárias da clínica para cada um ter o próprio acesso."
          acoes={{
            convidar: (d) => convidar.mutate(d),
            alterarPapel: (d) => alterarPapel.mutate(d),
            revogar: (pessoaId) => revogar.mutate({ pessoaId }),
            devolver: (pessoaId) => devolver.mutate({ pessoaId }),
            reenviarConvite: (pessoaId) => reenviar.mutate({ pessoaId }),
            ocupado:
              convidar.isPending ||
              alterarPapel.isPending ||
              revogar.isPending ||
              devolver.isPending ||
              reenviar.isPending,
          }}
        />
      </CardContent>
    </Card>
  );
}
