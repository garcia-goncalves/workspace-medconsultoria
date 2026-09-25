import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { cn } from "@app/ui";
import { trpc, type RouterOutputs } from "../../lib/trpc";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { EmptyState } from "../../components/ui/empty-state";
import { QueryError } from "../../components/ui/query-error";
import { DataTable, type Coluna } from "../../components/ui/data-table";
import { periodoDoPreset, type PresetPeriodo } from "./relatorio-periodo";

type Linha = RouterOutputs["tarefas"]["relatorioEntregas"][number];

const PRESETS: { chave: PresetPeriodo; label: string }[] = [
  { chave: "MES_ATUAL", label: "Este mês" },
  { chave: "MES_ANTERIOR", label: "Mês passado" },
  { chave: "PERSONALIZADO", label: "Personalizado" },
];

/** Relatório de entregas da equipe (ADMIN+): por pessoa, no período escolhido. */
export function RelatorioEntregas() {
  const [preset, setPreset] = useState<PresetPeriodo>("MES_ATUAL");
  const [personalizado, setPersonalizado] = useState(() => periodoDoPreset("MES_ATUAL", new Date()));
  const periodo = useMemo(
    () => (preset === "PERSONALIZADO" ? personalizado : periodoDoPreset(preset, new Date())),
    [preset, personalizado],
  );
  const valido = !!periodo.de && !!periodo.ate && periodo.de <= periodo.ate;

  // "AAAA-MM-DD" → meia-noite UTC, o mesmo formato date-only que o servidor espera.
  const relatorio = trpc.tarefas.relatorioEntregas.useQuery({ de: new Date(periodo.de), ate: new Date(periodo.ate) }, { enabled: valido });

  const numero = (n: number, destaque?: boolean) => (
    <span className={cn("tabular-nums", destaque && n > 0 && "font-medium text-destructive")}>{n}</span>
  );
  const colunas: Coluna<Linha>[] = [
    {
      chave: "nome",
      cabecalho: "Pessoa",
      principal: true,
      valorOrdenacao: (l) => l.nome,
      render: (l) => <span className="font-medium">{l.nome}</span>,
    },
    {
      chave: "concluidas",
      cabecalho: "Concluídas",
      alinhamento: "direita",
      valorOrdenacao: (l) => l.concluidas,
      render: (l) => numero(l.concluidas),
    },
    { chave: "noPrazo", cabecalho: "No prazo", alinhamento: "direita", valorOrdenacao: (l) => l.noPrazo, render: (l) => numero(l.noPrazo) },
    {
      chave: "atrasadas",
      cabecalho: "Com atraso",
      alinhamento: "direita",
      valorOrdenacao: (l) => l.atrasadas,
      render: (l) => numero(l.atrasadas, true),
    },
    {
      chave: "semPrazo",
      cabecalho: "Sem prazo",
      alinhamento: "direita",
      ocultaEmCelular: true,
      valorOrdenacao: (l) => l.semPrazo,
      render: (l) => numero(l.semPrazo),
    },
    {
      chave: "abertasAtrasadasHoje",
      cabecalho: "Atrasadas hoje",
      alinhamento: "direita",
      valorOrdenacao: (l) => l.abertasAtrasadasHoje,
      render: (l) => numero(l.abertasAtrasadasHoje, true),
    },
    {
      chave: "cartoesConcluidos",
      cabecalho: "Cartões concluídos",
      alinhamento: "direita",
      valorOrdenacao: (l) => l.cartoesConcluidos,
      render: (l) => numero(l.cartoesConcluidos),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="relatorio-periodo">Período</Label>
          <Select
            id="relatorio-periodo"
            value={preset}
            onChange={(e) => setPreset(e.target.value as PresetPeriodo)}
            className="w-full sm:w-44"
          >
            {PRESETS.map((p) => (
              <option key={p.chave} value={p.chave}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        {preset === "PERSONALIZADO" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="relatorio-de">De</Label>
              <Input
                id="relatorio-de"
                type="date"
                value={personalizado.de}
                onChange={(e) => setPersonalizado((p) => ({ ...p, de: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="relatorio-ate">Até</Label>
              <Input
                id="relatorio-ate"
                type="date"
                value={personalizado.ate}
                onChange={(e) => setPersonalizado((p) => ({ ...p, ate: e.target.value }))}
              />
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Tarefa com várias pessoas conta para cada uma. “Atrasadas hoje” não depende do período. Cartões: concluídos com a última alteração
        no período.
      </p>

      {!valido ? (
        <p className="text-sm text-destructive">A data inicial precisa vir antes da final.</p>
      ) : relatorio.isError ? (
        <QueryError onRetry={() => relatorio.refetch()} />
      ) : (
        <DataTable
          dados={relatorio.data ?? []}
          colunas={colunas}
          chaveLinha={(l) => l.userId}
          carregando={relatorio.isLoading}
          linhasEsqueleto={4}
          vazio={<EmptyState icon={BarChart3} title="Nada no período" description="Ninguém da equipe tem entregas neste período." />}
        />
      )}
    </div>
  );
}
