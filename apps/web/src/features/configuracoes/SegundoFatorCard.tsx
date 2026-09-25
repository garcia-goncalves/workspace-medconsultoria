import { useState } from "react";
import { ShieldCheck, ShieldAlert, Copy, Download, Smartphone, Loader2 } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { data as formatarData } from "../../lib/format-date";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { toast } from "../../components/ui/toast";
import { agruparChave, textoDosCodigos } from "./segundo-fator-texto";

/**
 * VERIFICAÇÃO EM DUAS ETAPAS da própria conta (onda 4C).
 *
 * Três momentos, e cada um mostra uma coisa só:
 *  1. **desligada** → um botão;
 *  2. **ativando** → a chave para o aplicativo e a caixa do primeiro código (sem o código certo,
 *     nada muda: o login continua só com a senha — quem desistir no meio não fica trancado fora);
 *  3. **acabou de ativar** → os 10 códigos de recuperação, UMA vez. Eles não voltam: o servidor
 *     guarda só o hash, e a tela diz isso antes de a pessoa fechar.
 *
 * ⚠️ QR CODE: não há gerador de QR no projeto e a casa não adiciona biblioteca para o que dá para
 * resolver sem ela. Todo aplicativo autenticador aceita a chave digitada ("inserir chave de
 * configuração"), e no celular o link `otpauth://` abre o aplicativo direto. Se um dia o QR fizer
 * falta de verdade, é aqui que ele entra.
 */
