import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Copy, Loader2 } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Combobox } from "../../components/ui/combobox";
import { toast } from "../../components/ui/toast";

/**
 * DUPLICAR PROPOSTA (Onda 4A): novo rascunho com o mesmo texto e itens, número novo, sem aceite nem
 * assinatura. Destino em branco = o mesmo cliente. A lista é a mesma do "Novo documento"
 * (clientes + leads em negociação), porque proposta vai também para quem ainda é lead (ADR-132).
 */
export function DuplicarPropostaDialog({
  open,
  onClose,
  documentoId,
  clienteNome,
  aguardandoAceite,
}: {
  open: boolean;
  onClose: () => void;
  documentoId: string;
  clienteNome: string | null;
  /** A original está com o link de aceite no ar (M3): duplicar para o mesmo cliente o desliga. */
  aguardandoAceite: boolean;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [destino, setDestino] = useState("");
  const destinatarios = trpc.documentos.destinatarios.useQuery(undefined, { enabled: open });
  const duplicar = trpc.documentos.duplicar.useMutation({
    onSuccess: (doc) => {
      utils.documentos.list.invalidate();
      toast("Proposta duplicada. Confira o texto antes de enviar.", "success");
      onClose();
      setDestino("");
      navigate({ to: "/documentos/$documentoId", params: { documentoId: doc.id } });
    },
  });

  const opcoes = useMemo(() => {
    const d = destinatarios.data;
    if (!d) return [];
    return [
      ...d.clientes.map((c) => ({ value: `c:${c.id}`, label: c.nome, hint: "Cliente" })),
      ...d.leads.map((l) => ({ value: `l:${l.id}`, label: l.rotulo, hint: l.etapa ? `Lead · ${l.etapa}` : "Lead" })),
    ];
  }, [destinatarios.data]);

  const confirmar = () => {
    const [tipo, id] = destino ? destino.split(":") : [];
    duplicar.mutate({
      id: documentoId,
      ...(tipo === "c" && id ? { clienteId: id } : {}),
      ...(tipo === "l" && id ? { leadId: id } : {}),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Duplicar proposta"
      hint="A cópia nasce em rascunho, com número novo, sem aceite nem assinatura. É o caminho para mudar preço ou itens sem mexer na proposta original."
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" className="min-h-11" onClick={onClose} disabled={duplicar.isPending}>
            Cancelar
          </Button>
          <Button className="min-h-11" onClick={confirmar} disabled={duplicar.isPending}>
            {duplicar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Duplicar
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="duplicar-destino">Para quem</Label>
          <Combobox
            id="duplicar-destino"
            value={destino}
            onChange={setDestino}
            options={opcoes}
            placeholder={clienteNome ? `O mesmo cliente (${clienteNome})` : "O mesmo destinatário"}
            emptyText={destinatarios.isError ? "Não foi possível carregar a lista." : "Nada encontrado."}
          />
        </div>
        {!destino && aguardandoAceite && (
          <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Esta proposta está aguardando o aceite do cliente. Ao duplicar, o link dela deixa de valer e ela fica marcada
            como substituída pela cópia — o cliente só poderá aceitar a nova, depois que você a enviar.
          </p>
        )}
        {destino && (
          <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Só o nome da clínica é trocado no texto. Antes de enviar, confira e apague do texto o que é da clínica
            original: <strong>CNPJ, nomes de médicos, endereço e observações</strong> — mandar dado de um cliente para
            outro expõe informação pessoal (LGPD).
          </p>
        )}
        {duplicar.error && <p className="text-sm text-destructive">{duplicar.error.message}</p>}
      </div>
    </Modal>
  );
}
