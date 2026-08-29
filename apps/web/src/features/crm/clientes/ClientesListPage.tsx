import { useMemo, useState, type MouseEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AcessoPortalBotao } from "../AcessoPortalBotao";
import type { LucideIcon } from "lucide-react";
import {
  Plus,
  Search,
  Users,
  LayoutGrid,
  List,
  Mail,
  MessageCircle,
  Phone,
  FolderKanban,
  CalendarClock,
  KeyRound,
  CheckCircle2,
  UserX,
  Target,
  Building2,
  Package,
  AlertTriangle,
  X,
} from "lucide-react";
import { cn } from "@app/ui";
import { trpc, type RouterOutputs } from "../../../lib/trpc";
import { maskTelefone } from "../../../lib/masks";
import { data } from "../../../lib/format-date";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { PageHeader } from "../../../components/ui/page-header";
import { DataTable, type Coluna } from "../../../components/ui/data-table";
import { Badge, type BadgeProps } from "../../../components/ui/badge";
import { EmptyState } from "../../../components/ui/empty-state";
import { Skeleton } from "../../../components/ui/skeleton";
import { QueryError } from "../../../components/ui/query-error";
import { useConfirm } from "../../../components/ui/confirm-dialog";
import { SITUACAO_COMERCIAL_LABEL, formatarCNPJ, type SituacaoComercial } from "@app/shared";
import { ClienteFormDialog } from "./ClienteFormDialog";
import { ConviteLinkDialog } from "../../configuracoes/ConviteLinkDialog";
import type { ConviteResultado } from "../../configuracoes/UsuarioFormDialog";

export const situacaoVar: Record<SituacaoComercial, BadgeProps["variant"]> = {
  PROSPECT: "primary",
  NEGOCIACAO: "warning",
  ATIVO: "success",
  INATIVO: "default",
  PERDIDO: "danger",
};

type ClienteItem = RouterOutputs["clientes"]["list"][number];

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const escolhidas = partes.length > 1 ? [partes[0], partes[partes.length - 1]] : partes;
  return escolhidas.map((p) => p?.[0]?.toUpperCase() ?? "").join("") || "?";
}

function whatsapp(telefone: string | null): string {
  const d = telefone?.replace(/\D/g, "") ?? "";
  if (d.length < 10) return "";
  return d.startsWith("55") ? d : `55${d}`;
}

// Filtros (chip). "" = todos. Só estados de CLIENTE — prospects/perdidos ficam no Funil.
const FILTROS: { v: "" | SituacaoComercial; label: string }[] = [
  { v: "", label: "Todos" },
  { v: "ATIVO", label: "Ativos" },
  { v: "INATIVO", label: "Inativos" },
];

function Kpi({ icon: Icon, label, value, tom = "primary" }: { icon: LucideIcon; label: string; value: string; tom?: "primary" | "success" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-sm">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
          tom === "success" ? "bg-success/5 text-success ring-success/10" : "bg-primary/5 text-primary ring-primary/10",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums text-primary">{value}</div>
      </div>
    </div>
  );
}

/** Ações rápidas de contato (e-mail/WhatsApp) — botões, para não aninhar <a> dentro do card-link. */
function ContatoRapido({ email, telefone }: { email: string | null; telefone: string | null }) {
  const wa = whatsapp(telefone);
  const parar = (e: MouseEvent) => e.stopPropagation();
  if (!email && !wa && !telefone) return <span className="text-xs text-muted-foreground">Sem contato cadastrado</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={parar}>
      {email && (
        <button
          onClick={() => (window.location.href = `mailto:${email}`)}
          className="inline-flex max-w-[190px] items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={email}
        >
          <Mail className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">{email}</span>
        </button>
      )}
      {wa && (
        <button
          onClick={() => window.open(`https://wa.me/${wa}`, "_blank", "noopener")}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success/10"
          title="WhatsApp"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          WhatsApp
        </button>
      )}
      {!email && !wa && telefone && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Phone className="h-3.5 w-3.5" /> {maskTelefone(telefone)}
        </span>
      )}
    </div>
  );
}

