import type { Role } from "./roles.js";

/** Grupos da tela de preferências, na ordem em que aparecem. */
export const EMAIL_GRUPOS = [
  "Vendas e funil",
  "Clientes e Portal",
  "Credenciamento",
  "Documentos",
  "Financeiro",
  "Agenda e tarefas",
  "Sistema",
] as const;

export type EmailGrupo = (typeof EMAIL_GRUPOS)[number];

export interface EmailCategoria {
  tipo: string;
  label: string;
  descricao: string;
  /** Seção da tela de preferências — 25 chaves soltas numa lista ninguém lê. */
  grupo: EmailGrupo;
  /** Categoria só relevante a partir deste papel (filtra a tela de preferências). */
  minRole?: Role;
  /**
   * Papéis para os quais este aviso NASCE desligado por e-mail (a pessoa liga na tela
   * se quiser). Casamento EXATO de papel — cada conta tem um só.
   *
   * Existe por causa do "lead novo": o lead nasce SEM responsável, então o sistema avisa
   * todo mundo que poderia atender. Com lead real chegando todo dia isso vira ruído e a
   * equipe para de ler — e quando para de ler, para de ler também o que importa. O aviso
   * dentro do sistema (o sininho) continua para todos; só o e-mail é que nasce fechado.
   */
  padraoDesligadoPara?: Role[];
}

/**
 * Categorias de e-mail que o usuário pode ligar/desligar. O `tipo` casa com o
 * `tipo` da notificação interna — o e-mail é disparado junto com a notificação.
 * (E-mails de segurança/acesso — convite, boas-vindas, redefinição de senha —
 * são SEMPRE enviados e não entram aqui.)
 */
export const EMAIL_CATEGORIAS: EmailCategoria[] = [
  { tipo: "lembrete", label: "Lembretes de compromisso", descricao: "Aviso antes de um evento ou reunião começar.", grupo: "Agenda e tarefas" },
  { tipo: "presenca_confirmada", label: "Presença confirmada", descricao: "Quando um cliente confirma presença numa reunião pelo Portal.", grupo: "Agenda e tarefas" },
  { tipo: "tarefa_atribuida", label: "Tarefa atribuída a você", descricao: "Quando alguém atribui um cartão/tarefa a você.", grupo: "Agenda e tarefas" },
  { tipo: "tarefa_atrasada", label: "Tarefas atrasadas", descricao: "Resumo de tarefas suas que passaram do prazo.", grupo: "Agenda e tarefas" },
  { tipo: "tarefa_delegada", label: "Tarefa delegada a você", descricao: "Quando um colega delega uma tarefa/pedido a você.", grupo: "Agenda e tarefas" },
  { tipo: "tarefa_concluida", label: "Tarefa que você pediu foi concluída", descricao: "Quando o responsável conclui uma tarefa que você delegou.", grupo: "Agenda e tarefas" },
  { tipo: "projeto_participante", label: "Adicionado a um projeto", descricao: "Quando você é incluído na equipe de um projeto.", grupo: "Agenda e tarefas" },
  { tipo: "suporte", label: "Mensagens de suporte", descricao: "Novas mensagens no canal de suporte do cliente.", grupo: "Clientes e Portal" },
  { tipo: "documento_revisao", label: "Documento aguardando revisão", descricao: "Documentos que precisam da sua análise.", grupo: "Documentos", minRole: "ADMIN" },
  { tipo: "conta_vencida", label: "Contas vencidas", descricao: "Alertas de contas a pagar/receber vencidas.", grupo: "Financeiro", minRole: "ADMIN" },
  { tipo: "conta_a_vencer", label: "Contas a vencer", descricao: "Aviso de contas a pagar/receber que vencem em breve.", grupo: "Financeiro", minRole: "ADMIN" },
  {
    tipo: "lead_novo",
    label: "Novo lead pelo site",
    descricao: "Quando alguém se cadastra pelo formulário público. Como o lead ainda não tem responsável, o aviso vai para toda a equipe comercial.",
    grupo: "Vendas e funil",
    minRole: "ADMIN",
    padraoDesligadoPara: ["ROOT"],
  },
  { tipo: "lead_atribuido", label: "Lead atribuído a você", descricao: "Quando você vira responsável por um lead do funil.", grupo: "Vendas e funil" },
  { tipo: "lead_convertido", label: "Lead virou cliente", descricao: "Quando um lead do funil é convertido em cliente (venda fechada).", grupo: "Vendas e funil" },
  { tipo: "lead_desistiu", label: "Lead desistiu pelo Portal", descricao: "Quando um lead informa pelo Portal que não deseja mais avançar.", grupo: "Vendas e funil" },
  { tipo: "lead_retomou", label: "Lead retomou o interesse", descricao: "Quando um lead que havia desistido retoma o atendimento pelo Portal.", grupo: "Vendas e funil" },
  { tipo: "proposta_aceita", label: "Proposta aceita pelo cliente", descricao: "Quando um cliente aceita a proposta pelo link/Portal.", grupo: "Vendas e funil" },
  { tipo: "proposta_recusada", label: "Proposta recusada pelo cliente", descricao: "Quando um cliente recusa a proposta pelo link/Portal.", grupo: "Vendas e funil" },
  { tipo: "credenciamento_aprovado", label: "Operadora aprovou um credenciamento", descricao: "Quando uma operadora aprova o credenciamento de um médico — é quando o honorário passa a ser devido.", grupo: "Credenciamento" },
  { tipo: "credenciamento_negado", label: "Operadora negou um credenciamento", descricao: "Quando uma operadora nega o credenciamento de um médico, com o motivo.", grupo: "Credenciamento" },
  { tipo: "servico_solicitado", label: "Cliente pediu serviços pelo Portal", descricao: "Quando um cliente escolhe serviços no Portal do Cliente.", grupo: "Clientes e Portal" },
  { tipo: "documento_cliente_enviado", label: "Cliente enviou um documento", descricao: "Quando um cliente anexa um documento pelo Portal.", grupo: "Clientes e Portal" },
  { tipo: "servico_cancelado", label: "Cliente cancelou um serviço", descricao: "Quando um cliente cancela um serviço pelo Portal.", grupo: "Clientes e Portal" },
  // ── OS SEIS AVISOS QUE TINHAM MODELO E NUNCA SAÍAM (M6) ──────────────────────────────
  //
  // Todos nascem da varredura proativa (`realtime/reminders.ts`), com `unico: true` por
  // entidade — o aviso não se repete a cada rodada. São exatamente os avisos que ninguém vai
  // buscar sozinho: um projeto que parou não grita, um lead esfriando não grita, uma proposta
  // sem resposta não grita. Por isso nascem LIGADOS: aqui o risco é avisar de MENOS, e aviso
  // que não chega é trabalho que não acontece.
  {
    tipo: "conflito_agenda",
    label: "Conflito de horário na agenda",
    descricao: "Quando dois compromissos seus caem no mesmo horário.",
    grupo: "Agenda e tarefas",
  },
  {
    tipo: "projeto_parado",
    label: "Projeto parado",
    descricao: "Projeto ativo sem nenhum movimento há mais de 14 dias.",
    grupo: "Agenda e tarefas",
  },
  {
    tipo: "projeto_sem_responsavel",
    label: "Projeto sem responsável",
    descricao: "Projeto que ficou sem ninguém responsável por ele.",
    grupo: "Agenda e tarefas",
    minRole: "ADMIN",
  },
  {
    tipo: "documento_parado",
    label: "Documento sem resposta do cliente",
    descricao: "Proposta ou documento enviado ao cliente que está há dias sem aceite nem assinatura.",
    grupo: "Documentos",
  },
  {
    tipo: "lead_parado",
    label: "Lead parado no funil",
    descricao: "Lead ativo sem movimento há mais de 14 dias.",
    grupo: "Vendas e funil",
  },
  {
    tipo: "upsell_oportunidade",
    label: "Cliente quer mais (upsell)",
    descricao: "Cliente ativo com uma oportunidade aberta no funil — quer contratar mais serviços.",
    grupo: "Vendas e funil",
  },
  { tipo: "incidente", label: "Alertas do sistema", descricao: "Incidentes técnicos detectados na aplicação.", grupo: "Sistema", minRole: "ROOT" },
  { tipo: "erro", label: "Erros do sistema", descricao: "Novos erros registrados na aplicação.", grupo: "Sistema", minRole: "ROOT" },
];

