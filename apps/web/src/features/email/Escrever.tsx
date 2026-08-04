import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";
import { toast } from "../../components/ui/toast";
import { dividirEmails, emailValido, montarCorpoEnvio, temConteudoParaRascunho } from "./compor";

export type ModoEscrever = "novo" | "responder" | "responderTodos" | "encaminhar";

interface AnexoEnviado {
  id: string;
  nome: string;
}

/** Teto do schema (`enviarEmailSchema.anexos`) — não vale a pena subir o 21º pra descobrir isso no servidor. */
const MAX_ANEXOS = 20;

/**
 * Estilo mínimo para o preview da citação, que roda num documento isolado (`srcDoc`) e por isso
 * não herda NENHUM CSS da aplicação — sem isto ficaria com a cara padrão do navegador (Times).
 */
const ESTILO_CITACAO = `<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:12.5px;line-height:1.5;color:#333;margin:0;padding:10px;word-break:break-word}
  blockquote{color:#555}
  a{color:#0057b8}
</style>`;

/**
 * Uma tela só para escrever/responder/responder a todos/encaminhar — o modo muda o que vem
 * pré-preenchido, não a estrutura da tela (ADR-44: Modal com footer fixo).
 *
 * A assinatura da caixa é responsabilidade EXCLUSIVA do servidor (`envio.service.ts`), que a
 * anexa em todo envio — esta tela NUNCA a mostra, insere ou edita. Inserir aqui também duplicaria
 * a assinatura no e-mail que sai.
 */
