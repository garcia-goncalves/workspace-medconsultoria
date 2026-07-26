import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, User } from "lucide-react";
import {
  createContaSchema,
  RECORRENCIA_LABEL,
  type CreateContaInput,
  type ContaTipo,
  type Escopo,
  type Recorrencia,
} from "@app/shared";
import { cn } from "@app/ui";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { MoneyInput } from "../../components/ui/money-input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";
import { Combobox } from "../../components/ui/combobox";

export interface ContaEditavel {
  id: string;
  tipo: ContaTipo;
  escopo: Escopo;
  descricao: string;
  valor: number;
  vencimento: Date;
  categoriaId: string | null;
  clienteId: string | null;
  recorrencia: Recorrencia;
  recorrenciaAte: Date | null;
  observacoes: string | null;
}

const toDateInput = (d?: Date | null): string => (d ? new Date(d).toISOString().slice(0, 10) : "");
// Recorrências oferecidas no form (Diária é rara para contas).
const RECORRENCIAS: Recorrencia[] = ["NENHUMA", "SEMANAL", "MENSAL"];

export function ContaFormDialog({
  open,
  onClose,
  conta,
  tipoPadrao,
  escopoPadrao,
}: {
  open: boolean;
  onClose: () => void;
  conta?: ContaEditavel;
  tipoPadrao?: ContaTipo;
  escopoPadrao?: Escopo;
}) {
  const utils = trpc.useUtils();
  const isEdit = !!conta;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateContaInput>({
    resolver: zodResolver(createContaSchema),
    defaultValues: { tipo: tipoPadrao ?? "PAGAR", escopo: escopoPadrao ?? "EMPRESA", recorrencia: "NENHUMA" },
  });

  const escopo = (watch("escopo") ?? "EMPRESA") as Escopo;
  const recorrencia = (watch("recorrencia") ?? "NENHUMA") as Recorrencia;

  const categorias = trpc.financeiro.categorias.list.useQuery({ escopo }, { enabled: open });
  const clientes = trpc.clientes.list.useQuery(undefined, { enabled: open && escopo === "EMPRESA" });

  useEffect(() => {
    if (!open) return;
    reset({
      tipo: conta?.tipo ?? tipoPadrao ?? "PAGAR",
      escopo: conta?.escopo ?? escopoPadrao ?? "EMPRESA",
      descricao: conta?.descricao ?? "",
      valor: (conta?.valor ?? undefined) as unknown as CreateContaInput["valor"],
      vencimento: toDateInput(conta?.vencimento) as unknown as CreateContaInput["vencimento"],
      categoriaId: conta?.categoriaId ?? "",
      clienteId: conta?.clienteId ?? "",
      recorrencia: conta?.recorrencia ?? "NENHUMA",
      recorrenciaAte: toDateInput(conta?.recorrenciaAte) as unknown as CreateContaInput["recorrenciaAte"],
      observacoes: conta?.observacoes ?? "",
    });
  }, [open, conta, tipoPadrao, escopoPadrao, reset]);

  const invalidate = () => {
    utils.financeiro.contas.list.invalidate();
    utils.financeiro.contas.resumo.invalidate();
    utils.financeiro.contas.agenda.invalidate();
    utils.financeiro.contas.porCategoria.invalidate();
  };
  const create = trpc.financeiro.contas.create.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const update = trpc.financeiro.contas.update.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const pending = create.isPending || update.isPending;

  const onSubmit = (data: CreateContaInput) => {
    if (conta) update.mutate({ id: conta.id, ...data });
    else create.mutate(data);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar conta" : "Nova conta"}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="conta-form" disabled={pending}>
            {isEdit ? "Salvar" : "Criar conta"}
          </Button>
        </>
      }
    >
      <form id="conta-form" onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        {/* Carteira: Empresa × Pessoal (não editável ao editar — moveria a privacidade) */}
        <div className="space-y-1">
          <Label hint="Empresa = contas do negócio. Pessoal = suas contas particulares, separadas.">Carteira</Label>
          <div className="inline-flex w-full rounded-lg border p-0.5">
            {(["EMPRESA", "PESSOAL"] as Escopo[]).map((e) => {
              const on = escopo === e;
              return (
                <button
                  key={e}
                  type="button"
                  disabled={isEdit}
                  onClick={() => setValue("escopo", e, { shouldDirty: true })}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60",
                    on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {e === "EMPRESA" ? <Building2 className="h-4 w-4" /> : <User className="h-4 w-4" />}
                  {e === "EMPRESA" ? "Empresa" : "Pessoal"}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="tipo" hint="A pagar = você vai pagar. A receber = você vai receber.">Tipo</Label>
            <Select id="tipo" {...register("tipo")}>
              <option value="PAGAR">A pagar</option>
              <option value="RECEBER">A receber</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="valor">Valor *</Label>
            <MoneyInput
              id="valor"
              value={watch("valor")}
              onChange={(v) => setValue("valor", v as number, { shouldDirty: true, shouldValidate: true })}
            />
            {errors.valor && <p className="text-xs text-destructive">{errors.valor.message}</p>}
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="descricao">Descrição *</Label>
          <Input id="descricao" autoFocus autoComplete="off" placeholder={escopo === "PESSOAL" ? "Ex.: Aluguel, Mercado…" : "Ex.: Mensalidade, Aluguel…"} {...register("descricao")} />
          {errors.descricao && <p className="text-xs text-destructive">{errors.descricao.message}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="vencimento" hint="Data limite para pagar ou receber esta conta.">Vencimento *</Label>
            <Input id="vencimento" type="date" autoComplete="off" {...register("vencimento")} />
            {errors.vencimento && <p className="text-xs text-destructive">{errors.vencimento.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="categoriaId" hint="Agrupa a conta para organizar os relatórios financeiros.">Categoria</Label>
            <Combobox
              id="categoriaId"
              value={watch("categoriaId") ?? ""}
              onChange={(v) => setValue("categoriaId", v, { shouldDirty: true })}
              options={(categorias.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
              placeholder="Buscar categoria…"
              emptyText="Nenhuma categoria."
            />
          </div>
        </div>

        {/* Recorrência (se repete, a próxima é criada sozinha ao marcar paga) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="recorrencia" hint="Se repete, ao marcar a conta como paga/recebida a próxima já é criada sozinha.">Repete?</Label>
            <Select id="recorrencia" {...register("recorrencia")}>
              {RECORRENCIAS.map((r) => (
                <option key={r} value={r}>
                  {RECORRENCIA_LABEL[r]}
                </option>
              ))}
            </Select>
          </div>
          {recorrencia !== "NENHUMA" && (
            <div className="space-y-1">
              <Label htmlFor="recorrenciaAte" hint="Data em que a repetição para de gerar novas contas.">Repetir até (opcional)</Label>
              <Input id="recorrenciaAte" type="date" autoComplete="off" {...register("recorrenciaAte")} />
            </div>
          )}
        </div>

        {escopo === "EMPRESA" && (
          <div className="space-y-1">
            <Label htmlFor="clienteId" hint="Vincula esta conta a um cliente — útil para relatórios.">Cliente (opcional)</Label>
            <Combobox
              id="clienteId"
              value={watch("clienteId") ?? ""}
              onChange={(v) => setValue("clienteId", v, { shouldDirty: true })}
              options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
              placeholder="Buscar cliente…"
              emptyText="Nenhum cliente encontrado."
            />
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="observacoes">Observações</Label>
          <Textarea id="observacoes" rows={2} autoComplete="off" {...register("observacoes")} />
        </div>

        {(create.error || update.error) && (
          <p className="text-sm text-destructive">{create.error?.message ?? update.error?.message}</p>
        )}
      </form>
    </Modal>
  );
}
