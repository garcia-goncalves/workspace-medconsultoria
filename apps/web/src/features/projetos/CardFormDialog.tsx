import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createCardSchema,
  PRIORIDADE_LABEL,
  type CreateCardInput,
  type CardStatus,
  type Prioridade,
} from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";
import { Combobox } from "../../components/ui/combobox";

export interface CardEditavel {
  id: string;
  titulo: string;
  descricao: string | null;
  prioridade: Prioridade;
  prazo: Date | null;
  responsavelId: string | null;
}

const toDateInput = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

export function CardFormDialog({
  open,
  onClose,
  projetoId,
  statusInicial,
  card,
}: {
  open: boolean;
  onClose: () => void;
  projetoId: string;
  statusInicial?: CardStatus;
  card?: CardEditavel;
}) {
  const utils = trpc.useUtils();
  const isEdit = !!card;
  const equipe = trpc.usuarios.equipe.useQuery(undefined, { enabled: open });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateCardInput>({
    resolver: zodResolver(createCardSchema),
    defaultValues: { projetoId, prioridade: "MEDIA" },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      card
        ? {
            projetoId,
            titulo: card.titulo,
            descricao: card.descricao ?? "",
            prioridade: card.prioridade,
            prazo: toDateInput(card.prazo) as unknown as CreateCardInput["prazo"],
            responsavelId: card.responsavelId ?? "",
          }
        : { projetoId, titulo: "", descricao: "", prioridade: "MEDIA", status: statusInicial, responsavelId: "" },
    );
  }, [open, card, projetoId, statusInicial, reset]);

  const invalidate = () => utils.cards.list.invalidate({ projetoId });
  const create = trpc.cards.create.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const update = trpc.cards.update.useMutation({
    onSuccess: () => {
      invalidate();
      if (card) utils.cards.get.invalidate({ id: card.id });
      onClose();
    },
  });
  const pending = create.isPending || update.isPending;

  const onSubmit = (data: CreateCardInput) => {
    if (card) {
      update.mutate({
        id: card.id,
        titulo: data.titulo,
        descricao: data.descricao,
        prioridade: data.prioridade,
        prazo: data.prazo,
        responsavelId: data.responsavelId ?? "",
      });
    } else {
      create.mutate(data);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar cartão" : "Novo cartão"}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="card-form" disabled={pending}>
            {isEdit ? "Salvar" : "Criar cartão"}
          </Button>
        </>
      }
    >
      <form id="card-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="titulo" hint="Nome curto que identifica a tarefa no cartão.">Título *</Label>
          <Input id="titulo" autoFocus autoComplete="off" {...register("titulo")} />
          {errors.titulo && <p className="text-xs text-destructive">{errors.titulo.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="descricao">Descrição</Label>
          <Textarea id="descricao" autoComplete="off" {...register("descricao")} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="prioridade" hint="Define a urgência da tarefa e a ordem de destaque no quadro.">Prioridade</Label>
            <Select id="prioridade" {...register("prioridade")}>
              {(Object.keys(PRIORIDADE_LABEL) as Prioridade[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORIDADE_LABEL[p]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prazo">Prazo</Label>
            <Input id="prazo" type="date" autoComplete="off" {...register("prazo")} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="responsavelId" hint="Quem vai executar esta tarefa. Deixe em branco para ficar com você.">Responsável</Label>
          <Combobox
            id="responsavelId"
            value={watch("responsavelId") ?? ""}
            onChange={(v) => setValue("responsavelId", v, { shouldDirty: true })}
            options={(equipe.data ?? []).map((u) => ({ value: u.id, label: u.nome }))}
            placeholder={isEdit ? "Buscar responsável…" : "Você (deixe em branco) ou escolha alguém"}
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
