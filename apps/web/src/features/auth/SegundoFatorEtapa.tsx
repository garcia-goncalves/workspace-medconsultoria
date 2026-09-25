import { useState } from "react";
import { Loader2, ShieldCheck, AlertCircle, ArrowLeft } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

/**
 * A SEGUNDA ETAPA DO LOGIN (onda 4C) — o código do aplicativo autenticador.
 *
 * Aparece depois da senha certa de quem ativou a verificação em duas etapas, e também depois de
 * redefinir a senha ou aceitar um convite: nenhum desses caminhos pula o código (o servidor
 * devolve o mesmo desafio nos três). Um componente só para as três telas, para a regra de "o que
 * aceitar e o que dizer" não divergir entre elas.
 *
 * Aceita os 6 dígitos OU um código de recuperação — a mesma caixa, porque quem perdeu o celular
 * está estressado e não deve ter de achar um segundo formulário.
 */
export function SegundoFatorEtapa({ desafio, onVoltar }: { desafio: string; onVoltar: () => void }) {
  const utils = trpc.useUtils();
  const [codigo, setCodigo] = useState("");
  const [usarRecuperacao, setUsarRecuperacao] = useState(false);
  const confirmar = trpc.auth.confirmarSegundoFator.useMutation({
    onSuccess: () => {
      // Mesma saída do login comum: tira `/login` (ou o link do e-mail) do caminho e recarrega o
      // `me` — o App troca a tela sozinho para o painel ou para o Portal.
      if (window.location.pathname !== "/") window.history.replaceState({}, "", "/");
      void utils.auth.me.invalidate();
    },
    onError: (e) => {
      setCodigo("");
      // O servidor não consegue conferir o código do aplicativo (chave do servidor ausente —
      // achado B3). A frase dele já diz o que fazer; aqui a caixa troca sozinha para o código de
      // recuperação, que é o único que abre a porta nesse estado. Só chega aqui quem acertou a
      // senha, então não há o que esconder.
      if (e.data?.code === "PRECONDITION_FAILED") setUsarRecuperacao(true);
    },
  });
  // Desafio vencido (5 min): não adianta outro código, é preciso digitar a senha de novo. O
  // servidor diz isso com uma frase própria — a de código errado é outra.
  const expirou = confirmar.error?.message.includes("expirou") ?? false;
  const podeEnviar = codigo.trim().length >= 6 && !confirmar.isPending;

  return (
    <div>
      <div className="mb-8">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Verificação em duas etapas</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {usarRecuperacao
            ? "Digite um dos códigos de recuperação que você guardou ao ativar. Cada um vale uma vez."
            : "Abra o aplicativo autenticador no celular e digite o código de 6 dígitos da MedConsultoria."}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (podeEnviar) confirmar.mutate({ desafio, codigo: codigo.trim() });
        }}
        className="space-y-5"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="codigo-2fa">{usarRecuperacao ? "Código de recuperação" : "Código"}</Label>
          <Input
            id="codigo-2fa"
            autoFocus
            autoComplete="one-time-code"
            inputMode={usarRecuperacao ? "text" : "numeric"}
            maxLength={usarRecuperacao ? 24 : 7}
            placeholder={usarRecuperacao ? "XXXX-XXXX-XXXX-XXXX" : "000000"}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            className={usarRecuperacao ? "font-mono uppercase" : "font-mono text-lg tracking-[0.4em]"}
          />
        </div>

        {confirmar.error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{confirmar.error.message}</span>
          </div>
        )}

        {expirou ? (
          <Button type="button" size="lg" className="w-full" onClick={onVoltar}>
            Entrar de novo
          </Button>
        ) : (
          <Button type="submit" size="lg" className="w-full" disabled={!podeEnviar}>
            {confirmar.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Conferindo…
              </>
            ) : (
              "Confirmar"
            )}
          </Button>
        )}
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onVoltar}
          className="flex min-h-11 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar
        </button>
        <button
          type="button"
          onClick={() => {
            setUsarRecuperacao((v) => !v);
            setCodigo("");
            confirmar.reset();
          }}
          className="flex min-h-11 items-center text-xs font-medium text-primary hover:underline"
        >
          {usarRecuperacao ? "Usar o código do aplicativo" : "Perdi o celular — usar código de recuperação"}
        </button>
      </div>
    </div>
  );
}
