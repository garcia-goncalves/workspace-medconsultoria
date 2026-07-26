import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createProjetoSchema, type CreateProjetoInput, type ProjetoStatus } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";
import { Combobox } from "../../components/ui/combobox";

export interface ProjetoEditavel {
  id: string;
  clienteId: string;
  nome: string;
  descricao: string | null;
  status: ProjetoStatus;
  previsaoFim: Date | null;
  responsavelId: string | null;
}

const STATUS_LABEL: Record<ProjetoStatus, string> = {
  ATIVO: "Ativo",
  PAUSADO: "Pausado",
  CONCLUIDO: "Concluído",
};

const toDateInput = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

export function ProjetoFormDialog({
  open,
  onClose,
  clienteIdFixo,
  projeto,
}: {
  open: boolean;
  onClose: () => void;
  clienteIdFixo?: string;
  projeto?: ProjetoEditavel;
}) {
  const utils = trpc.useUtils();
  const isEdit = !!projeto;
  const clientes = trpc.clientes.list.useQuery(undefined, {
    enabled: open && !clienteIdFixo && !isEdit,
  });
  const equipe = trpc.usuarios.equipe.useQuery(undefined, { enabled: open });
  const [status, setStatus] = useState<ProjetoStatus>("ATIVO");

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateProjetoInput>({
    resolver: zodResolver(createProjetoSchema),
    defaultValues: { clienteId: clienteIdFixo ?? "" },
  });

  useEffect(() => {
    if (!open) return;
    if (projeto) {
      reset({
        clienteId: projeto.clienteId,
        nome: projeto.nome,
        descricao: projeto.descricao ?? "",
        previsaoFim: toDateInput(projeto.previsaoFim) as unknown as CreateProjetoInput["previsaoFim"],
        responsavelId: projeto.responsavelId ?? "",
      });
      setStatus(projeto.status);
    } else {
      reset({ clienteId: clienteIdFixo ?? "", nome: "", descricao: "", responsavelId: "" });
      setStatus("ATIVO");
    }
  }, [open, projeto, clienteIdFixo, reset]);

  const invalidate = () => {
    utils.projetos.list.invalidate();
    utils.clientes.relacionados.invalidate();
    if (projeto) utils.projetos.get.invalidate({ id: projeto.id });
  };
  const create = trpc.projetos.create.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const update = trpc.projetos.update.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const pending = create.isPending || update.isPending;

  const onSubmit = (data: CreateProjetoInput) => {
    if (projeto) {
      update.mutate({
        id: projeto.id,
        nome: data.nome,
        descricao: data.descricao,
        previsaoFim: data.previsaoFim,
        responsavelId: data.responsavelId ?? "",
        status,
      });
    } else {
      create.mutate(data);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar projeto" : "Novo projeto"}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="projeto-form" disabled={pending}>
            {isEdit ? "Salvar" : "Criar projeto"}
          </Button>
        </>
      }
    >
      <form id="projeto-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {!clienteIdFixo && !isEdit && (
          <div className="space-y-1.5">
            <Label htmlFor="clienteId" hint="Cliente ao qual este projeto pertence.">Cliente *</Label>
            <Combobox
              id="clienteId"
              value={watch("clienteId") ?? ""}
              onChange={(v) => setValue("clienteId", v, { shouldValidate: true, shouldDirty: true })}
              options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
              placeholder="Buscar cliente…"
              emptyText="Nenhum cliente encontrado."
            />
            {errors.clienteId && (
              <p className="text-xs text-destructive">{errors.clienteId.message}</p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="nome" hint="Nome que identifica o projeto nas listas e no quadro de cartões.">Nome do projeto *</Label>
          <Input id="nome" autoFocus autoComplete="off" {...register("nome")} />
          {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="descricao">Descrição</Label>
          <Textarea id="descricao" autoComplete="off" {...register("descricao")} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="previsaoFim">Previsão de conclusão</Label>
            <Input id="previsaoFim" type="date" autoComplete="off" {...register("previsaoFim")} />
          </div>
          {isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="status" hint="Situação atual do projeto: Ativo, Pausado ou Concluído.">Status</Label>
              <Select id="status" value={status} onChange={(e) => setStatus(e.target.value as ProjetoStatus)}>
                {(Object.keys(STATUS_LABEL) as ProjetoStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="responsavelId" hint="Quem vai conduzir este projeto. Deixe em branco para ficar com você.">Responsável</Label>
          <Combobox
            id="responsavelId"
            value={watch("responsavelId") ?? ""}
            onChange={(v) => setValue("responsavelId", v, { shouldDirty: true })}
            options={(equipe.data ?? []).map((u) => ({ value: u.id, label: u.nome }))}
            placeholder="Buscar responsável…"
            emptyText="Ninguém encontrado."
          />
        </div>

        {(create.error || update.error) && (
          <p className="text-sm text-destructive">{create.error?.message ?? update.error?.message}</p>
        )}
      </form>
    </Modal>
  );
}
