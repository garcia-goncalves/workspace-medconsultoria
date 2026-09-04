import { useState } from "react";
import { Users } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { toast } from "../../components/ui/toast";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { PessoasDoPortal } from "./PessoasDoPortal";
import { usePodeNoPortal } from "./permissoes";
import { ConviteLinkDialog } from "../configuracoes/ConviteLinkDialog";
import type { ConviteResultado } from "../configuracoes/UsuarioFormDialog";

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

  // Achado da auditoria de 04/09/2026: quando o e-mail falhava (no ambiente local, SEMPRE — não
  // há servidor de e-mail), esta tela dizia só "fale com a nossa equipe" e DESCARTAVA o
  // `conviteUrl` que o servidor já calculou — a única das cinco telas de convite do sistema que
  // não dava um jeito alternativo de entregar o acesso. Agora reaproveita o mesmo diálogo das
  // outras quatro (`ConviteLinkDialog`).
  const [conviteInfo, setConviteInfo] = useState<ConviteResultado | null>(null);
  const emailPorPessoaId = new Map((q.data ?? []).map((p) => [p.id, p.email]));

  const convidar = trpc.portal.pessoas.convidar.useMutation({
    onSuccess: (r, variaveis) => {
      recarregar();
      setConviteInfo({ email: variaveis.email, conviteUrl: r.conviteUrl, emailEnviado: r.emailEnviado });
    },
    onError: aoFalhar,
  });
  const alterarPapel = trpc.portal.pessoas.alterarPapel.useMutation({
    onSuccess: recarregar,
    onError: aoFalhar,
  });
  const revogar = trpc.portal.pessoas.revogar.useMutation({ onSuccess: recarregar, onError: aoFalhar });
  const devolver = trpc.portal.pessoas.devolver.useMutation({
    onSuccess: (r, variaveis) => {
      recarregar();
      if (r.conviteUrl) {
        setConviteInfo({ email: emailPorPessoaId.get(variaveis.pessoaId) ?? "", conviteUrl: r.conviteUrl, emailEnviado: r.emailEnviado });
      } else {
        toast("Acesso devolvido.");
      }
    },
    onError: aoFalhar,
  });
  const reenviar = trpc.portal.pessoas.reenviarConvite.useMutation({
    onSuccess: (r, variaveis) => {
      recarregar();
      setConviteInfo({ email: emailPorPessoaId.get(variaveis.pessoaId) ?? "", conviteUrl: r.conviteUrl, emailEnviado: r.emailEnviado });
    },
    onError: aoFalhar,
  });

  // O papel vem da SESSÃO. Papel nulo é conta antiga, que sempre pôde tudo — a mesma regra do
  // `podeNoPortal` no servidor, e ela precisa ser a mesma aqui, senão a tela esconde um botão
  // que o servidor aceitaria (ou pior, mostra um que ele vai recusar).
  // ⚠️ NÃO basta olhar o papel: `papelPortal !== "EQUIPE"` deixava passar a SESSÃO DE SUPORTE
  // da Med (ADR-128), que entra como RESPONSAVEL da clínica e mesmo assim não pode escrever
  // nada. O resultado era "Convidar pessoa" e "Revogar" à vista para quem está em modo de
  // leitura, com a recusa chegando só depois do clique e do modal de confirmação — o mesmo
  // defeito que a ADR-139 fechou para os outros quatro botões e que não tinha chegado aqui.
  //
  // A régua é a função pura do `@app/shared`, a MESMA que o `portalProcedure` chama. Uma só,
  // porque duas divergem no primeiro ajuste (ADR-133).
  const convite = usePodeNoPortal()("pessoas.convidar");
  const souResponsavel = convite.pode;

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
          fraseSemPermissao={convite.frase}
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
      <ConviteLinkDialog info={conviteInfo} onClose={() => setConviteInfo(null)} />
    </Card>
  );
}
