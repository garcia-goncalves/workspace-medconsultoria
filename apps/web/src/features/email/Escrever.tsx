import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { cn } from "@app/ui";
import { trpc } from "../../lib/trpc";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";
import { toast } from "../../components/ui/toast";
import { dividirEmails, emailValido, formatarTamanho, montarCorpoEnvio, temConteudoParaRascunho } from "./compor";
import { useRascunhoAutomatico } from "./useRascunhoAutomatico";

export type ModoEscrever = "novo" | "responder" | "responderTodos" | "encaminhar";

/** Arquivo que a pessoa acabou de subir por `POST /email-anexo` (vive num temporário nosso). */
interface AnexoEnviado {
  id: string;
  nome: string;
  tamanho: number;
}

/**
 * Anexo que veio do e-mail sendo encaminhado (`prepararEncaminhamento`). NÃO é arquivo nosso:
 * só o id viaja: o servidor rebaixa o conteúdo do IMAP na hora de enviar, e tira o nome do banco.
 * Tirar um destes da lista não apaga nada — só deixa de levá-lo no encaminhamento.
 */
interface AnexoOriginal {
  id: string;
  nome: string;
  tamanho: number;
}

/** Teto do schema (`enviarEmailSchema.anexos`) — não vale a pena subir o 21º pra descobrir isso no servidor. */
const MAX_ANEXOS = 20;

/**
 * Teto REAL do servidor: `LIMITE_ANEXOS_BYTES` em `envio.service.ts` — 25 MB SOMANDO os anexos
 * novos e os que vieram do e-mail original. Conferir aqui evita subir um arquivo de 30 MB pela
 * rede inteira só para o envio ser recusado no fim.
 */
const LIMITE_TOTAL_BYTES = 25 * 1024 * 1024;

/**
 * Teto POR ARQUIVO da rota de upload (`TAMANHO_MAX`, `lib/storage.ts`). Sem conferir aqui, um
 * arquivo de 22 MB sobe pela rede inteira só para voltar 413 — e num link lento isso são minutos.
 */
