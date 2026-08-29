import * as React from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@app/ui";
import { Table, THead, TH, TR, TD } from "./table";
import { TableSkeleton } from "./skeleton";
import { ordenarPor, proximaOrdenacao, type DirecaoOrdenacao, type OrdenacaoAtual } from "./data-table-ordenacao";

export type AlinhamentoColuna = "esquerda" | "centro" | "direita";

/**
 * Uma coluna da `DataTable` como DADO, não como JSX solto — a mesma definição desenha a célula
 * da tabela (telas ≥md) e o par rótulo/valor do cartão (celular).
 */
export type Coluna<T> = {
  /** Identifica a coluna: chave do React e nome que a ordenação ativa lembra. */
  chave: string;
  cabecalho: string;
  /** Conteúdo da célula — a MESMA função é usada na tabela e no cartão. */
  render: (item: T) => React.ReactNode;
  alinhamento?: AlinhamentoColuna;
  /** Some do cartão do celular (continua na tabela) — para o dado secundário que não cabe lá. */
  ocultaEmCelular?: boolean;
  /** Vira o TÍTULO do cartão no celular. Marque no máximo uma coluna; sem nenhuma marcada, usa a 1ª. */
  principal?: boolean;
  /** Valor comparável para ordenar por esta coluna (string, número, data ou nulo). Sem isto, o
   *  cabeçalho não fica clicável — a coluna simplesmente não ordena. */
  valorOrdenacao?: (item: T) => string | number | Date | null;
};

const ALINHAMENTO_CLASSE: Record<AlinhamentoColuna, string> = {
  esquerda: "text-left",
  centro: "text-center",
  direita: "text-right",
};

/**
 * Tabela de dados responsiva: acima de `md` desenha a tabela de verdade (reaproveitando
 * `Table`/`THead`/`TH`/`TR`/`TD`); abaixo de `md` vira uma LISTA DE CARTÕES — a coluna
 * `principal` é o título do cartão, as demais viram pares rótulo/valor, e as marcadas
 * `ocultaEmCelular` somem. É a peça de maior alavancagem do refino móvel: um componente
 * aplicado em toda tela de listagem, em vez de uma solução responsiva por tela.
 *
 * Sem paginação nem filtro embutidos de propósito — cada tela já resolve isso do jeito dela.
 */
