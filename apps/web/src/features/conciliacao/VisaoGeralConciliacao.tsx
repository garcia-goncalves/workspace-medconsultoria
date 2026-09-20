import { FileSpreadsheet } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { EmptyState } from "../../components/ui/empty-state";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { formatBRL } from "../../lib/masks";
import { dataUTC } from "../../lib/format-date";

/**
 * Todos os clientes com produção, lado a lado — a pergunta da manhã é "onde está o dinheiro
 * parado?", e ela é de N clientes, não de um. Ordena pelo que mais pede atenção: glosa + a receber.
 */
export function VisaoGeralConciliacao({ onEscolher }: { onEscolher: (clienteId: string, temCirurgia: boolean) => void }) {
  const q = trpc.conciliacao.visaoGeral.useQuery();

  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.error) return <QueryError message={q.error.message} onRetry={() => void q.refetch()} />;
  if (q.data.clientes.length === 0) {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title="Nenhum cliente com produção importada"
        description="Escolha um cliente acima e importe a produção de consultas ou o mapa cirúrgico do TASY."
      />
    );
  }

  // ⚠️ Ordena pelo que TRAVOU primeiro (glosa + o a receber que passou do prazo), e só depois
  // pelo que ainda está dentro da espera normal. "Onde está o dinheiro parado?" é a pergunta da
  // manhã, e um a receber de três semanas não é dinheiro parado — é o ciclo funcionando.
  const linhas = [...q.data.clientes].sort(
    (a, b) => b.glosa + b.aReceberAtrasado - (a.glosa + a.aReceberAtrasado) || b.aReceber - a.aReceber || a.nome.localeCompare(b.nome),
  );
  // ⚠️ O total vem do SERVIDOR (`q.data.totais`), não somado aqui: era o único número de dinheiro
  // da tela calculado no navegador, e no dia em que esta lista ganhasse paginação ele viraria uma
  // soma parcial apresentada como total.
  const t = q.data.totais;

  return (
    <div className="rounded-lg border">
      <div className="border-b p-3">
        <h2 className="text-sm font-semibold">Visão geral — todos os clientes</h2>
        <p className="text-xs text-muted-foreground">
          Cobrado {formatBRL(t.cobrado)} · recebido {formatBRL(t.recebido)} · glosa {formatBRL(t.glosa)} · a receber {formatBRL(t.aReceber)}
          {t.aReceberAtrasado > 0 && <span className="text-destructive"> · {formatBRL(t.aReceberAtrasado)} passou do prazo</span>}
          {t.glosaSemRecurso > 0 && <span className="text-destructive"> · {formatBRL(t.glosaSemRecurso)} de glosa sem recurso</span>}
        </p>
      </div>
      <Table rotulo="Conciliação por cliente">
        <THead>
          <TR>
            <TH>Cliente</TH>
            <TH className="text-right">Consultas</TH>
            <TH className="text-right">Cirurgias</TH>
            <TH className="text-right">Cobrado</TH>
            <TH className="text-right">Recebido</TH>
            <TH className="text-right">Glosa</TH>
            <TH className="text-right">A receber</TH>
            <TH className="text-right">Passou do prazo</TH>
            <TH className="text-right">Glosa sem recurso</TH>
            <TH>Pendências</TH>
            <TH>Última importação</TH>
          </TR>
        </THead>
        <tbody>
          {linhas.map((c) => {
            const pendencias = [
              c.semValor > 0 && `${c.semValor} sem valor`,
              c.semAtendimento > 0 && `${c.semAtendimento} sem atendimento`,
              c.pendenciasDePara > 0 && `${c.pendenciasDePara} a ligar`,
              c.atrasadas > 0 && `${c.atrasadas} passou do prazo`,
              c.recursosSemResposta > 0 && `${c.recursosSemResposta} recurso(s) sem resposta`,
              c.recebidoSemProducao !== 0 && `${formatBRL(c.recebidoSemProducao)} sem cirurgia`,
            ].filter(Boolean);
            return (
              <TR key={c.clienteId}>
                <TD>
                  <Button variant="ghost" className="min-h-11 px-2 font-medium" onClick={() => onEscolher(c.clienteId, c.cirurgias > 0)}>
                    {c.nome}
                  </Button>
                </TD>
                <TD className="text-right">{c.consultas}</TD>
                <TD className="text-right">{c.cirurgias}</TD>
                <TD className="whitespace-nowrap text-right">{formatBRL(c.cobrado)}</TD>
                <TD className="whitespace-nowrap text-right">{formatBRL(c.recebido)}</TD>
                <TD className={`whitespace-nowrap text-right ${c.glosa > 0 ? "text-destructive" : ""}`}>{formatBRL(c.glosa)}</TD>
                <TD className="whitespace-nowrap text-right">{formatBRL(c.aReceber)}</TD>
                <TD className={`whitespace-nowrap text-right ${c.aReceberAtrasado > 0 ? "text-destructive" : ""}`}>
                  {c.aReceberAtrasado > 0 ? formatBRL(c.aReceberAtrasado) : "—"}
                </TD>
                {/* Glosa que ninguém recorreu: dinheiro perdido por omissão, cliente a cliente. */}
                <TD className={`whitespace-nowrap text-right ${c.glosaSemRecurso > 0 ? "font-medium text-destructive" : ""}`}>
                  {c.glosaSemRecurso > 0 ? formatBRL(c.glosaSemRecurso) : "—"}
                </TD>
                <TD className="text-xs text-warning">{pendencias.join(" · ") || <span className="text-muted-foreground">—</span>}</TD>
                <TD className="text-xs text-muted-foreground">{c.ultimaImportacao ? dataUTC(c.ultimaImportacao.em) : "—"}</TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
