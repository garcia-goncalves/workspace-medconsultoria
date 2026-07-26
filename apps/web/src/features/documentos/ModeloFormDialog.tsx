import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createModeloSchema,
  TIPO_MODELO_LABEL,
  type CreateModeloInput,
  type TipoModelo,
} from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";

export interface ModeloEditavel {
  id: string;
  nome: string;
  tipo: TipoModelo;
  corpo: string;
}

export function ModeloFormDialog({
  open,
  onClose,
  modelo,
}: {
  open: boolean;
  onClose: () => void;
  modelo?: ModeloEditavel;
}) {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const isEdit = !!modelo;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateModeloInput>({
    resolver: zodResolver(createModeloSchema),
    defaultValues: { tipo: "PROPOSTA" },
  });

  useEffect(() => {
    if (!open) return;
    reset({ nome: modelo?.nome ?? "", tipo: modelo?.tipo ?? "PROPOSTA", corpo: modelo?.corpo ?? "" });
  }, [open, modelo, reset]);

  const invalidate = () => utils.documentos.modelos.list.invalidate();
  // Ao criar, leva direto para o modelo (onde se edita com o editor + preview ao vivo).
  const create = trpc.documentos.modelos.create.useMutation({
    onSuccess: (m) => {
      invalidate();
      onClose();
      navigate({ to: "/modelos/$modeloId", params: { modeloId: m.id } });
    },
  });
  const update = trpc.documentos.modelos.update.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const pending = create.isPending || update.isPending;

  const onSubmit = (data: CreateModeloInput) => {
    if (modelo) update.mutate({ id: modelo.id, ...data });
    else create.mutate(data);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar modelo" : "Novo modelo"}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="modelo-form" disabled={pending}>
            {isEdit ? "Salvar" : "Criar modelo"}
          </Button>
        </>
      }
    >
      <form id="modelo-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" autoFocus autoComplete="off" {...register("nome")} />
            {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tipo" hint="Que tipo de documento este modelo gera (proposta, contrato, recibo…).">Tipo</Label>
            <Select id="tipo" {...register("tipo")}>
              {(Object.keys(TIPO_MODELO_LABEL) as TipoModelo[])
                .filter((t) => t !== "BRIEFING")
                .map((t) => (
                  <option key={t} value={t}>
                    {TIPO_MODELO_LABEL[t]}
                  </option>
                ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="corpo"
            hint="Escreva o texto do documento. Use {{variavel}} para os campos — {{cliente.nome}} e {{data}} se preenchem sozinhos."
          >
            Corpo do modelo
          </Label>
          <Textarea
            id="corpo"
            autoComplete="off"
            className="min-h-64 font-mono text-xs"
            placeholder="Use {{variavel}} para campos que serão preenchidos. Ex.: {{cliente.nome}}, {{valor}}, {{prazo}}"
            {...register("corpo")}
          />
          {errors.corpo && <p className="text-xs text-destructive">{errors.corpo.message}</p>}
        </div>
      </form>
    </Modal>
  );
}
