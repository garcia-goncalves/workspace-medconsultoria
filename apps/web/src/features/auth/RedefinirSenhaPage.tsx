import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, Eye, EyeOff, ArrowRight, AlertCircle, KeyRound } from "lucide-react";
import { redefinirSenhaSchema, type RedefinirSenhaInput } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { sincronizarAutofill } from "../../lib/form-autofill";
import { AuthShell } from "./AuthShell";

export function RedefinirSenhaPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const info = trpc.auth.validarReset.useQuery({ token }, { enabled: !!token, retry: false });
  const utils = trpc.useUtils();
  const redefinir = trpc.auth.redefinirSenha.useMutation({
    onSuccess: () => {
      void utils.auth.me.invalidate();
      window.location.href = "/";
    },
  });
  const [showPass, setShowPass] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<RedefinirSenhaInput>({
    resolver: zodResolver(redefinirSenhaSchema),
    defaultValues: { token, novaSenha: "", confirmar: "" },
  });

  const linkInvalido = !token || (info.isFetched && !info.data?.valido);

  if (info.isLoading) {
    return (
      <AuthShell>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </AuthShell>
    );
  }

  if (linkInvalido) {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Link inválido ou expirado</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Este link não é mais válido. Solicite uma nova redefinição de senha.
          </p>
          <a
            href="/esqueci-senha"
            className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            Pedir novo link
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-8">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Criar nova senha</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Defina uma nova senha para <strong>{info.data?.email}</strong>.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          // Gerenciador de senhas autopreenche sem disparar o evento que o RHF escuta.
          sincronizarAutofill(e, setValue, ["novaSenha", "confirmar"]);
          void handleSubmit((data) => redefinir.mutate(data))(e);
        }}
        className="space-y-5"
        noValidate
      >
        <input type="hidden" {...register("token")} />

        <div className="space-y-1.5">
          <Label htmlFor="novaSenha" hint="Use no mínimo 8 caracteres.">Nova senha</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="novaSenha"
              type={showPass ? "text" : "password"}
              autoComplete="new-password"
              autoFocus
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
          <Label htmlFor="confirmar" hint="Repita a mesma senha para confirmar que digitou certo.">Confirmar senha</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="confirmar"
              type={showPass ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repita a senha"
              className="pl-10"
              {...register("confirmar")}
            />
          </div>
          {errors.confirmar && <p className="text-xs text-destructive">{errors.confirmar.message}</p>}
        </div>

        {redefinir.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{redefinir.error.message}</span>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={redefinir.isPending}>
          {redefinir.isPending ? (
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
      </form>
    </AuthShell>
  );
}
