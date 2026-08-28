export interface VariavelTemplate {
  chave: string;
  /** Nome amigável mostrado ao admin (ex.: "Nome do cliente"). */
  rotulo: string;
  descricao: string;
  /** Valor de exemplo usado na prévia e no e-mail de teste. */
  exemplo: string;
}

export interface TemplateMeta {
  label: string;
  descricao: string;
  grupo: "Transacionais" | "Notificações" | "Sistema";
  /** true = o título/corpo também aparecem como notificação no sino (in-app). */
  notificacao: boolean;
  variaveis: VariavelTemplate[];
  temCta: boolean;
  default: {
    assunto: string;
    titulo: string;
    corpo: string; // parágrafos separados por linha em branco
    ctaTexto?: string;
    nota?: string;
  };
}

/**
 * Catálogo de TODOS os e-mails/notificações do sistema. O `corpo` aceita campos
 * automáticos no formato {{chave}} (preenchidos pelo sistema no envio). O layout
 * (logo, cores, assinatura, rodapé) é fixo — o admin edita só o conteúdo. Para
 * `notificacao: true`, o título/corpo também são usados na notificação in-app (sino).
 */
// `satisfies` (e NÃO `: Record<string, TemplateMeta>`): a anotação alargava as chaves para
// `string`, o que fazia `EmailTemplateChave` virar `string` e não proteger nada. Com
// `satisfies`, o objeto continua validado contra TemplateMeta E preserva as chaves literais.
export const EMAIL_TEMPLATES = {
  // ───────── Transacionais (e-mail; sempre enviados) ─────────
  convite: {
    label: "Convite de acesso",
    descricao: "Enviado quando um usuário é convidado. A pessoa define a senha pelo link.",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [
      { chave: "nome", rotulo: "Nome da pessoa", descricao: "Nome de quem recebe", exemplo: "Maria Silva" },
      { chave: "link", rotulo: "Link do botão", descricao: "Link para definir a senha", exemplo: "(link seguro)" },
    ],
    temCta: true,
    default: {
      assunto: "Seu acesso ao Workspace MedConsultoria",
      titulo: "Você foi convidado para o Workspace",
      corpo:
        "Você foi convidado para acessar o Workspace MedConsultoria — o ambiente onde centralizamos clientes, projetos, agenda, finanças e documentos.\n\nPara ativar seu acesso, defina sua senha clicando no botão abaixo:",
      ctaTexto: "Definir minha senha",
      nota: "Por segurança, este link expira em 72 horas e só pode ser usado uma vez. Se você não esperava este convite, ignore este e-mail.",
    },
  },
  boas_vindas: {
    label: "Boas-vindas",
    descricao: "Enviado logo após a pessoa ativar o acesso (aceitar o convite).",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [{ chave: "nome", rotulo: "Nome da pessoa", descricao: "Nome de quem recebe", exemplo: "Maria Silva" }],
    temCta: true,
    default: {
      assunto: "Bem-vindo ao Workspace MedConsultoria",
      titulo: "Acesso ativado — boas-vindas! 🎉",
      corpo:
        "Sua conta no Workspace MedConsultoria foi ativada com sucesso.\n\nAqui você acompanha clientes, projetos, agenda, finanças, documentos e se comunica com a equipe — tudo em um só lugar.",
      ctaTexto: "Acessar o workspace",
    },
  },
  /**
   * A mesma ativação de acesso, escrita para quem é CLIENTE. Nasceu porque `aceitarConvite`
   * mandava o texto acima para todo mundo — e o médico do Portal lia "Bem-vindo ao Workspace",
   * com a promessa de gerenciar clientes e finanças e um botão para o sistema interno da Med.
   * Quem escolhe entre os dois é `templateDeBoasVindas`, e o padrão dela é ESTE.
   */
  boas_vindas_portal: {
    label: "Boas-vindas ao Portal (cliente)",
    descricao: "Enviado ao cliente logo após ele ativar o acesso ao Portal do Cliente.",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [{ chave: "nome", rotulo: "Nome da pessoa", descricao: "Nome de quem recebe", exemplo: "Maria Silva" }],
    temCta: true,
    default: {
      assunto: "Bem-vindo ao Portal do Cliente — MedConsultoria",
      titulo: "Acesso ativado — boas-vindas! 🎉",
      corpo:
        "Seu acesso ao Portal do Cliente da MedConsultoria foi ativado com sucesso.\n\nNo Portal você acompanha o andamento dos seus serviços, envia os documentos que pedimos, vê propostas e contratos e fala direto com a nossa equipe.",
      ctaTexto: "Entrar no Portal",
    },
  },
  reset_senha: {
    label: "Redefinição de senha",
    descricao: "Enviado quando alguém pede para redefinir a senha (Esqueci minha senha).",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [
      { chave: "nome", rotulo: "Nome da pessoa", descricao: "Nome de quem recebe", exemplo: "Maria Silva" },
      { chave: "link", rotulo: "Link do botão", descricao: "Link para criar a nova senha", exemplo: "(link seguro)" },
    ],
    temCta: true,
    default: {
      // Texto NEUTRO de propósito: `solicitarReset` procura o e-mail sem filtrar papel, e o
      // cliente do Portal também é `User`. Dizer "Workspace" aqui é dar a um médico o nome de um
      // sistema que ele nunca viu, num e-mail de segurança — o jeito mais rápido de a mensagem
      // ser lida como golpe e ignorada.
      assunto: "Redefinição de senha — MedConsultoria",
      titulo: "Redefinição de senha",
      corpo:
        "Recebemos um pedido para redefinir a senha da sua conta na MedConsultoria.\n\nPara criar uma nova senha, clique no botão abaixo:",
      ctaTexto: "Redefinir minha senha",
      nota: "Este link expira em 1 hora e só pode ser usado uma vez. Se não foi você quem pediu, ignore este e-mail — sua senha atual continua válida.",
    },
  },
  lead_confirmacao: {
    label: "Confirmação de contato (lead)",
    descricao: "Resposta automática ao visitante que se cadastra pelo formulário público.",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [{ chave: "nome", rotulo: "Nome do contato", descricao: "Nome de quem se cadastrou", exemplo: "João Pereira" }],
    temCta: false,
    default: {
      assunto: "Recebemos seu contato — MedConsultoria",
      titulo: "Recebemos seu contato!",
      corpo:
        "Obrigado por entrar em contato com a MedConsultoria. Recebemos suas informações e nossa equipe vai analisar e retornar em breve.",
      nota: "Este é um e-mail automático de confirmação — não é necessário respondê-lo.",
    },
  },

  portal_boas_vindas: {
    label: "Acesso ao Portal do Cliente",
    descricao: "Boas-vindas com acesso ao Portal — enviado ao lead na captação e ao cliente novo. A pessoa define a senha pelo link.",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [
      { chave: "nome", rotulo: "Nome da pessoa", descricao: "Nome de quem recebe", exemplo: "Maria Silva" },
      { chave: "link", rotulo: "Link do botão", descricao: "Link para ativar o acesso (definir a senha)", exemplo: "(link seguro)" },
    ],
    temCta: true,
    default: {
      assunto: "Seu acesso ao Portal do Cliente — MedConsultoria",
      titulo: "Bem-vindo(a)! Acompanhe tudo pelo Portal 🎉",
      corpo:
        "Que bom ter você por aqui! Criamos o seu acesso ao Portal do Cliente da MedConsultoria — o espaço onde você acompanha o andamento do seu atendimento, documentos, reuniões e fala direto com a nossa equipe.\n\nPara ativar o acesso, defina sua senha clicando no botão abaixo:",
      ctaTexto: "Ativar meu acesso",
      nota: "Por segurança, este link expira em 72 horas e só pode ser usado uma vez. Se você não reconhece este contato, ignore este e-mail.",
    },
  },
  cliente_boas_vindas: {
    label: "Boas-vindas ao cliente",
    descricao: "Enviado quando um lead se torna cliente e JÁ tinha acesso ao Portal (sem novos dados de acesso).",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [
      { chave: "nome", rotulo: "Nome do cliente", descricao: "Nome de quem recebe", exemplo: "Maria Silva" },
      { chave: "link", rotulo: "Link do botão", descricao: "Link do Portal do Cliente", exemplo: "(link do Portal)" },
    ],
    temCta: true,
    default: {
      assunto: "Boas-vindas! Agora você é cliente MedConsultoria 🎉",
      titulo: "Que alegria ter você como cliente!",
      corpo:
        "É oficial: agora você é cliente da MedConsultoria. Obrigado pela confiança!\n\nVocê continua com o mesmo acesso ao Portal do Cliente que já usava — é só entrar para acompanhar seus projetos, documentos, reuniões e falar com a nossa equipe.",
      ctaTexto: "Acessar o Portal",
    },
  },

  assinatura_solicitada: {
    label: "Solicitação de assinatura",
    descricao: "Enviado ao signatário (cliente ou equipe) com o link para assinar um documento.",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [
      { chave: "nome", rotulo: "Nome do signatário", descricao: "Quem vai assinar", exemplo: "Maria Silva" },
      { chave: "documento", rotulo: "Documento", descricao: "Título do documento", exemplo: "Contrato de prestação de serviços" },
      { chave: "link", rotulo: "Link para assinar", descricao: "Abre a página de assinatura", exemplo: "(link seguro)" },
    ],
    temCta: true,
    default: {
      assunto: "Documento para assinatura — {{documento}}",
      titulo: "Você tem um documento para assinar",
      corpo:
        "A MedConsultoria enviou o documento \"{{documento}}\" para a sua assinatura eletrônica.\n\nÉ rápido e seguro: basta abrir o link, revisar o conteúdo e assinar (desenhando ou digitando seu nome).",
      ctaTexto: "Revisar e assinar",
      nota: "Sua assinatura fica registrada com data, hora e um código de integridade do documento, conforme a Lei 14.063/2020.",
    },
  },

  proposta_para_aceite: {
    label: "Proposta para aceite (cliente)",
    descricao: "Enviado ao cliente com o link para revisar a proposta e aceitar ou recusar online.",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [
      { chave: "nome", rotulo: "Nome do cliente", descricao: "Quem recebe", exemplo: "Maria Silva" },
      { chave: "documento", rotulo: "Proposta", descricao: "Título da proposta", exemplo: "Proposta - Clínica Bem-Estar" },
      { chave: "link", rotulo: "Link da proposta", descricao: "Abre a página de aceite", exemplo: "(link seguro)" },
    ],
    temCta: true,
    default: {
      assunto: "Sua proposta da MedConsultoria — {{documento}}",
      titulo: "Você tem uma proposta para revisar",
      corpo:
        "Preparamos uma proposta especialmente para você: \"{{documento}}\".\n\nÉ só abrir o link, revisar com calma e responder com um clique — aceitar ou, se preferir, recusar. Não precisa baixar nada.",
      ctaTexto: "Revisar a proposta",
      nota: "Qualquer dúvida, fale com a nossa equipe pelo Portal do Cliente. Ficamos à disposição.",
    },
  },

  reuniao_agendada: {
    label: "Reunião agendada (cliente)",
    descricao: "Enviado ao cliente quando uma reunião/evento é agendado com ele — opcional, a equipe escolhe se avisa.",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [
      { chave: "nome", rotulo: "Nome do cliente", descricao: "Quem recebe", exemplo: "Maria Silva" },
      { chave: "titulo", rotulo: "Título da reunião", descricao: "Nome do evento", exemplo: "Reunião de alinhamento" },
      { chave: "quando", rotulo: "Data e hora", descricao: "Quando acontece", exemplo: "12/07/2026 às 10:00" },
      { chave: "link", rotulo: "Link da reunião", descricao: "Meet/Zoom/Jitsi (opcional)", exemplo: "(link da reunião)" },
    ],
    temCta: true,
    default: {
      assunto: "Reunião agendada — {{titulo}}",
      titulo: "Sua reunião foi agendada 📅",
      corpo:
        "Agendamos uma reunião com você:\n\n\"{{titulo}}\"\nQuando: {{quando}}\n\nSe houver um link de acesso, use o botão abaixo na hora da reunião. Qualquer dúvida, fale com a nossa equipe pelo Portal do Cliente.",
      ctaTexto: "Entrar na reunião",
      nota: "Se precisar remarcar, é só avisar a nossa equipe.",
    },
  },

  lembrete_reuniao_cliente: {
    label: "Lembrete de reunião (cliente)",
    descricao: "Enviado ao cliente automaticamente na véspera/no dia de uma reunião agendada com ele.",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [
      { chave: "nome", rotulo: "Nome do cliente", descricao: "Quem recebe", exemplo: "Maria Silva" },
      { chave: "titulo", rotulo: "Título da reunião", descricao: "Nome do evento", exemplo: "Reunião de alinhamento" },
      { chave: "quando", rotulo: "Data e hora", descricao: "Quando acontece", exemplo: "12/07/2026 às 10:00" },
      { chave: "link", rotulo: "Link da reunião", descricao: "Meet/Zoom/Jitsi (opcional)", exemplo: "(link da reunião)" },
    ],
    temCta: true,
    default: {
      assunto: "Lembrete: {{titulo}} está chegando",
      titulo: "Sua reunião está chegando ⏰",
      corpo:
        "Passando para lembrar da nossa reunião:\n\n\"{{titulo}}\"\nQuando: {{quando}}\n\nSe houver um link de acesso, use o botão abaixo na hora. Nos vemos lá!",
      ctaTexto: "Entrar na reunião",
      nota: "Se precisar remarcar, é só avisar a nossa equipe pelo Portal do Cliente.",
    },
  },

  // ───────── Notificações (sino + e-mail; respeitam preferências) ─────────
  presenca_confirmada: {
    label: "Presença confirmada (cliente)",
    descricao: "Quando um cliente confirma presença numa reunião pelo Portal. Vai para o dono do evento.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "cliente", rotulo: "Nome do cliente", descricao: "Quem confirmou", exemplo: "Maria Silva" },
      { chave: "evento", rotulo: "Nome da reunião", descricao: "Título do evento", exemplo: "Reunião de alinhamento" },
    ],
    temCta: true,
    default: {
      assunto: "{{cliente}} confirmou presença",
      titulo: "{{cliente}} confirmou presença",
      corpo: "{{cliente}} confirmou presença na reunião \"{{evento}}\".",
      ctaTexto: "Ver na agenda",
    },
  },
  lembrete: {
    label: "Lembrete de compromisso",
    descricao: "Aviso antes de um evento/reunião começar. Vai para o dono do evento.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "evento", rotulo: "Nome do compromisso", descricao: "Título do compromisso", exemplo: "Reunião com Dr. Paulo Andrade" },
      { chave: "hora", rotulo: "Horário", descricao: "Horário de início", exemplo: "14:30" },
    ],
    temCta: true,
    default: {
      assunto: "Lembrete: {{evento}}",
      titulo: "Lembrete: {{evento}}",
      corpo: "Seu compromisso \"{{evento}}\" começa às {{hora}}.",
      ctaTexto: "Ver na agenda",
    },
  },
  tarefa_atribuida: {
    label: "Tarefa atribuída",
    descricao: "Quando alguém atribui um cartão/tarefa a você.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "tarefa", rotulo: "Nome da tarefa", descricao: "Título da tarefa", exemplo: "Enviar proposta para a clínica" },
      { chave: "projeto", rotulo: "Nome do projeto", descricao: "Nome do projeto", exemplo: "Credenciamento Unimed" },
    ],
    temCta: true,
    default: {
      assunto: "Nova tarefa atribuída a você",
      titulo: "Nova tarefa: {{tarefa}}",
      corpo: "A tarefa \"{{tarefa}}\" foi atribuída a você no projeto {{projeto}}.",
      ctaTexto: "Ver tarefa",
    },
  },
  tarefa_atrasada: {
    label: "Tarefas atrasadas",
    descricao: "Resumo de tarefas suas que passaram do prazo.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "qtd", rotulo: "Quantidade", descricao: "Quantidade de tarefas atrasadas", exemplo: "3" },
      { chave: "projeto", rotulo: "Nome do projeto", descricao: "Nome do projeto", exemplo: "Credenciamento Unimed" },
    ],
    temCta: true,
    default: {
      assunto: "Você tem tarefas atrasadas",
      titulo: "Você tem {{qtd}} tarefa(s) atrasada(s)",
      corpo: "Há {{qtd}} tarefa(s) atrasada(s) no projeto {{projeto}}. Que tal colocar em dia?",
      ctaTexto: "Ver projeto",
    },
  },
  tarefa_delegada: {
    label: "Tarefa delegada a você",
    descricao: "Quando um colega cria uma tarefa/pedido e coloca você como responsável.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "tarefa", rotulo: "Tarefa", descricao: "O que precisa ser feito", exemplo: "Ligar para o contador da clínica" },
      { chave: "dePor", rotulo: "Quem pediu", descricao: "Quem delegou a tarefa", exemplo: "Thaís Garcia" },
    ],
    temCta: true,
    default: {
      assunto: "Nova tarefa delegada a você",
      titulo: "Nova tarefa: {{tarefa}}",
      corpo: "{{dePor}} delegou uma tarefa a você: \"{{tarefa}}\". Confira os detalhes e o prazo.",
      ctaTexto: "Ver tarefa",
    },
  },
  tarefa_concluida: {
    label: "Tarefa que você pediu foi concluída",
    descricao: "Quando o responsável conclui uma tarefa que você havia delegado.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "tarefa", rotulo: "Tarefa", descricao: "O que foi feito", exemplo: "Ligar para o contador da clínica" },
      { chave: "porQuem", rotulo: "Quem concluiu", descricao: "Quem realizou a tarefa", exemplo: "João Pereira" },
    ],
    temCta: true,
    default: {
      assunto: "Tarefa concluída: {{tarefa}}",
      titulo: "Tarefa concluída: {{tarefa}}",
      corpo: "{{porQuem}} concluiu a tarefa \"{{tarefa}}\" que você havia pedido.",
      ctaTexto: "Ver tarefa",
    },
  },
  projeto_participante: {
    label: "Adicionado a um projeto",
    descricao: "Quando você é incluído na equipe de um projeto.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "projeto", rotulo: "Nome do projeto", descricao: "Nome do projeto", exemplo: "Credenciamento Unimed" }],
    temCta: true,
    default: {
      assunto: "Você foi adicionado a um projeto",
      titulo: "Você foi adicionado a um projeto",
      corpo: "Você agora faz parte da equipe do projeto {{projeto}}.",
      ctaTexto: "Ver projeto",
    },
  },
  suporte: {
    label: "Mensagem de suporte",
    descricao: "Nova mensagem no canal de suporte de um cliente.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "cliente", rotulo: "Nome do cliente", descricao: "Nome do cliente", exemplo: "Clínica Vida & Saúde" },
      { chave: "mensagem", rotulo: "Trecho da mensagem", descricao: "Início da mensagem recebida", exemplo: "Preciso de ajuda com o envio dos documentos." },
    ],
    temCta: true,
    default: {
      assunto: "Nova mensagem de suporte — {{cliente}}",
      titulo: "Suporte: {{cliente}}",
      corpo: "Nova mensagem de {{cliente}} no suporte: \"{{mensagem}}\"",
      ctaTexto: "Responder",
    },
  },
  proposta_aceita: {
    label: "Proposta aceita pelo cliente 🎉",
    descricao: "Quando um cliente aceita a proposta pelo link/Portal. Vai para o responsável e a gestão.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "cliente", rotulo: "Nome do cliente", descricao: "Quem aceitou", exemplo: "Clínica Bem-Estar" },
      { chave: "documento", rotulo: "Proposta", descricao: "Título da proposta", exemplo: "Proposta - Clínica Bem-Estar" },
    ],
    temCta: true,
    default: {
      assunto: "{{cliente}} aceitou a proposta 🎉",
      titulo: "Proposta aceita! 🎉",
      corpo: "Boa notícia! {{cliente}} aceitou a proposta \"{{documento}}\". Que tal já preparar o contrato e dar sequência?",
      ctaTexto: "Ver documento",
    },
  },
  credenciamento_aprovado: {
    label: "Operadora aprovou um credenciamento 🎉",
    descricao:
      "Quando uma operadora aprova o credenciamento de um médico. É o momento em que o honorário passa a ser devido — a conta a receber nasce junto. Vai para o responsável e a gestão.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "cliente", rotulo: "Nome do cliente", descricao: "A clínica ou PJ", exemplo: "Clínica Bem-Estar" },
      { chave: "profissional", rotulo: "Médico", descricao: "Quem foi credenciado", exemplo: "Dra. Helena Martins Prado" },
      { chave: "operadora", rotulo: "Operadora", descricao: "Quem aprovou", exemplo: "Omint" },
      { chave: "valor", rotulo: "Honorário", descricao: "O valor que virou conta a receber", exemplo: "R$ 2.500,00" },
    ],
    temCta: true,
    default: {
      assunto: "{{operadora}} aprovou o credenciamento de {{profissional}} 🎉",
      titulo: "Credenciamento aprovado! 🎉",
      corpo:
        "A {{operadora}} aprovou o credenciamento de {{profissional}} ({{cliente}}). O honorário de {{valor}} entrou no Financeiro como conta a receber.",
      ctaTexto: "Ver o cliente",
    },
  },
  credenciamento_negado: {
    label: "Operadora negou um credenciamento",
    descricao:
      "Quando uma operadora nega o credenciamento de um médico, com o motivo. Vai para o responsável e a gestão.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "cliente", rotulo: "Nome do cliente", descricao: "A clínica ou PJ", exemplo: "Clínica Bem-Estar" },
      { chave: "profissional", rotulo: "Médico", descricao: "Quem foi recusado", exemplo: "Dra. Helena Martins Prado" },
      { chave: "operadora", rotulo: "Operadora", descricao: "Quem negou", exemplo: "Omint" },
      { chave: "motivo", rotulo: "Motivo", descricao: "O que a operadora respondeu", exemplo: "Rede fechada para a especialidade." },
    ],
    temCta: true,
    default: {
      assunto: "{{operadora}} negou o credenciamento de {{profissional}}",
      titulo: "Credenciamento negado",
      corpo:
        "A {{operadora}} negou o credenciamento de {{profissional}} ({{cliente}}). Motivo: \"{{motivo}}\". Uma nova tentativa só com acordo expresso do cliente.",
      ctaTexto: "Ver o cliente",
    },
  },
  proposta_recusada: {
    label: "Proposta recusada pelo cliente",
    descricao: "Quando um cliente recusa a proposta pelo link/Portal (com o motivo). Vai para o responsável e a gestão.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "cliente", rotulo: "Nome do cliente", descricao: "Quem recusou", exemplo: "Clínica Bem-Estar" },
      { chave: "documento", rotulo: "Proposta", descricao: "Título da proposta", exemplo: "Proposta - Clínica Bem-Estar" },
      { chave: "motivo", rotulo: "Motivo", descricao: "O motivo informado pelo cliente", exemplo: "O valor ficou acima do previsto." },
    ],
    temCta: true,
    default: {
      assunto: "{{cliente}} recusou a proposta",
      titulo: "Proposta recusada",
      corpo: "{{cliente}} recusou a proposta \"{{documento}}\". Motivo: \"{{motivo}}\". Vale um contato para entender e, quem sabe, ajustar.",
      ctaTexto: "Ver documento",
    },
  },
  documento_revisao: {
    label: "Documento aguardando revisão",
    descricao: "Documentos que precisam de análise. Vai para admins.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "documento", rotulo: "Nome do documento", descricao: "Título do documento", exemplo: "Contrato de prestação de serviços" }],
    temCta: true,
    default: {
      assunto: "Documento aguardando revisão",
      titulo: "Documento aguardando revisão",
      corpo: "O documento \"{{documento}}\" está aguardando sua revisão.",
      ctaTexto: "Ver documento",
    },
  },
  conta_vencida: {
    label: "Conta vencida",
    descricao: "Alerta de conta a pagar/receber vencida. Vai para admins.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "descricao", rotulo: "Descrição da conta", descricao: "Descrição da conta", exemplo: "Mensalidade do plano" },
      { chave: "tipo", rotulo: "Tipo", descricao: "A pagar / A receber", exemplo: "A receber" },
      { chave: "valor", rotulo: "Valor", descricao: "Valor formatado", exemplo: "R$ 1.500,00" },
      { chave: "vencimento", rotulo: "Vencimento", descricao: "Data de vencimento", exemplo: "10/07/2026" },
    ],
    temCta: true,
    default: {
      assunto: "Conta vencida: {{descricao}}",
      titulo: "Conta vencida: {{descricao}}",
      corpo: "A conta \"{{descricao}}\" ({{tipo}}) no valor de {{valor}} venceu em {{vencimento}}.",
      ctaTexto: "Ver no financeiro",
    },
  },
  conta_a_vencer: {
    label: "Conta a vencer",
    descricao: "Aviso de conta a pagar/receber que vence nos próximos dias. Vai para admins.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "descricao", rotulo: "Descrição da conta", descricao: "Descrição da conta", exemplo: "Aluguel" },
      { chave: "tipo", rotulo: "Tipo", descricao: "A pagar / A receber", exemplo: "A pagar" },
      { chave: "valor", rotulo: "Valor", descricao: "Valor formatado", exemplo: "R$ 2.000,00" },
      { chave: "vencimento", rotulo: "Vencimento", descricao: "Data de vencimento", exemplo: "12/07/2026" },
    ],
    temCta: true,
    default: {
      assunto: "Conta a vencer: {{descricao}}",
      titulo: "Conta a vencer: {{descricao}}",
      corpo: "A conta \"{{descricao}}\" ({{tipo}}) no valor de {{valor}} vence em {{vencimento}}. Não esqueça!",
      ctaTexto: "Ver no financeiro",
    },
  },
  lead_novo: {
    label: "Novo lead pelo site",
    descricao: "Quando alguém se cadastra pelo formulário público. Vai para admins.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "contato", rotulo: "Nome do lead", descricao: "Nome (e empresa) do lead", exemplo: "João Pereira · Clínica Bem-Estar" }],
    temCta: true,
    default: {
      assunto: "Novo lead pelo site",
      titulo: "Novo lead pelo site",
      corpo: "Um novo lead se cadastrou pelo site: {{contato}}.",
      ctaTexto: "Ver no funil",
    },
  },
  lead_atribuido: {
    label: "Lead atribuído a você",
    descricao: "Quando alguém te define como responsável por um lead do funil.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "contato", rotulo: "Nome do lead", descricao: "Nome (e empresa) do lead", exemplo: "João Pereira · Clínica Bem-Estar" }],
    temCta: true,
    default: {
      assunto: "Um lead foi atribuído a você",
      titulo: "Novo lead sob sua responsabilidade",
      corpo: "O lead {{contato}} foi atribuído a você. Faça o primeiro contato e conduza pelo funil.",
      ctaTexto: "Ver no funil",
    },
  },
  lead_convertido: {
    label: "Lead virou cliente",
    descricao: "Quando um lead é convertido em cliente (venda fechada). Vai para o responsável e a gestão.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "cliente", rotulo: "Nome do cliente", descricao: "Nome do cliente/lead convertido", exemplo: "Clínica Bem-Estar" }],
    temCta: true,
    default: {
      assunto: "Venda fechada: {{cliente}} virou cliente 🎉",
      titulo: "Lead convertido em cliente! 🎉",
      corpo: "Parabéns! O lead {{cliente}} foi convertido em cliente. O projeto de onboarding já foi criado.",
      ctaTexto: "Ver cliente",
    },
  },
  lead_desistiu: {
    label: "Lead desistiu pelo Portal",
    descricao: "Quando o próprio lead/prospect declara pelo Portal que não deseja mais avançar. Vai para o responsável e a gestão.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "contato", rotulo: "Nome do lead", descricao: "Nome (e empresa) do lead", exemplo: "João Pereira · Clínica Bem-Estar" }],
    temCta: true,
    default: {
      assunto: "{{contato}} desistiu pelo Portal",
      titulo: "Um lead desistiu pelo Portal",
      corpo: "O lead {{contato}} informou pelo Portal que não deseja mais avançar e foi movido para os perdidos. Talvez valha um contato para entender o motivo.",
      ctaTexto: "Ver no funil",
    },
  },
  lead_retomou: {
    label: "Lead retomou o interesse",
    descricao: "Quando um lead que havia desistido decide retomar o atendimento pelo Portal. Vai para o responsável e a gestão.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "contato", rotulo: "Nome do lead", descricao: "Nome (e empresa) do lead", exemplo: "João Pereira · Clínica Bem-Estar" }],
    temCta: true,
    default: {
      assunto: "{{contato}} retomou o interesse 🙌",
      titulo: "Um lead retomou o atendimento",
      corpo: "Boa notícia! O lead {{contato}} decidiu retomar o atendimento pelo Portal e voltou ao funil. Dê sequência.",
      ctaTexto: "Ver no funil",
    },
  },
  servico_solicitado: {
    label: "Cliente pediu serviços pelo Portal",
    descricao: "Quando um cliente escolhe serviços no Portal — vira/atualiza uma oportunidade no funil. Vai para o responsável e a gestão.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "contato", rotulo: "Nome do cliente", descricao: "Nome (e empresa) do cliente", exemplo: "Clínica Bem-Estar" },
      { chave: "servicos", rotulo: "Serviços pedidos", descricao: "Lista dos serviços que o cliente escolheu", exemplo: "Faturamento, Marketing" },
    ],
    temCta: true,
    default: {
      assunto: "{{contato}} pediu serviços pelo Portal 🛎️",
      titulo: "Novo pedido de serviços pelo Portal",
      corpo: "{{contato}} escolheu no Portal os serviços: {{servicos}}. Uma oportunidade foi aberta/atualizada no funil — dê sequência.",
      ctaTexto: "Ver no funil",
    },
  },
  documento_cliente_enviado: {
    label: "Cliente enviou um documento",
    descricao: "Quando um cliente anexa um documento pelo Portal. Vai para o responsável e a gestão.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "cliente", rotulo: "Nome do cliente", descricao: "Cliente que enviou", exemplo: "Clínica Bem-Estar" },
      { chave: "documento", rotulo: "Documento", descricao: "Nome do arquivo enviado", exemplo: "RG - Dr. Silva.pdf" },
    ],
    temCta: false,
    default: {
      assunto: "{{cliente}} enviou um documento 📎",
      titulo: "Novo documento recebido pelo Portal",
      corpo: "{{cliente}} anexou o documento \"{{documento}}\" pelo Portal do Cliente. Confira na ficha do cliente.",
    },
  },
  servico_cancelado: {
    label: "Cliente cancelou um serviço",
    descricao: "Quando um cliente cancela um serviço pelo Portal. Vai para o responsável e a gestão.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "cliente", rotulo: "Nome do cliente", descricao: "Cliente que cancelou", exemplo: "Clínica Bem-Estar" },
      { chave: "servico", rotulo: "Serviço", descricao: "Serviço cancelado", exemplo: "Faturamento" },
    ],
    temCta: false,
    default: {
      assunto: "{{cliente}} cancelou um serviço",
      titulo: "Serviço cancelado pelo cliente",
      corpo: "{{cliente}} cancelou o serviço \"{{servico}}\" pelo Portal do Cliente. Vale um contato para entender o motivo.",
    },
  },
  servico_ativado: {
    label: "Serviço contratado (aviso ao cliente)",
    descricao: "Enviado ao cliente quando a equipe ativa um serviço para ele — opcional (opt-in).",
    grupo: "Transacionais",
    notificacao: false,
    variaveis: [
      { chave: "nome", rotulo: "Nome do cliente", descricao: "Quem recebe", exemplo: "Maria Silva" },
      { chave: "servico", rotulo: "Serviço", descricao: "Serviço contratado", exemplo: "Credenciamento" },
      { chave: "link", rotulo: "Link do Portal", descricao: "Portal do Cliente", exemplo: "(link do Portal)" },
    ],
    temCta: true,
    default: {
      assunto: "Serviço {{servico}} ativado — MedConsultoria",
      titulo: "Seu serviço foi ativado 🎉",
      corpo:
        "Ativamos o serviço \"{{servico}}\" para você! Para darmos andamento, acesse o Portal do Cliente e veja se há documentos ou informações que precisamos de você.",
      ctaTexto: "Acessar o Portal",
    },
  },

  conflito_agenda: {
    label: "Conflito de horário na agenda",
    descricao: "Alerta proativo quando dois compromissos seus se sobrepõem. Vai para o dono e os participantes.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [
      { chave: "titulo", rotulo: "Compromisso", descricao: "Título do compromisso em conflito", exemplo: "Reunião de kickoff" },
      { chave: "quando", rotulo: "Quando", descricao: "Data e hora do conflito", exemplo: "15/07/2026 às 10:00" },
    ],
    temCta: true,
    default: {
      assunto: "Conflito de horário na agenda",
      titulo: "Conflito de horário ⚠️",
      corpo: "Atenção: \"{{titulo}}\" ({{quando}}) está no mesmo horário de outro compromisso seu. Reveja a agenda para não perder nada.",
      ctaTexto: "Abrir a agenda",
    },
  },
  projeto_parado: {
    label: "Projeto parado",
    descricao: "Projeto ativo sem movimento há mais de 14 dias. Vai para o responsável (ou admins).",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "projeto", rotulo: "Nome do projeto", descricao: "Nome do projeto", exemplo: "Credenciamento Unimed" }],
    temCta: true,
    default: {
      assunto: "Projeto parado: {{projeto}}",
      titulo: "Projeto parado há +14 dias",
      corpo: "O projeto \"{{projeto}}\" está ativo mas sem movimento há mais de 14 dias. Que tal dar um empurrão ou revisar o andamento?",
      ctaTexto: "Ver projeto",
    },
  },
  projeto_sem_responsavel: {
    label: "Projeto sem responsável",
    descricao: "Projeto sem ninguém responsável. Vai para admins.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "projeto", rotulo: "Nome do projeto", descricao: "Nome do projeto", exemplo: "Credenciamento Unimed" }],
    temCta: true,
    default: {
      assunto: "Projeto sem responsável: {{projeto}}",
      titulo: "Projeto sem responsável",
      corpo: "O projeto \"{{projeto}}\" está sem responsável definido. Defina alguém para que não fique sem dono.",
      ctaTexto: "Ver projeto",
    },
  },
  upsell_oportunidade: {
    label: "Cliente quer mais (upsell)",
    descricao: "Cliente ativo com uma oportunidade aberta no funil (quer mais serviços). Vai para o responsável (ou admins).",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "cliente", rotulo: "Nome do cliente", descricao: "Nome do cliente", exemplo: "Clínica Bem-Estar" }],
    temCta: true,
    default: {
      assunto: "Oportunidade: {{cliente}} quer mais",
      titulo: "Oportunidade de upsell 💡",
      corpo: "{{cliente}} tem uma oportunidade aberta no funil (quer mais serviços). Vale dar sequência para não esfriar.",
      ctaTexto: "Ver no funil",
    },
  },

  documento_parado: {
    label: "Documento sem resposta do cliente",
    descricao: "Proposta ou documento enviado ao cliente que está há dias sem aceite/assinatura. Vai para quem criou e admins.",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "documento", rotulo: "Documento", descricao: "Título do documento", exemplo: "Proposta - Clínica Bem-Estar" }],
    temCta: true,
    default: {
      assunto: "Sem resposta: {{documento}}",
      titulo: "Documento parado aguardando o cliente",
      corpo: "O documento \"{{documento}}\" foi enviado ao cliente e ainda não teve resposta (aceite/assinatura). Que tal um lembrete amigável?",
      ctaTexto: "Ver documento",
    },
  },
  lead_parado: {
    label: "Lead parado no funil",
    descricao: "Lead ativo sem movimento há mais de 14 dias. Vai para o responsável (ou admins).",
    grupo: "Notificações",
    notificacao: true,
    variaveis: [{ chave: "contato", rotulo: "Nome do lead", descricao: "Nome (e empresa) do lead", exemplo: "João Pereira · Clínica Bem-Estar" }],
    temCta: true,
    default: {
      assunto: "Lead parado: {{contato}}",
      titulo: "Lead parado há +14 dias",
      corpo: "O lead {{contato}} está parado há mais de 14 dias no funil. Um retorno agora pode reaquecer a conversa.",
      ctaTexto: "Ver no funil",
    },
  },

  // ───────── Sistema (ROOT; título/detalhe dinâmicos) ─────────
  incidente: {
    label: "Alerta do sistema (incidente)",
    descricao: "Incidente técnico detectado (event loop, memória, etc.). Vai para o ROOT.",
    grupo: "Sistema",
    notificacao: true,
    variaveis: [
      { chave: "titulo", rotulo: "Título do alerta", descricao: "Título dinâmico do alerta", exemplo: "🚨 Uso de memória alto" },
      { chave: "detalhe", rotulo: "Detalhe", descricao: "Detalhe do incidente", exemplo: "Uso de memória chegou a 88% (limite 85%)." },
    ],
    temCta: true,
    default: {
      assunto: "{{titulo}}",
      titulo: "{{titulo}}",
      corpo: "{{detalhe}}",
      ctaTexto: "Ver no Sistema",
    },
  },
  erro: {
    label: "Erro do sistema",
    descricao: "Novo erro (ou regressão) registrado na aplicação. Vai para o ROOT.",
    grupo: "Sistema",
    notificacao: true,
    variaveis: [
      { chave: "titulo", rotulo: "Título do erro", descricao: "Novo erro / regressão", exemplo: "Novo erro registrado" },
      { chave: "resumo", rotulo: "Resumo", descricao: "Resumo do erro", exemplo: "TypeError: cannot read property 'id' of undefined" },
    ],
    temCta: true,
    default: {
      assunto: "{{titulo}}",
      titulo: "{{titulo}}",
      corpo: "{{resumo}}",
      ctaTexto: "Ver no Sistema",
    },
  },
} satisfies Record<string, TemplateMeta>;

/** União literal das chaves de template — use em quem DECLARA um tipo de aviso no código. */
export type EmailTemplateChave = keyof typeof EMAIL_TEMPLATES;

/**
 * Busca por chave vinda de FORA (input do admin, coluna do banco): aceita `string` e devolve
 * undefined se não existir. Quem escreve o tipo no próprio código deve usar
 * `EmailTemplateChave` e ser barrado pelo compilador, não por esta função.
 */
export function templateDe(chave: string): TemplateMeta | undefined {
  return (EMAIL_TEMPLATES as Record<string, TemplateMeta>)[chave];
}

/** Monta o mapa de valores de exemplo (para prévia e teste) de um template. */
export function exemploVars(chave: string): Record<string, string> {
  const meta = templateDe(chave);
  const vars: Record<string, string> = {};
  if (meta) for (const v of meta.variaveis) vars[v.chave] = v.exemplo;
  return vars;
}
