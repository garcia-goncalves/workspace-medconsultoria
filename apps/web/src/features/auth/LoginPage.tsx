import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle } from "lucide-react";
import { loginSchema, type LoginInput } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { sincronizarAutofill } from "../../lib/form-autofill";
import { AuthShell } from "./AuthShell";

export function LoginPage() {
  const utils = trpc.useUtils();
  const login = trpc.auth.login.useMutation({
    onSuccess: () => {
      // Entrou estando em `/login`? Tira a URL de login do caminho ANTES de a sessão existir,
      // senão a rota `/login` (agora "Você já está conectado") aparece no lugar do painel.
      if (window.location.pathname === "/login") window.history.replaceState({}, "", "/");
      utils.auth.me.invalidate();
    },
    onError: () => {
      // Limpa a SENHA e devolve o foco ao e-mail. O gerenciador do navegador costuma guardar a
      // senha de OUTRA conta: o campo continua parecendo preenchido (pontinhos), a pessoa troca
      // só o e-mail, tenta de novo e falha igual — sem nunca perceber. Limpar quebra esse laço.
      setValue("password", "");
      const senha = document.querySelector<HTMLInputElement>('input[name="password"]');
      if (senha) senha.value = "";
      document.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
    },
  });
  const [showPass, setShowPass] = useState(false);
  // Guarda o e-mail da ÚLTIMA tentativa para mostrá-lo no erro. O navegador costuma
  // autopreencher uma conta antiga; sem ver qual e-mail foi enviado, a pessoa jura que
  // digitou o certo e fica presa em "senha incorreta".
  const [emailTentado, setEmailTentado] = useState("");

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const avisarBloqueio = trpc.auth.registrarBloqueioNoNavegador.useMutation();

  const enviar = handleSubmit(
    (data) => {
      setEmailTentado(data.email);
      login.mutate(data);
    },
    (erros) => {
      // Validação barrou aqui: NENHUMA requisição de login sai. Sem este aviso, o servidor não
      // registra nada e "não consigo entrar" fica indepurável — foi o que aconteceu duas vezes.
      const motivo = Object.entries(erros)
        .map(([campo, e]) => `${campo}: ${e?.message ?? "inválido"}`)
        .join(" · ");
      const email = document.querySelector<HTMLInputElement>('input[name="email"]')?.value ?? "";
      avisarBloqueio.mutate({ email: email.slice(0, 200), motivo: motivo.slice(0, 200) });
    },
  );

  return (
    <AuthShell>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Acesse sua conta</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Informe seu e-mail e senha para entrar.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          // O autofill do Chrome escreve no DOM sem disparar o evento que o react-hook-form
          // escuta: sem isto, o formulário envia o que o React lembrava (vazio → "E-mail
          // inválido", ou uma conta antiga) em vez do que está na tela.
          sincronizarAutofill(e, setValue, ["email", "password"]);
          void enviar(e);
        }}
        className="space-y-5"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="voce@medconsultoria.com.br"
              className="pl-10"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "email-erro" : undefined}
              {...register("email")}
            />
          </div>
          {errors.email && <p id="email-erro" role="alert" className="text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Senha</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type={showPass ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              className="pl-10 pr-10"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "password-erro" : undefined}
              {...register("password")}
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
          {errors.password && <p id="password-erro" role="alert" className="text-xs text-destructive">{errors.password.message}</p>}
          <div className="flex justify-end pt-0.5">
            <a href="/esqueci-senha" className="text-xs font-medium text-primary hover:underline">
              Esqueci minha senha
            </a>
          </div>
        </div>

        {login.error && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {login.error.message}
              {emailTentado && (
                <>
                  {" "}
                  Tentamos entrar com <strong className="break-all">{emailTentado}</strong> — confira se é mesmo
                  o seu e-mail (o navegador pode ter preenchido outro).
                </>
              )}
            </span>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
          {login.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Entrando…
            </>
          ) : (
            <>
              Entrar
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Problemas para acessar? Fale com a MedConsultoria.
      </p>
    </AuthShell>
  );
}
