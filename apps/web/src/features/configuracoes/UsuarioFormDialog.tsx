import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { Mail } from "lucide-react";
import { ROLES, ROLE_LABEL, ROLE_LEVEL, type Role } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Combobox } from "../../components/ui/combobox";

export interface UsuarioEditavel {
  id: string;
  nome: string;
  email: string;
  role: Role;
  ativo: boolean;
  clienteId: string | null;
  /** Root primordial: papel e situação ficam travados (imutável). */
  protegido?: boolean;
}

/** Resultado de um convite, para a tela exibir o link (modo dev) ou confirmar o e-mail. */
export interface ConviteResultado {
  email: string;
  conviteUrl: string | null;
  emailEnviado: boolean;
}

interface FormValues {
  nome: string;
  email: string;
  novaSenha: string;
  role: Role;
  clienteId: string;
  ativo: string; // "true" | "false" (select nativo)
}

export function UsuarioFormDialog({
  open,
  onClose,
  usuario,
  onConvite,
}: {
  open: boolean;
  onClose: () => void;
  usuario?: UsuarioEditavel;
  onConvite?: (r: ConviteResultado) => void;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const isEdit = !!usuario;
  const isSelf = usuario?.id === user.id;
  const protegido = !!usuario?.protegido;
  // Root primordial ou você mesmo: papel/situação travados.
  const papelTravado = isSelf || protegido;
  const clientes = trpc.clientes.list.useQuery(undefined, { enabled: open });

  // Papéis atribuíveis: em geral só abaixo do seu (ex.: ADMIN cria Funcionário). O ROOT pode
  // atribuir QUALQUER papel, inclusive ROOT (cria outros roots). Mantém o papel atual do alvo.
  const rolesDisponiveis = ROLES.filter(
    (r) => user.role === "ROOT" || ROLE_LEVEL[r] < ROLE_LEVEL[user.role] || r === usuario?.role,
  );

  const {
    register,
    handleSubmit,
    watch,
    reset,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { role: "FUNCIONARIO", ativo: "true" },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      nome: usuario?.nome ?? "",
      email: usuario?.email ?? "",
      novaSenha: "",
      role: usuario?.role ?? "FUNCIONARIO",
      clienteId: usuario?.clienteId ?? "",
      ativo: usuario ? String(usuario.ativo) : "true",
    });
  }, [open, usuario, reset]);

  const roleAtual = watch("role");

  const convidar = trpc.usuarios.convidar.useMutation({
    onSuccess: (r) => {
      utils.usuarios.list.invalidate();
      onConvite?.({ email: r.usuario.email, conviteUrl: r.conviteUrl, emailEnviado: r.emailEnviado });
      onClose();
    },
  });
  const update = trpc.usuarios.update.useMutation({
    onSuccess: () => (utils.usuarios.list.invalidate(), onClose()),
  });
  const pending = convidar.isPending || update.isPending;

  const onSubmit = (d: FormValues) => {
    if (usuario) {
      update.mutate({
        id: usuario.id,
        nome: d.nome,
        email: d.email,
        role: d.role,
        ativo: d.ativo === "true",
        clienteId: d.role === "CLIENTE" ? d.clienteId : "",
        novaSenha: d.novaSenha || "",
      });
    } else {
      convidar.mutate({
        nome: d.nome,
        email: d.email,
        role: d.role,
        clienteId: d.role === "CLIENTE" ? d.clienteId : "",
      });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar usuário" : "Convidar usuário"}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="usuario-form" disabled={pending}>
            {isEdit ? "Salvar" : "Enviar convite"}
          </Button>
        </>
      }
    >
      <form id="usuario-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="nome">Nome *</Label>
          <Input
            id="nome"
            autoFocus
            autoComplete="name"
            {...register("nome", {
              required: "Informe o nome",
              minLength: { value: 2, message: "Nome muito curto" },
            })}
          />
          {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email" hint={!isEdit ? "A pessoa recebe um link neste e-mail para definir a própria senha e ativar o acesso." : undefined}>
            E-mail *
          </Label>
          <Input id="email" type="email" autoComplete="email" {...register("email", { required: "Informe o e-mail" })} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="role" hint="Determina o que a pessoa pode acessar no sistema. Funcionário vê o essencial; Administrador gere a empresa; Root tem acesso técnico total.">
              Papel *
            </Label>
            <Select id="role" disabled={papelTravado} {...register("role")}>
              {rolesDisponiveis.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
            {isSelf && <p className="text-xs text-muted-foreground">Você não altera o próprio papel.</p>}
            {protegido && !isSelf && <p className="text-xs text-muted-foreground">Root principal — sempre ROOT (não pode ser alterado).</p>}
          </div>

          {isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="ativo">Situação</Label>
              <Select id="ativo" disabled={papelTravado} {...register("ativo")}>
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </Select>
            </div>
          )}
        </div>

        {roleAtual === "CLIENTE" && (
          <div className="space-y-1.5">
            <Label htmlFor="clienteId">Cliente (escopo do Portal) *</Label>
            <Controller
              name="clienteId"
              control={control}
              rules={{ validate: (v) => roleAtual !== "CLIENTE" || !!v || "Selecione o cliente" }}
              render={({ field }) => (
                <Combobox
                  id="clienteId"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
                  placeholder="Buscar cliente…"
                  emptyText="Nenhum cliente encontrado."
                />
              )}
            />
            {errors.clienteId && <p className="text-xs text-destructive">{errors.clienteId.message}</p>}
            <p className="text-xs text-muted-foreground">
              O cliente só verá os dados vinculados a este cadastro.
            </p>
          </div>
        )}

        {isEdit ? (
          <div className="space-y-1.5">
            <Label htmlFor="novaSenha">Nova senha</Label>
            <Input
              id="novaSenha"
              type="password"
              autoComplete="new-password"
              placeholder="Deixe em branco para manter a atual"
              {...register("novaSenha", {
                minLength: { value: 8, message: "A senha deve ter ao menos 8 caracteres" },
              })}
            />
            {errors.novaSenha && <p className="text-xs text-destructive">{errors.novaSenha.message}</p>}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              Enviaremos um convite para a pessoa <strong>definir a própria senha</strong> e ativar o
              acesso. Nenhuma senha é definida por você.
            </span>
          </div>
        )}

        {(convidar.error || update.error) && (
          <p className="text-sm text-destructive">{convidar.error?.message ?? update.error?.message}</p>
        )}
      </form>
    </Modal>
  );
}
