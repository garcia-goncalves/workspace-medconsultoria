import { useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { trpc } from "../../../lib/trpc";
import { Card, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { toast } from "../../../components/ui/toast";
import { ServicosPicker } from "../../crm/leads/ServicosPicker";
import { PortalServicos } from "../PortalServicos";
import { usePodeNoPortal } from "../permissoes";

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
  const meusServicos = trpc.portal.meusServicos.useQuery();
  const utils = trpc.useUtils();
  // Pedir serviço novo é falar PELA clínica (ADR-131): a secretária vê o catálogo e não pede.
  const pedirServico = usePodeNoPortal()("solicitarServicos");
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

  // Achado da auditoria de 04/09/2026: o catálogo só descontava `servicosAtuais` (o carrinho do
  // LEAD ativo no funil) — cliente já convertido normalmente não tem lead ativo, então esse
  // conjunto ficava vazio e "O que você precisa?" oferecia até serviço JÁ CONTRATADO de verdade
  // (`portal.meusServicos`), abrindo caminho para pedido duplicado do que já se paga. Agora
  // descontamos os dois: o carrinho em aberto E o que já está contratado.
  const servicosAtuais = resumo.data?.servicosAtuais ?? [];
  const jaContratados = meusServicos.data ?? [];
  const jaPedidos = new Set([...servicosAtuais.map((s) => s.id), ...jaContratados.map((s) => s.servico.id)]);
  const disponiveis = (catalogo.data ?? []).filter((s) => !jaPedidos.has(s.id));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-primary">Meus serviços</h1>
        <p className="text-muted-foreground">O que está contratado e o que ainda precisamos de você.</p>
      </div>

      <PortalServicos />

      {/* ⚠️ Esta consulta leva ~12 s em produção. Sem um lugar reservado, a tela parecia
          pronta e um card inteiro caía do céu doze segundos depois, empurrando o que o
          cliente estava lendo. A silhueta diz "vem mais coisa" e o conteúdo chega no lugar
          que já estava guardado para ele.
          ⚠️ Achado do react-reviewer no PR #191: o gate precisa esperar TAMBÉM
          `meusServicos` — se `catalogo` responder antes dela, o card desenharia com
          `jaContratados` vazio e mostraria como "disponível" um serviço que a clínica já
          paga, na janela entre as duas respostas. */}
      {(catalogo.isLoading || meusServicos.isLoading) && (
        <Card>
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        </Card>
      )}

      {/* Autosserviço: o cliente escolhe os serviços que precisa, e o pedido vira oportunidade no funil */}
      {!meusServicos.isLoading && catalogo.data && catalogo.data.length > 0 && (
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
            ) : !pedirServico.pode ? (
              /* A LISTA CONTINUA VISÍVEL — a trava é sobre pedir, não sobre saber o que existe.
                 O que sai é o formulário: um seletor que não pode ser enviado é uma armadilha. */
              <>
                <ul className="space-y-1 text-sm">
                  {disponiveis.map((s) => (
                    <li key={s.id} className="text-foreground">
                      · {s.nome}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{pedirServico.frase}</p>
              </>
            ) : (
              <>
                {/* `ServicosPicker` é reaproveitado fora do Portal (cadastro de lead, captação
                    pública, "Nova oportunidade") — não pode ser editado daqui. O seletor
                    `[&_button]:min-h-11` alcança o alvo de toque sem tocar no componente. */}
                <div className="[&_button]:min-h-11">
                  <ServicosPicker servicos={disponiveis} value={pedidos} onChange={setPedidos} />
                </div>
                <Textarea
                  value={msgServico}
                  onChange={(e) => setMsgServico(e.target.value)}
                  placeholder="Quer contar algo sobre o que precisa? (opcional)"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    className="min-h-11"
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