function ClienteCard({ c, onOpen, onConvidarPortal }: { c: ClienteItem; onOpen: () => void; onConvidarPortal: () => void }) {
  const portal = c.portal;
  const proxima = c.proximaReuniao;
  return (
    <div
      onClick={onOpen}
      className="group flex cursor-pointer flex-col rounded-xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blueLight to-primary text-sm font-semibold text-white shadow-sm">
          {iniciais(c.nome)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground group-hover:text-primary">{c.nome}</div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3 shrink-0" />
            <span className="min-w-0 truncate">{c.cnpj ? formatarCNPJ(c.cnpj) : "CNPJ não informado"}</span>
          </div>
        </div>
        <Badge variant={situacaoVar[c.situacaoComercial as SituacaoComercial]}>
          {SITUACAO_COMERCIAL_LABEL[c.situacaoComercial as SituacaoComercial]}
        </Badge>
      </div>

      <div className="mt-3">
        <ContatoRapido email={c.email} telefone={c.telefone} />
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1" title="Projetos">
          <FolderKanban className="h-3.5 w-3.5" /> {c._count.projetos} {c._count.projetos === 1 ? "projeto" : "projetos"}
        </span>
        {c._count.servicosContratados > 0 ? (
          <span className="inline-flex items-center gap-1" title="Serviços contratados">
            <Package className="h-3.5 w-3.5" /> {c._count.servicosContratados} {c._count.servicosContratados === 1 ? "serviço" : "serviços"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-warning" title="Cliente sem serviço contratado — registre o que ele tem">
            <AlertTriangle className="h-3.5 w-3.5" /> Sem serviço
          </span>
        )}
        {proxima && (
          <span className="inline-flex items-center gap-1 text-primary" title="Próxima reunião">
            <CalendarClock className="h-3.5 w-3.5" /> {data(proxima)}
          </span>
        )}
        {/* Três estados do acesso (ADR-128): enviar · reenviar · Painel. O selo "Portal" que
            existia aqui só dizia "tem acesso" e não levava a lugar nenhum. */}
        <AcessoPortalBotao
          portal={portal}
          clienteId={c.id}
          temEmail={!!c.email}
          onEnviarAcesso={onConvidarPortal}
        />
        {c.emFunil && (
          <span
            className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 font-medium text-warning"
            title="Tem uma oportunidade aberta no funil (quer mais serviços)"
          >
            <Target className="h-3 w-3" /> No funil
          </span>
        )}
        {c.responsavel && (
          <span className="ml-auto inline-flex items-center gap-1.5" title={`Responsável: ${c.responsavel.nome}`}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
              {iniciais(c.responsavel.nome)}
            </span>
            <span className="max-w-[90px] truncate">{c.responsavel.nome.split(" ")[0]}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export function ClientesListPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [situacao, setSituacao] = useState<"" | SituacaoComercial>("");
  const [responsavelId, setResponsavelId] = useState("");
  const [visao, setVisao] = useState<"cards" | "lista">("cards");
  const [novo, setNovo] = useState(false);
  const [conviteInfo, setConviteInfo] = useState<ConviteResultado | null>(null);
  const [erroConvite, setErroConvite] = useState<string | null>(null);

  const clientes = trpc.clientes.list.useQuery({});
  const resumo = trpc.clientes.resumo.useQuery();
  const equipe = trpc.usuarios.equipe.useQuery();
  const convidarPortal = trpc.clientes.convidarPortal.useMutation({
    onSuccess: (r) => {
      setErroConvite(null);
      utils.clientes.list.invalidate();
      utils.clientes.resumo.invalidate(); // KPI "Com Portal ativo" reflete o novo acesso na hora
      setConviteInfo({ email: r.email, conviteUrl: r.conviteUrl, emailEnviado: r.emailEnviado });
    },
    onError: (e) => {
      setConviteInfo(null);
      setErroConvite(e.message);
    },
  });

  const enviarAcesso = async (c: ClienteItem) => {
    if (
      await confirm({
        title: "Enviar acesso ao Portal",
        description: `"${c.nome}" receberá um e-mail com o link de acesso ao Portal do Cliente (${c.email}). Confirmar o envio?`,
        confirmText: "Enviar",
        icon: KeyRound,
      })
    )
      convidarPortal.mutate({ id: c.id });
  };

  const abrir = (id: string) => navigate({ to: "/clientes/$clienteId", params: { clienteId: id } });

  // Busca instantânea (client-side) + filtros. A busca alimenta as contagens dos chips.
  const porBusca = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = clientes.data ?? [];
    if (!q) return base;
    return base.filter((c) =>
      [c.nome, c.email, c.cnpj, c.telefone].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [clientes.data, search]);

  const contagem = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of porBusca) m[c.situacaoComercial] = (m[c.situacaoComercial] ?? 0) + 1;
    return m;
  }, [porBusca]);

  const filtrados = useMemo(
    () =>
      porBusca.filter(
        (c) =>
          (!situacao || c.situacaoComercial === situacao) &&
          (!responsavelId || c.responsavelId === responsavelId),
      ),
    [porBusca, situacao, responsavelId],
  );

  const colunas: Coluna<ClienteItem>[] = [
    {
      chave: "cliente",
      cabecalho: "Cliente",
      principal: true,
      valorOrdenacao: (c) => c.nome,
      render: (c) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blueLight to-primary text-[11px] font-semibold text-white">
            {iniciais(c.nome)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-primary">{c.nome}</div>
            <div className="truncate text-xs text-muted-foreground">{c.cnpj ? formatarCNPJ(c.cnpj) : "CNPJ não informado"}</div>
          </div>
        </div>
      ),
    },
    {
      chave: "situacao",
      cabecalho: "Situação",
      render: (c) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={situacaoVar[c.situacaoComercial as SituacaoComercial]}>
            {SITUACAO_COMERCIAL_LABEL[c.situacaoComercial as SituacaoComercial]}
          </Badge>
          {c.emFunil && (
            <span
              className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning"
              title="Tem oportunidade aberta no funil (quer mais serviços)"
            >
              <Target className="h-3 w-3" /> No funil
            </span>
          )}
        </div>
      ),
    },
    {
      chave: "contato",
      cabecalho: "Contato",
      ocultaEmCelular: true,
      render: (c) => (
        <span className="block max-w-[220px] truncate text-muted-foreground">
          {c.email ?? (c.telefone ? maskTelefone(c.telefone) : "—")}
        </span>
      ),
    },
    {
      chave: "projetos",
      cabecalho: "Projetos",
      alinhamento: "direita",
      ocultaEmCelular: true,
      valorOrdenacao: (c) => c._count.projetos,
      render: (c) => <span className="tabular-nums text-muted-foreground">{c._count.projetos}</span>,
    },
    {
      chave: "servicos",
      cabecalho: "Serviços",
      alinhamento: "direita",
      valorOrdenacao: (c) => c._count.servicosContratados,
      render: (c) =>
        c._count.servicosContratados > 0 ? (
          <span className="tabular-nums text-muted-foreground">{c._count.servicosContratados}</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-warning" title="Sem serviço contratado">
            <AlertTriangle className="h-3.5 w-3.5" /> 0
          </span>
        ),
    },
    {
      chave: "proximaReuniao",
      cabecalho: "Próxima reunião",
      ocultaEmCelular: true,
      valorOrdenacao: (c) => (c.proximaReuniao ? new Date(c.proximaReuniao) : null),
      render: (c) =>
        c.proximaReuniao ? (
          <span className="inline-flex items-center gap-1 text-primary">
            <CalendarClock className="h-3.5 w-3.5" /> {data(c.proximaReuniao)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      chave: "portal",
      cabecalho: "Portal",
      ocultaEmCelular: true,
      render: (c) =>
        c.email || c.portal.estado === "ATIVO" ? (
          <AcessoPortalBotao portal={c.portal} clienteId={c.id} temEmail={!!c.email} onEnviarAcesso={() => enviarAcesso(c)} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      chave: "responsavel",
      cabecalho: "Responsável",
      ocultaEmCelular: true,
      valorOrdenacao: (c) => c.responsavel?.nome ?? null,
      render: (c) => <span className="text-muted-foreground">{c.responsavel?.nome ?? "—"}</span>,
    },
  ];

  const r = resumo.data;
  const filtrando = !!search.trim() || situacao !== "" || responsavelId !== "";
  const limpar = () => {
    setSearch("");
    setSituacao("");
    setResponsavelId("");
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Clientes"
        subtitle="Seus clientes ativos e inativos. (Leads e prospects em negociação ficam no Funil de vendas.) Abra uma ficha para ver tudo do cliente."
      >
        <Button onClick={() => setNovo(true)}>
          <Plus className="h-4 w-4" />
          Novo cliente
        </Button>
      </PageHeader>

      {/* KPIs da base */}
      <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {resumo.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[68px] rounded-xl" />)
        ) : (
          // Em erro, `r` fica indefinido: mostramos "—" em vez de travar no skeleton.
          <>
            <Kpi icon={Users} label="Total de clientes" value={r ? String(r.total) : "—"} />
            <Kpi icon={CheckCircle2} tom="success" label="Ativos" value={r ? String(r.ativos) : "—"} />
            <Kpi icon={UserX} label="Inativos" value={r ? String(r.inativos) : "—"} />
            <Kpi icon={KeyRound} label="Com Portal ativo" value={r ? String(r.portaisAtivos) : "—"} />
          </>
        )}
      </div>

      {/* Barra de trabalho: busca + filtros + alternância de visão */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, e-mail, CNPJ…"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg border p-0.5">
          {FILTROS.map((f) => {
            const n = f.v === "" ? porBusca.length : contagem[f.v] ?? 0;
            return (
              <button
                key={f.v || "todos"}
                onClick={() => setSituacao(f.v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  situacao === f.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[11px] tabular-nums",
                    situacao === f.v ? "bg-white/20" : "bg-muted",
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        <Select
          value={responsavelId}
          onChange={(e) => setResponsavelId(e.target.value)}
          className="h-9 w-auto"
          title="Filtrar por responsável"
        >
          <option value="">Todos os responsáveis</option>
          {equipe.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </Select>

        {filtrando && (
          <button
            onClick={limpar}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Limpar busca e filtros"
          >
            <X className="h-4 w-4" />
            Limpar
          </button>
        )}

        <div className="ml-auto inline-flex overflow-hidden rounded-lg border">
          <button
            onClick={() => setVisao("cards")}
            aria-label="Visão em cards"
            aria-pressed={visao === "cards"}
            className={cn("flex h-11 w-11 items-center justify-center transition-colors", visao === "cards" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setVisao("lista")}
            aria-label="Visão em lista"
            aria-pressed={visao === "lista"}
            className={cn("flex h-11 w-11 items-center justify-center transition-colors", visao === "lista" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {clientes.isError ? (
        <QueryError onRetry={() => clientes.refetch()} />
      ) : visao === "lista" ? (
        <DataTable
          dados={filtrados}
          colunas={colunas}
          chaveLinha={(c) => c.id}
          carregando={clientes.isLoading}
          linhasEsqueleto={6}
          aoClicarLinha={(c) => abrir(c.id)}
          vazio={
            <EmptyState
              icon={Users}
              title={clientes.data && clientes.data.length > 0 ? "Nenhum cliente com esses filtros" : "Nenhum cliente ainda"}
              description={
                clientes.data && clientes.data.length > 0
                  ? "Ajuste a busca ou os filtros para encontrar quem procura."
                  : "Comece cadastrando seu primeiro cliente."
              }
            >
              {!clientes.data || clientes.data.length === 0 ? (
                <Button onClick={() => setNovo(true)}>
                  <Plus className="h-4 w-4" />
                  Novo cliente
                </Button>
              ) : (
                <Button variant="outline" onClick={limpar}>
                  <X className="h-4 w-4" />
                  Limpar filtros
                </Button>
              )}
            </EmptyState>
          }
        />
      ) : clientes.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={Users}
          title={clientes.data && clientes.data.length > 0 ? "Nenhum cliente com esses filtros" : "Nenhum cliente ainda"}
          description={
            clientes.data && clientes.data.length > 0
              ? "Ajuste a busca ou os filtros para encontrar quem procura."
              : "Comece cadastrando seu primeiro cliente."
          }
        >
          {!clientes.data || clientes.data.length === 0 ? (
            <Button onClick={() => setNovo(true)}>
              <Plus className="h-4 w-4" />
              Novo cliente
            </Button>
          ) : (
            <Button variant="outline" onClick={limpar}>
              <X className="h-4 w-4" />
              Limpar filtros
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((c) => (
            <ClienteCard key={c.id} c={c} onOpen={() => abrir(c.id)} onConvidarPortal={() => enviarAcesso(c)} />
          ))}
        </div>
      )}
      </div>

      <ClienteFormDialog open={novo} onClose={() => setNovo(false)} />
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
