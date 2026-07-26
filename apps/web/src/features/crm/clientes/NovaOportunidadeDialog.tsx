import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { trpc } from "../../../lib/trpc";
import { Modal } from "../../../components/ui/modal";
import { Button } from "../../../components/ui/button";
import { Label } from "../../../components/ui/label";
import { MoneyInput } from "../../../components/ui/money-input";
import { Textarea } from "../../../components/ui/textarea";
import { toast } from "../../../components/ui/toast";
import { ServicosPicker } from "../leads/ServicosPicker";

/**
 * "Nova oportunidade" inteligente: para um cliente que já existe, o negócio nasce no
 * funil já sabendo QUAIS serviços ele quer (card + checklist prontos). O cliente segue
 * cliente — é um novo negócio (upsell), não "o cliente virou lead".
 */
export function NovaOportunidadeDialog({
  open,
  onClose,
  clienteId,
  clienteNome,
  onCriada,
}: {
  open: boolean;
  onClose: () => void;
  clienteId: string;
  clienteNome: string;
  onCriada: () => void;
}) {
  const utils = trpc.useUtils();
  const servicos = trpc.servicos.ativos.useQuery(undefined, { enabled: open });
  const [servicoIds, setServicoIds] = useState<string[]>([]);
  const [valor, setValor] = useState<number | undefined>(undefined);
  const [obs, setObs] = useState("");

  useEffect(() => {
    if (open) {
      setServicoIds([]);
      setValor(undefined);
      setObs("");
    }
  }, [open]);

  const criar = trpc.leads.novaOportunidade.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      utils.clientes.get.invalidate({ id: clienteId });
      utils.clientes.relacionados.invalidate({ id: clienteId });
      utils.clientes.list.invalidate();
      utils.clientes.resumo.invalidate();
      toast("Nova oportunidade aberta no funil. Este cliente segue seu cliente. 🎯", "success");
      onClose();
      onCriada();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova oportunidade"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={criar.isPending}
            onClick={() =>
              criar.mutate({
                clienteId,
                servicoIds,
                valorEstimado: valor,
                observacoes: obs.trim() || undefined,
              })
            }
          >
            <Target className="h-4 w-4" /> Abrir no funil
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Um novo negócio no Funil de vendas para <strong className="text-foreground">{clienteNome}</strong>. O cliente
          continua seu cliente — isto é uma nova oportunidade de venda.
        </p>

        {servicos.data && servicos.data.length > 0 && (
          <div className="space-y-1">
            <Label hint="Marque os serviços deste novo negócio — eles já entram como checklist no card do funil.">Quais serviços ele quer nesta oportunidade?</Label>
            <div className="max-h-[92px] overflow-y-auto rounded-lg border bg-muted/20 p-2">
              <ServicosPicker servicos={servicos.data} value={servicoIds} onChange={setServicoIds} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="valor" hint="Quanto você espera fechar com este negócio (pode ajustar depois).">Valor estimado</Label>
            <MoneyInput id="valor" value={valor} onChange={setValor} />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="obs">Observação</Label>
          <Textarea id="obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Contexto do novo negócio (opcional)…" />
        </div>

        {criar.error && <p className="text-sm text-destructive">{criar.error.message}</p>}
      </div>
    </Modal>
  );
}
