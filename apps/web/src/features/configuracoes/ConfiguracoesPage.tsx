import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, User, KeyRound, Users, ArrowRight, Mail } from "lucide-react";
import { cn } from "@app/ui";
import {
  updateProfileSchema,
  changePasswordSchema,
  hasRoleLevel,
  ROLE_LABEL,
  EMAIL_GRUPOS,
  type UpdateProfileInput,
  type ChangePasswordInput,
} from "@app/shared";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth-context";
import { PageHeader } from "../../components/ui/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { Button, buttonVariants } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { AvatarUpload } from "../../components/ui/avatar";
import { Skeleton } from "../../components/ui/skeleton";
import { QueryError } from "../../components/ui/query-error";
import { EmailsEnviadosList } from "../../components/EmailsEnviadosList";

/** Aviso de sucesso efêmero. */
function Sucesso({ children }: { children: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm font-medium text-success">
      <CheckCircle2 className="h-4 w-4" />
      {children}
    </p>
  );
}

function PerfilCard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [salvo, setSalvo] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { nome: user.nome },
  });

  const update = trpc.auth.updateProfile.useMutation({
    onSuccess: (_data, variables) => {
      utils.auth.me.invalidate();
      reset({ nome: variables.nome }); // rebaseia o form no valor salvo (limpa isDirty e mostra o sucesso)
      setSalvo(true);
    },
  });
  const removerAvatar = trpc.auth.removerAvatar.useMutation({ onSuccess: () => utils.auth.me.invalidate() });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <User className="h-4 w-4 text-muted-foreground" />
          Perfil
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label hint="Use uma foto sua (rosto) — ela aparece em toda a plataforma.">Foto de perfil</Label>
          <AvatarUpload
            id={user.id}
            nome={user.nome}
            avatarUrl={user.avatarUrl}
            onChanged={() => utils.auth.me.invalidate()}
            onRemover={() => removerAvatar.mutate()}
            podeRemover
          />
        </div>
        <form
          onSubmit={handleSubmit((d) => {
            setSalvo(false);
            update.mutate(d);
          })}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="nome">Nome</Label>
            <Input id="nome" autoComplete="name" {...register("nome")} />
            {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" value={user.email} disabled />
            <p className="text-xs text-muted-foreground">
              O e-mail e o papel ({ROLE_LABEL[user.role]}){" "}
              {hasRoleLevel(user.role, "ADMIN") ? (
                <>
                  são definidos na administração —{" "}
                  <Link to="/usuarios" className="text-primary hover:underline">
                    gerencie em Equipe e acessos
                  </Link>
                  .
                </>
              ) : (
                "são geridos pela administração."
              )}
            </p>
          </div>
          {update.error && <p className="text-sm text-destructive">{update.error.message}</p>}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" disabled={update.isPending || !isDirty}>
              Salvar
            </Button>
            {salvo && !isDirty && <Sucesso>Perfil atualizado.</Sucesso>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SenhaCard() {
  const [salvo, setSalvo] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { senhaAtual: "", novaSenha: "", confirmar: "" },
  });

  const change = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      setSalvo(true);
      reset({ senhaAtual: "", novaSenha: "", confirmar: "" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          Senha
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((d) => {
            setSalvo(false);
            change.mutate(d);
          })}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="senhaAtual">Senha atual</Label>
            <Input id="senhaAtual" type="password" autoComplete="current-password" {...register("senhaAtual")} />
            {errors.senhaAtual && (
              <p className="text-xs text-destructive">{errors.senhaAtual.message}</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="novaSenha" hint="Mínimo de 8 caracteres.">
                Nova senha
              </Label>
              <Input id="novaSenha" type="password" autoComplete="new-password" {...register("novaSenha")} />
              {errors.novaSenha && (
                <p className="text-xs text-destructive">{errors.novaSenha.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmar">Confirmar</Label>
              <Input id="confirmar" type="password" autoComplete="new-password" {...register("confirmar")} />
              {errors.confirmar && (
                <p className="text-xs text-destructive">{errors.confirmar.message}</p>
              )}
            </div>
          </div>
          {change.error && <p className="text-sm text-destructive">{change.error.message}</p>}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" disabled={change.isPending}>
              Alterar senha
            </Button>
            {salvo && <Sucesso>Senha alterada com sucesso.</Sucesso>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Interruptor (toggle) acessível. */
function Toggle({
  ativo,
  onToggle,
  disabled,
}: {
  ativo: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ativo}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        // alvo de toque ≥44px sem alargar o visual: pseudo-elemento amplia a área clicável
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors before:absolute before:-inset-2.5 before:content-[''] disabled:cursor-not-allowed disabled:opacity-50",
        ativo ? "bg-success" : "bg-input",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200",
          ativo ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** Preferências de e-mail: liga/desliga cada categoria de notificação por e-mail. */
function EmailsCard() {
  const utils = trpc.useUtils();
  const prefs = trpc.notificacoes.preferenciasEmail.useQuery();
  const setPref = trpc.notificacoes.setPreferenciaEmail.useMutation({
    onMutate: async ({ tipo, ativo }) => {
      await utils.notificacoes.preferenciasEmail.cancel();
      const prev = utils.notificacoes.preferenciasEmail.getData();
      utils.notificacoes.preferenciasEmail.setData(undefined, (old) =>
        old?.map((c) => (c.tipo === tipo ? { ...c, ativo } : c)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.notificacoes.preferenciasEmail.setData(undefined, ctx.prev);
    },
    onSettled: () => utils.notificacoes.preferenciasEmail.invalidate(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Mail className="h-4 w-4 text-muted-foreground" />
          Notificações por e-mail
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-1 text-sm text-muted-foreground">
          Escolha quais e-mails automáticos você quer receber. Desligar um aviso aqui{" "}
          <strong className="font-medium text-foreground">não</strong> o esconde do sistema: ele continua
          aparecendo no sininho, no topo da tela — você só deixa de receber a cópia por e-mail.
        </p>
        <p className="mb-4 text-sm text-muted-foreground">
          E-mails de acesso e segurança (convite, boas-vindas, redefinição de senha) são sempre enviados.
        </p>
        {prefs.isError ? (
          <QueryError onRetry={() => prefs.refetch()} />
        ) : prefs.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ) : (
          <div className="space-y-5">
            {EMAIL_GRUPOS.filter((g) => prefs.data?.some((p) => p.grupo === g)).map((grupo) => (
              <section key={grupo}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {grupo}
                </h3>
                <div className="divide-y">
                  {prefs.data
                    ?.filter((p) => p.grupo === grupo)
                    .map((p) => (
                      <div key={p.tipo} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{p.label}</div>
                          <div className="text-xs text-muted-foreground">{p.descricao}</div>
                        </div>
                        <Toggle
                          ativo={p.ativo}
                          disabled={setPref.isPending}
                          onToggle={() => setPref.mutate({ tipo: p.tipo, ativo: !p.ativo })}
                        />
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Histórico de e-mails que o usuário logado recebeu do sistema. */
function MeusEmailsCard() {
  const meusEmails = trpc.emailsEnviados.meus.useQuery();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Mail className="h-4 w-4 text-muted-foreground" />
          Meus e-mails
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Os e-mails que o sistema enviou para você.
        </p>
        {meusEmails.isError ? (
          <QueryError onRetry={() => meusEmails.refetch()} />
        ) : meusEmails.isLoading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-14 rounded-lg" />
            <Skeleton className="h-14 rounded-lg" />
          </div>
        ) : (
          <EmailsEnviadosList
            emails={meusEmails.data ?? []}
            vazio="Você ainda não recebeu e-mails do sistema."
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Atalho para a administração de equipe/acessos (somente ADMIN+). */
function EquipeCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
          Equipe e acessos
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Cadastre funcionários e crie acessos de Portal para os clientes.
        </p>
        <Link to="/usuarios" className={buttonVariants({ variant: "outline" })}>
          Gerenciar equipe
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
}

export function ConfiguracoesPage() {
  const { user } = useAuth();
  const podeGerirEquipe = hasRoleLevel(user.role, "ADMIN");

  // Garante que a página abra no topo.
  // Corpo em BLOCO de propósito: `useEffect(() => window.scrollTo(0, 0), [])` devolve
  // implicitamente o retorno de `scrollTo`, que nos Chrome atuais é uma **Promise**. O React
  // trata esse retorno como a função de limpeza e quebra com "destroy is not a function" —
  // derrubando a página inteira. Efeito não pode retornar nada além de uma função.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" subtitle="Seu perfil, sua senha, as preferências de quais e-mails você recebe e o histórico das mensagens enviadas a você." />
      <div className="grid gap-6 lg:grid-cols-2">
        <PerfilCard />
        <SenhaCard />
      </div>
      <EmailsCard />
      <MeusEmailsCard />
      {podeGerirEquipe && <EquipeCard />}
    </div>
  );
}
