import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { MoneyInput } from "../../components/ui/money-input";
import { formatBRL, parseBRL } from "../../lib/masks";

type CampoTipo = "money" | "percent" | "textarea" | "text";

/** Infere o tipo do campo pelo nome — para o formulário ficar "inteligente" (dinheiro, %, texto longo). */
function campoTipo(nome: string): CampoTipo {
  const n = nome.toLowerCase();
  if (/(valor|total|faturad|glosad|recuperad|investiment|honorari|receita|custo|pre[cç]o|mensalidade)/.test(n)) return "money";
  if (/(percentual|percent|taxa|%)/.test(n)) return "percent";
  if (
    /(objetivo|atividade|entregav|escopo|prazo|observ|situacao|situa[cç][aã]o|ponto|oportunidad|recomenda|motivo|acoe|a[cç][oõ]e|destaque|aten[cç][aã]o|proximo|pr[oó]ximo|indicador|descric|descri[cç][aã]o|resumo|tema|pauta|decis|conteudo|conte[uú]do|licoe|li[cç][oõ]e|topico|t[oó]pico|beneficio|benef[ií]cio|analise|an[aá]lise|diretriz)/.test(n)
  )
    return "textarea";
  return "text";
}

/** Rótulo legível a partir do nome do campo: "total_faturado" → "Total faturado". */
function rotulo(nome: string): string {
  const s = nome.replace(/[_.]/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Formulário de preenchimento INTELIGENTE (genérico): rótulos legíveis + tipo de campo inferido
 * pelo nome (dinheiro com `MoneyInput`, % , texto longo com `Textarea`). Usado por todos os
 * modelos "preencher campos" (Escopo, Diagnóstico, Relatórios, Onboarding, Checklist, etc.).
 */
export function SmartCampos({
  campos,
  vars,
  setVars,
}: {
  campos: string[];
  vars: Record<string, string>;
  setVars: (fn: (s: Record<string, string>) => Record<string, string>) => void;
}) {
  const set = (nome: string, v: string) => setVars((s) => ({ ...s, [nome]: v }));

  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3.5">
      {campos.map((nome) => {
        const tipo = campoTipo(nome);
        const id = `campo-${nome}`;
        return (
          <div key={nome} className="space-y-1">
            <Label htmlFor={id} className="text-xs" hint={`O que você digitar aqui substitui {{${nome}}} no documento ao gerar.`}>
              {rotulo(nome)}
            </Label>
            {tipo === "money" ? (
              <MoneyInput
                id={id}
                value={parseBRL(vars[nome] ?? "") ?? undefined}
                onChange={(v) => set(nome, v != null ? formatBRL(v) : "")}
                className="h-9"
              />
            ) : tipo === "textarea" ? (
              <Textarea id={id} rows={2} value={vars[nome] ?? ""} onChange={(e) => set(nome, e.target.value)} />
            ) : (
              <Input
                id={id}
                autoComplete="off"
                placeholder={tipo === "percent" ? "Ex.: 3,5%" : undefined}
                value={vars[nome] ?? ""}
                onChange={(e) => set(nome, e.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
