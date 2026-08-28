import { useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { trpc } from "../../../lib/trpc";
import { Card, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { toast } from "../../../components/ui/toast";
import { ServicosPicker } from "../../crm/leads/ServicosPicker";
import { PortalServicos } from "../PortalServicos";

/**
 * MEUS SERVIÇOS — o que a clínica contratou, e o que ela ainda pode contratar.
 *
 * Esta seção é a única casa de `portal.servicosDisponiveis` (o catálogo do autosserviço). A
 * consulta leva **11,9 s em produção** e, na página única de antes, era obrigatória para o
 * Portal abrir — inclusive para quem só queria assinar um contrato. Com as seções, ela só
 * dispara quando alguém abre esta tela. Foi o ganho de desempenho que saiu de graça do
 * redesenho, e é por isso que o catálogo mora aqui, e não no Início.
 */
export function PortalServicosPage() {
  const resumo = trpc.portal.resumo.useQuery();
  const catalogo = trpc.portal.servicosDisponiveis.useQuery();
  const utils = trpc.useUtils();
  const [pedidos, setPedidos] = useState<string[]>([]);
  const [msgServico, setMsgServico] = useState("");

  const solicitar = trpc.portal.solicitarServicos.useMutation({
    onSuccess: () => {
      utils.portal.resumo.invalidate();
      setPedidos([]);
      setMsgServico("");
      toast("Recebemos seu pedido! Nossa equipe já vai preparar tudo para você. 🎯", "success");
    },
  });

  const servicosAtuais = resumo.data?.servicosAtuais ?? [];
  const jaPedidos = new Set(servicosAtuais.map((s) => s.id));
  const disponiveis = (catalogo.data ?? []).filter((s) => !jaPedidos.has(s.id));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-primary">Meus serviços</h1>
        <p className="text-muted-foreground">O que está contratado e o que ainda precisamos de você.</p>
      </div>

      <PortalServicos />

      {/* Autosserviço: o cliente escolhe os serviços que precisa, e o pedido vira oportunidade no funil */}
      {catalogo.data && catalogo.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Sparkles className="h-4 w-4 text-primary" /> O que você precisa?
            </CardTitle>
            <span className="text-xs text-muted-foreground">Escolha e nós preparamos</span>
          </CardHeader>
          <div className="space-y-3 p-5 pt-1">
            {servicosAtuais.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Você já pediu: <span className="font-medium text-foreground">{servicosAtuais.map((s) => s.nome).join(", ")}</span>.
              </p>
            )}
            {disponiveis.length === 0 ? (
              <p className="text-sm text-muted-foreground">Você já solicitou todos os nossos serviços. 🎉</p>
            ) : (
              <>
                <ServicosPicker servicos={disponiveis} value={pedidos} onChange={setPedidos} />
                <Textarea
                  value={msgServico}
                  onChange={(e) => setMsgServico(e.target.value)}
                  placeholder="Quer contar algo sobre o que precisa? (opcional)"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={pedidos.length === 0 || solicitar.isPending}
                    onClick={() => solicitar.mutate({ servicoIds: pedidos, mensagem: msgServico.trim() || undefined })}
                  >
                    <Send className="h-4 w-4" /> Solicitar
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