/** Conjunto de tipos que disparam e-mail (usado no back para filtrar). */
export const EMAIL_TIPOS: string[] = EMAIL_CATEGORIAS.map((c) => c.tipo);

/**
 * A conta de sistema (ROOT primordial, ADR-89) NUNCA recebe e-mail operacional: ninguém
 * a lê, e cada aviso mandado para ela é um endereço a mais na conta de envio sem leitor
 * do outro lado. Comparação normalizada — endereço se digita com maiúscula e com espaço.
 */
export function ehContaDeSistema(email: string | null | undefined, emailDoSistema: string): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === emailDoSistema.trim().toLowerCase();
}

/** O aviso `tipo` nasce ligado por e-mail para quem tem o papel `role`? */
export function emailLigadoPorPadrao(tipo: string, role: Role): boolean {
  const cat = EMAIL_CATEGORIAS.find((c) => c.tipo === tipo);
  if (!cat) return true;
  return !(cat.padraoDesligadoPara ?? []).includes(role);
}

export interface DecisaoDeEmail {
  tipo: string;
  role: Role;
  email: string | null;
  ativo: boolean;
  excluido: boolean;
  /** `null` = a pessoa nunca mexeu na preferência; vale o padrão. */
  preferencia: boolean | null;
  /** E-mail da conta de sistema (ROOT primordial). */
  emailDoSistema: string;
}

/**
 * PONTO ÚNICO: este aviso vira e-mail para esta pessoa?
 *
 * Pura de propósito — o `notificar()` (que envia) e a tela de preferências (que mostra)
 * leem a MESMA régua. Duas cópias divergiriam, e a tela passaria a mentir sobre o que
 * está sendo enviado; foi assim que "Enviados hoje" mentiu por meses (ADR-133).
 */
export function decidirEmailOperacional(p: DecisaoDeEmail): boolean {
  if (!EMAIL_TIPOS.includes(p.tipo)) return false;
  if (!p.ativo || p.excluido) return false;
  if (!p.email || p.email.startsWith("deleted+")) return false;
  if (ehContaDeSistema(p.email, p.emailDoSistema)) return false;
  return p.preferencia ?? emailLigadoPorPadrao(p.tipo, p.role);
}
