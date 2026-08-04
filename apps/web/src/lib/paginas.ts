import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Filter,
  Users,
  FolderKanban,
  ListTodo,
  Calendar,
  MessageSquare,
  Inbox,
  FileText,
  Wallet,
  SlidersHorizontal,
  Briefcase,
  Mail,
  UserCog,
  SendHorizontal,
  Settings,
  ServerCog,
  FileSignature,
} from "lucide-react";
import type { Role } from "@app/shared";

/**
 * Catálogo ÚNICO das páginas navegáveis da aplicação.
 *
 * Fonte de verdade da busca ("Ir para") do Ctrl+K **e do menu lateral**. Antes, a paleta e o menu
 * mantinham listas SEPARADAS à mão — e divergiam: primeiro sumiram Sistema e Modelos da busca;
 * depois "E-mail" entrou aqui e não apareceu no menu, porque o `AppLayout` tinha o próprio
 * `NAV_GROUPS`. Agora o menu é DERIVADO daqui (`MENU_GRUPOS`) e `paginas.test.ts` cruza os dois
 * com as rotas reais do router: página nova sem decisão de menu reprova.
 *
 * `keywords`: termos que a pessoa digitaria mas não estão no rótulo (ex.: "saúde" → Sistema,
 * "usuários" → Equipe). Busca sem acento e sem caixa (ver `normalizar`).
 * `grupo`: em que grupo do menu lateral o item aparece. Sem `grupo` = fora do menu (abre por
 * Ajustes, pela ficha ou pelo menu do usuário).
 */
export type GrupoMenu = "Dia a dia" | "Configuração";

/** Ordem dos grupos no menu lateral. */
export const GRUPOS_MENU: readonly GrupoMenu[] = ["Dia a dia", "Configuração"];

export interface Pagina {
  label: string;
  icon: LucideIcon;
  to: string;
  minRole: Role;
  keywords?: string[];
  grupo?: GrupoMenu;
}

export const PAGINAS: Pagina[] = [
  { label: "Início", icon: LayoutDashboard, to: "/", minRole: "FUNCIONARIO", grupo: "Dia a dia", keywords: ["dashboard", "home", "painel", "resumo"] },
  { label: "Vendas", icon: Filter, to: "/leads", minRole: "FUNCIONARIO", grupo: "Dia a dia", keywords: ["funil", "leads", "oportunidades", "pipeline", "negocios"] },
  { label: "Clientes", icon: Users, to: "/clientes", minRole: "FUNCIONARIO", grupo: "Dia a dia", keywords: ["contatos", "empresas"] },
  { label: "Projetos", icon: FolderKanban, to: "/projetos", minRole: "FUNCIONARIO", grupo: "Dia a dia", keywords: ["kanban", "quadro"] },
  { label: "Tarefas", icon: ListTodo, to: "/tarefas", minRole: "FUNCIONARIO", grupo: "Dia a dia", keywords: ["delegar", "pedidos", "comigo", "deleguei", "afazeres", "to-do", "solicitacoes"] },
  { label: "Agenda", icon: Calendar, to: "/agenda", minRole: "FUNCIONARIO", grupo: "Dia a dia", keywords: ["calendario", "eventos", "compromissos", "reunioes"] },
  { label: "Mensagens", icon: MessageSquare, to: "/mensagens", minRole: "FUNCIONARIO", grupo: "Dia a dia", keywords: ["chat", "conversas", "suporte", "chamados"] },
  { label: "E-mail", icon: Inbox, to: "/email", minRole: "FUNCIONARIO", grupo: "Dia a dia", keywords: ["email", "e-mail", "caixa de entrada", "webmail", "inbox", "mensagem"] },
  { label: "Documentos", icon: FileText, to: "/documentos", minRole: "FUNCIONARIO", grupo: "Dia a dia", keywords: ["propostas", "contratos", "atas", "recibos"] },
  { label: "Financeiro", icon: Wallet, to: "/financeiro", minRole: "ADMIN", grupo: "Dia a dia", keywords: ["contas", "pagar", "receber", "carteira", "dinheiro"] },
  // ── Configuração ──
  { label: "Ajustes", icon: SlidersHorizontal, to: "/ajustes", minRole: "ADMIN", grupo: "Configuração", keywords: ["configuracao", "catalogos"] },
  { label: "Serviços", icon: Briefcase, to: "/servicos", minRole: "ADMIN", keywords: ["catalogo", "exigencias", "passos"] },
  { label: "Modelos de documento", icon: FileSignature, to: "/modelos", minRole: "ADMIN", keywords: ["modelos", "templates", "briefings", "moldes"] },
  { label: "Mensagens automáticas", icon: Mail, to: "/emails", minRole: "ADMIN", keywords: ["e-mails", "templates de email", "comunicacoes", "notificacoes"] },
  { label: "Equipe e acessos", icon: UserCog, to: "/usuarios", minRole: "ADMIN", keywords: ["usuarios", "permissoes", "papeis", "convites"] },
  { label: "E-mails enviados", icon: SendHorizontal, to: "/emails-enviados", minRole: "ADMIN", keywords: ["monitor", "entregas", "falhas de email"] },
  { label: "Configurações", icon: Settings, to: "/configuracoes", minRole: "FUNCIONARIO", keywords: ["perfil", "senha", "foto", "preferencias"] },
  { label: "Sistema", icon: ServerCog, to: "/sistema", minRole: "ROOT", grupo: "Configuração", keywords: ["saude", "erros", "incidentes", "sessoes", "desempenho", "banco", "manutencao", "diagnostico"] },
];

/**
 * Menu lateral, DERIVADO do catálogo acima (o `AppLayout` só filtra por papel e desenha).
 * A ordem dentro do grupo é a ordem de `PAGINAS`.
 */
export const MENU_GRUPOS: { titulo: GrupoMenu; itens: Pagina[] }[] = GRUPOS_MENU.map((titulo) => ({
  titulo,
  itens: PAGINAS.filter((p) => p.grupo === titulo),
}));

/** Minúsculas + sem acento — para a busca casar "saude" com "Saúde" e "servicos" com "Serviços". */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** Casa a consulta contra o rótulo, a rota e as palavras-chave. */
export function paginaCasa(p: Pagina, consulta: string): boolean {
  const q = normalizar(consulta.trim());
  if (!q) return true;
  const alvo = normalizar([p.label, p.to, ...(p.keywords ?? [])].join(" "));
  return alvo.includes(q);
}
