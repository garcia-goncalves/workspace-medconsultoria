import { useState } from "react";
import { hasRoleLevel } from "@app/shared";
import { AlertTriangle, Receipt } from "lucide-react";
import { useAuth } from "../../lib/auth-context";
import { trpc, type RouterOutputs } from "../../lib/trpc";
import { EmptyState } from "../../components/ui/empty-state";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Modal } from "../../components/ui/modal";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { toast } from "../../components/ui/toast";
import { data as dataBrasilia, dataUTC } from "../../lib/format-date";
import { formatBRL } from "../../lib/masks";

type Mes = RouterOutputs["conciliacao"]["honorario"]["meses"][number];

/**
 * O HONORÁRIO DA MED — o percentual do faturamento sobre o que a clínica RECEBEU (Onda 2).
 *
 * Cada linha é um MÊS DO CRÉDITO (a data de pagamento do repasse), nunca o mês do atendimento: o
 * contrato cobra sobre o dinheiro que já caiu na conta da clínica. Todo número é o de HOJE,
 * recalculado do repasse; o que foi lançado aparece ao lado, e a diferença é dita em voz alta.
 *
 * ⚠️ O funcionário VÊ tudo (ele concilia o repasse que é a base); lançar e atualizar são ADMIN+, e
 * a tela mostra o botão desabilitado com o motivo — o servidor recusa do mesmo jeito.
 */

const SITUACAO: Record<Mes["situacao"], { rotulo: string; variant: "default" | "primary" | "success" | "warning" | "danger" }> = {
  A_LANCAR: { rotulo: "A lançar", variant: "warning" },
  LANCADO: { rotulo: "Lançado", variant: "primary" },
  DIVERGENTE: { rotulo: "Divergente", variant: "danger" },
  PAGO: { rotulo: "Pago", variant: "success" },
  MES_EM_CURSO: { rotulo: "Mês em curso", variant: "default" },
  SEM_PERCENTUAL: { rotulo: "Sem percentual", variant: "default" },
  FORA_DO_CONTRATO: { rotulo: "Fora do contrato", variant: "default" },
  NADA_A_COBRAR: { rotulo: "Nada a cobrar", variant: "default" },
};

const pct = (p: number | null) => (p === null ? "—" : `${p.toLocaleString("pt-BR")}%`);

/** O que dizer sob a situação — quem lançou, e a divergência quando houver. */
function Detalhe({ m }: { m: Mes }) {
  const l = m.lancamento;
  if (!l) return null;
  return (
    <span className="block text-xs text-muted-foreground">
      {l.contaExcluida ? (
        <span className="text-warning">A conta lançada em {dataBrasilia(l.lancadoEm)} foi excluída no Financeiro.</span>
      ) : (
        <>
          Lançado em {dataBrasilia(l.lancadoEm)}
          {l.lancadoPor && ` por ${l.lancadoPor}`}
          {l.contaVencimento && ` · vence ${dataUTC(l.contaVencimento)}`}
        </>
      )}
      {m.divergiu && !l.contaExcluida && (
        <span className="block text-destructive">
          Lançado {formatBRL(l.valor)} sobre {formatBRL(l.base)}; hoje o repasse soma {formatBRL(m.baseRecebida)} ({formatBRL(m.honorario ?? 0)}).
          {l.contaPaga && " A conta já foi paga — lance a diferença como ajuste no Financeiro."}
        </span>
      )}
    </span>
  );
}

function Acao({
  m,
  podeLancar,
  onLancar,
  onAtualizar,
  pendente,
}: {
  m: Mes;
  podeLancar: boolean;
  onLancar: () => void;
  onAtualizar: () => void;
  pendente: boolean;
}) {
  const motivo = podeLancar ? undefined : "Só ADMIN lança ou atualiza o honorário no Financeiro.";
  if (m.situacao === "A_LANCAR") {
    return (
      <Button className="min-h-11" disabled={!podeLancar || pendente} title={motivo} onClick={onLancar}>
        Lançar
      </Button>
    );
  }
  if (m.situacao === "DIVERGENTE") {
    return (
      <Button variant="outline" className="min-h-11" disabled={!podeLancar || pendente} title={motivo} onClick={onAtualizar}>
        Atualizar valor
      </Button>
    );
  }
  return null;
}

