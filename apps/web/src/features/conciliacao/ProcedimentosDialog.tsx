import { useState } from "react";
import { Trash2 } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { MoneyInput } from "../../components/ui/money-input";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { toast } from "../../components/ui/toast";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { formatBRL } from "../../lib/masks";

/**
 * O de-para de PROCEDIMENTO: cada procedimento do TASY ganha código e valor do pacote — é daqui
 * que sai o "cobrado" de cada cirurgia. Valor padrão vale para qualquer convênio; o valor por
 * convênio ganha dele (a mesma revascularização vale uma coisa na Unimed e outra no SUS).
 *
 * Mudar um valor aqui vale NA HORA para todas as cirurgias do procedimento, sem retroação: o
 * servidor calcula o cobrado na leitura.
 */
export function ProcedimentosDialog({ clienteId, onClose, onSalvo }: { clienteId: string; onClose: () => void; onSalvo: () => void }) {
  const procedimentos = trpc.conciliacao.procedimentos.useQuery({ clienteId });
  const operadoras = trpc.documentos.operadoras.list.useQuery();
  const utils = trpc.useUtils();

  const salvar = trpc.conciliacao.salvarProcedimento.useMutation({
    onSuccess: (r) => {
      toast(r.removido ? "Valor removido." : "Valor salvo — as cirurgias já usam o novo valor.", "success");
      void utils.conciliacao.procedimentos.invalidate({ clienteId });
      onSalvo();
    },
    onError: (e) => toast(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Procedimentos e valores"
      size="xl"
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Concluído
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        O valor de cada procedimento é o <strong>cobrado</strong> das cirurgias dele. Informe o valor padrão e, se o convênio paga
        diferente, o valor daquele convênio.
      </p>
      {procedimentos.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : procedimentos.error ? (
        <QueryError message={procedimentos.error.message} onRetry={() => void procedimentos.refetch()} />
      ) : procedimentos.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma cirurgia importada ainda.</p>
      ) : (
        <ul className="space-y-3">
          {procedimentos.data.map((p) => (
            <li key={p.procedimento} className="rounded-lg border p-3">
              <p className="text-sm font-medium">
                {p.procedimento} <span className="font-normal text-muted-foreground">· {p.cirurgias} cirurgia(s)</span>
              </p>
              {/* ⚠️ A `key` inclui o que está GRAVADO. O estado dos campos é inicializado da prop
                  uma vez só; sem isto, quando a lista era rebuscada com um valor novo (outra
                  pessoa salvou, ou o de-para mudou) o input continuava mostrando o valor ANTIGO
                  com o "Salvar" aceso — e um clique regravava o velho por cima do novo, em
                  silêncio, mudando o cobrado de todas as cirurgias do procedimento. */}
              <LinhaDeValor
                key={`padrao:${p.padrao?.codigo ?? ""}:${p.padrao?.valor ?? ""}`}
                rotulo="Padrão"
                inicial={p.padrao}
                // O padrão vale para quem NÃO tem valor específico por convênio — daí o total do
                // procedimento menos o que já está coberto por operadora, não o total cru.
                cirurgiasAfetadas={Math.max(
                  p.cirurgias - p.porOperadora.reduce((soma, o) => soma + o.cirurgias, 0),
                  0,
                )}
                pendente={salvar.isPending}
                onSalvar={(codigo, valor) => salvar.mutate({ clienteId, textoBruto: p.procedimento, operadoraId: null, codigo, valor })}
              />
              {p.porOperadora.map((o) => (
                <LinhaDeValor
                  key={`${o.operadoraId}:${o.codigo ?? ""}:${o.valor ?? ""}`}
                  rotulo={o.operadora}
                  inicial={{ codigo: o.codigo, valor: o.valor }}
                  cirurgiasAfetadas={o.cirurgias}
                  pendente={salvar.isPending}
                  onSalvar={(codigo, valor) =>
                    salvar.mutate({ clienteId, textoBruto: p.procedimento, operadoraId: o.operadoraId, codigo, valor })
                  }
                  removivel
                />
              ))}
              <NovoPorConvenio
                operadoras={(operadoras.data ?? []).filter((op) => !p.porOperadora.some((o) => o.operadoraId === op.id))}
                pendente={salvar.isPending}
                onAdicionar={(operadoraId, codigo, valor) =>
                  salvar.mutate({ clienteId, textoBruto: p.procedimento, operadoraId, codigo, valor })
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function LinhaDeValor({
  rotulo,
  inicial,
  cirurgiasAfetadas,
  pendente,
  onSalvar,
  removivel,
}: {
  rotulo: string;
  inicial: { codigo: string | null; valor: number | null } | null;
  /** Quantas cirurgias usam este valor hoje — é o número que aparece ao confirmar apagar/mudar. */
  cirurgiasAfetadas: number;
  pendente: boolean;
  onSalvar: (codigo: string | null, valor: number | null) => void;
  removivel?: boolean;
}) {
  const [codigo, setCodigo] = useState(inicial?.codigo ?? "");
  const [valor, setValor] = useState<number | undefined>(inicial?.valor ?? undefined);
  const mudou = codigo !== (inicial?.codigo ?? "") || (valor ?? null) !== (inicial?.valor ?? null);
  const confirm = useConfirm();

  const quantas = `${cirurgiasAfetadas} cirurgia${cirurgiasAfetadas === 1 ? "" : "s"}`;

  async function salvarComConfirmacao() {
    const codigoFinal = codigo.trim() || null;
    const valorFinal = valor ?? null;
    const valorAntes = inicial?.valor ?? null;
    // Só o VALOR entra na conferência — é ele que vira o "cobrado" das cirurgias. Trocar só o
    // código (referência do procedimento) não muda dinheiro nenhum, e mudar valor onde não havia
    // nenhum (valorAntes null) não tira referência de ninguém: nenhum dos dois confirma.
    if (valorAntes !== null && valorFinal !== valorAntes) {
      const apagando = valorFinal === null;
      const ok = await confirm({
        title: apagando ? `Remover o valor de "${rotulo}"` : `Mudar o valor de "${rotulo}"`,
        description: apagando
          ? `${quantas} vão ficar sem valor de referência, e a glosa delas deixa de ser calculada.`
          : `${quantas} vão passar a usar o valor novo na hora, sem retroação.`,
        confirmText: apagando ? "Remover" : "Confirmar",
        variant: apagando ? "destructive" : "default",
      });
      if (!ok) return;
    }
    onSalvar(codigoFinal, valorFinal);
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="w-full text-xs font-medium text-muted-foreground sm:w-40 sm:truncate">{rotulo}</span>
      <Input
        aria-label={`Código — ${rotulo}`}
        className="h-9 w-36"
        maxLength={40}
        placeholder="Código"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
      />
      <MoneyInput aria-label={`Valor — ${rotulo}`} className="h-9 w-40" value={valor} onChange={setValor} />
      <Button size="sm" disabled={!mudou || pendente} onClick={salvarComConfirmacao}>
        Salvar
      </Button>
      {removivel && (
        <Button
          size="sm"
          variant="ghost"
          // A própria feature já usa `min-h-11` nos alvos de toque (tabela, visão geral); este
          // ícone tinha ficado de fora, com ~36px.
          className="min-h-11"
          aria-label={`Remover o valor de ${rotulo}`}
          disabled={pendente}
          onClick={async () => {
            // ⚠️ Não é "limpar um campo": sem valor de referência, o cobrado de TODAS as
            // cirurgias desse procedimento vira "sem valor" e a glosa some junto. Alvo pequeno,
            // ao lado do "Salvar", sem desfazer — confirma antes, como toda ação destrutiva
            // desta casa.
            const ok = await confirm({
              title: "Remover o valor deste convênio",
              description: `${quantas} de "${rotulo}" vão ficar sem valor de referência, e a glosa delas deixa de ser calculada.`,
              confirmText: "Remover",
              variant: "destructive",
            });
            if (ok) onSalvar(null, null);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
      {!inicial && !mudou && <span className="text-xs text-warning">sem valor — as cirurgias ficam "sem valor de referência"</span>}
      {inicial?.valor != null && !mudou && <span className="text-xs text-muted-foreground">{formatBRL(inicial.valor)}</span>}
    </div>
  );
}

function NovoPorConvenio({
  operadoras,
  pendente,
  onAdicionar,
}: {
  operadoras: { id: string; nome: string }[];
  pendente: boolean;
  onAdicionar: (operadoraId: string, codigo: string | null, valor: number | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [operadoraId, setOperadoraId] = useState("");
  const [codigo, setCodigo] = useState("");
  const [valor, setValor] = useState<number | undefined>(undefined);

  if (!aberto) {
    return (
      <Button size="sm" variant="ghost" className="mt-1" onClick={() => setAberto(true)}>
        + Valor diferente para um convênio
      </Button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Select aria-label="Convênio" className="h-9 w-40" value={operadoraId} onChange={(e) => setOperadoraId(e.target.value)}>
        <option value="">Convênio…</option>
        {operadoras.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome}
          </option>
        ))}
      </Select>
      <Input
        aria-label="Código"
        className="h-9 w-36"
        maxLength={40}
        placeholder="Código"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
      />
      <MoneyInput aria-label="Valor" className="h-9 w-40" value={valor} onChange={setValor} />
      <Button
        size="sm"
        disabled={!operadoraId || (valor === undefined && !codigo.trim()) || pendente}
        onClick={() => {
          onAdicionar(operadoraId, codigo.trim() || null, valor ?? null);
          setAberto(false);
          setOperadoraId("");
          setCodigo("");
          setValor(undefined);
        }}
      >
        Adicionar
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAberto(false)}>
        Cancelar
      </Button>
    </div>
  );
}
