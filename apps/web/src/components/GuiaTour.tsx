import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Sparkles,
  Compass,
  LayoutDashboard,
  Filter,
  Briefcase,
  FileSignature,
  Users,
  CalendarClock,
  Mail,
  CheckCircle2,
  X,
  ChevronLeft,
  ChevronRight,
  MousePointerClick,
  ListChecks,
  ArrowRightLeft,
  UserCheck,
  FolderKanban,
  Wallet,
  MessageSquare,
  UserCog,
  ServerCog,
  Settings,
  FileText,
  SlidersHorizontal,
  SendHorizontal,
} from "lucide-react";
import { cn } from "@app/ui";
import { hasRoleLevel, type Role } from "@app/shared";
import { useAuth } from "../lib/auth-context";

export interface Passo {
  icon: LucideIcon;
  titulo: string;
  descricao: React.ReactNode;
  minRole?: Role;
  /** Mostra o logotipo (igual o menu) no lugar do ícone. */
  logo?: boolean;
}
interface Guia {
  titulo: string;
  passos: Passo[];
}

// ── Guia geral (aparece no Dashboard) ────────────────────
const VISAO_GERAL: Passo[] = [
  {
    icon: Sparkles,
    logo: true,
    titulo: "Bem-vindo ao Workspace!",
    descricao:
      "Este é o cérebro operacional da MedConsultoria — clientes, funil de vendas, projetos, agenda, finanças e documentos, tudo num só lugar. Em um minutinho eu te mostro o essencial.",
  },
  {
    icon: Compass,
    titulo: "O menu lateral",
    descricao:
      "À esquerda você navega entre as áreas, agrupadas em Comercial, Operação e Gestão. O que aparece depende do seu nível de acesso. Pode recolher o menu no ícone do topo.",
  },
  {
    icon: LayoutDashboard,
    titulo: "Dashboard",
    descricao:
      "Sua tela inicial reúne o que precisa da sua atenção agora: tarefas, compromissos do dia, contas a vencer e alertas. É o seu ponto de partida todo dia.",
  },
  {
    icon: Filter,
    titulo: "Funil de vendas",
    descricao: (
      <>
        Cada oportunidade é um <strong>card</strong>. Clique para abrir o painel do lead com os{" "}
        <strong>próximos passos</strong>; arraste (por qualquer ponto) para mudar de etapa. Ao concluir os passos
        obrigatórios, o lead fica pronto para avançar. Alguns avanços acontecem sozinhos.
      </>
    ),
  },
  {
    icon: Briefcase,
    titulo: "Serviços",
    minRole: "ADMIN",
    descricao:
      "Cadastre os serviços que a MedConsultoria oferece. Cada serviço tem seus próprios passos por etapa — que entram automaticamente no checklist do lead que escolher aquele serviço.",
  },
  {
    icon: FileSignature,
    titulo: "Documentos e assinaturas",
    descricao: (
      <>
        Gere <strong>propostas, contratos e briefings</strong> a partir de modelos, já preenchidos com os dados do
        cliente. Envie para <strong>assinatura digital</strong> — o cliente e a equipe assinam pelo link, com validade
        jurídica e trilha de auditoria.
      </>
    ),
  },
  {
    icon: Users,
    titulo: "Clientes e Projetos",
    descricao:
      "Quando um lead fecha, ele vira Cliente e um Projeto é criado com os serviços como tarefas. Acompanhe tudo pela ficha do cliente e pelos quadros (kanban) de cada projeto.",
  },
  {
    icon: CalendarClock,
    titulo: "Agenda e Financeiro",
    descricao:
      "Organize compromissos, reuniões e lembretes na Agenda (com avisos automáticos). No Financeiro, controle contas a pagar e a receber, com alertas de vencimento e o resultado do mês.",
  },
  {
    icon: Mail,
    titulo: "Comunicações",
    minRole: "ADMIN",
    descricao:
      "Personalize os textos de todos os e-mails e notificações automáticas — mantendo o logo, as cores e a assinatura da marca. Você edita só o conteúdo.",
  },
  {
    icon: CheckCircle2,
    titulo: "Pronto para começar!",
    descricao: (
      <>
        É isso! Em <strong>qualquer página</strong>, o botão <strong>?</strong> no topo abre o guia daquela tela. Bom
        trabalho! 🚀
      </>
    ),
  },
];

