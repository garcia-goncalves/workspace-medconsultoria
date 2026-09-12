import { useEffect, useState } from "react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Loader2,
  Pencil,
  Trash2,
  FileDown,
  FileText,
  Send,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  FileSignature,
  ShieldCheck,
  Printer,
  ExternalLink,
  Circle,
  Handshake,
  Copy,
  XCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { TIPO_MODELO_LABEL, DOC_INTERACAO, situacaoDocumento } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { Button } from "../../components/ui/button";
import { DocumentoEditor } from "./DocumentoEditor";
import { Badge } from "../../components/ui/badge";
import { QueryError } from "../../components/ui/query-error";
import { isNotFoundError } from "../../lib/trpc-error";
import { useConfirm, useConfirmar, usePrompt } from "../../components/ui/confirm-dialog";
import {
  DocumentoBranded,
  imprimirDocumento,
  baixarWordDocumento,
  type DocumentoBrandedProps,
} from "./DocumentoBranded";
import { dataHora, data } from "../../lib/format-date";
import { useDynamicCrumb } from "../../components/layout/Breadcrumbs";

const route = getRouteApi("/documentos/$documentoId");

/** Assinatura digital do documento: solicitar, acompanhar e comprovar. */
function AssinaturasCard({
  documentoId,
  temCliente,
  assinado,
}: {
  documentoId: string;
  temCliente: boolean;
  assinado: boolean;
}) {
  const utils = trpc.useUtils();
  const confirmar = useConfirmar();
  const lista = trpc.assinaturas.doDocumento.useQuery({ documentoId });
  const invalidate = () => {
    utils.assinaturas.doDocumento.invalidate({ documentoId });
    utils.documentos.get.invalidate({ id: documentoId });
  };
  const solicitar = trpc.assinaturas.solicitar.useMutation({ onSuccess: invalidate });
  const assinaturas = lista.data ?? [];

  const pedirAssinaturas = async () => {
    const { confirmado, marcado } = await confirmar({
      title: assinaturas.length ? "Solicitar novamente" : "Solicitar assinaturas",
      description:
        "O conteúdo atual do documento será congelado para assinatura. O link de cada signatário fica disponível aqui no painel (\"Abrir link\").",
      confirmText: "Solicitar assinaturas",
      checkbox: {
        label: "Enviar o link por e-mail ao cliente e à MedConsultoria",
        hint: "Se não marcar, ninguém é avisado por e-mail — você copia o link no painel e envia como preferir.",
        default: true,
      },
    });
    if (confirmado) solicitar.mutate({ documentoId, avisarPorEmail: marcado });
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b bg-muted/30 px-5 py-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <FileSignature className="h-4 w-4 text-primary" />
          Assinaturas
          {assinado && <Badge variant="success">Assinado por todos</Badge>}
        </span>
        <div className="flex gap-2">
          {assinado && (
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Comprovante
            </Button>
          )}
          {temCliente && (
            <Button size="sm" variant={assinaturas.length ? "outline" : "default"} disabled={solicitar.isPending} onClick={pedirAssinaturas}>
              <Send className="h-4 w-4" />
              {assinaturas.length ? "Solicitar novamente" : "Solicitar assinaturas"}
            </Button>
          )}
        </div>
      </div>

      <div className="p-5">
        {!temCliente ? (
          <p className="text-sm text-muted-foreground">
            Vincule um cliente com e-mail ao documento para habilitar a assinatura digital.
          </p>
        ) : solicitar.error ? (
          <p className="text-sm text-destructive">{solicitar.error.message}</p>
        ) : assinaturas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ainda não solicitado. Ao solicitar, gera-se um link de assinatura para o cliente e para a MedConsultoria
            (desenhando ou digitando o nome), com validade jurídica — você escolhe se envia por e-mail ou copia o link
            daqui.
          </p>
        ) : (
          <div className="space-y-2.5">
            {assinaturas.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm">
                {a.status === "ASSINADO" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                )}
                <div className="min-w-0">
                  <div className="font-medium">
                    {a.nome} <span className="text-xs font-normal text-muted-foreground">· {a.papel === "CLIENTE" ? "Cliente" : "MedConsultoria"}</span>
                  </div>
                  {a.status === "ASSINADO" && a.assinadoEm ? (
                    <div className="text-xs text-muted-foreground">
                      Assinado em {dataHora(a.assinadoEm)} · {a.metodo === "DESENHO" ? "desenho" : "digitado"}
                      {a.ip ? ` · IP ${a.ip}` : ""}
                      {!a.integro && <span className="text-destructive"> · integridade divergente</span>}
                    </div>
                  ) : null}
                  {/* A PROVA DO CONSENTIMENTO. Antes a caixa "li e concordo" era exigida e não
                      ficava registrada em lugar nenhum — numa assinatura contestada não havia o
                      que mostrar. "Não registrado" aparece nas assinaturas anteriores a esta
                      coluna, e é a verdade: elas consentiram, mas a prova não foi guardada. */}
                  {a.status === "ASSINADO" ? (
                    <div className="text-xs text-muted-foreground">
                      {a.consentimentoEm ? (
                        <>Consentimento registrado em {dataHora(a.consentimentoEm)} · texto v{a.consentimentoVersao}</>
                      ) : (
                        <span className="text-warning">Consentimento não registrado (assinatura anterior a este registro)</span>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">Aguardando assinatura</div>
                  )}
                </div>
                {a.status !== "ASSINADO" && (
                  <a
                    href={`/ir/assinar/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
                  >
                    {a.papel === "MEDCONSULTORIA" ? "Assinar agora" : "Abrir link"}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
            <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Cada assinatura guarda data, hora, IP e o código de integridade (hash) do documento.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Aceite online da proposta: habilita o link público, acompanha a resposta (aceite/recusa). */
function PropostaAceiteCard({ documentoId, temCliente }: { documentoId: string; temCliente: boolean }) {
  const utils = trpc.useUtils();
  const confirmar = useConfirmar();
  const status = trpc.propostas.doDocumento.useQuery({ documentoId });
  const invalidate = () => {
    utils.propostas.doDocumento.invalidate({ documentoId });
    utils.documentos.get.invalidate({ id: documentoId });
  };
  const habilitar = trpc.propostas.habilitar.useMutation({ onSuccess: invalidate });
  const p = status.data;

  const habilitarAceite = async () => {
    const { confirmado, marcado } = await confirmar({
      title: p ? "Reenviar para aceite" : "Habilitar aceite online",
      description:
        "O conteúdo atual da proposta será congelado. O cliente poderá aceitar ou recusar por um link (e pelo Portal). O link fica disponível aqui no painel.",
      confirmText: p ? "Reenviar" : "Habilitar aceite",
      checkbox: {
        label: "Enviar o link por e-mail ao cliente",
        hint: "Se não marcar, ninguém é avisado por e-mail — copie o link daqui e envie como preferir.",
        default: true,
      },
    });
    if (confirmado) habilitar.mutate({ documentoId, avisarPorEmail: marcado });
  };

  const aceita = p?.status === "ACEITA";
  const recusada = p?.status === "RECUSADA";

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b bg-muted/30 px-5 py-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Handshake className="h-4 w-4 text-primary" />
          Aceite da proposta
          {aceita && <Badge variant="success">Aceita</Badge>}
          {recusada && <Badge variant="danger">Recusada</Badge>}
          {p?.status === "PENDENTE" && <Badge variant="warning">Aguardando</Badge>}
        </span>
        {temCliente && !aceita && (
          <Button size="sm" variant={p ? "outline" : "default"} disabled={habilitar.isPending} onClick={habilitarAceite}>
            <Send className="h-4 w-4" />
            {p ? "Reenviar para aceite" : "Habilitar aceite online"}
          </Button>
        )}
      </div>

      <div className="p-5">
        {!temCliente ? (
          <p className="text-sm text-muted-foreground">
            Vincule um cliente à proposta para habilitar o aceite online.
          </p>
        ) : habilitar.error ? (
          <p className="text-sm text-destructive">{habilitar.error.message}</p>
        ) : !p ? (
          <p className="text-sm text-muted-foreground">
            Ainda não habilitado. Ao habilitar, o cliente recebe um link para <strong>aceitar ou recusar</strong> a
            proposta online (também aparece no Portal) — sem precisar baixar nada.
          </p>
        ) : (
          <div className="space-y-3">
            {p.status === "PENDENTE" && (
              <>
                {p.conteudoAlterado ? (
                  <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    A proposta foi editada após habilitar o aceite. Reenvie para o cliente conseguir responder.
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Aguardando a resposta do cliente.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`/proposta/${p.token}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
                  >
                    Abrir link <ExternalLink className="h-3 w-3" />
                  </a>
                  <button
                    onClick={() => navigator.clipboard?.writeText(p.link).catch(() => {})}
                    className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
                  >
                    Copiar link <Copy className="h-3 w-3" />
                  </button>
                </div>
              </>
            )}
            {aceita && (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                Cliente aceitou{p.respondidaEm ? ` em ${dataHora(p.respondidaEm)}` : ""}. Que tal gerar o contrato?
              </p>
            )}
            {recusada && (
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2 text-muted-foreground">
                  <XCircle className="h-4 w-4" />
                  Cliente recusou{p.respondidaEm ? ` em ${dataHora(p.respondidaEm)}` : ""}.
                </p>
                {p.motivoRecusa && (
                  <p className="rounded-lg border bg-muted/40 p-3">
                    <span className="font-medium">Motivo:</span> {p.motivoRecusa}
                  </p>
                )}
              </div>
            )}
            <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              A resposta guarda data, hora, IP e o código de integridade (hash) da proposta.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function DocumentoDetailPage() {
  const { documentoId } = route.useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const utils = trpc.useUtils();
  const doc = trpc.documentos.get.useQuery({ id: documentoId });
  const [conteudo, setConteudo] = useState("");
  const [editando, setEditando] = useState(false);
  useDynamicCrumb(doc.data?.titulo);

  useEffect(() => {
    if (doc.data && !editando) setConteudo(doc.data.conteudo);
  }, [doc.data, editando]);

  const invalidate = () => {
    utils.documentos.get.invalidate({ id: documentoId });
    // Status/conteúdo mudam o que a LISTA de documentos mostra (situação) — atualiza lá também.
    utils.documentos.list.invalidate();
  };
  const salvar = trpc.documentos.updateConteudo.useMutation({
    onSuccess: () => (invalidate(), setEditando(false)),
  });
  const setStatus = trpc.documentos.setStatus.useMutation({ onSuccess: invalidate });
  const remove = trpc.documentos.remove.useMutation({
    onSuccess: () => {
      utils.documentos.list.invalidate();
      navigate({ to: "/documentos" });
    },
  });
  const ia = trpc.ia.disponivel.useQuery();
  const melhorarIA = trpc.documentos.melhorarComIA.useMutation({ onSuccess: invalidate });

  if (doc.isError && !isNotFoundError(doc.error)) {
    return <QueryError onRetry={() => doc.refetch()} />;
  }
  if (doc.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!doc.data) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Documento não encontrado.</p>
        <Link to="/documentos" className="text-primary hover:underline">
          ← Voltar
        </Link>
      </div>
    );
  }

  const d = doc.data;
  const enviado = d.status === "ENVIADO";
  const sit = situacaoDocumento(d);

  // Props da moldura branded — reusadas na leitura, no preview de edição, no PDF e no Word.
  const propsBase: Omit<DocumentoBrandedProps, "conteudoMarkdown"> = {
    tipo: d.modelo ? TIPO_MODELO_LABEL[d.modelo.tipo] : undefined,
    titulo: d.titulo,
    clienteNome: d.cliente?.nome ?? null,
    data: data(d.createdAt),
    statusLabel: sit.label,
    rodapeExtra: d.assinadoEm
      ? `Assinado digitalmente · integridade verificada em ${dataHora(d.assinadoEm)}.`
      : null,
  };
  const brandedView: DocumentoBrandedProps = { ...propsBase, conteudoMarkdown: d.conteudo };
  const brandedEdit: DocumentoBrandedProps = { ...propsBase, conteudoMarkdown: conteudo };

  return (
    <div className="space-y-6">
      <Link
        to="/documentos"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Documentos
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-primary">{d.titulo}</h1>
            <Badge variant={sit.variant}>{sit.label}</Badge>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {d.cliente ? `${d.cliente.nome} · ` : ""}criado por {d.criadoPor?.nome ?? "usuário removido"}
            {d.aprovadoPor ? ` · aprovado por ${d.aprovadoPor.nome}` : ""}
            {d.enviadoEm ? ` · enviado em ${dataHora(d.enviadoEm)}` : ""}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 hover:bg-destructive/10 hover:text-destructive"
          onClick={async () => {
            if (
              await confirm({
                title: "Remover documento",
                description: `"${d.titulo}" será removido. Esta ação não pode ser desfeita.`,
                confirmText: "Remover",
                variant: "destructive",
              })
            )
              remove.mutate({ id: d.id });
          }}
          aria-label="Remover documento"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-sm">
        {d.status === "RASCUNHO" && (
          <Button size="sm" onClick={() => setStatus.mutate({ id: d.id, status: "EM_REVISAO" })}>
            <Send className="h-4 w-4" />
            Enviar para revisão
          </Button>
        )}
        {d.status === "EM_REVISAO" && (
          <>
            <Button size="sm" onClick={() => setStatus.mutate({ id: d.id, status: "APROVADO" })}>
              <CheckCircle2 className="h-4 w-4" />
              Aprovar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatus.mutate({ id: d.id, status: "RASCUNHO" })}
            >
              <RotateCcw className="h-4 w-4" />
              Voltar a rascunho
            </Button>
          </>
        )}
        {d.status === "APROVADO" && (
          <>
            <Button size="sm" onClick={() => setStatus.mutate({ id: d.id, status: "ENVIADO" })}>
              <Send className="h-4 w-4" />
              Marcar como enviado
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatus.mutate({ id: d.id, status: "RASCUNHO" })}
            >
              <RotateCcw className="h-4 w-4" />
              Voltar a rascunho
            </Button>
          </>
        )}

        {ia.data?.disponivel && !enviado && (
          <Button
            size="sm"
            variant="secondary"
            disabled={melhorarIA.isPending}
            onClick={async () => {
              const instr = await prompt({
                title: "Melhorar com IA",
                description: "Descreva o que a IA deve ajustar no documento.",
                placeholder: "Ex.: deixe o tom mais formal e resuma a introdução…",
                confirmText: "Melhorar",
                multiline: true,
                required: true,
                icon: Sparkles,
              });
              if (instr && instr.trim()) melhorarIA.mutate({ id: d.id, instrucao: instr.trim() });
            }}
          >
            {melhorarIA.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Melhorar com IA
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => imprimirDocumento(brandedView)}>
            <FileDown className="h-4 w-4" />
            PDF
          </Button>
          <Button size="sm" variant="outline" onClick={() => baixarWordDocumento(brandedView)}>
            <FileText className="h-4 w-4" />
            Word
          </Button>
        </div>
      </div>

      {/* Interação por tipo (DOC_INTERACAO): proposta = aceite/recusa; contrato/escopo = assinatura;
          demais (relatório, ata, briefing, recibo…) = só leitura/entrega. */}
      {(() => {
        const interacao = d.modelo ? DOC_INTERACAO[d.modelo.tipo] : "nenhum";
        if (interacao === "aceite") return <PropostaAceiteCard documentoId={d.id} temCliente={!!d.cliente} />;
        if (interacao === "assinatura")
          return <AssinaturasCard documentoId={d.id} temCliente={!!d.cliente} assinado={!!d.assinadoEm} />;
        return null;
      })()}

      {editando ? (
        <div className="space-y-3">
          {/* Barra de ações da edição (fixa no topo do conteúdo) */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-xl border bg-card px-4 py-2.5 shadow-sm">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Pencil className="h-4 w-4 text-primary" />
              Editando · a prévia atualiza ao lado
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditando(false)} disabled={salvar.isPending}>
                Cancelar
              </Button>
              <Button size="sm" onClick={() => salvar.mutate({ id: d.id, conteudo })} disabled={salvar.isPending}>
                {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Salvar versão
              </Button>
            </div>
          </div>
          {/* Editor (barra + textarea, gruda ao rolar) | preview A4 inteiro (sem scroll próprio) */}
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <DocumentoEditor value={conteudo} onChange={setConteudo} className="lg:sticky lg:top-16" />
            <div className="rounded-xl border bg-muted/30 p-4 sm:p-6">
              <DocumentoBranded {...brandedEdit} />
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b bg-muted/30 px-5 py-3">
            <span className="text-sm font-medium">Documento</span>
            <Button size="sm" variant="ghost" onClick={() => setEditando(true)} disabled={enviado}>
              <Pencil className="h-4 w-4" />
              Editar
            </Button>
          </div>
          <div className="bg-muted/30 p-4 sm:p-8">
            <DocumentoBranded {...brandedView} />
          </div>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        {d.versoes.length} versão(ões) · última edição {dataHora(d.updatedAt)}
      </div>
    </div>
  );
}
