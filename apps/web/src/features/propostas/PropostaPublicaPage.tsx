import { useState } from "react";
import { CheckCircle2, XCircle, ShieldCheck, AlertTriangle, Loader2, ThumbsUp, ThumbsDown } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { DocumentoBranded } from "../documentos/DocumentoBranded";

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-brand-blueLight text-xs font-bold text-white">
            M
          </span>
          <span className="font-semibold">MedConsultoria</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}

export function PropostaPublicaPage({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const q = trpc.propostas.porToken.useQuery({ token });
  const responder = trpc.propostas.responder.useMutation({ onSuccess: () => utils.propostas.porToken.invalidate({ token }) });
  // Fluxo em passos p/ evitar aceite/recusa por engano: "acao" → confirma "aceitar" ou informa "recusar".
  const [modo, setModo] = useState<"acao" | "aceitar" | "recusar">("acao");
  const [motivo, setMotivo] = useState("");

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
            Este link de proposta não é válido. Confira se copiou o endereço inteiro, ou peça um novo à MedConsultoria.
          </p>
        </div>
      </Casca>
    );
  }

  const d = q.data;
  const decisao = responder.data?.decisao ?? (d.status !== "PENDENTE" ? d.status : null);
  const respondida = decisao === "ACEITA" || decisao === "RECUSADA";

  const documento = (
    <div className="overflow-hidden rounded-xl border bg-muted/30 p-4 sm:p-6">
      <DocumentoBranded
        tipo="Proposta"
        titulo={d.documento.titulo}
        clienteNome={d.clienteNome}
        conteudoMarkdown={d.documento.conteudo}
      />
    </div>
  );

  if (respondida) {
    const aceita = decisao === "ACEITA";
    return (
      <Casca>
        <div className="space-y-4">
          <div className="rounded-xl border bg-background p-8 text-center">
            {aceita ? (
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
            ) : (
              <XCircle className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            )}
            <h1 className="text-xl font-semibold">{aceita ? "Proposta aceita! 🎉" : "Proposta recusada"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {aceita
                ? "Obrigado! A nossa equipe já foi avisada e dará sequência com os próximos passos."
                : "Tudo bem — registramos a sua resposta e a equipe entrará em contato. Obrigado pelo retorno."}
            </p>
          </div>
          {documento}
        </div>
      </Casca>
    );
  }

  if (d.conteudoAlterado) {
    return (
      <Casca>
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Esta proposta foi atualizada após o envio. Por segurança, peça um novo link à MedConsultoria.</span>
          </div>
          {documento}
        </div>
      </Casca>
    );
  }

  return (
    <Casca>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold leading-tight">{d.documento.titulo}</h1>
          <p className="text-sm text-muted-foreground">
            {d.clienteNome ? `${d.clienteNome}, r` : "R"}evise a proposta abaixo e responda com um clique.
          </p>
        </div>

        {documento}

        {responder.error && <p className="text-sm text-destructive">{responder.error.message}</p>}

        {modo === "recusar" ? (
          <div className="rounded-xl border bg-background p-4">
            <h2 className="mb-2 text-sm font-semibold">Conte rapidamente o motivo</h2>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder="Ex.: o valor ficou acima do previsto, o prazo não atende…"
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1"
                disabled={responder.isPending}
                onClick={() => setModo("acao")}
              >
                Voltar
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!motivo.trim() || responder.isPending}
                onClick={() => responder.mutate({ token, decisao: "RECUSADA", motivo: motivo.trim() })}
              >
                {responder.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsDown className="h-4 w-4" />}
                Recusar proposta
              </Button>
            </div>
          </div>
        ) : modo === "aceitar" ? (
          <div className="rounded-xl border border-primary/30 bg-background p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ThumbsUp className="h-4 w-4 text-primary" />
              Confirmar o aceite
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Você está aceitando a proposta <strong>“{d.documento.titulo}”</strong>. Ao confirmar, a nossa equipe é
              avisada e dá sequência com os próximos passos.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1"
                disabled={responder.isPending}
                onClick={() => setModo("acao")}
              >
                Voltar
              </Button>
              <Button
                className="flex-1"
                disabled={responder.isPending}
                onClick={() => responder.mutate({ token, decisao: "ACEITA" })}
              >
                {responder.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Sim, aceitar proposta
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              disabled={responder.isPending}
              onClick={() => setModo("recusar")}
            >
              <ThumbsDown className="h-4 w-4" />
              Recusar
            </Button>
            <Button size="lg" className="flex-1" disabled={responder.isPending} onClick={() => setModo("aceitar")}>
              <ThumbsUp className="h-4 w-4" />
              Aceitar proposta
            </Button>
          </div>
        )}

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Sua resposta fica registrada com data, hora e código de integridade da proposta.
        </p>
      </div>
    </Casca>
  );
}
