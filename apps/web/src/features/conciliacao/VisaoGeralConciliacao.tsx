import { useMemo, useState } from "react";
import { FileSpreadsheet, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@app/ui";
import { trpc } from "../../lib/trpc";
import type { RouterOutputs } from "../../lib/trpc";
import { EmptyState } from "../../components/ui/empty-state";
import { Table, THead, TH, TR, TD } from "../../components/ui/table";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { formatBRL } from "../../lib/masks";
import { dataUTC } from "../../lib/format-date";
import { ordenarPor, type DirecaoOrdenacao, type OrdenacaoAtual } from "../../components/ui/data-table-ordenacao";
import { proximaOrdenacaoVisaoGeral, type ChaveOrdenacaoVisaoGeral } from "./visao-geral-ordenacao";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";

type LinhaVisaoGeral = RouterOutputs["conciliacao"]["visaoGeral"]["clientes"][number];

/** Uma coluna ordenável do cabeçalho: o rótulo mostrado e como extrair o valor comparável da linha. */
const COLUNAS: { chave: ChaveOrdenacaoVisaoGeral; rotulo: string; valor: (l: LinhaVisaoGeral) => string | number }[] = [
  { chave: "cliente", rotulo: "Cliente", valor: (l) => l.nome },
  { chave: "cobrado", rotulo: "Cobrado", valor: (l) => l.cobrado },
  { chave: "recebido", rotulo: "Recebido", valor: (l) => l.recebido },
  { chave: "glosa", rotulo: "Glosa", valor: (l) => l.glosa },
  { chave: "aReceber", rotulo: "A receber", valor: (l) => l.aReceber },
  { chave: "aReceberAtrasado", rotulo: "Passou do prazo", valor: (l) => l.aReceberAtrasado },
  { chave: "glosaSemRecurso", rotulo: "Glosa sem recurso", valor: (l) => l.glosaSemRecurso },
];

/**
 * A tabela desta tela não vira cartão no celular (rola na horizontal — `Table` já cuida disso), e
 * os cabeçalhos-botão continuam clicáveis lá dentro. Este `<select>` some acima de `md` porque é
 * um atalho: evita ter de rolar até o cabeçalho certo para trocar a ordenação numa tela pequena.
 * Uma opção por coluna × direção — `padrao` volta à ordem do servidor (glosa + atraso primeiro).
 */
const OPCOES_ORDENACAO_MOBILE: { valor: string; rotulo: string }[] = [
  { valor: "padrao", rotulo: "Padrão (mais urgente primeiro)" },
  ...COLUNAS.flatMap((c) =>
    c.chave === "cliente"
      ? [
          { valor: `${c.chave}:asc`, rotulo: "Cliente (A → Z)" },
          { valor: `${c.chave}:desc`, rotulo: "Cliente (Z → A)" },
        ]
      : [
          { valor: `${c.chave}:desc`, rotulo: `${c.rotulo} (maior primeiro)` },
          { valor: `${c.chave}:asc`, rotulo: `${c.rotulo} (menor primeiro)` },
        ],
  ),
];

/** Cabeçalho clicável de uma coluna ordenável: seta indica a direção ativa, `aria-sort` no `<th>`. */
function ThOrdenavel({
  chave,
  rotulo,
  ordenacao,
  onOrdenar,
  direita = false,
}: {
  chave: ChaveOrdenacaoVisaoGeral;
  rotulo: string;
  ordenacao: OrdenacaoAtual | null;
  onOrdenar: (chave: ChaveOrdenacaoVisaoGeral) => void;
  direita?: boolean;
}) {
  const direcaoAtiva = ordenacao?.chave === chave ? ordenacao.direcao : null;
  const ariaSort: "ascending" | "descending" | "none" =
    direcaoAtiva === "asc" ? "ascending" : direcaoAtiva === "desc" ? "descending" : "none";
  return (
    <TH aria-sort={ariaSort} className={direita ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onOrdenar(chave)}
        className={cn(
          "inline-flex items-center gap-1 font-semibold uppercase tracking-wider outline-none transition-colors hover:text-foreground focus-visible:text-primary",
          direita && "flex-row-reverse",
        )}
      >
        {rotulo}
        {direcaoAtiva === "asc" ? (
          <ChevronUp className="h-3 w-3" />
        ) : direcaoAtiva === "desc" ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground/50" />
        )}
      </button>
    </TH>
  );
}

