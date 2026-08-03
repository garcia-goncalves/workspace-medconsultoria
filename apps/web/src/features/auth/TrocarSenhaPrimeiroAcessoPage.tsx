import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, Eye, EyeOff, ArrowRight, AlertCircle, KeyRound } from "lucide-react";
import { changePasswordSchema, type ChangePasswordInput, type SessionUser } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { sincronizarAutofill } from "../../lib/form-autofill";
import { AuthShell } from "./AuthShell";

/**
 * Primeiro acesso de uma conta interna: a senha ainda é a compartilhada do seed, então a
 * pessoa define a dela antes de entrar (ADR-91). É PÁGINA, não modal — a pessoa acabou de
 * entrar e tem uma tarefa só; um modal por cima da app sugeriria que dá para adiar.
 *
 * Reusa `auth.changePassword` de propósito: exigir a senha atual impede que uma sessão
 * roubada troque a senha e tranque o dono para fora. Nada de endpoint novo.
 */
export function TrocarSenhaPrimeiroAcessoPage({ user, onSair }: { user: SessionUser; onSair: () => void }) {
  const utils = trpc.useUtils();
  const trocar = trpc.auth.changePassword.useMutation({
    onSuccess: () => void utils.auth.me.invalidate(), // some sozinha: `me` volta com senhaTrocadaEm
  });
  const [showPass, setShowPass] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { senhaAtual: "", novaSenha: "", confirmar: "" },
  });

  const primeiroNome = user.nome.split(" ")[0];

  return (
    <AuthShell>
      <div className="mb-8">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Bem-vindo{primeiroNome ? `, ${primeiroNome}` : ""}!
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Sua conta ainda usa a senha inicial, que outras pessoas conhecem. Defina uma senha só sua
          para continuar.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          // Gerenciador de senhas autopreenche sem disparar o evento que o RHF escuta.
          sincronizarAutofill(e, setValue, ["senhaAtual", "novaSenha", "confirmar"]);
          void handleSubmit((data) => trocar.mutate(data))(e);
        }}
        className="space-y-5"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="senhaAtual" hint="A mesma que você acabou de usar para entrar.">
            Senha atual
          </Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="senhaAtual"
              type="password"
              autoComplete="current-password"
              autoFocus
              placeholder="Senha que você usou agora"
              className="pl-10"
              {...register("senhaAtual")}
            />
          </div>
          {errors.senhaAtual && <p className="text-xs text-destructive">{errors.senhaAtual.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="novaSenha" hint="Use no mínimo 8 caracteres.">
            Nova senha
          </Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="novaSenha"
              type={showPass ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Ao menos 8 caracteres"
              className="pl-10 pr-10"
              {...register("novaSenha")}
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={showPass ? "Ocultar senha" : "Mostrar senha"}
              aria-label={showPass ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.novaSenha && <p className="text-xs text-destructive">{errors.novaSenha.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmar" hint="Repita a mesma senha para confirmar que digitou certo.">
            Confirmar nova senha
          </Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="confirmar"
              type={showPass ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repita a nova senha"
              className="pl-10"
              {...register("confirmar")}
            />
          </div>
          {errors.confirmar && <p className="text-xs text-destructive">{errors.confirmar.message}</p>}
        </div>

        {trocar.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{trocar.error.message}</span>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={trocar.isPending}>
          {trocar.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Salvando…
            </>
          ) : (
            <>
              Salvar e entrar
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>

        {/* Saída de emergência: entrou na conta errada, ou não sabe a senha atual. */}
        <p className="text-center text-sm text-muted-foreground">
          Entrou como <strong className="text-foreground">{user.email}</strong>.{" "}
          <button type="button" onClick={onSair} className="font-medium text-primary hover:underline">
            Sair
          </button>
        </p>
      </form>
    </AuthShell>
  );
}