const LIMITE_ARQUIVO_BYTES = 20 * 1024 * 1024;

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
  // Duas versões da citação, montadas no servidor (`citacao.ts`): `citacaoPreview` é a única que
  // aparece na tela; `citacaoEnvio` é a única que entra no `corpoHtml` mandado para `email.enviar`.
  // NUNCA trocar uma pela outra: a oposição entre elas é a decisão de segurança do módulo — quem
  // encaminha nunca repassa o pixel de rastreio do remetente ao cliente.
  // Hoje as duas chegam iguais na prática (o corpo é gravado no banco JÁ higienizado, sem o `src`
  // remoto original, então "restaurar a imagem no envio" é um no-op) — manter os dois campos
  // separados é o que impede a regra de sumir quando o corpo cru voltar a ser guardado.
  const [citacaoPreview, setCitacaoPreview] = useState("");
  const [citacaoEnvio, setCitacaoEnvio] = useState("");
  const [anexos, setAnexos] = useState<AnexoEnviado[]>([]);
  const [anexosOriginais, setAnexosOriginais] = useState<AnexoOriginal[]>([]);
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
      // Já vêm marcados: encaminhar um e-mail cujo ponto inteiro É o PDF é o caso normal, não a
      // exceção. Quem não quiser levar algum tira da lista.
      setAnexosOriginais(encaminhamento.data.anexos);
      setPreenchido(true);
    }
  }, [preenchido, ehResposta, modo, resposta.data, encaminhamento.data]);

  useEffect(() => {
    if (resposta.error) toast(resposta.error.message);
  }, [resposta.error]);
  useEffect(() => {
    if (encaminhamento.error) toast(encaminhamento.error.message);
  }, [encaminhamento.error]);

  // Achado 2 (React) — o toast do efeito acima SOME sozinho. Se `prepararResposta`/
  // `prepararEncaminhamento` cair em erro (rede, caixa fora do ar, mensagem apagada), o
  // pré-preenchimento acima nunca seta `preenchido = true` — sem isto, `carregandoPreparo` fica
  // `true` PARA SEMPRE, o botão Enviar morre desabilitado, e a única pista já sumiu da tela.
  // Guardamos o erro e o `refetch` certo para mostrar um estado PERSISTENTE no corpo do modal.
  //
  // O `!preenchido` no começo é o que impede a tarja de aparecer sobre um formulário já pronto:
  // depois do pré-preenchimento, um refetch em segundo plano que falhe não tira nada da tela — o
  // texto e os campos continuam certos ali —, e mostrar erro nesse ponto só assustaria.
  const erroPreparo =
    !preenchido && (ehResposta ? resposta.isError : modo === "encaminhar" ? encaminhamento.isError : false);
  const refazerPreparo = ehResposta ? resposta.refetch : encaminhamento.refetch;
  const refazendoPreparo = ehResposta ? resposta.isFetching : modo === "encaminhar" ? encaminhamento.isFetching : false;

  /**
   * Responder/encaminhar SEM a mensagem original: as duas queries ficam desligadas (`enabled`),
   * então nada nunca carrega e o Enviar fica desabilitado para sempre. Não deveria acontecer
   * (`EmailPage` só abre esses modos com a mensagem aberta na mão), mas até aqui a tela precisa
   * explicar o que houve em vez de parecer travada.
   */
  const faltaMensagem = modo !== "novo" && !mensagemId;

  // Rascunho automático na pasta Drafts do servidor — lógica isolada em `useRascunhoAutomatico`
  // (testável com timers falsos, sem montar tRPC) para cobrir 3 defeitos: timer disparando NO
  // MEIO do envio, rascunho órfão depois de enviar, e duas gravações em voo ao mesmo tempo.
  const salvarRascunhoMutation = trpc.email.salvarRascunho.useMutation();
  const descartarRascunhoMutation = trpc.email.descartarRascunho.useMutation();
  const rascunho = useRascunhoAutomatico({
    temConteudo: () =>
      temConteudoParaRascunho({
        para: paraTexto,
        cc: ccTexto,
        cco: ccoTexto,
        assunto,
        corpo: corpoDigitado,
        citacao: citacaoEnvio,
      }),
    compor: () => ({
      caixaId,
      para: dividirEmails(paraTexto),
      cc: dividirEmails(ccTexto),
      cco: dividirEmails(ccoTexto),
      assunto,
      // O MESMO corpo que seria enviado (citação de envio, não a de preview) — ver comentário
      // de `citacaoPreview`/`citacaoEnvio` acima: nunca trocar uma pela outra.
      corpoHtml: montarCorpoEnvio(corpoDigitado, citacaoEnvio),
    }),
    salvar: (input) => salvarRascunhoMutation.mutateAsync(input),
    descartar: (uid) => descartarRascunhoMutation.mutateAsync({ caixaId, uid }),
  });

  // Salva 5s depois da ÚLTIMA tecla — nunca a cada tecla (seria uma conexão IMAP por tecla). O
  // timer reinicia a cada mudança de campo; o cleanup cancela um save pendente se a pessoa
  // continuar digitando, ou some sozinho quando o componente desmonta.
  useEffect(() => {
    rascunho.agendar();
    return rascunho.cancelarPendente;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paraTexto, ccTexto, ccoTexto, assunto, corpoDigitado, citacaoEnvio]);

  /**
   * `onSuccess`/`onError` de `useMutation` são chamados pela MUTAÇÃO do query-core, não pelo
   * observer — então eles rodam mesmo com este componente já desmontado. Isso é bom para tudo que
   * é global (o toast do resultado, invalidar a lista, apagar o rascunho no servidor) e é
   * DESASTRE para `onFechar()`: a pessoa fecha um envio lento (o SMTP tem `socketTimeout` de 45s),
   * começa a escrever OUTRO e-mail, e o envio antigo termina fechando a composição nova no meio da
   * digitação — levando junto o texto dos últimos 5s, que o cleanup do timer cancela antes de
   * gravar. Perder texto é o que este módulo inteiro existe para evitar.
   */
  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  const enviar = trpc.email.enviar.useMutation({
    onSuccess: (r) => {
      utils.email.mensagens.invalidate();
      toast(
        r.copiaEmEnviados
          ? "E-mail enviado."
          : "E-mail enviado, mas não consegui guardar a cópia em Enviados.",
        "success",
      );
      // Apaga no servidor o rascunho da composição que acabou de sair — sem isto, todo e-mail
      // que passou 5s parado antes de enviar deixava uma cópia desatualizada em Rascunhos.
      rascunho.descartarAposEnvio();
      // Só fecha se esta tela AINDA for esta tela (ver o comentário de `montadoRef`).
      if (montadoRef.current) onFechar();
    },
    onError: (e) => {
      // A mensagem vem pronta do servidor — inclusive a trava de destino de teste fora de produção.
      toast(e.message);
      // O envio falhou: a pessoa continua na tela, então os rascunhos precisam voltar a gravar
      // normalmente (sem isto, `enviando` ficaria ligado para sempre e nenhum rascunho novo salvaria).
      rascunho.aoEnvioFalhou();
    },
  });

  /** Fecha a tela salvando o rascunho pendente antes — Cancelar, X do modal, Esc e clique fora. */
  const aoFechar = () => {
    rascunho.aoFechar();
    onFechar();
  };

  /** Tudo que vai pendurado no e-mail: o que a pessoa subiu + o que veio do original. */
  const bytesAnexos =
    anexos.reduce((s, a) => s + a.tamanho, 0) + anexosOriginais.reduce((s, a) => s + a.tamanho, 0);

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
    return { id: corpo.id, nome: corpo.nome, tamanho: arquivo.size };
  };

  const anexar = async (arquivos: FileList | null) => {
    if (!arquivos || arquivos.length === 0) return;
    const lista = Array.from(arquivos);
    if (anexos.length + lista.length > MAX_ANEXOS) {
      toast(`São no máximo ${MAX_ANEXOS} arquivos anexados por e-mail.`);
      return;
    }
    // Conferido ANTES de subir: o servidor recusa o envio acima de 25 MB somados, e descobrir
    // isso só na hora de enviar significaria ter subido o arquivo inteiro à toa.
    const grande = lista.find((f) => f.size > LIMITE_ARQUIVO_BYTES);
    if (grande) {
      toast(`"${grande.name}" tem ${formatarTamanho(grande.size)} — cada arquivo pode ter no máximo 20 MB.`);
      return;
    }
    const novoTotal = bytesAnexos + lista.reduce((s, f) => s + f.size, 0);
    if (novoTotal > LIMITE_TOTAL_BYTES) {
      toast(
        `Tudo somado daria ${formatarTamanho(novoTotal)} — o limite é 25 MB por e-mail. ` +
          "Tire algum anexo ou mande o arquivo por link.",
      );
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
  /** Só tira da lista de envio — o anexo continua no e-mail original, intocado. */
  const removerAnexoOriginal = (id: string) => setAnexosOriginais((prev) => prev.filter((a) => a.id !== id));

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

    // As duas travas de anexo, aqui e não só no aviso da tela: sem elas a mutação sai, o servidor
    // recusa, e o que a pessoa lê é a mensagem de validação do zod (uma lista de `issues`) ou o
    // erro de 25 MB depois de o envio inteiro ter viajado.
    if (anexosOriginais.length > MAX_ANEXOS) {
      toast(
        `Dá para levar no máximo ${MAX_ANEXOS} anexos do e-mail original — tire ${anexosOriginais.length - MAX_ANEXOS} da lista.`,
      );
      return;
    }
    if (bytesAnexos > LIMITE_TOTAL_BYTES) {
      toast(`Os anexos somam ${formatarTamanho(bytesAnexos)} — o limite é 25 MB por e-mail. Tire algum da lista.`);
      return;
    }

    // Cancela o timer de 5s ANTES de mandar (achado 1): sem isto, um envio lento (SMTP + cópia em
    // Enviados + marcar respondida) deixa o timer disparar NO MEIO do envio e gravar um rascunho
    // que ninguém mais remove.
    rascunho.aoComecarEnvio();
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
      // Só os ids: o conteúdo nunca passa pelo navegador — quem rebaixa do IMAP é o servidor, que
      // também tira o nome do banco (nome vindo do cliente não seria confiável).
      anexosOriginais: anexosOriginais.map((a) => a.id),
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
          {/* Enquanto o envio está em voo este botão SÓ fecha a tela — não cancela nada (não
              existe desfazer um e-mail que já saiu), e por isso ele muda de nome. Desabilitá-lo,
              como se fazia antes, era incoerente: o X, o Esc e o clique fora continuavam fechando
              do mesmo jeito. Ou as três portas se comportam igual, ou nenhuma — e trancar as três
              seria pior: o SMTP tem `socketTimeout` de 45s (`smtp.ts`), então um servidor lento
              prenderia a pessoa no modal por quase um minuto. O resultado do envio chega pelo
              toast, com a tela já fechada. */}
          <Button type="button" variant="outline" onClick={aoFechar}>
            {enviar.isPending ? "Fechar" : "Cancelar"}
          </Button>
          <Button type="submit" form="escrever-form" disabled={enviar.isPending || carregandoPreparo}>
            {enviar.isPending ? "Enviando…" : "Enviar"}
          </Button>
        </>
      }
    >
      <form id="escrever-form" onSubmit={aoSubmeter} className="space-y-3" noValidate>
        {faltaMensagem && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Esta tela precisa da mensagem original e ela não veio. Feche, abra o e-mail que você
            quer {modo === "encaminhar" ? "encaminhar" : "responder"} e tente por ali.
          </div>
        )}
        {erroPreparo && (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <p>
              Não deu para carregar {modo === "encaminhar" ? "a mensagem que você está encaminhando" : "a mensagem original"}.
              Verifique a conexão e tente de novo.
            </p>
            {/* Sem o `disabled`, clicar duas vezes parecia que nada tinha acontecido: a busca leva
                alguns segundos e a tarja continuava idêntica no meio do caminho. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refazendoPreparo}
              onClick={() => void refazerPreparo()}
            >
              {refazendoPreparo ? "Tentando…" : "Tentar de novo"}
            </Button>
          </div>
        )}
        {/* Achado 3 (React) — envolve TODOS os campos (não só o botão Enviar): enquanto o envio
            está em voo, editar Para/Cc/Cco/Assunto/Corpo não muda nada no que está saindo (o
            payload já foi capturado por valor em `enviar.mutate`, logo abaixo) — deixar os campos
            editáveis prometia um efeito que eles não têm. */}
        <fieldset disabled={enviar.isPending} className="space-y-3 border-0 p-0 m-0 min-w-0">
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
            <Label hint="Tudo somado (inclusive o que veio do e-mail original) precisa caber em 25 MB, no máximo 20 arquivos.">
              Anexos
            </Label>
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
          {(anexos.length > 0 || anexosOriginais.length > 0) && (
            <>
              <ul className="space-y-1">
                {/* Os do e-mail original vêm primeiro e ficam MARCADOS: tirar um destes não apaga
                    arquivo nenhum (o e-mail original continua intacto), enquanto tirar um anexo
                    novo joga fora o arquivo que a pessoa acabou de subir. */}
                {anexosOriginais.map((a) => (
                  <li
                    key={`orig-${a.id}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-dashed bg-muted/20 px-2 py-1 text-xs"
                  >
                    <span className="truncate" title={a.nome}>
                      {a.nome}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      <span>{formatarTamanho(a.tamanho)}</span>
                      <span className="rounded bg-muted px-1 py-0.5 text-[10px]">do e-mail original</span>
                      <button
                        type="button"
                        onClick={() => removerAnexoOriginal(a.id)}
                        className="hover:text-destructive"
                        // Distinto do rótulo do anexo novo de propósito: um anexo novo pode ter
                        // exatamente o mesmo nome de um do original, e no leitor de tela os dois
                        // botões ficariam indistinguíveis.
                        aria-label={`Remover ${a.nome}, anexo do e-mail original`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
                {anexos.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1 text-xs"
                  >
                    <span className="truncate" title={a.nome}>
                      {a.nome}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      <span>{formatarTamanho(a.tamanho)}</span>
                      <button
                        type="button"
                        onClick={() => removerAnexo(a.id)}
                        className="hover:text-destructive"
                        aria-label={`Remover anexo ${a.nome}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <p className={cn("text-[11px]", bytesAnexos > LIMITE_TOTAL_BYTES ? "text-destructive" : "text-muted-foreground")}>
                {formatarTamanho(bytesAnexos)} de 25 MB
              </p>
              {/* O schema do servidor recusa mais de 20 ids em `anexosOriginais` — sem este aviso,
                  encaminhar um e-mail com 21 anexos falharia num erro de validação ilegível. */}
              {anexosOriginais.length > MAX_ANEXOS && (
                <p role="alert" className="text-[11px] text-destructive">
                  Dá para levar no máximo {MAX_ANEXOS} anexos do e-mail original — tire{" "}
                  {anexosOriginais.length - MAX_ANEXOS} da lista.
                </p>
              )}
            </>
          )}
        </div>
        </fieldset>
      </form>
    </Modal>
  );
}
