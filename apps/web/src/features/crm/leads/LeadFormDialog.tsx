import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createLeadSchema, type CreateLeadInput } from "@app/shared";
import { trpc } from "../../../lib/trpc";
import { Modal } from "../../../components/ui/modal";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { MaskedInput } from "../../../components/ui/masked-input";
import { MoneyInput } from "../../../components/ui/money-input";
import { Autocomplete } from "../../../components/ui/autocomplete";
import { maskTelefone } from "../../../lib/masks";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import { Combobox } from "../../../components/ui/combobox";
import { ServicosPicker } from "./ServicosPicker";

export interface LeadEditavel {
  id: string;
  nome: string;
  empresa: string | null;
  email: string | null;
  telefone: string | null;
  origem: string | null;
  valorEstimado: number | null;
  observacoes: string | null;
  responsavelId: string | null;
  servicoIds: string[];
}

export function LeadFormDialog({
  open,
  onClose,
  lead,
}: {
  open: boolean;
  onClose: () => void;
  lead?: LeadEditavel;
}) {
  const utils = trpc.useUtils();
  const isEdit = !!lead;
  const equipe = trpc.usuarios.equipe.useQuery(undefined, { enabled: open });
  const servicos = trpc.servicos.ativos.useQuery(undefined, { enabled: open });
  const origens = trpc.origens.ativas.useQuery(undefined, { enabled: open });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateLeadInput>({
    resolver: zodResolver(createLeadSchema),
    defaultValues: { nome: "" },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      lead
        ? {
            nome: lead.nome,
            empresa: lead.empresa ?? "",
            email: lead.email ?? "",
            telefone: lead.telefone ?? "",
            origem: lead.origem ?? "",
            valorEstimado: lead.valorEstimado ?? undefined,
            observacoes: lead.observacoes ?? "",
            responsavelId: lead.responsavelId ?? "",
            servicoIds: lead.servicoIds,
          }
        : { nome: "", empresa: "", email: "", telefone: "", origem: "", observacoes: "", responsavelId: "", servicoIds: [] },
    );
  }, [open, lead, reset]);

  const invalidate = () => utils.leads.list.invalidate();
  const create = trpc.leads.create.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const update = trpc.leads.update.useMutation({ onSuccess: () => (invalidate(), onClose()) });
  const pending = create.isPending || update.isPending;

  const onSubmit = (data: CreateLeadInput) => {
    if (lead) update.mutate({ id: lead.id, ...data });
    else create.mutate(data);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar lead" : "Novo lead"}
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="lead-form" disabled={pending}>
            {isEdit ? "Salvar" : "Criar lead"}
          </Button>
        </>
      }
    >
      <form id="lead-form" onSubmit={handleSubmit(onSubmit)} className="space-y-2.5" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" autoFocus autoComplete="name" {...register("nome")} />
            {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="empresa">Empresa</Label>
            <Input id="empresa" autoComplete="organization" {...register("empresa")} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="telefone">Telefone</Label>
            <MaskedInput id="telefone" inputMode="tel" autoComplete="tel" placeholder="(11) 90000-0000" format={maskTelefone} {...register("telefone")} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="origem" hint="De onde este lead veio (indicação, site, evento…) — ajuda a saber o que está trazendo mais clientes.">Origem</Label>
            <Autocomplete
              id="origem"
              value={watch("origem") ?? ""}
              onChange={(v) => setValue("origem", v, { shouldDirty: true })}
              sugestoes={(origens.data ?? []).map((o) => o.nome)}
              maxItens={100}
              placeholder="Ex.: Indicação, Site, Evento…"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="valorEstimado" hint="Quanto você espera fechar com este lead (pode ajustar depois).">Valor estimado</Label>
            <MoneyInput
              id="valorEstimado"
              value={watch("valorEstimado")}
              onChange={(v) => setValue("valorEstimado", v, { shouldDirty: true })}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="responsavelId" hint="Quem da equipe vai cuidar deste lead.">Responsável</Label>
          <Combobox
            id="responsavelId"
            value={watch("responsavelId") ?? ""}
            onChange={(v) => setValue("responsavelId", v, { shouldDirty: true })}
            options={(equipe.data ?? []).map((u) => ({ value: u.id, label: u.nome }))}
            placeholder="Buscar responsável…"
            emptyText="Ninguém encontrado."
          />
        </div>

        {servicos.data && servicos.data.length > 0 && (
          <div className="space-y-1">
            <Label hint="Marque os serviços de interesse — eles viram o checklist do card no funil.">Serviços que o lead precisa</Label>
            <div className="max-h-[88px] overflow-y-auto rounded-lg border bg-muted/20 p-2">
              <ServicosPicker
                servicos={servicos.data}
                value={watch("servicoIds") ?? []}
                onChange={(ids) => setValue("servicoIds", ids, { shouldDirty: true })}
              />
            </div>
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
