import { Mail } from "lucide-react";
import { trpc } from "../../../lib/trpc";
import { Card, CardHeader, CardTitle } from "../../../components/ui/card";
import { EmailsEnviadosList } from "../../../components/EmailsEnviadosList";
import { PortalSuporte } from "../PortalSuporte";

/**
 * SUPORTE — falar com a equipe, e o histórico do que já mandamos por e-mail.
 *
 * `portal.emails` passa a carregar **só aqui**. Na página única ela vinha junto com todo o
 * resto, para uma lista que o cliente abre de vez em quando.
 */
export function PortalSuportePage() {
  const emails = trpc.portal.emails.useQuery();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-primary">Suporte</h1>
        <p className="text-muted-foreground">Fale direto com a nossa equipe — respondemos por aqui.</p>
      </div>

      <PortalSuporte />

      <Card>
        <CardHeader>
          <CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" /> Seus e-mails
          </CardTitle>
          <span className="text-xs text-muted-foreground">Tudo que enviamos para você</span>
        </CardHeader>
        <div className="p-4 pt-1">
          <EmailsEnviadosList emails={emails.data ?? []} mostrarStatus={false} vazio="Você ainda não recebeu e-mails." />
        </div>
      </Card>
    </div>
  );
}
