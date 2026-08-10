import type { Role } from "./roles.js";

export interface EmailCategoria {
  tipo: string;
  label: string;
  descricao: string;
  /** Categoria só relevante a partir deste papel (filtra a tela de preferências). */
  minRole?: Role;
}

/**
 * Categorias de e-mail que o usuário pode ligar/desligar. O `tipo` casa com o
 * `tipo` da notificação interna — o e-mail é disparado junto com a notificação.
 * (E-mails de segurança/acesso — convite, boas-vindas, redefinição de senha —
 * são SEMPRE enviados e não entram aqui.)
 */
export const EMAIL_CATEGORIAS: EmailCategoria[] = [
  { tipo: "lembrete", label: "Lembretes de compromisso", descricao: "Aviso antes de um evento ou reunião começar." },
  { tipo: "presenca_confirmada", label: "Presença confirmada", descricao: "Quando um cliente confirma presença numa reunião pelo Portal." },
  { tipo: "tarefa_atribuida", label: "Tarefa atribuída a você", descricao: "Quando alguém atribui um cartão/tarefa a você." },
  { tipo: "tarefa_atrasada", label: "Tarefas atrasadas", descricao: "Resumo de tarefas suas que passaram do prazo." },
  { tipo: "tarefa_delegada", label: "Tarefa delegada a você", descricao: "Quando um colega delega uma tarefa/pedido a você." },
  { tipo: "tarefa_concluida", label: "Tarefa que você pediu foi concluída", descricao: "Quando o responsável conclui uma tarefa que você delegou." },
  { tipo: "projeto_participante", label: "Adicionado a um projeto", descricao: "Quando você é incluído na equipe de um projeto." },
  { tipo: "suporte", label: "Mensagens de suporte", descricao: "Novas mensagens no canal de suporte do cliente." },
  { tipo: "documento_revisao", label: "Documento aguardando revisão", descricao: "Documentos que precisam da sua análise.", minRole: "ADMIN" },
  { tipo: "conta_vencida", label: "Contas vencidas", descricao: "Alertas de contas a pagar/receber vencidas.", minRole: "ADMIN" },
  { tipo: "conta_a_vencer", label: "Contas a vencer", descricao: "Aviso de contas a pagar/receber que vencem em breve.", minRole: "ADMIN" },
  { tipo: "lead_novo", label: "Novo lead pelo site", descricao: "Quando alguém se cadastra pelo formulário público.", minRole: "ADMIN" },
  { tipo: "lead_atribuido", label: "Lead atribuído a você", descricao: "Quando você vira responsável por um lead do funil." },
  { tipo: "lead_convertido", label: "Lead virou cliente", descricao: "Quando um lead do funil é convertido em cliente (venda fechada)." },
  { tipo: "lead_desistiu", label: "Lead desistiu pelo Portal", descricao: "Quando um lead informa pelo Portal que não deseja mais avançar." },
  { tipo: "lead_retomou", label: "Lead retomou o interesse", descricao: "Quando um lead que havia desistido retoma o atendimento pelo Portal." },
  { tipo: "proposta_aceita", label: "Proposta aceita pelo cliente", descricao: "Quando um cliente aceita a proposta pelo link/Portal." },
  { tipo: "proposta_recusada", label: "Proposta recusada pelo cliente", descricao: "Quando um cliente recusa a proposta pelo link/Portal." },
  { tipo: "credenciamento_aprovado", label: "Operadora aprovou um credenciamento", descricao: "Quando uma operadora aprova o credenciamento de um médico — é quando o honorário passa a ser devido." },
  { tipo: "credenciamento_negado", label: "Operadora negou um credenciamento", descricao: "Quando uma operadora nega o credenciamento de um médico, com o motivo." },
  { tipo: "servico_solicitado", label: "Cliente pediu serviços pelo Portal", descricao: "Quando um cliente escolhe serviços no Portal do Cliente." },
  { tipo: "documento_cliente_enviado", label: "Cliente enviou um documento", descricao: "Quando um cliente anexa um documento pelo Portal." },
  { tipo: "servico_cancelado", label: "Cliente cancelou um serviço", descricao: "Quando um cliente cancela um serviço pelo Portal." },
  { tipo: "incidente", label: "Alertas do sistema", descricao: "Incidentes técnicos detectados na aplicação.", minRole: "ROOT" },
  { tipo: "erro", label: "Erros do sistema", descricao: "Novos erros registrados na aplicação.", minRole: "ROOT" },
];

/** Conjunto de tipos que disparam e-mail (usado no back para filtrar). */
export const EMAIL_TIPOS: string[] = EMAIL_CATEGORIAS.map((c) => c.tipo);