// ── Guias por página ─────────────────────────────────────
const GUIA_FUNIL: Passo[] = [
  {
    icon: Filter,
    titulo: "O funil de vendas",
    descricao: "Cada oportunidade é um card; as colunas são as etapas (do primeiro contato ao fechamento). No topo, os números do funil: leads, valor e ticket médio.",
  },
  {
    icon: MousePointerClick,
    titulo: "Abra e mova o card",
    descricao: (
      <>
        <strong>Clique</strong> num card para abrir o painel do lead (contato por WhatsApp/e-mail, serviços, próximos
        passos e histórico). <strong>Arraste</strong> por qualquer ponto do card para mudar de etapa.
      </>
    ),
  },
  {
    icon: ListChecks,
    titulo: "Próximos passos",
    descricao: (
      <>
        Cada etapa tem um checklist — os passos <em>obrigatórios</em> precisam ser concluídos para avançar. Cada serviço
        do lead adiciona seus próprios passos, e você pode incluir passos avulsos.
      </>
    ),
  },
  {
    icon: FileSignature,
    titulo: "Gerar documentos e assinar",
    descricao: "Passos como “Enviar proposta” têm o botão Gerar: ele cria o documento do modelo com os dados do lead e leva à página do documento, onde você solicita a assinatura digital. Ao assinar, o passo se conclui sozinho.",
  },
  {
    icon: ArrowRightLeft,
    titulo: "Avanços automáticos",
    descricao: "Convidou para o Portal → Qualificação; o lead acessou o Portal ou uma proposta foi assinada → Proposta. A automação só avança, nunca volta — e você pode mover manualmente quando quiser.",
  },
  {
    icon: UserCheck,
    titulo: "Converter em cliente",
    descricao: "Ao fechar, use Converter: o lead vira Cliente e um Projeto é criado automaticamente com os serviços contratados como tarefas.",
  },
];

const GUIA_CLIENTES: Passo[] = [
  { icon: Users, titulo: "Sua base de clientes", descricao: "Só quem já é cliente (Ativo ou Inativo) — leads e prospects em negociação ficam no Funil de Vendas. No topo, os números: total, ativos, inativos e quantos têm o Portal ativo." },
  { icon: Filter, titulo: "Buscar e filtrar", descricao: "Filtre por Todos / Ativos / Inativos e por responsável, ou busque por nome. Use “Novo cliente” para cadastrar à mão — ou eles chegam sozinhos quando você converte um lead no funil." },
  { icon: FileText, titulo: "A ficha do cliente", descricao: "Clique num cliente para abrir a ficha — o hub dele: contatos, anotações, origem comercial, serviços contratados, projetos, documentos, próximas reuniões e o financeiro (só ADMIN)." },
  { icon: MessageSquare, titulo: "Suporte e Portal", descricao: "Na ficha você acompanha os chamados de suporte do cliente e envia o acesso ao Portal (“Enviar acesso”). Ativar/Desativar o cliente é um clique — toda exclusão pede confirmação." },
  { icon: Sparkles, titulo: "Nova oportunidade (upsell)", descricao: "Cliente quer mais um serviço? Use “Nova oportunidade”: abre um novo negócio no funil já com os serviços escolhidos, sem transformar o cliente em lead de novo." },
];

