import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createTarefaSchema, TAREFA_PRIORIDADE_LABEL, tarefaPrioridadeEnum, type CreateTarefaInput, type TarefaPrioridade } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";
import { Combobox } from "../../components/ui/combobox";

export interface TarefaEditavel {
  id: string;
  titulo: string;
  descricao: string | null;
  responsavelId: string;
  prazo: Date | string | null;
  prioridade: TarefaPrioridade;
  clienteId: string | null;
  projetoId: string | null;
}

/** Contexto pré-preenchido ao delegar a partir de uma ficha/projeto. */
export interface TarefaDefaults {
  clienteId?: string;
  projetoId?: string;
  responsavelId?: string;
}

const toDateInput = (d?: Date | string | null): string => (d ? new Date(d).toISOString().slice(0, 10) : "");
const PRIORIDADES = tarefaPrioridadeEnum.options;

export function TarefaFormDialog({
  open,
  onClose,
  tarefa,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  tarefa?: TarefaEditavel;
  defaults?: TarefaDefaults;
}) {
  const utils = trpc.useUtils();
  const isEdit = !!tarefa;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateTarefaInput>({
    resolver: zodResolver(createTarefaSchema),
    defaultValues: { prioridade: "NORMAL" },
  });

  const equipe = trpc.usuarios.equipe.useQuery(undefined, { enabled: open });
  const clientes = trpc.clientes.list.useQuery(undefined, { enabled: open });

  useEffect(() => {
    if (!open) return;
    reset({
      titulo: tarefa?.titulo ?? "",
      descricao: tarefa?.descricao ?? "",
      responsavelId: tarefa?.responsavelId ?? defaults?.responsavelId ?? "",
      prazo: toDateInput(tarefa?.prazo) as unknown as CreateTarefaInput["prazo"],
      prioridade: tarefa?.prioridade ?? "NORMAL",
      clienteId: tarefa?.clienteId ?? defaults?.clienteId ?? "",
      projetoId: tarefa?.projetoId ?? defaults?.projetoId ?? "",
    });
  }, [open, tarefa, defaults, reset]);

  const invalidate = () => {
    utils.tarefas.list.invalidate();
    utils.tarefas.contar.invalidate();
    utils.dashboard.resumo.invalidate();
  };
  const create = trpc.tarefas.create.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const update = trpc.tarefas.update.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const pending = create.isPending || update.isPending;

  const onSubmit = (data: CreateTarefaInput) => {
    if (tarefa) update.mutate({ id: tarefa.id, ...data });
    else create.mutate(data);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar tarefa" : "Nova tarefa"}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="tarefa-form" disabled={pending}>
            {isEdit ? "Salvar" : "Criar tarefa"}
          </Button>
        </>
      }
    >
      <form id="tarefa-form" onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <div className="space-y-1">
          <Label htmlFor="titulo">O que precisa ser feito? *</Label>
          <Input id="titulo" autoFocus autoComplete="off" placeholder="Ex.: Ligar para o contador da clínica" {...register("titulo")} />
          {errors.titulo && <p className="text-xs text-destructive">{errors.titulo.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="descricao">Detalhes (opcional)</Label>
          <Textarea id="descricao" rows={3} autoComplete="off" placeholder="Contexto, links, o que for útil para quem vai fazer…" {...register("descricao")} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="responsavelId" hint="Quem vai fazer. Deixe em branco para atribuir a você mesmo.">Responsável</Label>
          <Combobox
            id="responsavelId"
            value={watch("responsavelId") ?? ""}
            onChange={(v) => setValue("responsavelId", v, { shouldDirty: true })}
            options={(equipe.data ?? []).map((u) => ({ value: u.id, label: u.nome }))}
            placeholder="Você (deixe em branco) ou escolha alguém"
            emptyText="Ninguém encontrado."
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="prazo" hint="Com prazo, a tarefa entra em “Pedidos comigo” no Início do responsável e fica em vermelho quando atrasa.">Prazo (opcional)</Label>
            <Input id="prazo" type="date" autoComplete="off" {...register("prazo")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="prioridade">Prioridade</Label>
            <Select id="prioridade" {...register("prioridade")}>
              {PRIORIDADES.map((p) => (
                <option key={p} value={p}>
                  {TAREFA_PRIORIDADE_LABEL[p]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="clienteId" hint="Só para dar contexto — a tarefa aparece ligada a esse cliente. Pode deixar em branco.">Cliente (opcional)</Label>
          <Combobox
            id="clienteId"
            value={watch("clienteId") ?? ""}
            onChange={(v) => setValue("clienteId", v, { shouldDirty: true })}
            options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
            placeholder="Buscar cliente…"
            emptyText="Nenhum cliente encontrado."
          />
        </div>
      </form>
    </Modal>
  );
}
