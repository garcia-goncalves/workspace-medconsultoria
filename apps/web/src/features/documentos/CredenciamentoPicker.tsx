import { useEffect, useState } from "react";
import { Building2, Loader2, Settings2, Stethoscope, UserPlus } from "lucide-react";
import type { CelulaGrade } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Label } from "../../components/ui/label";
import { MoneyInput } from "../../components/ui/money-input";
import { formatBRL } from "../../lib/masks";
import { OperadorasDialog } from "./OperadorasDialog";

/**
 * Formulário PRÓPRIO da Proposta de credenciamento (≠ Proposta comercial).
 *
 * **A grade médico × operadora** (ADR-104): a operadora credencia PESSOAS, então cada
 * cruzamento — este médico, nesta operadora — tem preço próprio e vira uma linha que a Thaís
 * acompanha até a aprovação. Substitui o "valor por operadora × quantidade", que somava certo
 * e não dizia nada sobre quem estava sendo credenciado onde.
 *
 * Cliente **sem médico cadastrado** cai no formato antigo (marcar operadoras + valor por
 * operadora): a proposta sai assim mesmo, e a grade se monta quando os médicos existirem.
 * Bloquear a proposta por falta de cadastro travaria a venda por um detalhe de ordem.
 */
export function CredenciamentoPicker({
  clienteId,
  celulas,
  setCelulas,
  operadoras,
  setOperadoras,
  valorOperadora,
  setValorOperadora,
  onModoGrade,
}: {
  clienteId: string;
  celulas: CelulaGrade[];
  setCelulas: (v: CelulaGrade[]) => void;
  operadoras: string[];
  setOperadoras: (v: string[]) => void;
  valorOperadora: number;
  setValorOperadora: (v: number) => void;
  /** Avisa o diálogo qual formato está em uso, para ele mandar a grade ou as operadoras. */
  onModoGrade: (v: boolean) => void;
}) {
  const grade = trpc.credenciamento.grade.useQuery({ clienteId }, { enabled: !!clienteId });
  const catalogo = trpc.documentos.operadoras.list.useQuery();
  const [gerir, setGerir] = useState(false);

  // A grade traz também o médico DESATIVADO que ainda tem processo em curso, para o card de
  // andamento na ficha não perdê-lo de vista. Aqui é o contrário: proposta é venda nova, e não
  // se vende credenciamento de quem saiu da lista.
  const profissionais = (grade.data?.profissionais ?? []).filter((p) => p.ativo);
  const temGrade = !!clienteId && profissionais.length > 0;

  useEffect(() => {
    onModoGrade(temGrade);
  }, [temGrade, onModoGrade]);

  // ── Modo grade ─────────────────────────────────────────────────────────────

  const chave = (profissionalId: string, operadoraId: string) => `${profissionalId}|${operadoraId}`;
  const marcadas = new Map(celulas.map((c) => [chave(c.profissionalId, c.operadoraId), c]));
  const valorDe = (profissionalId: string, operadoraId: string) =>
    marcadas.get(chave(profissionalId, operadoraId))?.valor;

  const alternar = (profissionalId: string, operadoraId: string) => {
    const k = chave(profissionalId, operadoraId);
    if (marcadas.has(k)) {
      setCelulas(celulas.filter((c) => chave(c.profissionalId, c.operadoraId) !== k));
      return;
    }
    setCelulas([...celulas, { profissionalId, operadoraId, valor: valorOperadora || 0 }]);
  };

  const mudarValor = (profissionalId: string, operadoraId: string, valor: number) => {
    const k = chave(profissionalId, operadoraId);
    setCelulas(celulas.map((c) => (chave(c.profissionalId, c.operadoraId) === k ? { ...c, valor } : c)));
  };

  /** Marca (ou desmarca) todas as operadoras de um médico de uma vez. */
  const alternarTodas = (profissionalId: string) => {
    const doMedico = celulas.filter((c) => c.profissionalId === profissionalId);
    const ops = grade.data?.operadoras ?? [];
    if (doMedico.length === ops.length) {
      setCelulas(celulas.filter((c) => c.profissionalId !== profissionalId));
      return;
    }
    const jaTem = new Set(doMedico.map((c) => c.operadoraId));
    setCelulas([
      ...celulas,
      ...ops
        .filter((o) => !jaTem.has(o.id))
        .map((o) => ({ profissionalId, operadoraId: o.id, valor: valorOperadora || 0 })),
    ]);
  };

  const total = celulas.reduce((s, c) => s + (c.valor || 0), 0);

  if (grade.isLoading && clienteId) {
    return (
      <div className="flex justify-center rounded-lg border py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (temGrade) {
    const ops = grade.data?.operadoras ?? [];
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label
            className="flex items-center gap-1.5"
            hint="O credenciamento é por pessoa: marque, para cada médico, as operadoras em que ele será credenciado. Cada cruzamento tem preço próprio."
          >
            <Stethoscope className="h-4 w-4 text-primary" /> Grade de credenciamento *
          </Label>
          <button
            type="button"
            onClick={() => setGerir(true)}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Settings2 className="h-3.5 w-3.5" /> Gerenciar operadoras
          </button>
        </div>

        <div className="space-y-1">
          <Label htmlFor="cred-padrao" hint="Preenche o valor de cada cruzamento que você marcar. Depois dá para mudar um a um.">
            Valor padrão por credenciamento
          </Label>
          <MoneyInput id="cred-padrao" value={valorOperadora} onChange={(v) => setValorOperadora(v ?? 0)} className="h-9" />
        </div>

        {ops.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            Catálogo de operadoras vazio — use “Gerenciar operadoras” para adicionar.
          </p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border p-2">
            {profissionais.map((p) => {
              const doMedico = celulas.filter((c) => c.profissionalId === p.id);
              const somaMedico = doMedico.reduce((s, c) => s + (c.valor || 0), 0);
              return (
                <div key={p.id} className="rounded-lg border bg-card p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[p.especialidade, [p.conselho, p.conselhoNumero, p.conselhoUf].filter(Boolean).join(" ")]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {doMedico.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {doMedico.length} · <span className="font-semibold text-primary">{formatBRL(somaMedico)}</span>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => alternarTodas(p.id)}
                        className="rounded-md border px-2 py-0.5 text-xs font-medium transition-colors hover:bg-accent"
                      >
                        {doMedico.length === ops.length ? "Nenhuma" : "Todas"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1">
                    {ops.map((o) => {
                      const valor = valorDe(p.id, o.id);
                      const marcada = valor !== undefined;
                      return (
                        <div key={o.id} className="flex items-center gap-2">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent">
                            <input
                              type="checkbox"
                              checked={marcada}
                              onChange={() => alternar(p.id, o.id)}
                              className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                            />
                            <span className={marcada ? "truncate font-medium" : "truncate"}>{o.nome}</span>
                          </label>
                          {marcada && (
                            <MoneyInput
                              value={valor}
                              onChange={(v) => mudarValor(p.id, o.id, v ?? 0)}
                              className="h-8 w-32 shrink-0 text-right"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {celulas.length} credenciamento(s){total > 0 ? " · total" : ""}
          </span>
          {total > 0 && <span className="ml-1 font-semibold text-primary">{formatBRL(total)}</span>}
        </div>

        <OperadorasDialog open={gerir} onClose={() => setGerir(false)} />
      </div>
    );
  }

  // ── Modo antigo: cliente sem médico cadastrado ─────────────────────────────

  const marcada = (nome: string) => operadoras.includes(nome);
  const toggle = (nome: string) =>
    setOperadoras(marcada(nome) ? operadoras.filter((n) => n !== nome) : [...operadoras, nome]);
  const totalSimples = valorOperadora * operadoras.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5" hint="Marque os convênios/operadoras para os quais este cliente será credenciado.">
          <Building2 className="h-4 w-4 text-primary" /> Operadoras a credenciar *
        </Label>
        <button
          type="button"
          onClick={() => setGerir(true)}
          className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Settings2 className="h-3.5 w-3.5" /> Gerenciar operadoras
        </button>
      </div>

      {clienteId && (
        <p className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/20 p-2.5 text-xs text-muted-foreground">
          <UserPlus className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Este cliente ainda não tem médicos cadastrados. Cadastre-os na ficha dele para cobrar por
            <strong> médico × operadora</strong> — por enquanto, a proposta sai com um valor por operadora.
          </span>
        </p>
      )}

      <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-1.5">
        {catalogo.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (catalogo.data ?? []).length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">
            Catálogo vazio — use “Gerenciar operadoras” para adicionar.
          </p>
        ) : (
          (catalogo.data ?? []).map((op) => (
            <label key={op.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
              <input
                type="checkbox"
                checked={marcada(op.nome)}
                onChange={() => toggle(op.nome)}
                className="h-4 w-4 shrink-0 accent-[var(--primary)]"
              />
              <span className={marcada(op.nome) ? "font-medium" : ""}>{op.nome}</span>
            </label>
          ))
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cred-valor" hint="Valor cobrado do cliente por cada operadora selecionada acima.">Investimento por operadora</Label>
          <MoneyInput id="cred-valor" value={valorOperadora} onChange={(v) => setValorOperadora(v ?? 0)} className="h-9" />
        </div>
        <div className="flex flex-col justify-end">
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {operadoras.length} selecionada(s){valorOperadora > 0 ? " · total" : ""}
            </span>
            {valorOperadora > 0 && <span className="ml-1 font-semibold text-primary">{formatBRL(totalSimples)}</span>}
          </div>
        </div>
      </div>

      <OperadorasDialog open={gerir} onClose={() => setGerir(false)} />
    </div>
  );
}