export function SegundoFatorCard() {
  const utils = trpc.useUtils();
  const status = trpc.auth.segundoFator.status.useQuery();
  const [ativacao, setAtivacao] = useState<{ chave: string; uri: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  // A senha é pedida para ATIVAR também: quem só roubou a sessão não cadastra o próprio celular.
  const [senhaAtivar, setSenhaAtivar] = useState("");
  const [codigosNovos, setCodigosNovos] = useState<string[] | null>(null);
  const [desativando, setDesativando] = useState(false);
  const [senha, setSenha] = useState("");
  const [codigoDesativar, setCodigoDesativar] = useState("");

  const recarregar = () => utils.auth.segundoFator.status.invalidate();
  const iniciar = trpc.auth.segundoFator.iniciar.useMutation({
    onSuccess: (r) => {
      setAtivacao(r);
      setCodigo("");
    },
    onError: (e) => toast(e.message),
  });
  const confirmar = trpc.auth.segundoFator.confirmar.useMutation({
    onSuccess: (r) => {
      setAtivacao(null);
      setCodigo("");
      setSenhaAtivar("");
      setCodigosNovos(r.codigosRecuperacao);
      void recarregar();
    },
  });
  const desativar = trpc.auth.segundoFator.desativar.useMutation({
    onSuccess: () => {
      setDesativando(false);
      setSenha("");
      setCodigoDesativar("");
      toast("Verificação em duas etapas desativada.");
      void recarregar();
    },
  });

  const s = status.data;
  // Quem não é ADMIN/ROOT e nunca ativou não tem o que fazer aqui. Quem foi rebaixado com o 2FA
  // ligado continua vendo o cartão — precisa conseguir desligar.
  if (!s || (!s.recomendado && !s.ativo)) return null;

  const copiar = async (texto: string, aviso: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast(aviso);
    } catch {
      toast("Não foi possível copiar. Selecione o texto e copie à mão.");
    }
  };

  const baixarCodigos = (codigos: string[]) => {
    const url = URL.createObjectURL(new Blob([textoDosCodigos(codigos)], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "codigos-de-recuperacao-medconsultoria.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {s.ativo ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldAlert className="h-4 w-4 text-warning" />}
          Verificação em duas etapas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {codigosNovos ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-success">Ativada. Agora guarde os códigos de recuperação.</p>
            <p className="text-sm text-muted-foreground">
              Se perder o celular, cada código abaixo entra <strong>uma vez</strong> no lugar do código do aplicativo. Eles{" "}
              <strong>não serão mostrados de novo</strong> — guarde num lugar seguro, fora deste computador.
            </p>
            <ul className="grid grid-cols-1 gap-1.5 rounded-lg border bg-muted/40 p-3 font-mono text-sm sm:grid-cols-2">
              {codigosNovos.map((c) => (
                <li key={c} className="select-all">
                  {c}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void copiar(codigosNovos.join("\n"), "Códigos copiados.")}>
                <Copy className="h-4 w-4" />
                Copiar
              </Button>
              <Button type="button" variant="outline" onClick={() => baixarCodigos(codigosNovos)}>
                <Download className="h-4 w-4" />
                Baixar .txt
              </Button>
              <Button type="button" onClick={() => setCodigosNovos(null)}>
                Já guardei
              </Button>
            </div>
          </div>
        ) : s.ativo ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ativa desde {s.ativadoEm ? formatarData(s.ativadoEm) : "—"}. Ao entrar, além da senha, o sistema pede o código do aplicativo.
            </p>
            <p className={s.codigosRestantes <= 3 ? "text-sm font-medium text-warning" : "text-sm text-muted-foreground"}>
              {s.codigosRestantes === 1 ? "Resta 1 código de recuperação." : `Restam ${s.codigosRestantes} códigos de recuperação.`}
              {s.codigosRestantes <= 3 && " Para gerar novos, desative e ative de novo."}
            </p>
            {desativando ? (
              <form
                className="space-y-3 rounded-lg border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  desativar.mutate({ senha, codigo: codigoDesativar.trim() });
                }}
                noValidate
              >
                <p className="text-sm text-muted-foreground">
                  Para desligar, confirme a sua senha e um código do aplicativo (ou de recuperação).
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="sf-senha">Senha</Label>
                    <Input
                      id="sf-senha"
                      type="password"
                      autoComplete="current-password"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sf-codigo-desativar">Código</Label>
                    <Input
                      id="sf-codigo-desativar"
                      autoComplete="one-time-code"
                      value={codigoDesativar}
                      onChange={(e) => setCodigoDesativar(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </div>
                {desativar.error && <p className="text-sm text-destructive">{desativar.error.message}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="destructive" disabled={desativar.isPending || !senha || codigoDesativar.trim().length < 6}>
                    Desativar
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setDesativando(false)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : (
              <Button type="button" variant="outline" onClick={() => setDesativando(true)}>
                Desativar
              </Button>
            )}
          </div>
        ) : !s.disponivel ? (
          <p className="text-sm text-muted-foreground">
            A verificação em duas etapas ainda não foi configurada neste servidor. Peça a quem administra a hospedagem para definir a chave{" "}
            <code className="rounded bg-muted px-1">TOTP_CRYPTO_KEY</code>.
          </p>
        ) : ativacao ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              confirmar.mutate({ senha: senhaAtivar, codigo: codigo.trim() });
            }}
            noValidate
          >
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>Instale um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
              <li>
                No aplicativo, escolha <em>inserir chave de configuração</em> e digite a chave abaixo — ou, no celular, toque em{" "}
                <em>Abrir no aplicativo</em>.
              </li>
              <li>Digite o código de 6 dígitos que aparecer.</li>
            </ol>
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Chave</div>
              <div className="mt-1 select-all break-all font-mono text-sm">{agruparChave(ativacao.chave)}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void copiar(ativacao.chave, "Chave copiada.")}>
                  <Copy className="h-4 w-4" />
                  Copiar chave
                </Button>
                <a
                  href={ativacao.uri}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent"
                >
                  <Smartphone className="h-4 w-4" />
                  Abrir no aplicativo
                </a>
              </div>
            </div>
            <div className="grid max-w-md gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sf-senha-ativar">Sua senha</Label>
                <Input
                  id="sf-senha-ativar"
                  type="password"
                  autoComplete="current-password"
                  value={senhaAtivar}
                  onChange={(e) => setSenhaAtivar(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sf-codigo">Código do aplicativo</Label>
                <Input
                  id="sf-codigo"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={7}
                  placeholder="000000"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  className="font-mono tracking-[0.3em]"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Ao ativar, as suas outras sessões abertas (outros navegadores e computadores) são encerradas.
            </p>
            {confirmar.error && <p className="text-sm text-destructive">{confirmar.error.message}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={confirmar.isPending || !senhaAtivar || codigo.trim().length < 6}>
                {confirmar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar e ativar
              </Button>
              <Button type="button" variant="outline" onClick={() => setAtivacao(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Protege a sua conta mesmo se a senha vazar: para entrar, além dela, o sistema pede um código do seu celular.
            </p>
            <Button type="button" onClick={() => iniciar.mutate()} disabled={iniciar.isPending}>
              Ativar verificação em duas etapas
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