const GUIA_SERVICOS: Passo[] = [
  { icon: Briefcase, titulo: "Catálogo de serviços", descricao: "Os serviços que a MedConsultoria oferece, com categoria e preço (valor fixo e/ou % do faturamento, avulso ou mensal). O lead escolhe no cadastro (site ou manual) e eles entram no card e no contrato." },
  { icon: SlidersHorizontal, titulo: "Configurar cada serviço", descricao: "No botão “Configurar”, um diálogo com três abas: Detalhes (preço, cláusulas de contrato), Exigências (o que o cliente precisa enviar) e Passos (as tarefas da venda por etapa)." },
  { icon: ListChecks, titulo: "Exigências e passos", descricao: "As Exigências viram o checklist que o cliente cumpre no Portal (documento, resposta ou briefing). Os Passos entram automaticamente no funil do lead que contratar o serviço." },
  { icon: Settings, titulo: "Organizar", descricao: "Crie, renomeie, reordene (arraste), ative/desative ou remova serviços. As mudanças valem para os próximos cadastros — os projetos já criados não mudam." },
];

const GUIA_PROJETOS: Passo[] = [
  { icon: FolderKanban, titulo: "Um projeto por serviço", descricao: "Ao converter um lead, nasce um projeto para cada serviço contratado (“Serviço — Cliente”), já com os cartões do roteiro. A lista ordena por urgência (atrasados primeiro) e mostra ativos, pausados, concluídos e com atraso." },
  { icon: ArrowRightLeft, titulo: "Quadro kanban", descricao: "As colunas são o fluxo: A fazer → Em andamento → Aguardando cliente / Aguardando terceiros → Concluído. Arraste o cartão por qualquer ponto; o status de alguns cartões anda sozinho conforme o cliente entrega." },
  { icon: MousePointerClick, titulo: "Abrir o cartão", descricao: "Clique no cartão para abrir: à esquerda o checklist, à direita o cronômetro e os comentários. Marcar todas as tarefas de um cartão o conclui; concluir todos os cartões conclui o projeto." },
  { icon: ListChecks, titulo: "Checklist, prazo e responsável", descricao: "Cada tarefa tem checklist, prazo, prioridade e responsável — atribua para cada um ver o que é dele. O cartão “Entregas do cliente” marca-se sozinho quando o cliente envia pelo Portal." },
  { icon: CalendarClock, titulo: "Cronômetro", descricao: "Inicie e pare o cronômetro no cartão para registrar o tempo trabalhado. Cada sessão vira um registro — útil para acompanhar esforço por projeto." },
];

const GUIA_AGENDA: Passo[] = [
  { icon: CalendarClock, titulo: "Sua agenda", descricao: "Compromissos, retornos e reuniões da empresa e pessoais. Cada evento pode ter cliente, projeto, participantes da equipe, recorrência e link de reunião. Crie no “Novo evento” ou clicando num horário." },
  { icon: Compass, titulo: "5 visões", descricao: "Alterne entre Lista, Dia, Semana, Mês e Ano. Dia e Semana são grades de horário com arrastar-para-reagendar; use “Hoje” para voltar ao presente e o filtro Empresa / Pessoal / Tudo." },
  { icon: ArrowRightLeft, titulo: "Reagendar arrastando", descricao: "Nas visões de grade, arraste o bloco do evento para outro horário para reagendar (eventos não recorrentes). A linha do “agora” mostra o horário atual." },
  { icon: CheckCircle2, titulo: "Conflitos e lembretes", descricao: "Se dois eventos se sobrepõem, o sistema avisa (anel âmbar) — sem bloquear. Lembretes internos saem 15 min antes; o cliente recebe um e-mail nas 24h anteriores à reunião." },
  { icon: Sparkles, titulo: "Reuniões e Resumo por IA", descricao: "Reuniões com link (Meet/Zoom/Jitsi) ganham botão de entrar, e o cliente confirma presença e baixa o .ics pelo Portal. O “Resumo IA” no topo resume o período para você." },
];

