import { useEffect, useState } from "react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Plus,
  Loader2,
  Mail,
  Phone,
  FileText,
  Users,
  StickyNote,
  FolderKanban,
  Calendar,
  Wallet,
  Video,
  LifeBuoy,
  Target,
  Briefcase,
  KeyRound,
  Sparkles,
} from "lucide-react";
import {
  situacaoDocumento,
  EVENTO_TIPO_LABEL,
  SITUACAO_COMERCIAL_LABEL,
  CHAMADO_STATUS_LABEL,
  hasRoleLevel,
  type SituacaoComercial,
} from "@app/shared";
import { useAuth } from "../../../lib/auth-context";
import { isNotFoundError } from "../../../lib/trpc-error";
import { trpc } from "../../../lib/trpc";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { MaskedInput } from "../../../components/ui/masked-input";
import { maskTelefone, maskCpfCnpj, formatBRL } from "../../../lib/masks";
import { dataHora, dataUTC, data } from "../../../lib/format-date";
import { Textarea } from "../../../components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "../../../components/ui/card";
import { Badge, type BadgeProps } from "../../../components/ui/badge";
import { QueryError } from "../../../components/ui/query-error";
import { useConfirm } from "../../../components/ui/confirm-dialog";
import { getSocket, POLL, REALTIME_SOCKET_ENABLED } from "../../../lib/socket";
import { ClienteFormDialog } from "./ClienteFormDialog";
import { NovaOportunidadeDialog } from "./NovaOportunidadeDialog";
import { AssistenteIADialog } from "../../../components/ui/assistente-ia";
import { ServicosContratadosCard } from "./ServicosContratadosCard";
import { DocumentosClienteCard } from "./DocumentosClienteCard";
import { NovoDocumentoDialog } from "../../documentos/NovoDocumentoDialog";
import { ConviteLinkDialog } from "../../configuracoes/ConviteLinkDialog";
import type { ConviteResultado } from "../../configuracoes/UsuarioFormDialog";
import { situacaoVar } from "./ClientesListPage";
import { ProjetoFormDialog } from "../../projetos/ProjetoFormDialog";
import { EmailsEnviadosList } from "../../../components/EmailsEnviadosList";
import { useDynamicCrumb } from "../../../components/layout/Breadcrumbs";

const route = getRouteApi("/clientes/$clienteId");

const projStatusLabel: Record<string, string> = {
  ATIVO: "Ativo",
  PAUSADO: "Pausado",
  CONCLUIDO: "Concluído",
};
const projStatusVar: Record<string, BadgeProps["variant"]> = {
  ATIVO: "success",
  PAUSADO: "warning",
  CONCLUIDO: "default",
};
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const escolhidas = partes.length > 1 ? [partes[0], partes[partes.length - 1]] : partes;
  return escolhidas.map((p) => p?.[0]?.toUpperCase() ?? "").join("") || "?";
}

