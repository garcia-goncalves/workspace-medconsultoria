import { useState } from "react";
import { FileSignature, CheckCircle2, ShieldCheck, AlertTriangle, Loader2, Circle } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { dataHora } from "../../lib/format-date";
import { Button } from "../../components/ui/button";
import { SignaturePad, type AssinaturaValor } from "./SignaturePad";
import { TEXTO_CONSENTIMENTO_ASSINATURA } from "@app/shared";

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-brand-blueLight text-xs font-bold text-white">
            M
          </span>
          <span className="font-semibold">MedConsultoria</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}

export function AssinarPage({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const q = trpc.assinaturas.porToken.useQuery({ token });
  const assinar = trpc.assinaturas.assinar.useMutation({ onSuccess: () => utils.assinaturas.porToken.invalidate() });
  const [valor, setValor] = useState<AssinaturaValor>({ metodo: "DESENHO" });
  const [consentiu, setConsentiu] = useState(false);

  if (q.isLoading) {
    return (
      <Casca>
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Casca>
    );
  }
  // ⚠️ FALHA DE REDE NÃO É LINK INVÁLIDO — e a diferença aqui custa caro.
  //
  // Esta é a página que o médico abre DESLOGADO, no celular, numa rede qualquer. Juntar
  // `isError` com `!data` fazia um blip de conexão dizer a ele que o link morreu (e o TanStack
  // Query está com `retry: false`, então basta UMA tentativa falhar). Ele então pede outro link,
  // e a Med emite um segundo documento para o mesmo negócio.
  //
  // ⚠️ **Mas token inválido TAMBÉM chega como erro** — o servidor responde `NOT_FOUND`. Quem
  // separa as duas coisas é o CÓDIGO da resposta, não o fato de ter dado erro: só o que o
  // servidor recusou explicitamente é "link inválido"; o resto (rede, 500, timeout) é
  // "tente de novo". Um teste de ponta a ponta pegou exatamente esta confusão.
  const codigo = q.error?.data?.code;
  // PRECONDITION_FAILED = link EXPIRADO (ADR-141). Entra aqui para não ser lido como
  // falha de rede — e ganha tela própria abaixo, porque expirado não é inválido.
  const linkRecusadoPeloServidor =
    codigo === "NOT_FOUND" || codigo === "BAD_REQUEST" || codigo === "FORBIDDEN" || codigo === "PRECONDITION_FAILED";
  if (q.isError && !linkRecusadoPeloServidor) {
    return (
      <Casca>
        <div className="rounded-xl border bg-background p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-warning" />
          <h1 className="text-lg font-semibold">Não conseguimos carregar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Seu link continua valendo — foi a conexão com o nosso servidor que falhou. Tente de novo
            em alguns instantes.
          </p>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="mt-4 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Tentar de novo
          </button>
        </div>
      </Casca>
    );
  }
  // ⚠️ TRÊS frases, não duas: falha de rede (acima), EXPIRADO (aqui) e inválido (abaixo).
  // Dizer "link inválido" a quem tem o link certo, só velho, o faz achar que foi enganado —
  // e a saída dele é outra: pedir um novo, não conferir o endereço.
  if (codigo === "PRECONDITION_FAILED") {
    return (
      <Casca>
        <div className="rounded-xl border bg-background p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-warning" />
          <h1 className="text-lg font-semibold">Link expirado</h1>
          <p className="mt-1 text-sm text-muted-foreground">{q.error?.message}</p>
          <p className="mt-3 text-sm text-muted-foreground">
            Fale com a equipe da MedConsultoria pelo e-mail{" "}
            <a className="font-medium underline" href="mailto:contato@medconsultoria.com.br">
              contato@medconsultoria.com.br
            </a>
            .
          </p>
        </div>
      </Casca>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Casca>
        <div className="rounded-xl border bg-background p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-warning" />
          <h1 className="text-lg font-semibold">Link inválido</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Este link de assinatura não é válido. Confira se copiou o endereço inteiro, ou peça um novo à MedConsultoria.
          </p>
        </div>
      </Casca>
    );
  }

  const d = q.data;
  const assinado = d.status === "ASSINADO" || assinar.data?.ok;
  const preenchido = valor.metodo === "DESENHO" ? !!valor.imagem : !!valor.nomeDigitado?.trim();

  const listaSignatarios = (
    <div className="rounded-xl border bg-background p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Signatários</h2>
      <div className="space-y-1.5">
        {d.todas.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            {s.status === "ASSINADO" ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground/50" />
            )}
            <span className="font-medium">{s.nome}</span>
            <span className="text-xs text-muted-foreground">({s.papel === "CLIENTE" ? "Cliente" : "MedConsultoria"})</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {s.status === "ASSINADO" && s.assinadoEm ? dataHora(s.assinadoEm) : "pendente"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  if (assinado) {
    return (
      <Casca>
        <div className="space-y-4">
          <div className="rounded-xl border bg-background p-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
            <h1 className="text-xl font-semibold">Assinatura registrada!</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Obrigado, {d.signatario.nome}. Sua assinatura de <strong>“{d.documento.titulo}”</strong> foi registrada com
              data, hora e código de integridade.
            </p>
          </div>
          {listaSignatarios}
        </div>
      </Casca>
    );
  }

  return (
    <Casca>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <FileSignature className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
          <div>
            <h1 className="text-xl font-semibold leading-tight">{d.documento.titulo}</h1>
            <p className="text-sm text-muted-foreground">{d.signatario.nome}, revise o documento abaixo e assine.</p>
          </div>
        </div>

        {d.conteudoAlterado ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Este documento foi alterado após o envio. Por segurança, peça um novo link de assinatura à MedConsultoria.</span>
          </div>
        ) : (
          <>
            <div className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-xl border bg-background p-5 text-sm leading-relaxed">
              {d.documento.conteudo}
            </div>

            {listaSignatarios}

            <div className="rounded-xl border bg-background p-4">
              <h2 className="mb-2 text-sm font-semibold">Sua assinatura</h2>
              <SignaturePad onChange={setValor} />

              <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={consentiu}
                  onChange={(e) => setConsentiu(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                />
                {/* O texto vem do `@app/shared` porque é ELE que fica gravado como prova, por
                    versão. Escrito aqui, a frase lida e a frase provada podiam divergir. */}
                <span className="text-muted-foreground">{TEXTO_CONSENTIMENTO_ASSINATURA}</span>
              </label>

              {assinar.error && <p className="mt-2 text-sm text-destructive">{assinar.error.message}</p>}

              <Button
                size="lg"
                className="mt-3 w-full"
                disabled={!consentiu || !preenchido || assinar.isPending}
                onClick={() =>
                  assinar.mutate({
                    token,
                    metodo: valor.metodo,
                    imagem: valor.imagem,
                    nomeDigitado: valor.nomeDigitado,
                    consentimento: true,
                  })
                }
              >
                {assinar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
                Assinar documento
              </Button>
            </div>
          </>
        )}

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Assinatura eletrônica com trilha de auditoria (data, hora, IP e código de integridade).
        </p>
      </div>
    </Casca>
  );
}