export function DataTable<T>({
  dados,
  colunas,
  chaveLinha,
  carregando = false,
  linhasEsqueleto = 5,
  vazio,
  acoes,
  aoClicarLinha,
  className,
}: {
  dados: T[];
  colunas: Coluna<T>[];
  /** Extrai a chave React de cada linha (o id do registro). */
  chaveLinha: (item: T) => string;
  carregando?: boolean;
  linhasEsqueleto?: number;
  /** Mostrado no lugar da tabela quando `dados` está vazio e não está carregando (ex.: `<EmptyState/>`). */
  vazio?: React.ReactNode;
  /** Ações da linha. No desktop viram a última coluna; no cartão, o rodapé — com alvo de toque
   *  de no mínimo 44px, mesmo que o botão passado seja pequeno (`size="sm"`/`"icon"`). */
  acoes?: (item: T) => React.ReactNode;
  aoClicarLinha?: (item: T) => void;
  className?: string;
}) {
  const [ordenacao, setOrdenacao] = React.useState<OrdenacaoAtual | null>(null);

  const direcaoDaColuna = (chave: string): DirecaoOrdenacao | null =>
    ordenacao && ordenacao.chave === chave ? ordenacao.direcao : null;

  const colunaOrdenada = ordenacao ? colunas.find((c) => c.chave === ordenacao.chave) : undefined;
  const linhas = React.useMemo(() => {
    if (!ordenacao || !colunaOrdenada?.valorOrdenacao) return dados;
    return ordenarPor(dados, colunaOrdenada.valorOrdenacao, ordenacao.direcao);
  }, [dados, ordenacao, colunaOrdenada]);

  if (carregando) return <TableSkeleton rows={linhasEsqueleto} cols={colunas.length} />;
  if (dados.length === 0 && vazio) return <>{vazio}</>;

  const colunaPrincipal = colunas.find((c) => c.principal) ?? colunas[0];
  const colunasCartao = colunas.filter((c) => c.chave !== colunaPrincipal?.chave && !c.ocultaEmCelular);

  const alternarOrdenacao = (chave: string) => setOrdenacao((atual) => proximaOrdenacao(atual, chave));

  return (
    <>
      {/* ≥md: tabela de verdade */}
      <div className="hidden md:block">
        <Table className={className}>
          <THead>
            <tr>
              {colunas.map((c) => {
                const ordenavel = !!c.valorOrdenacao;
                const direcaoAtiva = direcaoDaColuna(c.chave);
                const ariaSort: "ascending" | "descending" | "none" | undefined = !ordenavel
                  ? undefined
                  : direcaoAtiva === "asc"
                    ? "ascending"
                    : direcaoAtiva === "desc"
                      ? "descending"
                      : "none";
                return (
                  <TH
                    key={c.chave}
                    aria-sort={ariaSort}
                    className={ALINHAMENTO_CLASSE[c.alinhamento ?? "esquerda"]}
                  >
                    {ordenavel ? (
                      <button
                        type="button"
                        onClick={() => alternarOrdenacao(c.chave)}
                        className={cn(
                          "inline-flex items-center gap-1 font-semibold uppercase tracking-wider outline-none transition-colors hover:text-foreground focus-visible:text-primary",
                          c.alinhamento === "direita" && "flex-row-reverse",
                        )}
                      >
                        {c.cabecalho}
                        {direcaoAtiva === "asc" ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : direcaoAtiva === "desc" ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 text-muted-foreground/50" />
                        )}
                      </button>
                    ) : (
                      c.cabecalho
                    )}
                  </TH>
                );
              })}
              {acoes && <TH className="text-right">Ações</TH>}
            </tr>
          </THead>
          <tbody>
            {linhas.map((item) => (
              <TR
                key={chaveLinha(item)}
                onClick={aoClicarLinha ? () => aoClicarLinha(item) : undefined}
                className={aoClicarLinha ? "cursor-pointer" : undefined}
              >
                {colunas.map((c) => (
                  <TD key={c.chave} className={ALINHAMENTO_CLASSE[c.alinhamento ?? "esquerda"]}>
                    {c.render(item)}
                  </TD>
                ))}
                {acoes && (
                  <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">{acoes(item)}</div>
                  </TD>
                )}
              </TR>
            ))}
          </tbody>
        </Table>
      </div>

      {/* <md: lista de cartões */}
      <div className={cn("flex flex-col gap-3 md:hidden", className)}>
        {linhas.map((item) => (
          <div
            key={chaveLinha(item)}
            onClick={aoClicarLinha ? () => aoClicarLinha(item) : undefined}
            className={cn(
              "rounded-xl border bg-card p-4 shadow-sm",
              aoClicarLinha && "cursor-pointer transition-colors active:bg-accent/40",
            )}
          >
            {colunaPrincipal && (
              <div className="font-semibold text-foreground">{colunaPrincipal.render(item)}</div>
            )}
            {colunasCartao.length > 0 && (
              <dl className="mt-2 flex flex-col gap-1.5 border-t pt-2.5 text-sm">
                {colunasCartao.map((c) => (
                  <div key={c.chave} className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {c.cabecalho}
                    </dt>
                    <dd className="min-w-0 text-right">{c.render(item)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {acoes && (
              // Alvo de toque ≥44px (min-h-11/min-w-11 = 44px na escala do Tailwind), mesmo que
              // o botão passado por quem chama seja pequeno (size="sm"/"icon" ficam com ~36-40px).
              <div
                className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t pt-3 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:min-w-11 [&_a]:items-center [&_a]:justify-center [&_button]:min-h-11 [&_button]:min-w-11"
                onClick={(e) => e.stopPropagation()}
              >
                {acoes(item)}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
