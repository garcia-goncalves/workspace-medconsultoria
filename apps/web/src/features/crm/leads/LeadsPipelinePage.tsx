import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { LucideIcon } from "lucide-react";
import { Plus, Users, Wallet, TrendingUp, Link2, Check, Tags, Percent, ThumbsDown, RotateCcw, UserCheck, AlertTriangle, Search, Inbox, X } from "lucide-react";
import { cn } from "@app/ui";
import { trpc } from "../../../lib/trpc";
import { formatBRL, formatBRLCompact } from "../../../lib/masks";
import { dataHora } from "../../../lib/format-date";
import { Button } from "../../../components/ui/button";
import { PageHeader } from "../../../components/ui/page-header";
import { Badge } from "../../../components/ui/badge";
import { Skeleton } from "../../../components/ui/skeleton";
import { Modal } from "../../../components/ui/modal";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { QueryError } from "../../../components/ui/query-error";
import { useConfirm, useConfirmar, usePrompt } from "../../../components/ui/confirm-dialog";
import { ConviteLinkDialog } from "../../configuracoes/ConviteLinkDialog";
import type { ConviteResultado } from "../../configuracoes/UsuarioFormDialog";
import { hasRoleLevel } from "@app/shared";
import { useAuth } from "../../../lib/auth-context";
import { LeadCard, type LeadItem } from "./LeadCard";
import { LeadFormDialog, type LeadEditavel } from "./LeadFormDialog";
import { LeadDetailPanel } from "./LeadDetailPanel";
import { OrigensDialog } from "./OrigensDialog";

type Board = Record<string, LeadItem[]>;
interface Stage {
  id: string;
  nome: string;
  cor: string | null;
}

