import { Users } from "lucide-react";
import { trpc } from "../../../lib/trpc";
import { toast } from "../../../components/ui/toast";
import { Card, CardHeader, CardTitle, CardContent } from "../../../components/ui/card";
import { PessoasDoPortal } from "../../portal/PessoasDoPortal";

/**
 * "Pessoas com acesso ao Portal", na ficha do cliente (ADR-131).
 *
 * O lado da EQUIPE DA MED da mesma lista que o cliente vê no Portal dele. Responde a pergunta
 * que a Thaís não tinha onde responder — *"a secretária da clínica também precisa entrar"* —
 * sem que ninguém tenha de dividir uma senha.
 *
 * ⚠️ Não substitui o botão **Enviar acesso** do topo da ficha: aquele é a PRIMEIRA porta da
 * clínica (a conta do responsável, criada junto com o cliente). Este card é quem vem depois.
 */
export function PessoasDoPortalCard({ clienteId }: { clienteId: string }) {
  const utils = trpc.useUtils();
  const q = trpc.clientes.pessoas.list.useQuery({ clienteId });

  const recarregar = () => {
    utils.clientes.pessoas.list.invalidate({ clienteId });
    // O card de acesso no topo da ficha lê as mesmas contas: sem isto, convidar alguém aqui
    // deixaria o topo dizendo "Sem acesso ao Portal" enquanto a lista logo abaixo mostra a
    // pessoa recém-convidada.
    utils.clientes.get.invalidate({ id: clienteId });
  };
  const aoFalhar = (e: { message: string }) => toast(e.message);

  const convidar = trpc.clientes.pessoas.convidar.useMutation({
    onSuccess: (r) => {
      recarregar();
      toast(
        r.emailEnviado
          ? "Convite enviado. A pessoa recebe um e-mail com o link para criar a senha."
          : "Pessoa cadastrada, mas o e-mail não saiu — confira em E-mails enviados.",
      );
    },
    onError: aoFalhar,
  });
  const alterarPapel = trpc.clientes.pessoas.alterarPapel.useMutation({
    onSuccess: recarregar,
    onError: aoFalhar,
  });
  const revogar = trpc.clientes.pessoas.revogar.useMutation({
    onSuccess: recarregar,
    onError: aoFalhar,
  });
  const devolver = trpc.clientes.pessoas.devolver.useMutation({
    onSuccess: recarregar,
    onError: aoFalhar,
  });
  const reenviar = trpc.clientes.pessoas.reenviarConvite.useMutation({
    onSuccess: () => {
      recarregar();
      toast("Convite reenviado.");
    },
    onError: aoFalhar,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Users className="h-4 w-4 text-primary" /> Pessoas com acesso ao Portal
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          Médicos e secretárias desta clínica, cada um com o próprio acesso · o responsável também
          convida e revoga pelo Portal dele
        </span>
      </CardHeader>
      <CardContent>
        <PessoasDoPortal
          pessoas={q.data ?? []}
          carregando={q.isLoading}
          vazio="Ninguém desta clínica tem acesso ao Portal ainda. Convide o responsável, e depois os médicos e as secretárias."
          acoes={{
            convidar: (d) => convidar.mutate({ ...d, clienteId }),
            alterarPapel: (d) => alterarPapel.mutate({ ...d, clienteId }),
            revogar: (pessoaId) => revogar.mutate({ pessoaId, clienteId }),
            devolver: (pessoaId) => devolver.mutate({ pessoaId, clienteId }),
            reenviarConvite: (pessoaId) => reenviar.mutate({ pessoaId, clienteId }),
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