const GUIA_FINANCEIRO: Passo[] = [
  { icon: Wallet, titulo: "Duas carteiras", descricao: "Empresa (os livros da MedConsultoria, compartilhados com a gestão) e Pessoal (privada — só você vê a sua). O seletor Empresa / Pessoal / Tudo no topo troca a visão." },
  { icon: ListChecks, titulo: "A pagar e a receber", descricao: "Nas abas, lance contas com valor, vencimento e categoria. Contas recorrentes se renovam sozinhas: ao marcar uma como paga, a próxima ocorrência é criada automaticamente." },
  { icon: CheckCircle2, titulo: "Precisa de você", descricao: "O bloco “Precisa de você” junta o que está vencido, vence hoje e nesta semana — a pagar e a receber. Marque como paga/recebida com um clique." },
  { icon: ArrowRightLeft, titulo: "Resultado e para onde vai", descricao: "Os KPIs mostram a receber e a pagar pendentes, o saldo previsto e o resultado do mês (realizado). O gráfico por categoria mostra de onde vem e para onde vai o dinheiro." },
  { icon: Settings, titulo: "Categorias", descricao: "Organize entradas e saídas por categoria, separadas por carteira (Empresa × Pessoal). Edite-as em “Categorias” aqui ou em Ajustes → Catálogos." },
];

const GUIA_DOCUMENTOS: Passo[] = [
  { icon: FileText, titulo: "O arquivo de documentos", descricao: "Todos os documentos gerados (propostas, contratos, atas, recibos…), com a situação de cada um. Filtre por cliente, tipo e situação, ou busque pelo título. Os modelos ficam em Ajustes → Modelos." },
  { icon: Sparkles, titulo: "Novo documento", descricao: "Em “Novo documento”, escolha o que criar e o cliente: a Proposta monta-se pelos serviços (com preços do catálogo e total), a Ata a IA resume suas anotações e a Pauta a IA gera com o contexto do cliente." },
  { icon: MousePointerClick, titulo: "Revisar e melhorar", descricao: "O documento nasce em rascunho, numa folha A4 com a marca. Edite o texto, use a IA para melhorar, e siga o fluxo Rascunho → Em revisão → Aprovado → Enviado. Exporte em PDF ou Word." },
  { icon: FileSignature, titulo: "Assinatura digital", descricao: "Em “Solicitar assinaturas”, cliente e MedConsultoria recebem um link, assinam (desenhando ou digitando) com validade jurídica (Lei 14.063/2020) e fica registrado com data, hora e código de integridade." },
  { icon: CheckCircle2, titulo: "Automação", descricao: "Ao mover o lead para “Proposta”, o sistema já gera a proposta; ao aceitar, gera o contrato com as cláusulas de cada serviço — os dois nascem em revisão e avisam a equipe." },
];

const GUIA_MENSAGENS: Passo[] = [
  { icon: MessageSquare, titulo: "Tudo num só lugar", descricao: "Conversas com a equipe, grupos e o suporte de cada cliente ficam juntos, separados nas abas Diretas, Grupos, Clientes e Leads. Comece uma nova no botão + Nova conversa." },
  { icon: UserCheck, titulo: "Suporte do cliente (helpdesk)", descricao: "Cada chamado de um cliente é um ticket com protocolo, assunto, status (Aberto / Em andamento / Resolvido), prioridade e responsável. O cliente vê a mesma conversa pelo Portal." },
  { icon: CheckCircle2, titulo: "No dia a dia", descricao: "Novas mensagens avisam no sino. Você pode editar ou apagar a própria mensagem, e fixar, silenciar ou arquivar uma conversa. As arquivadas ficam na aba Arquivadas." },
];

// ── Ajustes (o hub de configuração) ──────────────────────
const GUIA_AJUSTES: Passo[] = [
  { icon: SlidersHorizontal, titulo: "Configure uma vez, o sistema usa sozinho", descricao: "Aqui ficam as configurações que você define uma vez e a aplicação aplica no dia a dia. Você raramente precisa voltar." },
  { icon: Briefcase, titulo: "Automações", descricao: "Serviços (o catálogo e o que cada um dispara na venda), Modelos de documento (os textos-base de proposta, contrato, ata e recibo) e Mensagens automáticas (os e-mails e avisos que o sistema envia com a marca da empresa)." },
  { icon: ListChecks, titulo: "Catálogos", descricao: "Listas reutilizáveis: Categorias (financeiro), Origens (de onde vêm os leads) e Operadoras (para credenciamento). Você também as edita onde são usadas — aqui estão todas num lugar só." },
  { icon: UserCog, titulo: "Administração", descricao: "Atalhos para Equipe e acessos, E-mails enviados (monitor de entregas) e, para o Root, o painel Sistema." },
];

