import { useEffect, useState } from "react";
import { Building2, Loader2, Settings2, Stethoscope, UserPlus } from "lucide-react";
import type { CelulaGrade } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { MoneyInput } from "../../components/ui/money-input";
import { formatBRL } from "../../lib/masks";
import { OperadorasDialog } from "./OperadorasDialog";

/** A operadora escolhida — id para a grade, nome para o corpo do documento. */
export type OperadoraEscolhida = { id: string; nome: string } | null;

/**
 * Formulário PRÓPRIO da Proposta de credenciamento (≠ Proposta comercial).
 *
 * **Uma proposta, uma operadora** (ADR-126). O papel real da Thaís negocia com uma operadora de
 * cada vez: cada uma tem o próprio prazo, a própria documentação e o próprio desfecho, e uma
 * proposta com três operadoras dentro não pode ser aceita "pela metade". Credenciar em três =
 * três propostas, três números na sequência dela.
 *
 * **A grade médico × operadora não mudou** (ADR-104): o credenciamento continua sendo por
 * pessoa, cada cruzamento com preço próprio e acompanhamento até a aprovação. O que se recorta
 * aqui é o DOCUMENTO — escolhida a operadora, marcam-se os médicos que entram nesta proposta.
 *
 * Cliente **sem médico cadastrado** cai no formato antigo (operadora + valor): a proposta sai
 * assim mesmo, e a grade se monta quando os médicos existirem. Bloquear a venda por falta de
 * cadastro travaria o negócio por um detalhe de ordem.
 */