export function ClienteDetailPage() {
  const { clienteId } = route.useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const utils = trpc.useUtils();

  const cliente = trpc.clientes.get.useQuery({ id: clienteId });
  const rel = trpc.clientes.relacionados.useQuery({ id: clienteId });
  const chamados = trpc.clientes.chamados.useQuery({ clienteId }, { refetchInterval: POLL.chamadosCliente });
  const emails = trpc.emailsEnviados.doCliente.useQuery({ clienteId }, { enabled: !!clienteId });

  useEffect(() => {
    if (!REALTIME_SOCKET_ENABLED) return; // polling acima entrega em produção
    const socket = getSocket();
    const onMsg = () => utils.clientes.chamados.invalidate({ clienteId });
    socket.on("mensagem", onMsg);
    return () => {
      socket.off("mensagem", onMsg);
    };
  }, [utils, clienteId]);
  const ia = trpc.ia.disponivel.useQuery();
  const resumirIA = trpc.ia.resumirCliente.useMutation();
  const [resumoIA, setResumoIA] = useState(false);
  const [editar, setEditar] = useState(false);
  const [novaOport, setNovaOport] = useState(false);
  const [novoProjeto, setNovoProjeto] = useState(false);
  const [novoDoc, setNovoDoc] = useState(false);
  const [novaNota, setNovaNota] = useState("");
  const [novoContato, setNovoContato] = useState({ nome: "", email: "", telefone: "" });

  const { user } = useAuth();
  // Arquivar/desativar cliente é ADMIN+ (RBAC, alinhado ao backend). FUNCIONARIO não vê a ação.
  const podeGerirCliente = hasRoleLevel(user.role, "ADMIN");

  const remove = trpc.clientes.remove.useMutation({
    onSuccess: () => {
      utils.clientes.list.invalidate();
      utils.clientes.resumo.invalidate();
      navigate({ to: "/clientes" });
    },
  });
  const setAtivo = trpc.clientes.setAtivo.useMutation({
    onSuccess: () => {
      utils.clientes.get.invalidate({ id: clienteId });
      utils.clientes.list.invalidate();
      utils.clientes.resumo.invalidate();
    },
  });
  const [conviteInfo, setConviteInfo] = useState<ConviteResultado | null>(null);
  const [erroConvite, setErroConvite] = useState<string | null>(null);
  const convidarPortal = trpc.clientes.convidarPortal.useMutation({
    onSuccess: (r) => {
      setErroConvite(null);
      utils.clientes.get.invalidate({ id: clienteId });
      utils.clientes.list.invalidate();
      setConviteInfo({ email: r.email, conviteUrl: r.conviteUrl, emailEnviado: r.emailEnviado });
    },
    onError: (e) => {
      setConviteInfo(null);
      setErroConvite(e.message);
    },
  });
  const addNota = trpc.clientes.addNota.useMutation({
    onSuccess: () => {
      setNovaNota("");
      utils.clientes.get.invalidate({ id: clienteId });
    },
  });
  const addContato = trpc.clientes.addContato.useMutation({
    onSuccess: () => {
      setNovoContato({ nome: "", email: "", telefone: "" });
      utils.clientes.get.invalidate({ id: clienteId });
    },
  });
  const removeContato = trpc.clientes.removeContato.useMutation({
    onSuccess: () => utils.clientes.get.invalidate({ id: clienteId }),
  });
  useDynamicCrumb(cliente.data?.nome);

  // 404 (cliente inexistente) cai no bloco "não encontrado" abaixo — não no erro
  // genérico de "Tentar de novo" (que sugere falha transitória de conexão).
  if (cliente.isError && !isNotFoundError(cliente.error)) {
    return <QueryError onRetry={() => cliente.refetch()} />;
  }
  if (cliente.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!cliente.data) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Cliente não encontrado.</p>
        <Link to="/clientes" className="text-primary hover:underline">
          ← Voltar para clientes
        </Link>
      </div>
    );
  }

  const c = cliente.data;

  const podeAtivar = c.situacaoComercial === "ATIVO" || c.situacaoComercial === "INATIVO";

  return (
    <div className="space-y-6">
      <Link
        to="/clientes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Clientes
      </Link>

      {/* Cabeçalho: identidade + ações */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/5 text-lg font-semibold text-primary ring-1 ring-inset ring-primary/10">
            {iniciais(c.nome)}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold text-primary">{c.nome}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge>{c.tipo}</Badge>
              <Badge variant={situacaoVar[c.situacaoComercial as SituacaoComercial]}>
                {SITUACAO_COMERCIAL_LABEL[c.situacaoComercial as SituacaoComercial]}
              </Badge>
              {!podeAtivar ? (
                <Link to="/leads" className="text-xs text-primary hover:underline" title="É um lead no Funil — a situação acompanha o funil">
                  no funil · ver →
                </Link>
              ) : podeGerirCliente ? (
                <button
                  disabled={setAtivo.isPending}
                  onClick={async () => {
                    const ativar = c.situacaoComercial !== "ATIVO";
                    if (
                      await confirm({
                        title: ativar ? "Ativar cliente" : "Desativar cliente",
                        description: ativar
                          ? `"${c.nome}" voltará a ser um cliente ativo.`
                          : `"${c.nome}" será marcado como inativo (relação pausada/encerrada). Ele continua na sua base e você pode reativar quando quiser.`,
                        confirmText: ativar ? "Ativar" : "Desativar",
                        variant: ativar ? "default" : "destructive",
                      })
                    )
                      setAtivo.mutate({ id: c.id, ativo: ativar });
                  }}
                  className="text-xs font-medium text-primary transition-colors hover:underline disabled:opacity-50"
                >
                  {c.situacaoComercial === "ATIVO" ? "Desativar" : "Ativar"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {ia.data?.disponivel && (
            <Button variant="outline" size="sm" title="Resumo do cliente + próximos passos, com IA" onClick={() => setResumoIA(true)}>
              <Sparkles className="h-4 w-4" />
              Resumir com IA
            </Button>
          )}
          <Button variant="outline" size="sm" title="Abrir um novo negócio no funil para este cliente" onClick={() => setNovaOport(true)}>
            <Target className="h-4 w-4" />
            Nova oportunidade
          </Button>
          {c.portalAtivo ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-sm font-medium text-primary" title="O cliente já tem acesso ativo ao Portal">
              <KeyRound className="h-4 w-4" /> Portal ativo
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={convidarPortal.isPending || !c.email}
              title={c.email ? "Enviar o acesso ao Portal do Cliente" : "Cadastre um e-mail para enviar o acesso"}
              onClick={async () => {
                if (
                  await confirm({
                    title: "Enviar acesso ao Portal",
                    description: `"${c.nome}" receberá um e-mail com o link de acesso ao Portal do Cliente (${c.email}). Confirmar o envio?`,
                    confirmText: "Enviar",
                    icon: KeyRound,
                  })
                )
                  convidarPortal.mutate({ id: c.id });
              }}
            >
              <KeyRound className="h-4 w-4" />
              Enviar acesso
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditar(true)}>
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
          {podeGerirCliente && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={remove.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: "Arquivar cliente",
                    description: `"${c.nome}" sai das listas (arquivado). O histórico, documentos e financeiro são preservados.`,
                    confirmText: "Arquivar",
                    variant: "destructive",
                  })
                )
                  remove.mutate({ id: c.id });
              }}
            >
              <Trash2 className="h-4 w-4" />
              Arquivar
            </Button>
          )}
        </div>
      </div>

      {/* Corpo: coluna principal (trabalho) + barra lateral (referência) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ───────── Coluna principal ───────── */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <ServicosContratadosCard clienteId={c.id} />

          {/* Suporte em destaque — o canal de conversa com o cliente, logo no topo */}
          <Card className="border-primary/30 ring-1 ring-primary/5">
            <CardHeader>
              <CardTitle>
                <LifeBuoy className="h-4 w-4 text-primary" /> Chamados de suporte
              </CardTitle>
              <span className="text-xs text-muted-foreground">Abertos pelo Portal ou pela equipe · clique para responder em Mensagens</span>
            </CardHeader>
            {chamados.data && chamados.data.length > 0 ? (
              <div className="divide-y">
                {chamados.data.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      sessionStorage.setItem("abrirConversa", t.id);
                      navigate({ to: "/mensagens" });
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{t.assunto ?? "Chamado"}</span>
                        <span className="text-[10px] text-muted-foreground">#{t.numero}</span>
                        <span className={"rounded-full px-2 py-0.5 text-[10px] font-semibold " + (t.status === "RESOLVIDO" ? "bg-success/15 text-success" : t.status === "EM_ANDAMENTO" ? "bg-brand-blueLight/15 text-brand-blueText" : "bg-warning/15 text-warning")}>
                          {CHAMADO_STATUS_LABEL[t.status]}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{t.ultimaMensagem?.conteudo ?? "Sem mensagens"}</div>
                    </div>
                    {t.naoLidas > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">{t.naoLidas}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum chamado de suporte ainda.</p>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <FolderKanban className="h-4 w-4 text-muted-foreground" /> Projetos
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setNovoProjeto(true)}>
                <Plus className="h-4 w-4" /> Novo
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {rel.data && rel.data.projetos.length > 0 ? (
                rel.data.projetos.map((p) => {
                  const total = p.cards.length;
                  const concluidos = p.cards.filter((c) => c.status === "CONCLUIDO").length;
                  const progresso = total ? Math.round((concluidos / total) * 100) : 0;
                  return (
                    <Link
                      key={p.id}
                      to="/projetos/$projetoId"
                      params={{ projetoId: p.id }}
                      className="block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent/40"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{p.nome}</span>
                        <Badge variant={projStatusVar[p.status]}>{projStatusLabel[p.status]}</Badge>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={"h-full rounded-full " + (progresso === 100 ? "bg-success" : "bg-primary")}
                            style={{ width: `${progresso}%` }}
                          />
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {total === 0 ? "sem tarefas" : `${concluidos}/${total}`}
                        </span>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum projeto ainda.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>
                  <FileText className="h-4 w-4 text-muted-foreground" /> Documentos MedConsultoria
                </CardTitle>
                <span className="text-xs text-muted-foreground">Propostas, contratos, atas e briefings gerados para este cliente</span>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => setNovoDoc(true)}>
                  <FileText className="h-4 w-4" /> Novo documento
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {rel.data && rel.data.documentos.length > 0 ? (
                rel.data.documentos.map((d) => {
                  const s = situacaoDocumento(d);
                  return (
                    <Link
                      key={d.id}
                      to="/documentos/$documentoId"
                      params={{ documentoId: d.id }}
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent/40"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{d.titulo}</span>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </Link>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum documento gerado ainda.</p>
              )}
            </CardContent>
          </Card>

          {/* Documentos DO CLIENTE (arquivos enviados/anexados) — diferente dos da Med acima */}
          <DocumentosClienteCard clienteId={c.id} />

          {/* Anotações / timeline */}
          <Card>
            <CardHeader>
              <CardTitle>
                <StickyNote className="h-4 w-4 text-muted-foreground" /> Anotações
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!novaNota.trim()) return;
                  addNota.mutate({ entidadeTipo: "cliente", entidadeId: c.id, conteudo: novaNota });
                }}
              >
                <Textarea
                  placeholder="Escreva uma anotação…"
                  value={novaNota}
                  onChange={(e) => setNovaNota(e.target.value)}
                />
                <Button type="submit" size="sm" disabled={addNota.isPending || !novaNota.trim()}>
                  Adicionar
                </Button>
              </form>

              <div className="space-y-3">
                {c.notas.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma anotação ainda.</p>
                )}
                {c.notas.map((n) => (
                  <div key={n.id} className="border-l-2 border-accent pl-3 text-sm">
                    <p className="whitespace-pre-wrap">{n.conteudo}</p>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {n.autor?.nome ?? "Sistema"} · {dataHora(n.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ───────── Barra lateral: referência ───────── */}
        <div className="space-y-6">
          {/* Ficha / contato */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Briefcase className="h-4 w-4 text-muted-foreground" /> Ficha
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              {c.documento && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Documento</span>
                  <span className="font-medium">{maskCpfCnpj(c.documento)}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">E-mail</span>
                {c.email ? (
                  <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 truncate font-medium text-primary hover:underline">
                    <Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.email}</span>
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Telefone</span>
                <span className="inline-flex items-center gap-1 font-medium">
                  {c.telefone ? (
                    <>
                      <Phone className="h-3.5 w-3.5 shrink-0" /> {maskTelefone(c.telefone)}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
              </div>
              {c.observacoes && (
                <div className="border-t pt-2.5">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Observações</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{c.observacoes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Resumo comercial — desde quando é cliente, valor contratado e se está no funil querendo mais */}
          {rel.data &&
            rel.data.origem.length > 0 &&
            (() => {
              const origem = rel.data.origem;
              const ganhos = origem.filter((o) => o.status === "convertido");
              const abertos = origem.filter((o) => o.status === "em_andamento");
              const perdidos = origem.filter((o) => o.status === "perdido");
              const valorContratado = ganhos.reduce((sum, g) => sum + (g.valorEstimado ?? 0), 0);
              const datas = ganhos.map((g) => new Date(g.convertidoEm ?? g.createdAt).getTime());
              const clienteDesde = datas.length ? new Date(Math.min(...datas)) : null;
              const origens = [...new Set(origem.map((o) => o.origem).filter(Boolean))];
              return (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Target className="h-4 w-4 text-muted-foreground" /> Resumo comercial
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {clienteDesde && (
                        <div className="flex items-center justify-between gap-2">
                          <span>Cliente desde</span>
                          <strong className="text-foreground">{data(clienteDesde)}</strong>
                        </div>
                      )}
                      {valorContratado > 0 && (
                        <div className="flex items-center justify-between gap-2">
                          <span>Valor contratado</span>
                          <strong className="text-success">{formatBRL(valorContratado)}</strong>
                        </div>
                      )}
                      {origens.length > 0 && (
                        <div className="flex items-center justify-between gap-2">
                          <span>Origem</span>
                          <span className="text-foreground">{origens.join(", ")}</span>
                        </div>
                      )}
                    </div>

                    {abertos.map((o) => (
                      <div key={o.id} className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 font-semibold text-warning">
                            <Target className="h-4 w-4" /> No funil agora
                          </span>
                          <span className="text-xs text-muted-foreground">quer mais · etapa {o.etapa}</span>
                          {o.valorEstimado != null && (
                            <span className="ml-auto font-medium tabular-nums text-primary">{formatBRL(o.valorEstimado)}</span>
                          )}
                        </div>
                        {o.servicos.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {o.servicos.map((s) => (
                              <span key={s.id} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                                {s.nome}
                              </span>
                            ))}
                          </div>
                        )}
                        <Link to="/leads" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
                          Ver no funil →
                        </Link>
                      </div>
                    ))}

                    {perdidos.map((o) => (
                      <div key={o.id} className="rounded-lg border p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="danger">Perdido</Badge>
                          {o.servicos.length > 0 && (
                            <span className="text-xs text-muted-foreground">{o.servicos.map((s) => s.nome).join(", ")}</span>
                          )}
                        </div>
                        {o.motivoPerda && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">Motivo:</span> {o.motivoPerda}
                          </p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })()}

          {/* Contatos */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" /> Contatos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {c.contatos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum contato cadastrado.</p>}
                {c.contatos.map((ct) => (
                  <div
                    key={ct.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent/30"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{ct.nome}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[ct.cargo, ct.email, ct.telefone && maskTelefone(ct.telefone)].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <button
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: "Remover contato",
                            description: `Remover "${ct.nome}" dos contatos deste cliente?`,
                            confirmText: "Remover",
                            variant: "destructive",
                          })
                        )
                          removeContato.mutate({ id: ct.id });
                      }}
                      aria-label="Remover contato"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <form
                className="space-y-2 border-t pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!novoContato.nome.trim()) return;
                  addContato.mutate({ clienteId: c.id, principal: false, ...novoContato });
                }}
              >
                <Input
                  placeholder="Nome do contato"
                  autoComplete="name"
                  value={novoContato.nome}
                  onChange={(e) => setNovoContato((s) => ({ ...s, nome: e.target.value }))}
                />
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  placeholder="E-mail"
                  value={novoContato.email}
                  onChange={(e) => setNovoContato((s) => ({ ...s, email: e.target.value }))}
                />
                <MaskedInput
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="(11) 90000-0000"
                  format={maskTelefone}
                  value={novoContato.telefone}
                  onChange={(e) => setNovoContato((s) => ({ ...s, telefone: e.target.value }))}
                />
                <Button type="submit" size="sm" variant="secondary" disabled={addContato.isPending}>
                  <Plus className="h-4 w-4" />
                  Adicionar contato
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Próximos compromissos */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" /> Próximos compromissos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rel.data && rel.data.eventos.length > 0 ? (
                rel.data.eventos.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <span className="w-24 shrink-0 text-xs font-medium tabular-nums text-primary">{data(e.inicio)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{e.titulo}</div>
                      <div className="truncate text-xs text-muted-foreground">{EVENTO_TIPO_LABEL[e.tipo]}</div>
                    </div>
                    {e.linkReuniao && (
                      <a
                        href={e.linkReuniao}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success/20"
                      >
                        <Video className="h-3.5 w-3.5" /> Entrar
                      </a>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum compromisso futuro.</p>
              )}
            </CardContent>
          </Card>

          {/* Financeiro (só admin recebe as contas) */}
          {rel.data?.contas && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <Wallet className="h-4 w-4 text-muted-foreground" /> Financeiro
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {rel.data.contas.length > 0 ? (
                  rel.data.contas.map((ct) => (
                    <div key={ct.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{ct.descricao}</span>
                          {ct.recorrencia === "MENSAL" && (
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Mensal</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          vence {dataUTC(ct.vencimento)}
                          {ct.pago ? " · paga" : ""}
                        </div>
                      </div>
                      <span
                        className={
                          ct.tipo === "RECEBER"
                            ? "shrink-0 font-medium tabular-nums text-success"
                            : "shrink-0 font-medium tabular-nums text-destructive"
                        }
                      >
                        {ct.tipo === "RECEBER" ? "+" : "−"} {formatBRL(ct.valor)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhuma conta vinculada.</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* E-mails enviados */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Mail className="h-4 w-4 text-muted-foreground" /> E-mails enviados
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <EmailsEnviadosList emails={emails.data ?? []} vazio="Nenhum e-mail enviado a este cliente ainda." />
            </CardContent>
          </Card>
        </div>
      </div>

      <ClienteFormDialog
        open={editar}
        onClose={() => setEditar(false)}
        cliente={{
          id: c.id,
          nome: c.nome,
          tipo: c.tipo,
          documento: c.documento,
          email: c.email,
          telefone: c.telefone,
          observacoes: c.observacoes,
          responsavelId: c.responsavelId,
        }}
      />

      <ProjetoFormDialog open={novoProjeto} onClose={() => setNovoProjeto(false)} clienteIdFixo={c.id} />

      <NovoDocumentoDialog open={novoDoc} onClose={() => setNovoDoc(false)} clienteFixo={c.id} />

      <NovaOportunidadeDialog
        open={novaOport}
        onClose={() => setNovaOport(false)}
        clienteId={c.id}
        clienteNome={c.nome}
        onCriada={() => navigate({ to: "/leads" })}
      />

      {resumoIA && (
        <AssistenteIADialog
          title={`Resumo — ${c.nome}`}
          run={() => resumirIA.mutateAsync({ clienteId: c.id })}
          onClose={() => setResumoIA(false)}
        />
      )}

      <ConviteLinkDialog
        info={conviteInfo}
        erro={erroConvite}
        onClose={() => {
          setConviteInfo(null);
          setErroConvite(null);
        }}
      />
    </div>
  );
}
