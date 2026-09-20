import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { MoneyInput } from "../../components/ui/money-input";
import { toast } from "../../components/ui/toast";
import { formatBRL } from "../../lib/masks";
import { dataUTC } from "../../lib/format-date";
import { STATUS_CONCILIACAO, type StatusConciliacao } from "./partes";

/** O que o diálogo precisa de uma linha conciliada (ver `LinhaConciliada` no servidor). */
export interface CirurgiaConciliada {
  id: string;
  numeroCirurgia: string;
  atendimento: string | null;
  dataCirurgia: string;
  pacienteNome: string;
  procedimento: string;
  convenioBruto: string;
  statusBruto: string;
  autorizacaoBruto: string;
  codigo: string | null;
  cobrado: number | null;
  cobradoOrigem: "MANUAL" | "DE_PARA" | null;
  recebido: number | null;
  recebidoOrigem: "MANUAL" | "REPASSE" | null;
  repasseCompartilhado: boolean;
  dataPagamento: string | null;
  glosa: number | null;
  statusConciliacao: StatusConciliacao;
  naoCobrar: boolean;
  observacao: string | null;
}

/**
 * Conciliar UMA cirurgia à mão. Os valores automáticos (do de-para e do repasse) aparecem como
 * referência; digitar aqui SOBREPÕE, e apagar o campo devolve ao automático — o servidor grava
 * só o que alguém digitou (`valorCobrado`/`valorRecebido` nulos = vale o calculado).
 */
export function EditarCirurgiaDialog({
  clienteId,
  cirurgia: c,
  onClose,
  onSalvo,
}: {
  clienteId: string;
  cirurgia: CirurgiaConciliada;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [codigo, setCodigo] = useState(c.codigo ?? "");
  const [cobrado, setCobrado] = useState<number | undefined>(c.cobradoOrigem === "MANUAL" ? (c.cobrado ?? undefined) : undefined);
  const [recebido, setRecebido] = useState<number | undefined>(c.recebidoOrigem === "MANUAL" ? (c.recebido ?? undefined) : undefined);
  const [dataPagamento, setDataPagamento] = useState(c.recebidoOrigem === "MANUAL" ? (c.dataPagamento ?? "") : "");
  const [naoCobrar, setNaoCobrar] = useState(c.naoCobrar);
  const [observacao, setObservacao] = useState(c.observacao ?? "");

  const salvar = trpc.conciliacao.editarCirurgia.useMutation({
    onSuccess: () => {
      toast("Cirurgia atualizada.", "success");
      onSalvo();
      onClose();
    },
    onError: (e) => toast(e.message),
  });

  const status = STATUS_CONCILIACAO[c.statusConciliacao];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Cirurgia ${c.numeroCirurgia}`}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={salvar.isPending}
            onClick={() =>
              salvar.mutate({
                clienteId,
                cirurgiaId: c.id,
                codigoProcedimento: codigo.trim() || null,
                valorCobrado: cobrado ?? null,
                valorRecebido: recebido ?? null,
                dataPagamento: dataPagamento || null,
                naoCobrar,
                observacao: observacao.trim() || null,
              })
            }
          >
            {salvar.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-muted/40 p-3 text-sm">
          <p className="font-medium">{c.pacienteNome}</p>
          <p className="text-muted-foreground">
            {dataUTC(c.dataCirurgia)} · {c.procedimento} · {c.convenioBruto}
          </p>
          <p className="text-muted-foreground">
            Atendimento {c.atendimento ?? <span className="text-warning">sem número</span>} · {c.statusBruto} · autorização:{" "}
            {c.autorizacaoBruto || "—"}
          </p>
          <p className={`mt-1 font-medium ${status.cor}`}>
            {status.rotulo}
            {c.glosa !== null && c.glosa > 0 && ` · glosa de ${formatBRL(c.glosa)}`}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ec-codigo">Código do procedimento</Label>
            <Input id="ec-codigo" value={codigo} maxLength={40} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex.: 30917042" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ec-cobrado">Valor cobrado</Label>
            <MoneyInput
              id="ec-cobrado"
              value={cobrado}
              onChange={setCobrado}
              placeholder={c.cobradoOrigem === "DE_PARA" ? `${formatBRL(c.cobrado)} (do de-para)` : "Sem valor de referência"}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ec-recebido">Valor recebido</Label>
            <MoneyInput
              id="ec-recebido"
              value={recebido}
              onChange={setRecebido}
              placeholder={c.recebidoOrigem === "REPASSE" ? `${formatBRL(c.recebido)} (do repasse)` : "Nada recebido ainda"}
            />
            {c.repasseCompartilhado && (
              <p className="text-xs text-muted-foreground">O repasse deste atendimento foi dividido com outra cirurgia, pelo cobrado.</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="ec-data">Data do pagamento</Label>
            <Input id="ec-data" type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
          </div>
        </div>

        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={naoCobrar} onChange={(e) => setNaoCobrar(e.target.checked)} />
          Não cobrar (particular pago direto, cortesia, acordo) — sai das somas de dinheiro
        </label>

        <div className="space-y-1">
          <Label htmlFor="ec-obs">Observação</Label>
          <Textarea id="ec-obs" rows={2} maxLength={2000} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">Deixe um valor em branco para voltar ao automático (de-para e repasse).</p>
      </div>
    </Modal>
  );
}
