import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClienteSchema, type CreateClienteInput } from "@app/shared";
import { trpc } from "../../../lib/trpc";
import { Modal } from "../../../components/ui/modal";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { MaskedInput } from "../../../components/ui/masked-input";
import { maskTelefone, maskCNPJ } from "../../../lib/masks";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import { Combobox } from "../../../components/ui/combobox";
import { useConfirm, useConfirmar } from "../../../components/ui/confirm-dialog";
import { UserPlus } from "lucide-react";

export interface ClienteEditavel {
  id: string;
  nome: string;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  observacoes: string | null;
  responsavelId: string | null;
}

export function ClienteFormDialog({
  open,
  onClose,
  cliente,
}: {
  open: boolean;
  onClose: () => void;
  cliente?: ClienteEditavel;
}) {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const confirmar = useConfirmar();
  const isEdit = !!cliente;
  const equipe = trpc.usuarios.equipe.useQuery(undefined, { enabled: open });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateClienteInput>({
    resolver: zodResolver(createClienteSchema),
    defaultValues: { cnpj: "" },
  });

  // Sincroniza o formulário ao abrir (novo = limpo; edição = dados do cliente).
  useEffect(() => {
    if (!open) return;
    reset(
      cliente
        ? {
            nome: cliente.nome,
            cnpj: cliente.cnpj ?? "",
            email: cliente.email ?? "",
            telefone: cliente.telefone ?? "",
            observacoes: cliente.observacoes ?? "",
            responsavelId: cliente.responsavelId ?? "",
          }
        : { nome: "", cnpj: "", email: "", telefone: "", observacoes: "", responsavelId: "" },
    );
  }, [open, cliente, reset]);

  const create = trpc.clientes.create.useMutation({
    onSuccess: () => {
      utils.clientes.list.invalidate();
      utils.clientes.resumo.invalidate();
      onClose();
    },
  });
  const update = trpc.clientes.update.useMutation({
    onSuccess: () => {
      utils.clientes.list.invalidate();
      utils.clientes.resumo.invalidate();
      if (cliente) utils.clientes.get.invalidate({ id: cliente.id });
      onClose();
    },
  });

  const pending = create.isPending || update.isPending;

  const onSubmit = async (data: CreateClienteInput) => {
    if (cliente) {
      update.mutate({ id: cliente.id, ...data });
      return;
    }
    // Novo cliente: confirma o cadastro e pergunta se envia o acesso ao Portal por e-mail.
    const temEmail = !!data.email?.trim();
    if (temEmail) {
      const { confirmado, marcado } = await confirmar({
        title: "Confirmar cadastro do cliente?",
        description: `Vamos cadastrar "${data.nome.trim()}" na sua base de clientes.`,
        confirmText: "Cadastrar cliente",
        icon: UserPlus,
        checkbox: {
          // NASCE DESMARCADA (ADR-128). Cadastro feito pela equipe não avisa o cliente sozinho:
          // e-mail de boas-vindas é para quem se cadastrou em /comecar e está esperando por ele.
          // Marcada por padrão, ninguém desmarcava — o "automático" era o descuido de todo dia.
          label: "Avisar o cliente agora, por e-mail",
          hint: `Deixe desmarcado para cadastrar em silêncio. Você envia o acesso quando quiser, pelo botão "Enviar acesso" na ficha. Marcando, ${data.email!.trim()} recebe o link agora.`,
          default: false,
        },
      });
      if (!confirmado) return;
      create.mutate({ ...data, enviarAcessoPortal: marcado });
    } else {
      const ok = await confirm({
        title: "Confirmar cadastro do cliente?",
        description: `Vamos cadastrar "${data.nome.trim()}". Sem e-mail cadastrado, o acesso ao Portal pode ser enviado depois pela ficha.`,
        confirmText: "Cadastrar cliente",
        icon: UserPlus,
      });
      if (!ok) return;
      create.mutate({ ...data, enviarAcessoPortal: false });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar cliente" : "Novo cliente"}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="cliente-form" disabled={pending}>
            {isEdit ? "Salvar" : "Criar cliente"}
          </Button>
        </>
      }
    >
      <form id="cliente-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="nome">Nome *</Label>
          <Input id="nome" autoFocus autoComplete="name" {...register("nome")} />
          {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cnpj" hint="O CNPJ da clínica ou do consultório. Pode ficar em branco agora e ser preenchido depois.">
            CNPJ
          </Label>
          <MaskedInput
            id="cnpj"
            autoComplete="off"
            placeholder="00.000.000/0000-00"
            format={maskCNPJ}
            {...register("cnpj")}
          />
          {errors.cnpj && <p className="text-xs text-destructive">{errors.cnpj.message}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="telefone">Telefone</Label>
            <MaskedInput id="telefone" inputMode="tel" autoComplete="tel" placeholder="(11) 90000-0000" format={maskTelefone} {...register("telefone")} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="responsavelId" hint="Quem da equipe cuida deste cliente no dia a dia.">Responsável</Label>
          <Combobox
            id="responsavelId"
            value={watch("responsavelId") ?? ""}
            onChange={(v) => setValue("responsavelId", v, { shouldDirty: true })}
            options={(equipe.data ?? []).map((u) => ({ value: u.id, label: u.nome }))}
            placeholder="Buscar responsável…"
            emptyText="Ninguém encontrado."
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="observacoes">Observações</Label>
          <Textarea id="observacoes" autoComplete="off" {...register("observacoes")} />
        </div>

        {(create.error || update.error) && (
          <p className="text-sm text-destructive">
            {create.error?.message ?? update.error?.message}
          </p>
        )}
      </form>
    </Modal>
  );
}
