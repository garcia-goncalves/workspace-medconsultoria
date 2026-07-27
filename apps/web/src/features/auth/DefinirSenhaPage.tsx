import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, Eye, EyeOff, ArrowRight, AlertCircle, ShieldCheck } from "lucide-react";
import { aceitarConviteSchema, type AceitarConviteInput } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { sincronizarAutofill } from "../../lib/form-autofill";
import { AuthShell } from "./AuthShell";

export function DefinirSenhaPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const info = trpc.auth.validarConvite.useQuery({ token }, { enabled: !!token, retry: false });
  const utils = trpc.useUtils();
  const aceitar = trpc.auth.aceitarConvite.useMutation({
    onSuccess: () => {
      void utils.auth.me.invalidate();
      window.location.href = "/"; // entra direto (já autenticado)
    },
  });
  const [showPass, setShowPass] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AceitarConviteInput>({
    resolver: zodResolver(aceitarConviteSchema),
    defaultValues: { token, novaSenha: "", confirmar: "" },
  });

  const conviteInvalido = !token || (info.isFetched && !info.data?.valido);

  if (info.isLoading) {
    return (
      <AuthShell>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </AuthShell>
    );
  }

  if (conviteInvalido) {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Convite inválido ou expirado</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Este link não é mais válido. Peça um novo convite ao administrador do workspace.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            Ir para o login
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
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Olá{info.data?.nome?.split(" ")[0] ? `, ${info.data.nome.split(" ")[0]}` : ""}!
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Defina sua senha para ativar o acesso de <strong>{info.data?.email}</strong>.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          // Gerenciador de senhas autopreenche sem disparar o evento que o RHF escuta.
          sincronizarAutofill(e, setValue, ["novaSenha", "confirmar"]);
          void handleSubmit((data) => aceitar.mutate(data))(e);
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

        {aceitar.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{aceitar.error.message}</span>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={aceitar.isPending}>
          {aceitar.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Ativando…
            </>
          ) : (
            <>
              Definir senha e entrar
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
