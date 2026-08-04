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
 * Fonte de verdade da busca ("Ir para") do Ctrl+K. Antes, a paleta e o menu lateral mantinham
 * listas SEPARADAS à mão — e divergiam: Sistema e Modelos existiam no app mas não apareciam na
 * busca. Há um teste (`paginas.test.ts`) que cruza este catálogo com as rotas reais do router e
 * falha se uma página navegável ficar de fora.
 *
 * `keywords`: termos que a pessoa digitaria mas não estão no rótulo (ex.: "saúde" → Sistema,
 * "usuários" → Equipe). Busca sem acento e sem caixa (ver `normalizar`).
 */
export interface Pagina {
  label: string;
  icon: LucideIcon;
  to: string;
  minRole: Role;
  keywords?: string[];
}

export const PAGINAS: Pagina[] = [
  { label: "Início", icon: LayoutDashboard, to: "/", minRole: "FUNCIONARIO", keywords: ["dashboard", "home", "painel", "resumo"] },
  { label: "Vendas", icon: Filter, to: "/leads", minRole: "FUNCIONARIO", keywords: ["funil", "leads", "oportunidades", "pipeline", "negocios"] },
  { label: "Clientes", icon: Users, to: "/clientes", minRole: "FUNCIONARIO", keywords: ["contatos", "empresas"] },
  { label: "Projetos", icon: FolderKanban, to: "/projetos", minRole: "FUNCIONARIO", keywords: ["kanban", "quadro"] },
  { label: "Tarefas", icon: ListTodo, to: "/tarefas", minRole: "FUNCIONARIO", keywords: ["delegar", "pedidos", "comigo", "deleguei", "afazeres", "to-do", "solicitacoes"] },
  { label: "Agenda", icon: Calendar, to: "/agenda", minRole: "FUNCIONARIO", keywords: ["calendario", "eventos", "compromissos", "reunioes"] },
  { label: "Mensagens", icon: MessageSquare, to: "/mensagens", minRole: "FUNCIONARIO", keywords: ["chat", "conversas", "suporte", "chamados"] },
  { label: "E-mail", icon: Inbox, to: "/email", minRole: "FUNCIONARIO", keywords: ["email", "e-mail", "caixa de entrada", "webmail", "inbox", "mensagem"] },
  { label: "Documentos", icon: FileText, to: "/documentos", minRole: "FUNCIONARIO", keywords: ["propostas", "contratos", "atas", "recibos"] },
  { label: "Financeiro", icon: Wallet, to: "/financeiro", minRole: "ADMIN", keywords: ["contas", "pagar", "receber", "carteira", "dinheiro"] },
  // ── Configuração ──
  { label: "Ajustes", icon: SlidersHorizontal, to: "/ajustes", minRole: "ADMIN", keywords: ["configuracao", "catalogos"] },
  { label: "Serviços", icon: Briefcase, to: "/servicos", minRole: "ADMIN", keywords: ["catalogo", "exigencias", "passos"] },
  { label: "Modelos de documento", icon: FileSignature, to: "/modelos", minRole: "ADMIN", keywords: ["modelos", "templates", "briefings", "moldes"] },
  { label: "Mensagens automáticas", icon: Mail, to: "/emails", minRole: "ADMIN", keywords: ["e-mails", "templates de email", "comunicacoes", "notificacoes"] },
  { label: "Equipe e acessos", icon: UserCog, to: "/usuarios", minRole: "ADMIN", keywords: ["usuarios", "permissoes", "papeis", "convites"] },
  { label: "E-mails enviados", icon: SendHorizontal, to: "/emails-enviados", minRole: "ADMIN", keywords: ["monitor", "entregas", "falhas de email"] },
  { label: "Configurações", icon: Settings, to: "/configuracoes", minRole: "FUNCIONARIO", keywords: ["perfil", "senha", "foto", "preferencias"] },
  { label: "Sistema", icon: ServerCog, to: "/sistema", minRole: "ROOT", keywords: ["saude", "erros", "incidentes", "sessoes", "desempenho", "banco", "manutencao", "diagnostico"] },
];

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