const GUIA_MODELOS: Passo[] = [
  { icon: FileSignature, titulo: "Os moldes dos seus documentos", descricao: "Cada modelo é o texto-base de um tipo de documento — proposta, contrato, escopo, recibo, briefing — reutilizado sempre que você gera um documento para um cliente." },
  { icon: FileText, titulo: "Campos que se preenchem sozinhos", descricao: "No texto, campos como {{cliente.nome}} são trocados pelos dados reais na hora de gerar. O preview ao lado mostra como a folha A4 fica, com a marca da empresa." },
  { icon: Sparkles, titulo: "Briefings interativos", descricao: "Modelos do tipo briefing viram um formulário que o cliente responde na tela pelo Portal (texto, escolha, checklist…). Os documentos de cada cliente você gera na ficha dele e acompanha em Documentos." },
];

const GUIA_COMUNICACOES: Passo[] = [
  { icon: Mail, titulo: "Mensagens automáticas", descricao: "Todos os textos dos e-mails e avisos que o sistema envia sozinho ficam aqui, separados por Transacionais, Notificações e Sistema. Edite só o conteúdo — o visual com a marca é fixo." },
  { icon: Sparkles, titulo: "Campos automáticos", descricao: "Clique nos “campos automáticos” para inseri-los no texto — o sistema preenche com o dado real no envio (ex.: nome do cliente)." },
  { icon: CheckCircle2, titulo: "Prévia e teste", descricao: "Veja a prévia ao vivo (e-mail e sino) e envie um e-mail de teste antes de salvar. Restaure o padrão quando quiser." },
];

const GUIA_EMAILS_ENVIADOS: Passo[] = [
  { icon: SendHorizontal, titulo: "Monitor de e-mails enviados", descricao: "O registro de tudo que o sistema disparou: convites, boas-vindas, links de assinatura, lembretes. Os KPIs no topo mostram enviados nos últimos 7 dias, falhas e a taxa de entrega." },
  { icon: Filter, titulo: "Filtros", descricao: "Filtre por status (enviados / só falhas), tipo de e-mail, período e busca. Use quando um cliente disser que não recebeu — aqui você confirma se saiu, para quem e quando." },
  { icon: CheckCircle2, titulo: "Por que falhou", descricao: "Cada falha traz o motivo (ex.: caixa inexistente, servidor recusou). Se o SMTP não estiver configurado, os e-mails aparecem como “modo dev” — o link é mostrado na tela em vez de enviado." },
];

const GUIA_USUARIOS: Passo[] = [
  { icon: UserCog, titulo: "Equipe e acessos", descricao: "Aqui ficam a equipe interna e os clientes com acesso ao Portal, com nome, e-mail, papel e situação. A tabela mostra quem está ativo e quem já aceitou o convite." },
  { icon: Mail, titulo: "Convidar", descricao: "Em “Convidar usuário”, informe e-mail e papel — a pessoa recebe um link e define a própria senha. Você nunca digita a senha de ninguém; nenhuma senha fica exposta." },
  { icon: Settings, titulo: "Papéis (menor privilégio)", descricao: "Funcionário (o necessário para o trabalho), Administrador (tudo da empresa) e Root (tudo + o painel Sistema). Você só atribui papéis ABAIXO do seu — só o Root cria Administradores." },
  { icon: CheckCircle2, titulo: "Ativar e desativar", descricao: "Desative um acesso para bloquear a entrada sem apagar o histórico; reative quando precisar. Ações sobre pares ou superiores ficam ocultas para você." },
];