export function HonorarioPainel({ clienteId }: { clienteId: string }) {
  const { user } = useAuth();
  const podeLancar = hasRoleLevel(user?.role ?? "CLIENTE", "ADMIN");
  const utils = trpc.useUtils();
  const q = trpc.conciliacao.honorario.useQuery({ clienteId });
  const [lancando, setLancando] = useState<Mes | null>(null);
  const [atualizando, setAtualizando] = useState<Mes | null>(null);

  function recarregar() {
    // A conta nova aparece no Financeiro e na ficha do cliente; a visão geral soma o "a lançar".
    void utils.conciliacao.invalidate();
    void utils.financeiro.invalidate();
  }

  const atualizar = trpc.conciliacao.atualizarHonorario.useMutation({
    onSuccess: (r) => {
      toast(`Valor atualizado para ${formatBRL(r.valor)}.`, "success");
      setAtualizando(null);
      recarregar();
    },
    onError: (e) => {
      toast(e.message);
      void q.refetch();
    },
  });

  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.error) return <QueryError message={q.error.message} onRetry={() => void q.refetch()} />;
  const h = q.data;

  if (h.meses.length === 0) {
    return <EmptyState icon={Receipt} title="Nada a calcular" description={h.motivo ?? "Nenhum repasse importado ainda."} />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3 text-sm">
        <p>
          {h.contratacao?.percentual != null ? (
            <>
              <strong>{pct(h.contratacao.percentual)}</strong> do que a clínica recebe dos convênios, no mês em que o repasse cai na conta
              dela.
            </>
          ) : (
            <span className="text-warning">{h.motivo ?? "A contratação do faturamento não tem percentual definido."}</span>
          )}
          {h.aLancarTotal > 0 && <span className="text-warning"> · {formatBRL(h.aLancarTotal)} a lançar</span>}
        </p>
        {h.repasseSemData.linhas > 0 && (
          <p className="mt-1 flex gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {h.repasseSemData.linhas} linha(s) de repasse ({formatBRL(h.repasseSemData.total)}) sem data de pagamento não entram em mês
            nenhum.
          </p>
        )}
      </div>

      <div className="rounded-lg border">
        {/* ≥md: tabela. */}
        <div className="hidden md:block">
          <Table rotulo="Honorário por mês do crédito">
            <THead>
              <TR>
                <TH>Mês do crédito</TH>
                <TH className="text-right">Recebido</TH>
                <TH className="text-right">Percentual</TH>
                <TH className="text-right">Honorário</TH>
                <TH>Situação</TH>
                <TH>Ação</TH>
              </TR>
            </THead>
            <tbody>
              {h.meses.map((m) => (
                <TR key={m.mes} data-linha>
                  <TD className="font-medium">{m.rotulo}</TD>
                  <TD className="whitespace-nowrap text-right">
                    {formatBRL(m.baseRecebida)}
                    <span className="block text-xs text-muted-foreground">{m.linhasDeRepasse} linha(s)</span>
                  </TD>
                  <TD className="text-right">{pct(m.percentual)}</TD>
                  <TD className="whitespace-nowrap text-right">{m.honorario === null ? "—" : formatBRL(m.honorario)}</TD>
                  <TD>
                    <Badge variant={SITUACAO[m.situacao].variant}>{SITUACAO[m.situacao].rotulo}</Badge>
                    <Detalhe m={m} />
                  </TD>
                  <TD>
                    <Acao
                      m={m}
                      podeLancar={podeLancar}
                      pendente={atualizar.isPending}
                      onLancar={() => setLancando(m)}
                      onAtualizar={() => setAtualizando(m)}
                    />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </div>

        {/* <md: um cartão por mês, como o painel de cirurgias. `data-linha` nas duas formas. */}
        <ul aria-label="Honorário por mês do crédito" className="divide-y md:hidden">
          {h.meses.map((m) => (
            <li key={m.mes} data-linha className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{m.rotulo}</p>
                <Badge variant={SITUACAO[m.situacao].variant}>{SITUACAO[m.situacao].rotulo}</Badge>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Recebido</dt>
                  <dd className="break-words">{formatBRL(m.baseRecebida)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Percentual</dt>
                  <dd>{pct(m.percentual)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Honorário</dt>
                  <dd className="break-words">{m.honorario === null ? "—" : formatBRL(m.honorario)}</dd>
                </div>
              </dl>
              <Detalhe m={m} />
              <Acao
                m={m}
                podeLancar={podeLancar}
                pendente={atualizar.isPending}
                onLancar={() => setLancando(m)}
                onAtualizar={() => setAtualizando(m)}
              />
            </li>
          ))}
        </ul>
      </div>

      {!podeLancar && (
        <p className="text-xs text-muted-foreground">Lançar e atualizar o honorário no Financeiro é de quem responde pela conta (ADMIN).</p>
      )}

      {lancando && (
        <LancarHonorarioDialog
          clienteId={clienteId}
          mes={lancando}
          onClose={() => setLancando(null)}
          onLancado={() => {
            setLancando(null);
            recarregar();
          }}
          onDesatualizado={() => void q.refetch()}
        />
      )}

      <Modal
        open={!!atualizando}
        onClose={() => setAtualizando(null)}
        title={atualizando ? `Atualizar o honorário de ${atualizando.rotulo}` : ""}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAtualizando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={atualizar.isPending || !atualizando?.honorario}
              onClick={() => atualizando?.honorario && atualizar.mutate({ clienteId, mes: atualizando.mes, valorConferido: atualizando.honorario })}
            >
              {atualizar.isPending ? "Atualizando…" : "Atualizar"}
            </Button>
          </div>
        }
      >
        {atualizando?.lancamento && (
          <p className="text-sm">
            A conta a receber passa de <strong>{formatBRL(atualizando.lancamento.valor)}</strong> para{" "}
            <strong>{formatBRL(atualizando.honorario ?? 0)}</strong> ({pct(atualizando.percentual)} sobre {formatBRL(atualizando.baseRecebida)}{" "}
            recebidos).
          </p>
        )}
      </Modal>
    </div>
  );
}

function LancarHonorarioDialog({
  clienteId,
  mes,
  onClose,
  onLancado,
  onDesatualizado,
}: {
  clienteId: string;
  mes: Mes;
  onClose: () => void;
  onLancado: () => void;
  onDesatualizado: () => void;
}) {
  const [vencimento, setVencimento] = useState(mes.vencimentoSugerido);
  const [observacao, setObservacao] = useState("");
  const lancar = trpc.conciliacao.lancarHonorario.useMutation({
    onSuccess: (r) => {
      toast(`Honorário de ${mes.rotulo} lançado no Financeiro: ${formatBRL(r.valor)}.`, "success");
      onLancado();
    },
    onError: (e) => {
      toast(e.message);
      // O servidor recusa quando o repasse mudou ou alguém lançou antes — a tela precisa do novo.
      onDesatualizado();
    },
  });
  const vencimentoValido = /^\d{4}-\d{2}-\d{2}$/.test(vencimento);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Lançar o honorário de ${mes.rotulo}`}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={lancar.isPending || !vencimentoValido || !mes.honorario}
            onClick={() =>
              mes.honorario &&
              lancar.mutate({ clienteId, mes: mes.mes, vencimento, valorConferido: mes.honorario, observacao: observacao.trim() || null })
            }
          >
            {lancar.isPending ? "Lançando…" : `Lançar ${formatBRL(mes.honorario ?? 0)}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          Cria uma conta a receber no Financeiro de <strong>{formatBRL(mes.honorario ?? 0)}</strong> — {pct(mes.percentual)} sobre{" "}
          {formatBRL(mes.baseRecebida)} recebidos dos convênios com crédito em {mes.rotulo}.
        </p>
        <div className="space-y-1">
          <Label htmlFor="hon-vencimento">Vencimento</Label>
          <Input id="hon-vencimento" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hon-obs">Observação (opcional)</Label>
          <Input id="hon-obs" maxLength={2000} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