/**
 * Todos os clientes com produção, lado a lado — a pergunta da manhã é "onde está o dinheiro
 * parado?", e ela é de N clientes, não de um. Sem clicar em cabeçalho nenhum, a ordem é a do
 * SERVIDOR (`conciliacao-financeira.service.ts`, `visaoGeral`): glosa + atraso primeiro.
 */
export function VisaoGeralConciliacao({ onEscolher }: { onEscolher: (clienteId: string, temCirurgia: boolean) => void }) {
  const q = trpc.conciliacao.visaoGeral.useQuery();
  // `null` = sem clique ainda → mantém a ordem que o servidor mandou (o padrão desta tela).
  const [ordenacao, setOrdenacao] = useState<OrdenacaoAtual | null>(null);

  const colunaAtiva = ordenacao ? COLUNAS.find((c) => c.chave === ordenacao.chave) : undefined;
  const linhas = useMemo(() => {
    const base = q.data?.clientes ?? [];
    if (!ordenacao || !colunaAtiva) return base;
    return ordenarPor(base, colunaAtiva.valor, ordenacao.direcao);
  }, [q.data, ordenacao, colunaAtiva]);

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

  const alternarOrdenacao = (chave: ChaveOrdenacaoVisaoGeral) =>
    setOrdenacao((atual) => proximaOrdenacaoVisaoGeral(atual, chave));

  const valorSelectMobile = ordenacao ? `${ordenacao.chave}:${ordenacao.direcao}` : "padrao";
  const aoEscolherOrdenacaoMobile = (valor: string) => {
    if (valor === "padrao") return setOrdenacao(null);
    const [chave, direcao] = valor.split(":") as [ChaveOrdenacaoVisaoGeral, DirecaoOrdenacao];
    setOrdenacao({ chave, direcao });
  };

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
      {/* A tabela em si já rola na horizontal (`Table`) e os cabeçalhos continuam clicáveis lá
          dentro — este atalho só evita a rolagem para trocar a ordenação numa tela pequena. */}
      <div className="space-y-1 border-b p-3 md:hidden">
        <Label htmlFor="ordenar-visao-geral">Ordenar por</Label>
        <Select id="ordenar-visao-geral" value={valorSelectMobile} onChange={(e) => aoEscolherOrdenacaoMobile(e.target.value)}>
          {OPCOES_ORDENACAO_MOBILE.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </Select>
      </div>
      <Table rotulo="Conciliação por cliente">
        <THead>
          <TR>
            <ThOrdenavel chave="cliente" rotulo="Cliente" ordenacao={ordenacao} onOrdenar={alternarOrdenacao} />
            <TH className="text-right">Consultas</TH>
            <TH className="text-right">Cirurgias</TH>
            <ThOrdenavel chave="cobrado" rotulo="Cobrado" ordenacao={ordenacao} onOrdenar={alternarOrdenacao} direita />
            <ThOrdenavel chave="recebido" rotulo="Recebido" ordenacao={ordenacao} onOrdenar={alternarOrdenacao} direita />
            <ThOrdenavel chave="glosa" rotulo="Glosa" ordenacao={ordenacao} onOrdenar={alternarOrdenacao} direita />
            <ThOrdenavel chave="aReceber" rotulo="A receber" ordenacao={ordenacao} onOrdenar={alternarOrdenacao} direita />
            <ThOrdenavel chave="aReceberAtrasado" rotulo="Passou do prazo" ordenacao={ordenacao} onOrdenar={alternarOrdenacao} direita />
            <ThOrdenavel chave="glosaSemRecurso" rotulo="Glosa sem recurso" ordenacao={ordenacao} onOrdenar={alternarOrdenacao} direita />
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