function FunnelStat({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/5 text-primary ring-1 ring-inset ring-primary/10">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-xl font-semibold tabular-nums text-primary">{value}</div>
        {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

function Column({
  stage,
  leads,
  filtrando,
  onOpen,
  onEdit,
  onRemove,
  onConvert,
  onConvidarPortal,
  convertingId,
  convidandoPortalId,
}: {
  stage: Stage;
  leads: LeadItem[];
  filtrando: boolean;
  onOpen: (l: LeadItem) => void;
  onEdit: (l: LeadItem) => void;
  onRemove: (l: LeadItem) => void;
  onConvert: (l: LeadItem) => void;
  onConvidarPortal: (l: LeadItem) => void;
  convertingId: string | undefined;
  convidandoPortalId: string | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const totalCol = leads.reduce((s, l) => s + (l.valorEstimado ?? 0), 0);
  return (
    <div className="flex flex-col rounded-xl bg-muted/40 lg:h-full lg:min-w-0 lg:flex-1">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3.5 py-2.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: stage.cor ?? "#94a3b8" }}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium leading-tight">{stage.nome}</div>
          {totalCol > 0 && (
            <div className="text-[11px] tabular-nums text-muted-foreground">
              {formatBRLCompact(totalCol)}
            </div>
          )}
        </div>
        <Badge className="ml-auto shrink-0">{leads.length}</Badge>
      </div>
      <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "flex min-h-24 flex-1 flex-col gap-2 rounded-b-xl p-2.5 transition-colors lg:min-h-0 lg:overflow-y-auto",
            isOver && "bg-accent/50",
          )}
        >
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onOpen={() => onOpen(lead)}
              onEdit={() => onEdit(lead)}
              onRemove={() => onRemove(lead)}
              onConvert={() => onConvert(lead)}
              onConvidarPortal={() => onConvidarPortal(lead)}
              converting={convertingId === lead.id}
              convidandoPortal={convidandoPortalId === lead.id}
            />
          ))}
          {leads.length === 0 && (
            <div className="rounded-md border border-dashed border-border/70 px-4 py-6 text-center text-xs text-muted-foreground">
              {filtrando ? "Sem resultados nesta etapa" : "Arraste um lead para cá"}
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export function LeadsPipelinePage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const confirmar = useConfirmar();
  const prompt = usePrompt();
  const { user } = useAuth();
  const isAdmin = hasRoleLevel(user.role, "ADMIN");
  const utils = trpc.useUtils();
  const stages = trpc.pipeline.stages.useQuery();
  // refetch periódico: reflete os avanços automáticos do funil "ao vivo" no board.
  const leads = trpc.leads.list.useQuery(undefined, { refetchInterval: 30_000 });
  const resumo = trpc.leads.resumo.useQuery(undefined, { refetchInterval: 60_000 });

  const [board, setBoard] = useState<Board>({});
  const [activeLead, setActiveLead] = useState<LeadItem | null>(null);
  const [novo, setNovo] = useState(false);
  const [origensAberto, setOrigensAberto] = useState(false);
  const [leadAberto, setLeadAberto] = useState<string | null>(null);
  const [editando, setEditando] = useState<LeadEditavel | null>(null);
  const [conviteInfo, setConviteInfo] = useState<ConviteResultado | null>(null);
  const [erroConvite, setErroConvite] = useState<string | null>(null);
  const [linkCopiado, setLinkCopiado] = useState(false);
  const [perdidosAberto, setPerdidosAberto] = useState(false);
  const perdidos = trpc.leads.perdidos.useQuery(undefined, { enabled: perdidosAberto });
  const [busca, setBusca] = useState("");
  const [filtroResp, setFiltroResp] = useState("");
  const equipe = trpc.usuarios.equipe.useQuery();

  // Leads visíveis no board após busca + filtro por responsável (KPIs seguem no total).
  const leadsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (leads.data ?? []).filter((l) => {
      if (filtroResp && l.responsavelId !== filtroResp) return false;
      if (!q) return true;
      return [l.nome, l.empresa, l.email].some((v) => v?.toLowerCase().includes(q));
    });
  }, [leads.data, busca, filtroResp]);
  const filtrando = !!busca.trim() || !!filtroResp;

  const copiarCaptacao = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/captura`);
    setLinkCopiado(true);
    setTimeout(() => setLinkCopiado(false), 2000);
  };

  useEffect(() => {
    if (!stages.data || !leads.data) return;
    const next: Board = {};
    for (const s of stages.data) next[s.id] = [];
    for (const l of leadsFiltrados) {
      const arr = next[l.pipelineStageId] ?? (next[l.pipelineStageId] = []);
      arr.push(l);
    }
    setBoard(next);
  }, [stages.data, leads.data, leadsFiltrados]);

  // A situação do cliente é o placar do funil — toda ação que muda o funil pode mudar a
  // situação de um cliente, então invalidamos as queries de clientes junto.
  const invalidarClientes = () => {
    utils.clientes.list.invalidate();
    utils.clientes.resumo.invalidate();
    utils.clientes.get.invalidate();
  };
  const move = trpc.leads.move.useMutation({
    onSettled: () => {
      utils.leads.list.invalidate();
      invalidarClientes();
    },
  });
  const remove = trpc.leads.remove.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      invalidarClientes();
    },
  });
  const convert = trpc.leads.convert.useMutation({
    onSuccess: (res) => {
      utils.leads.list.invalidate();
      invalidarClientes();
      navigate({ to: "/clientes/$clienteId", params: { clienteId: res.clienteId } });
    },
  });
  const convidarPortal = trpc.leads.convidarPortal.useMutation({
    onSuccess: (r) => {
      setErroConvite(null);
      // O convite avança o lead ("Qualificação") → atualiza board, resumo/taxa e a ficha do cliente.
      invalidarFunil();
      setConviteInfo({ email: r.email, conviteUrl: r.conviteUrl, emailEnviado: r.emailEnviado });
    },
    onError: (e) => {
      setConviteInfo(null);
      setErroConvite(e.message);
    },
  });
  const invalidarFunil = () => {
    utils.leads.list.invalidate();
    utils.leads.resumo.invalidate();
    utils.leads.perdidos.invalidate();
    invalidarClientes();
  };
  const marcarPerdido = trpc.leads.marcarPerdido.useMutation({ onSuccess: invalidarFunil });
  const reabrir = trpc.leads.reabrir.useMutation({ onSuccess: invalidarFunil });

  // Handlers compartilhados entre os botões do card e o painel do lead.
  // Fecham o painel lateral antes de abrir qualquer diálogo (evita popup atrás do fundo).
  const abrirEdicao = (l: LeadItem) => {
    setLeadAberto(null);
    setEditando({
      id: l.id,
      nome: l.nome,
      empresa: l.empresa,
      email: l.email,
      telefone: l.telefone,
      origem: l.origem,
      valorEstimado: l.valorEstimado,
      observacoes: l.observacoes,
      responsavelId: l.responsavelId,
      servicoIds: l.servicos.map((s) => s.id),
    });
  };
  const abrirEdicaoPorId = (id: string) => {
    const l = leads.data?.find((x) => x.id === id);
    if (l) abrirEdicao(l);
  };

  const converter = async (l: { id: string; nome: string }) => {
    setLeadAberto(null);
    const full = leads.data?.find((x) => x.id === l.id);
    const temServico = (full?.servicos.length ?? 0) > 0;
    const temEmail = !!full?.email?.trim();
    const avisoSemServico = temServico
      ? ""
      : " ⚠️ Este lead não tem nenhum serviço marcado — o cliente nascerá sem serviço contratado. Se quiser, cancele e marque os serviços em Editar antes de converter.";
    const { confirmado, marcado } = await confirmar({
      title: "Converter em cliente",
      description: `"${l.nome}" será convertido em cliente e sairá do funil. Você poderá continuar o trabalho pela ficha do cliente.${avisoSemServico}`,
      confirmText: "Converter",
      icon: temServico ? UserCheck : AlertTriangle,
      checkbox: {
        label: "Enviar boas-vindas e acesso ao Portal por e-mail",
        hint: temEmail
          ? `O cliente recebe as boas-vindas e o link de acesso em ${full!.email!.trim()}.`
          : "Este lead não tem e-mail cadastrado — nada será enviado.",
        default: temEmail,
      },
    });
    if (confirmado) convert.mutate({ id: l.id, enviarEmail: marcado });
  };

  const remover = async (l: { id: string; nome: string }) => {
    setLeadAberto(null);
    if (
      await confirm({
        title: "Remover lead",
        description: `O lead "${l.nome}" será removido do funil. Esta ação não pode ser desfeita.`,
        confirmText: "Remover",
        variant: "destructive",
      })
    )
      remove.mutate({ id: l.id });
  };

  const perder = async (l: { id: string; nome: string }) => {
    setLeadAberto(null);
    const motivo = await prompt({
      title: "Marcar como perdido",
      icon: ThumbsDown,
      description: `Por que "${l.nome}" não avançou? O lead sai do funil, mas continua no relatório de ganho/perda e pode ser reaberto quando quiser.`,
      placeholder: "Ex.: escolheu outro fornecedor, sem orçamento, sem retorno…",
      confirmText: "Marcar como perdido",
      multiline: true,
      required: true,
    });
    if (motivo) marcarPerdido.mutate({ id: l.id, motivo });
  };

  const convidarPortalConfirm = async (l: { id: string; nome: string; email: string | null; clienteId: string | null; portalAtivo?: boolean }) => {
    setLeadAberto(null);
    // Reenvio só quando há acesso de Portal DE VERDADE (não só clienteId ligado).
    const reenvio = l.portalAtivo ?? !!l.clienteId;
    const alvo = l.email ? `para ${l.email}` : "para o e-mail cadastrado no lead";
    if (
      await confirm({
        title: reenvio ? "Reenviar convite do Portal" : "Enviar convite do Portal",
        description: reenvio
          ? `Vamos reenviar o e-mail com o link de acesso ao Portal ${alvo}. Confirmar o envio?`
          : `"${l.nome}" receberá um e-mail com o convite de acesso ao Portal do Cliente ${alvo}, e o lead avança para "Qualificação". Confirmar o envio?`,
        confirmText: reenvio ? "Reenviar convite" : "Enviar convite",
      })
    )
      convidarPortal.mutate({ id: l.id });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const findContainer = (id: string): string | undefined => {
    if (board[id]) return id;
    return Object.keys(board).find((k) => board[k]?.some((l) => l.id === id));
  };

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    const c = findContainer(id);
    if (c) setActiveLead(board[c]?.find((l) => l.id === id) ?? null);
  };

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = findContainer(activeId);
    const to = findContainer(overId);
    if (!from || !to || from === to) return;

    setBoard((prev) => {
      const fromItems = prev[from];
      const toItems = prev[to];
      if (!fromItems || !toItems) return prev;
      const idx = fromItems.findIndex((l) => l.id === activeId);
      const moving = fromItems[idx];
      if (!moving) return prev;

      let insertAt = toItems.length;
      if (!prev[overId]) {
        const oi = toItems.findIndex((l) => l.id === overId);
        if (oi >= 0) insertAt = oi;
      }
      return {
        ...prev,
        [from]: fromItems.filter((l) => l.id !== activeId),
        [to]: [...toItems.slice(0, insertAt), moving, ...toItems.slice(insertAt)],
      };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveLead(null);
    if (!over) {
      // Solto fora de qualquer coluna: reverte o estado otimista com um refetch.
      utils.leads.list.invalidate();
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    const to = findContainer(overId) ?? findContainer(activeId);
    if (!to) return;

    const items = board[to];
    if (!items) return;
    const oldIndex = items.findIndex((l) => l.id === activeId);
    if (oldIndex < 0) return;
    const newIndex = board[overId] ? items.length - 1 : items.findIndex((l) => l.id === overId);

    let finalItems = items;
    if (newIndex >= 0 && newIndex !== oldIndex) {
      finalItems = arrayMove(items, oldIndex, newIndex);
      setBoard((prev) => ({ ...prev, [to]: finalItems }));
    }
    const finalIndex = Math.max(0, finalItems.findIndex((l) => l.id === activeId));
    move.mutate({ id: activeId, pipelineStageId: to, ordem: finalIndex });
  };

  const carregando = stages.isLoading || leads.isLoading;
  const erroCarregar = stages.isError || leads.isError;

  const todos = leads.data ?? [];
  const totalLeads = todos.length;
  const valorTotal = todos.reduce((s, l) => s + (l.valorEstimado ?? 0), 0);
  const comValor = todos.filter((l) => l.valorEstimado != null).length;
  const ticket = comValor ? valorTotal / comValor : 0;

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Funil de vendas"
        subtitle="Acompanhe cada oportunidade da chegada ao fechamento. Clique num card para abrir o painel do lead com os próximos passos; arraste (por qualquer ponto) para mudar de etapa."
      >
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Button variant="outline" onClick={() => setOrigensAberto(true)} title="Gerenciar as origens de lead">
              <Tags className="h-4 w-4" />
              Origens
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setPerdidosAberto(true)}
            title="Ver os leads perdidos e reabrir se precisar"
          >
            <ThumbsDown className="h-4 w-4" />
            Perdidos
            {resumo.data && resumo.data.perdidos > 0 && (
              <span className="ml-1 rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums">{resumo.data.perdidos}</span>
            )}
          </Button>
          <Button variant="outline" onClick={copiarCaptacao} title="Copiar o link do formulário público de captação">
            {linkCopiado ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
            {linkCopiado ? "Link copiado" : "Link de captação"}
          </Button>
          <Button onClick={() => setNovo(true)}>
            <Plus className="h-4 w-4" />
            Novo lead
          </Button>
        </div>
      </PageHeader>

      {erroCarregar ? (
        <QueryError
          onRetry={() => {
            stages.refetch();
            leads.refetch();
          }}
        />
      ) : carregando ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] rounded-xl" />
            ))}
          </div>
          <div className="flex flex-col gap-3 lg:flex-row">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col gap-2.5 rounded-xl bg-muted/40 p-2.5 lg:min-w-0 lg:flex-1"
              >
                <Skeleton className="mx-1 mt-0.5 h-4 w-24" />
                <Skeleton className="h-24 rounded-md" />
                <Skeleton className="h-24 rounded-md" />
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FunnelStat icon={Users} label="Leads ativos" value={String(totalLeads)} />
            <FunnelStat icon={Wallet} label="Valor no funil" value={formatBRL(valorTotal)} />
            <FunnelStat icon={TrendingUp} label="Ticket médio" value={formatBRL(ticket)} />
            <FunnelStat
              icon={Percent}
              label="Taxa de conversão"
              value={resumo.data ? `${Math.round(resumo.data.taxaConversao * 100)}%` : "—"}
              hint={resumo.data ? `${resumo.data.ganhos} ganho(s) · ${resumo.data.perdidos} perdido(s)` : undefined}
            />
          </div>

          {totalLeads === 0 && !filtrando ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center shadow-sm">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Inbox className="h-6 w-6" />
              </span>
              <div>
                <p className="font-medium">Seu funil está vazio</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Cadastre o primeiro lead ou compartilhe o link de captação para receber contatos do site.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setNovo(true)}>
                  <Plus className="h-4 w-4" /> Novo lead
                </Button>
                <Button variant="outline" onClick={copiarCaptacao}>
                  {linkCopiado ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                  {linkCopiado ? "Link copiado" : "Link de captação"}
                </Button>
              </div>
            </div>
          ) : (
          <>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome, empresa ou e-mail…"
                className="pl-9"
              />
            </div>
            <Select aria-label="Filtrar por responsável" value={filtroResp} onChange={(e) => setFiltroResp(e.target.value)} className="w-56">
              <option value="">Todos os responsáveis</option>
              {(equipe.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </Select>
            {filtrando && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {leadsFiltrados.length} de {totalLeads} lead{totalLeads === 1 ? "" : "s"}
                </span>
                <button
                  onClick={() => {
                    setBusca("");
                    setFiltroResp("");
                  }}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Limpar busca e filtros"
                >
                  <X className="h-3.5 w-3.5" />
                  Limpar
                </button>
              </div>
            )}
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:items-stretch">
              {stages.data?.map((stage) => (
                <Column
                  key={stage.id}
                  stage={stage}
                  leads={board[stage.id] ?? []}
                  filtrando={filtrando}
                  onOpen={(l) => setLeadAberto(l.id)}
                  onEdit={abrirEdicao}
                  onRemove={remover}
                  onConvert={converter}
                  onConvidarPortal={convidarPortalConfirm}
                  convertingId={convert.isPending ? convert.variables?.id : undefined}
                  convidandoPortalId={convidarPortal.isPending ? convidarPortal.variables?.id : undefined}
                />
              ))}
            </div>

            <DragOverlay>
              {activeLead ? (
                <div className="w-64">
                  <LeadCard lead={activeLead} overlay />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          </>
          )}
        </>
      )}

      <LeadFormDialog open={novo} onClose={() => setNovo(false)} />
      <LeadFormDialog
        open={!!editando}
        onClose={() => setEditando(null)}
        lead={editando ?? undefined}
      />
      <ConviteLinkDialog
        info={conviteInfo}
        erro={erroConvite}
        onClose={() => {
          setConviteInfo(null);
          setErroConvite(null);
        }}
      />
      <OrigensDialog open={origensAberto} onClose={() => setOrigensAberto(false)} />
      <LeadDetailPanel
        leadId={leadAberto}
        onClose={() => setLeadAberto(null)}
        acoes={{
          onEditar: abrirEdicaoPorId,
          onConverter: converter,
          onConvidarPortal: convidarPortalConfirm,
          onPerder: perder,
          onRemover: remover,
        }}
      />

      <Modal open={perdidosAberto} onClose={() => setPerdidosAberto(false)} title="Leads perdidos">
        <p className="mb-4 text-sm text-muted-foreground">
          Oportunidades que não avançaram. Reabra para trazer de volta ao funil.
        </p>
        {perdidos.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : perdidos.isError ? (
          <div className="py-6 text-center text-sm text-destructive">
            Não foi possível carregar os leads perdidos.{" "}
            <button onClick={() => perdidos.refetch()} className="font-medium underline">
              Tentar de novo
            </button>
          </div>
        ) : !perdidos.data || perdidos.data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum lead perdido. 🎉</p>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {perdidos.data.map((l) => (
              <div key={l.id} className="flex items-start gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{l.nome}</span>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                      style={{ background: l.pipelineStage.cor ?? "#94a3b8" }}
                    >
                      {l.pipelineStage.nome}
                    </span>
                  </div>
                  {l.empresa && <div className="truncate text-xs text-muted-foreground">{l.empresa}</div>}
                  {l.motivoPerda && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Motivo:</span> {l.motivoPerda}
                    </p>
                  )}
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Perdido em {l.perdidoEm ? dataHora(l.perdidoEm) : "—"}
                    {l.responsavel ? ` · ${l.responsavel.nome}` : ""}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={reabrir.isPending}
                  onClick={() => reabrir.mutate({ id: l.id })}
                  title="Reabrir no funil"
                >
                  <RotateCcw className="h-4 w-4" /> Reabrir
                </Button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