const GUIA_CONFIG: Passo[] = [
  { icon: UserCheck, titulo: "Seu perfil", descricao: "Atualize seu nome e sua foto — ela aparece em toda a aplicação (avatar). O e-mail e o papel são definidos pela administração." },
  { icon: Settings, titulo: "Sua senha", descricao: "Troque a senha quando quiser. Ao trocar, as outras sessões são encerradas por segurança — você continua conectado só aqui." },
  { icon: Mail, titulo: "Preferências de e-mail", descricao: "Escolha quais e-mails automáticos quer receber. Os de acesso e segurança (convite, redefinição de senha) são sempre enviados." },
];

const GUIA_SISTEMA: Passo[] = [
  { icon: ServerCog, titulo: "Painel técnico (só Root)", descricao: "A saúde da aplicação em tempo real: banco, memória, event loop e taxa de erro. As abas separam Visão geral, Incidentes, Desempenho, Banco, Erros, Sessões, Atividade e Manutenção." },
  { icon: ListChecks, titulo: "Erros e incidentes", descricao: "Erros capturados automaticamente ficam na aba Erros — resolva, oculte ou peça a análise da IA. Incidentes registram quedas e degradações, com o histórico de uptime." },
  { icon: Sparkles, titulo: "Diagnóstico e manutenção", descricao: "Use o Diagnóstico com IA no topo para uma leitura rápida do estado. Em Manutenção você limpa sessões expiradas e vê as migrações do banco e a configuração do ambiente." },
];

// A ORDEM importa: `guiaDaRota` casa por prefixo, então rotas mais específicas vêm ANTES das
// que as contêm (`/emails-enviados` antes de `/emails`). Os títulos batem com os rótulos do
// menu lateral — divergências ("Comunicações"/"Usuários") confundiam. O teste em GuiaTour.test
// garante que toda rota de página tenha um guia próprio e que a ordem de prefixos esteja correta.
const OUTRAS: { prefixo: string; guia: Guia }[] = [
  { prefixo: "/leads", guia: { titulo: "Vendas", passos: GUIA_FUNIL } },
  { prefixo: "/clientes", guia: { titulo: "Clientes", passos: GUIA_CLIENTES } },
  { prefixo: "/servicos", guia: { titulo: "Serviços", passos: GUIA_SERVICOS } },
  { prefixo: "/modelos", guia: { titulo: "Modelos de documento", passos: GUIA_MODELOS } },
  { prefixo: "/projetos", guia: { titulo: "Projetos", passos: GUIA_PROJETOS } },
  { prefixo: "/agenda", guia: { titulo: "Agenda", passos: GUIA_AGENDA } },
  { prefixo: "/financeiro", guia: { titulo: "Financeiro", passos: GUIA_FINANCEIRO } },
  { prefixo: "/documentos", guia: { titulo: "Documentos", passos: GUIA_DOCUMENTOS } },
  { prefixo: "/mensagens", guia: { titulo: "Mensagens", passos: GUIA_MENSAGENS } },
  { prefixo: "/ajustes", guia: { titulo: "Ajustes", passos: GUIA_AJUSTES } },
  // `/emails-enviados` ANTES de `/emails` — senão o prefixo mais curto captura os dois.
  { prefixo: "/emails-enviados", guia: { titulo: "E-mails enviados", passos: GUIA_EMAILS_ENVIADOS } },
  { prefixo: "/emails", guia: { titulo: "Mensagens automáticas", passos: GUIA_COMUNICACOES } },
  { prefixo: "/usuarios", guia: { titulo: "Equipe e acessos", passos: GUIA_USUARIOS } },
  { prefixo: "/configuracoes", guia: { titulo: "Configurações", passos: GUIA_CONFIG } },
  { prefixo: "/sistema", guia: { titulo: "Sistema", passos: GUIA_SISTEMA } },
];

/** Prefixos mapeados, na ordem — exportado para o teste-guarda conferir ordem e cobertura. */
export const PREFIXOS_GUIA = OUTRAS.map((o) => o.prefixo);

