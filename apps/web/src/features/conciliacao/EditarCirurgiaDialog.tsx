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
import { data as dataBrasilia, dataUTC } from "../../lib/format-date";
import { Aviso, STATUS_CONCILIACAO, type StatusConciliacao, type StatusRecurso } from "./partes";

/** O que o diálogo precisa de uma linha conciliada (ver `LinhaConciliada` no servidor). */
export interface CirurgiaConciliada {
  id: string;
  numeroCirurgia: string;
  atendimento: string | null;
  dataCirurgia: string;
  /** Precisa saber se o MÊS está fechado (não só a cirurgia) — ver `fechada` abaixo. */
  competencia: string;
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
  /** O recurso de glosa mais recente (Fase 2c). Nulo = nunca se recorreu desta cirurgia. */
  recurso: { id: string; tentativa: number; status: StatusRecurso; protocolo: string | null; semResposta: boolean } | null;
  naoCobrar: boolean;
  observacao: string | null;
}

/**
 * Conciliar UMA cirurgia à mão. Os valores automáticos (do de-para e do repasse) aparecem como
 * referência; digitar aqui SOBREPÕE, e apagar o campo devolve ao automático — o servidor grava
 * só o que alguém digitou (`valorCobrado`/`valorRecebido` nulos = vale o calculado).
 *
 * ⚠️ COM O MÊS FECHADO, o diálogo abre SÓ LEITURA — campos desabilitados, Salvar desabilitado, e
 * uma explicação no topo. Antes disso ele abria editável e só reclamava no Salvar (o servidor já
 * recusa, `assertCompetenciaAberta`); isso fazia a pessoa preencher tudo de novo para descobrir
 * no fim que o mês está fechado. A trava do servidor CONTINUA sendo a que vale — esta é só a
 * tela chegando na mesma conclusão mais cedo.
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

  // ⚠️ O diálogo BUSCA SOZINHO se o mês está fechado — não recebe isso do painel que o abriu.
  // A tela já mostra o selo do mês em outro lugar; aqui é a mesma pergunta, feita de novo, para
  // este componente não depender de uma prop que alguém esqueceria de passar no próximo lugar
  // que abrir este diálogo.
  const fechadas = trpc.conciliacao.competenciasFechadas.useQuery({ clienteId });
  const fechada = fechadas.data?.find((f) => f.competencia === c.competencia) ?? null;

  const salvar = trpc.conciliacao.editarCirurgia.useMutation({
    onSuccess: () => {
      toast("Cirurgia atualizada.", "success");
      onSalvo();
      onClose();
    },
    onError: (e) => toast(e.message),
  });

  const status = STATUS_CONCILIACAO[c.statusConciliacao];
  const somenteLeitura = !!fechada;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Cirurgia ${c.numeroCirurgia}`}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {somenteLeitura ? "Fechar" : "Cancelar"}
          </Button>
          <Button
            disabled={somenteLeitura || salvar.isPending}
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
        {fechada && (
          <Aviso tom="atencao">
            <strong>
              {c.competencia} está fechado
              {fechada.fechadoPor && ` — conferido por ${fechada.fechadoPor}`}
            </strong>{" "}
            em {dataBrasilia(fechada.fechadoEm)}. Só um administrador pode reabrir o mês para editar esta cirurgia; os campos abaixo são só
            para conferência.
          </Aviso>
        )}
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
            <Input
              id="ec-codigo"
              value={codigo}
              maxLength={40}
              disabled={somenteLeitura}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ex.: 30917042"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ec-cobrado">Valor cobrado</Label>
            <MoneyInput
              id="ec-cobrado"
              value={cobrado}
              disabled={somenteLeitura}
              onChange={setCobrado}
              placeholder={c.cobradoOrigem === "DE_PARA" ? `${formatBRL(c.cobrado)} (do de-para)` : "Sem valor de referência"}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ec-recebido">Valor recebido</Label>
            <MoneyInput
              id="ec-recebido"
              value={recebido}
              disabled={somenteLeitura}
              onChange={setRecebido}
              placeholder={c.recebidoOrigem === "REPASSE" ? `${formatBRL(c.recebido)} (do repasse)` : "Nada recebido ainda"}
            />
            {c.repasseCompartilhado && (
              <p className="text-xs text-muted-foreground">O repasse deste atendimento foi dividido com outra cirurgia, pelo cobrado.</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="ec-data">Data do pagamento</Label>
            <Input
              id="ec-data"
              type="date"
              value={dataPagamento}
              disabled={somenteLeitura}
              onChange={(e) => setDataPagamento(e.target.value)}
            />
          </div>
        </div>

        <label
          className={`flex min-h-11 items-center gap-2 text-sm ${somenteLeitura ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
        >
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={naoCobrar}
            disabled={somenteLeitura}
            onChange={(e) => setNaoCobrar(e.target.checked)}
          />
          Não cobrar (particular pago direto, cortesia, acordo) — sai das somas de dinheiro
        </label>

        <div className="space-y-1">
          <Label htmlFor="ec-obs">Observação</Label>
          <Textarea
            id="ec-obs"
            rows={2}
            maxLength={2000}
            value={observacao}
            disabled={somenteLeitura}
            onChange={(e) => setObservacao(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">Deixe um valor em branco para voltar ao automático (de-para e repasse).</p>
      </div>
    </Modal>
  );
}