export function Escrever({
  modo,
  caixaId,
  mensagemId,
  onFechar,
}: {
  modo: ModoEscrever;
  caixaId: string;
  /** Mensagem original — obrigatória nos modos de resposta/encaminhamento. */
  mensagemId?: string;
  onFechar: () => void;
}) {
  const utils = trpc.useUtils();

  const [paraTexto, setParaTexto] = useState("");
  const [ccTexto, setCcTexto] = useState("");
  const [ccoTexto, setCcoTexto] = useState("");
  const [mostrarCcCco, setMostrarCcCco] = useState(false);
  const [assunto, setAssunto] = useState("");
  const [corpoDigitado, setCorpoDigitado] = useState("");
  // Duas versões da citação (ADR — ver `citacao.ts`): `citacaoPreview` tem imagem remota
  // bloqueada e é a única que aparece na tela; `citacaoEnvio` tem a imagem restaurada e é a
  // única que entra no `corpoHtml` mandado para `email.enviar`. NUNCA trocar uma pela outra.
  const [citacaoPreview, setCitacaoPreview] = useState("");
  const [citacaoEnvio, setCitacaoEnvio] = useState("");
  const [anexos, setAnexos] = useState<AnexoEnviado[]>([]);
  const [anexando, setAnexando] = useState(false);
  const [preenchido, setPreenchido] = useState(modo === "novo");
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  const ehResposta = modo === "responder" || modo === "responderTodos";
  const resposta = trpc.email.prepararResposta.useQuery(
    { mensagemId: mensagemId ?? "", aTodos: modo === "responderTodos" },
    { enabled: ehResposta && !!mensagemId },
  );
  const encaminhamento = trpc.email.prepararEncaminhamento.useQuery(
    { mensagemId: mensagemId ?? "" },
    { enabled: modo === "encaminhar" && !!mensagemId },
  );

  // Pré-preenchimento roda UMA vez, quando o `preparar*` responder — nunca de novo depois (senão
  // um refetch em segundo plano apagaria o que a pessoa já digitou).
  useEffect(() => {
    if (preenchido) return;
    if (ehResposta && resposta.data) {
      setParaTexto(resposta.data.para.join(", "));
      setCcTexto(resposta.data.cc.join(", "));
      if (resposta.data.cc.length > 0) setMostrarCcCco(true);
      setAssunto(resposta.data.assunto);
      setCitacaoPreview(resposta.data.citacaoPreview);
      setCitacaoEnvio(resposta.data.citacaoEnvio);
      setPreenchido(true);
    } else if (modo === "encaminhar" && encaminhamento.data) {
      setAssunto(encaminhamento.data.assunto);
      setCitacaoPreview(encaminhamento.data.citacaoPreview);
      setCitacaoEnvio(encaminhamento.data.citacaoEnvio);
      setPreenchido(true);
    }
  }, [preenchido, ehResposta, modo, resposta.data, encaminhamento.data]);

  useEffect(() => {
    if (resposta.error) toast(resposta.error.message);
  }, [resposta.error]);
  useEffect(() => {
    if (encaminhamento.error) toast(encaminhamento.error.message);
  }, [encaminhamento.error]);

  const enviar = trpc.email.enviar.useMutation({
    onSuccess: (r) => {
      utils.email.mensagens.invalidate();
      toast(
        r.copiaEmEnviados
          ? "E-mail enviado."
          : "E-mail enviado, mas não consegui guardar a cópia em Enviados.",
        "success",
      );
      onFechar();
    },
    // A mensagem vem pronta do servidor — inclusive a trava de destino de teste fora de produção.
    onError: (e) => toast(e.message),
  });

  // UID (no servidor) do rascunho já gravado, para a próxima gravação regravar POR CIMA dele em
  // vez de duplicar. Fica em `ref` (não `state`) de propósito: não precisa causar re-render, e
  // `aoFechar` pode gravar depois do componente já ter desmontado (ver abaixo) sem o aviso de
  // "setState num componente desmontado" que uma `state` daria.
  const uidRascunhoRef = useRef<number | null>(null);
  const salvarRascunho = trpc.email.salvarRascunho.useMutation({
    onSuccess: (r) => {
      uidRascunhoRef.current = r.uid;
    },
    // Sem `onError`: rascunho é um detalhe — se esta gravação falhar (servidor fora, sem pasta
    // Drafts etc.), a próxima tentativa (5s depois, ou ao fechar de novo) resolve sozinha. Um
    // toast aqui só atrapalharia quem está no meio de escrever.
  });

  /**
   * Grava o que está na tela na pasta Drafts do servidor — só quando há conteúdo de verdade
   * (`temConteudoParaRascunho`), senão nasceria rascunho em branco a cada "Escrever" aberto e
   * fechado sem uma letra digitada.
   *
   * NUNCA é chamada pelo `onSuccess` do envio (`enviar`, acima): ali o fechamento continua
   * chamando `onFechar` puro. Se esta função rodasse depois de um envio bem-sucedido, todo
   * e-mail enviado geraria TAMBÉM um rascunho fantasma da mesma composição, parado para sempre
   * em Rascunhos — só esta função (via `aoFechar`) nunca aparece no caminho do envio.
   */
  const salvarRascunhoAgora = () => {
    if (
      !temConteudoParaRascunho({
        para: paraTexto,
        cc: ccTexto,
        cco: ccoTexto,
        assunto,
        corpo: corpoDigitado,
        citacao: citacaoEnvio,
      })
    ) {
      return;
    }
    salvarRascunho.mutate({
      caixaId,
      para: dividirEmails(paraTexto),
      cc: dividirEmails(ccTexto),
      cco: dividirEmails(ccoTexto),
      assunto,
      // O MESMO corpo que seria enviado (citação de envio, não a de preview) — ver comentário
      // de `citacaoPreview`/`citacaoEnvio` acima: nunca trocar uma pela outra.
      corpoHtml: montarCorpoEnvio(corpoDigitado, citacaoEnvio),
      uidAnterior: uidRascunhoRef.current ?? undefined,
    });
  };

  // Salva 5s depois da ÚLTIMA tecla — nunca a cada tecla (seria uma conexão IMAP por tecla). O
  // timer reinicia a cada mudança de campo; o cleanup cancela um save pendente se a pessoa
  // continuar digitando, ou some sozinho quando o componente desmonta.
  useEffect(() => {
    const id = window.setTimeout(salvarRascunhoAgora, 5000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paraTexto, ccTexto, ccoTexto, assunto, corpoDigitado, citacaoEnvio]);

  /** Fecha a tela salvando o rascunho pendente antes — Cancelar, X do modal, Esc e clique fora. */
  const aoFechar = () => {
    salvarRascunhoAgora();
    onFechar();
  };

  const subirAnexo = async (arquivo: File): Promise<AnexoEnviado> => {
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    const resp = await fetch("/email-anexo", { method: "POST", credentials: "include", body: fd });
    let corpo: { id?: string; nome?: string; error?: string } = {};
    try {
      corpo = await resp.json();
    } catch {
      /* resposta sem corpo JSON — cai no erro genérico abaixo */
    }
    if (!resp.ok || !corpo.id || !corpo.nome) {
      throw new Error(corpo.error ?? "Falha ao anexar o arquivo.");
    }
    return { id: corpo.id, nome: corpo.nome };
  };

  const anexar = async (arquivos: FileList | null) => {
    if (!arquivos || arquivos.length === 0) return;
    const lista = Array.from(arquivos);
    if (anexos.length + lista.length > MAX_ANEXOS) {
      toast(`São no máximo ${MAX_ANEXOS} anexos por e-mail.`);
      return;
    }
    setAnexando(true);
    try {
      // Um POST por arquivo — a rota só aceita um arquivo por requisição.
      for (const arquivo of lista) {
        const anexo = await subirAnexo(arquivo);
        setAnexos((prev) => [...prev, anexo]);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Falha ao anexar o arquivo.");
    } finally {
      setAnexando(false);
    }
  };

  const removerAnexo = (id: string) => setAnexos((prev) => prev.filter((a) => a.id !== id));

  const aoSubmeter = (e: React.FormEvent) => {
    e.preventDefault();
    const para = dividirEmails(paraTexto);
    const cc = dividirEmails(ccTexto);
    const cco = dividirEmails(ccoTexto);
    const todos = [...para, ...cc, ...cco];

    if (todos.length === 0) {
      toast("Informe pelo menos um destinatário.");
      return;
    }
    const invalido = todos.find((end) => !emailValido(end));
    if (invalido) {
      toast(`Endereço de e-mail inválido: ${invalido}`);
      return;
    }

    enviar.mutate({
      caixaId,
      para,
      cc,
      cco,
      assunto,
      corpoHtml: montarCorpoEnvio(corpoDigitado, citacaoEnvio),
      emRespostaA: ehResposta ? mensagemId : undefined,
      encaminhando: modo === "encaminhar" ? mensagemId : undefined,
      anexos,
    });
  };

  const titulo =
    modo === "responder"
      ? "Responder"
      : modo === "responderTodos"
        ? "Responder a todos"
        : modo === "encaminhar"
          ? "Encaminhar"
          : "Escrever";

  const carregandoPreparo = modo !== "novo" && !preenchido;

  return (
    <Modal
      open
      onClose={aoFechar}
      title={titulo}
      size="xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="submit" form="escrever-form" disabled={enviar.isPending || carregandoPreparo}>
            {enviar.isPending ? "Enviando…" : "Enviar"}
          </Button>
        </>
      }
    >
      <form id="escrever-form" onSubmit={aoSubmeter} className="space-y-3" noValidate>
        <div className="space-y-1">
          <Label htmlFor="esc-para" hint="Quem recebe o e-mail. Separe vários endereços por vírgula, ponto-e-vírgula ou espaço.">
            Para *
          </Label>
          <Input
            id="esc-para"
            value={paraTexto}
            onChange={(e) => setParaTexto(e.target.value)}
            placeholder="alguem@exemplo.com.br"
            autoComplete="off"
          />
        </div>

        {!mostrarCcCco && (
          <button
            type="button"
            onClick={() => setMostrarCcCco(true)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Cc/Cco
          </button>
        )}

        {mostrarCcCco && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="esc-cc">Cc</Label>
              <Input
                id="esc-cc"
                value={ccTexto}
                onChange={(e) => setCcTexto(e.target.value)}
                placeholder="(opcional) copia@exemplo.com.br"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="esc-cco">Cco</Label>
              <Input
                id="esc-cco"
                value={ccoTexto}
                onChange={(e) => setCcoTexto(e.target.value)}
                placeholder="(opcional) copia-oculta@exemplo.com.br"
                autoComplete="off"
              />
            </div>
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="esc-assunto">Assunto</Label>
          <Input
            id="esc-assunto"
            value={assunto}
            onChange={(e) => setAssunto(e.target.value)}
            placeholder="(opcional)"
            maxLength={500}
            autoComplete="off"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="esc-corpo">Mensagem</Label>
          <Textarea
            id="esc-corpo"
            value={corpoDigitado}
            onChange={(e) => setCorpoDigitado(e.target.value)}
            rows={10}
            placeholder="Escreva sua mensagem…"
          />
        </div>

        {citacaoPreview && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Mensagem citada (vai junto, sem edição):</p>
            <iframe
              title="Mensagem citada"
              sandbox=""
              srcDoc={ESTILO_CITACAO + citacaoPreview}
              className="h-40 w-full rounded-md border bg-white"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label hint="Até 20 MB por arquivo, no máximo 20 anexos por e-mail.">Anexos</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={anexando}
              onClick={() => inputArquivoRef.current?.click()}
            >
              <Paperclip className="mr-1.5 h-3.5 w-3.5" />
              {anexando ? "Anexando…" : "Anexar"}
            </Button>
            <input
              ref={inputArquivoRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void anexar(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {anexos.length > 0 && (
            <ul className="space-y-1">
              {anexos.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1 text-xs"
                >
                  <span className="truncate">{a.nome}</span>
                  <button
                    type="button"
                    onClick={() => removerAnexo(a.id)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remover anexo ${a.nome}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
    </Modal>
  );
}