/** Resolve o guia da página a partir da rota atual. */
export function guiaDaRota(path: string): Guia {
  if (path === "/") return { titulo: "Visão geral", passos: VISAO_GERAL };
  const achado = OUTRAS.find((o) => path.startsWith(o.prefixo));
  return achado?.guia ?? { titulo: "Visão geral", passos: VISAO_GERAL };
}

/**
 * Modal VISUAL do guia (sem acoplamento com o router). Recebe título + passos e desenha o
 * carrossel. Usado tanto pelo `GuiaTour` da equipe quanto pelo Portal do Cliente — assim o
 * cliente também tem um "?", com o mesmo visual.
 */
export function GuiaModal({
  open,
  onClose,
  titulo,
  passos,
  resetKey,
}: {
  open: boolean;
  onClose: () => void;
  titulo: string;
  passos: Passo[];
  /** Muda para reiniciar no passo 0 (ex.: trocou de rota). */
  resetKey?: string;
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (open) setI(0);
  }, [open, resetKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((v) => Math.min(v + 1, passos.length - 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(v - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, passos.length, onClose]);

  if (!open || passos.length === 0) return null;
  const passo = passos[Math.min(i, passos.length - 1)]!;
  const Icon = passo.icon;
  const ultimo = i >= passos.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl animate-scale-in">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          title="Fechar guia"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Faixa superior — azul escuro da marca (igual o menu) */}
        <div className="flex shrink-0 flex-col items-center gap-2 bg-gradient-to-br from-brand-blueDark to-brand-blueText py-6 sm:py-8">
          {passo.logo ? (
            <div key={i} className="flex items-center gap-3 animate-scale-in">
              <img src="/simbolo.png" alt="MedConsultoria" className="h-14 w-14 shrink-0" />
              <div className="text-left leading-tight">
                <div className="text-xl font-bold tracking-tight text-white">MedConsultoria</div>
                <div className="text-xs font-medium text-white/60">Workspace</div>
              </div>
            </div>
          ) : (
            <span key={i} className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-white animate-scale-in">
              <Icon className="h-8 w-8" />
            </span>
          )}
          <span className="text-[11px] font-medium uppercase tracking-wider text-white/70">Guia · {titulo}</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-6">
          <div key={i} className="min-h-0 flex-1 animate-fade-in overflow-y-auto">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Passo {i + 1} de {passos.length}
            </div>
            <h2 className="mt-1 text-xl font-semibold">{passo.titulo}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{passo.descricao}</p>
          </div>

          {/* Indicadores de progresso */}
          <div className="mt-5 flex shrink-0 flex-wrap items-center justify-center gap-1.5">
            {passos.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setI(idx)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  idx === i ? "w-5 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground/40",
                )}
                aria-label={`Ir para o passo ${idx + 1}`}
              />
            ))}
          </div>

          {/* Ações */}
          <div className="mt-5 flex shrink-0 items-center justify-between gap-2">
            {i === 0 ? (
              <button onClick={onClose} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                Fechar
              </button>
            ) : (
              <button
                onClick={() => setI((v) => Math.max(v - 1, 0))}
                className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </button>
            )}

            <button
              onClick={() => (ultimo ? onClose() : setI((v) => Math.min(v + 1, passos.length - 1)))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {ultimo ? "Concluir" : "Próximo"}
              {!ultimo && <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Guia "?" da ÁREA DA EQUIPE. Resolve o guia pela rota atual e filtra passos por papel, depois
 * delega o visual ao GuiaModal. No Dashboard mostra a visão geral (10 passos); nas demais, o
 * passo a passo daquela página. O guia do Portal do Cliente vive em `features/portal`.
 */
export function GuiaTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const guia = guiaDaRota(path);
  const passos = guia.passos.filter((p) => !p.minRole || hasRoleLevel(user.role, p.minRole));
  return <GuiaModal open={open} onClose={onClose} titulo={guia.titulo} passos={passos} resetKey={path} />;
}