export function CredenciamentoPicker({
  clienteId,
  celulas,
  setCelulas,
  operadora,
  setOperadora,
  valorOperadora,
  setValorOperadora,
  onModoGrade,
}: {
  clienteId: string;
  celulas: CelulaGrade[];
  setCelulas: (v: CelulaGrade[]) => void;
  operadora: OperadoraEscolhida;
  setOperadora: (v: OperadoraEscolhida) => void;
  valorOperadora: number;
  setValorOperadora: (v: number) => void;
  /** Avisa o diálogo qual formato está em uso, para ele mandar a grade ou a operadora solta. */
  onModoGrade: (v: boolean) => void;
}) {
  const grade = trpc.credenciamento.grade.useQuery({ clienteId }, { enabled: !!clienteId });
  // Só as operadoras marcadas para CREDENCIAMENTO (ADR-126).
  const catalogo = trpc.documentos.operadoras.list.useQuery({ uso: "CREDENCIAMENTO" });
  const [gerir, setGerir] = useState(false);

  // A grade traz também o médico DESATIVADO que ainda tem processo em curso, para o card de
  // andamento na ficha não perdê-lo de vista. Aqui é o contrário: proposta é venda nova, e não
  // se vende credenciamento de quem saiu da lista.
  const profissionais = (grade.data?.profissionais ?? []).filter((p) => p.ativo);
  const temGrade = !!clienteId && profissionais.length > 0;

  useEffect(() => {
    onModoGrade(temGrade);
  }, [temGrade, onModoGrade]);

  // A lista de onde se escolhe: no modo grade vem do cliente (inclui operadora já com processo,
  // mesmo desmarcada depois); sem cliente, vem do catálogo.
  const opcoes = temGrade ? (grade.data?.operadoras ?? []) : (catalogo.data ?? []).map((o) => ({ id: o.id, nome: o.nome }));

  // Trocar de operadora descarta os cruzamentos da anterior: a proposta é de UMA, e deixar
  // células órfãs faria o documento sair com médico credenciado onde ninguém escolheu.
  const escolher = (id: string) => {
    const achada = opcoes.find((o) => o.id === id) ?? null;
    setOperadora(achada);
    setCelulas([]);
  };

  const escolhida = operadora?.id ?? "";

  const seletorOperadora = (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor="cred-operadora"
          className="flex items-center gap-1.5"
          hint="Cada proposta de credenciamento é de UMA operadora. Para credenciar em várias, gere uma proposta por operadora — cada uma recebe o próprio número."
        >
          <Building2 className="h-4 w-4 text-primary" /> Operadora desta proposta *
        </Label>
        <button
          type="button"
          onClick={() => setGerir(true)}
          className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Settings2 className="h-3.5 w-3.5" /> Gerenciar operadoras
        </button>
      </div>
      {catalogo.isLoading || (temGrade && grade.isLoading) ? (
        <div className="flex justify-center rounded-lg border py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : opcoes.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
          Catálogo de operadoras vazio — use “Gerenciar operadoras” para adicionar.
        </p>
      ) : (
        <Select id="cred-operadora" value={escolhida} onChange={(e) => escolher(e.target.value)}>
          <option value="">Escolha a operadora…</option>
          {opcoes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </Select>
      )}
      <p className="text-xs text-muted-foreground">
        Uma proposta por operadora — cada uma recebe o próprio número na sequência.
      </p>
    </div>
  );

  if (grade.isLoading && clienteId) {
    return (
      <div className="flex justify-center rounded-lg border py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Modo grade: escolhida a operadora, marcam-se os médicos ────────────────

  if (temGrade) {
    const marcado = (profissionalId: string) => celulas.find((c) => c.profissionalId === profissionalId);
    const alternar = (profissionalId: string) => {
      if (!operadora) return;
      if (marcado(profissionalId)) {
        setCelulas(celulas.filter((c) => c.profissionalId !== profissionalId));
        return;
      }
      setCelulas([...celulas, { profissionalId, operadoraId: operadora.id, valor: valorOperadora || 0 }]);
    };
    const mudarValor = (profissionalId: string, valor: number) =>
      setCelulas(celulas.map((c) => (c.profissionalId === profissionalId ? { ...c, valor } : c)));
    const todos = () => {
      if (!operadora) return;
      if (celulas.length === profissionais.length) {
        setCelulas([]);
        return;
      }
      setCelulas(
        profissionais.map(
          (p) => marcado(p.id) ?? { profissionalId: p.id, operadoraId: operadora.id, valor: valorOperadora || 0 },
        ),
      );
    };
    const total = celulas.reduce((s, c) => s + (c.valor || 0), 0);

    return (
      <div className="space-y-3">
        {seletorOperadora}

        <div className="space-y-1">
          <Label htmlFor="cred-padrao" hint="Preenche o valor de cada médico que você marcar. Depois dá para mudar um a um.">
            Valor padrão por credenciamento
          </Label>
          <MoneyInput id="cred-padrao" value={valorOperadora} onChange={(v) => setValorOperadora(v ?? 0)} className="h-9" />
        </div>

        {!operadora ? (
          <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            Escolha a operadora acima para marcar quais médicos entram nesta proposta.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <Label
                className="flex items-center gap-1.5"
                hint="O credenciamento é por pessoa: marque quais médicos entram nesta proposta e o valor de cada um."
              >
                <Stethoscope className="h-4 w-4 text-primary" /> Médicos em {operadora.nome} *
              </Label>
              <button
                type="button"
                onClick={todos}
                className="rounded-md border px-2 py-0.5 text-xs font-medium transition-colors hover:bg-accent"
              >
                {celulas.length === profissionais.length ? "Nenhum" : "Todos"}
              </button>
            </div>

            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2">
              {profissionais.map((p) => {
                const celula = marcado(p.id);
                return (
                  <div key={p.id} className="flex items-center gap-2 rounded-md px-1.5 py-1">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={!!celula}
                        onChange={() => alternar(p.id)}
                        className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                      />
                      <span className="min-w-0">
                        <span className={celula ? "block truncate font-medium" : "block truncate"}>{p.nome}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[p.especialidade, [p.conselho, p.conselhoNumero, p.conselhoUf].filter(Boolean).join(" ")]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </label>
                    {celula && (
                      <MoneyInput
                        value={celula.valor}
                        onChange={(v) => mudarValor(p.id, v ?? 0)}
                        className="h-8 w-32 shrink-0 text-right"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {celulas.length} médico(s) em {operadora.nome}
                {total > 0 ? " · total" : ""}
              </span>
              {total > 0 && <span className="ml-1 font-semibold text-primary">{formatBRL(total)}</span>}
            </div>
          </>
        )}

        <OperadorasDialog open={gerir} onClose={() => setGerir(false)} />
      </div>
    );
  }

  // ── Modo antigo: cliente sem médico cadastrado ─────────────────────────────

  return (
    <div className="space-y-3">
      {seletorOperadora}

      {clienteId && (
        <p className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/20 p-2.5 text-xs text-muted-foreground">
          <UserPlus className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Este cliente ainda não tem médicos cadastrados. Cadastre-os na ficha dele para cobrar por
            <strong> médico</strong> — por enquanto, a proposta sai com um valor único para a operadora.
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cred-valor" hint="Valor cobrado do cliente pelo credenciamento nesta operadora.">
            Investimento
          </Label>
          <MoneyInput id="cred-valor" value={valorOperadora} onChange={(v) => setValorOperadora(v ?? 0)} className="h-9" />
        </div>
        <div className="flex flex-col justify-end">
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{operadora ? operadora.nome : "Nenhuma operadora escolhida"}</span>
            {valorOperadora > 0 && <span className="ml-1 font-semibold text-primary">{formatBRL(valorOperadora)}</span>}
          </div>
        </div>
      </div>

      <OperadorasDialog open={gerir} onClose={() => setGerir(false)} />
    </div>
  );
}
