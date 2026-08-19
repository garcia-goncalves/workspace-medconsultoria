import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import { emReais } from "../../lib/dinheiro.js";
import { Prisma } from "@prisma/client";

/**
 * Catálogo inicial COMPLETO — os serviços reais da MedConsultoria com detalhes,
 * exigências (o que o cliente entrega) e passos (checklist do funil por etapa).
 * Fonte: brand/ + medconsultoria.com.br. Tudo editável na página Serviços.
 *
 * Obs.: as exigências do tipo BRIEFING (formulário do catálogo) são semeadas à parte,
 * junto com os formulários-modelo (`formularios.service`), pois dependem de um formulário.
 */
type ReqSeed = { titulo: string; tipo: "DOCUMENTO" | "INFORMACAO"; obrigatorio: boolean; descricao?: string };
type PassoSeed = { titulo: string; etapaChave: string; obrigatorio: boolean };
type Recorr = "AVULSO" | "MENSAL";
type ServicoSeed = {
  nome: string;
  categoria: string;
  valor: number | null;
  // Precificação: valor fixo (avulso/mensal) e/ou % do faturamento (avulso/mensal). Padrões: AVULSO / MENSAL.
  valorRecorrencia?: Recorr;
  percentual?: number | null;
  percentualRecorrencia?: Recorr;
  descricao: string;
  requisitos: ReqSeed[];
  passos: PassoSeed[];
};

/**
 * Cláusulas de contrato por serviço (Markdown). Entram no CONTRATO gerado automaticamente
 * ao aceitar a proposta, juntando as condições de todos os serviços contratados. Editáveis
 * na página Serviços. Backfill idempotente em `seedIfEmpty` (só preenche onde está vazio).
 */
const CLAUSULAS_SERVICOS: Record<string, string> = {
  "Gestão Operacional":
    "A CONTRATADA fará o mapeamento dos processos da clínica (da agenda ao pagamento), identificará gargalos e proporá melhorias, treinará a equipe e definirá indicadores de acompanhamento. Entregáveis: diagnóstico operacional, plano de organização e rotina de acompanhamento dos resultados. A CONTRATANTE fornecerá as informações da operação e disponibilizará a equipe para as atividades de implantação.",
  Faturamento:
    "A CONTRATADA realizará a gestão do faturamento médico: auditoria e conferência das guias, processamento junto às operadoras, conciliação de pagamentos, recurso de glosas e relatórios gerenciais. A remuneração observará o percentual acordado sobre o valor efetivamente faturado, apurado mensalmente. A CONTRATANTE fornecerá tempestivamente as guias, os demonstrativos das operadoras e o acesso necessário aos portais de faturamento.",
  "Credenciamento médico e odontológico":
    "A CONTRATADA conduzirá o processo de credenciamento da CONTRATANTE junto às operadoras e convênios selecionados — organização documental, cadastro, protocolo e acompanhamento até a efetivação. A CONTRATADA envidará os melhores esforços na condução; a aprovação final, contudo, é ato exclusivo de cada operadora e não constitui obrigação de resultado da CONTRATADA. A CONTRATANTE fornecerá os documentos exigidos de forma completa e verídica.",
  "Negociação com operadoras":
    "A CONTRATADA analisará os contratos e tabelas vigentes com as operadoras e conduzirá a renegociação de valores, prazos e condições, buscando melhores termos para a CONTRATANTE. Os resultados dependem da aceitação das operadoras; a CONTRATADA não garante índice específico de reajuste. A CONTRATANTE autorizará a CONTRATADA a representá-la nas tratativas e fornecerá os contratos e demonstrativos necessários.",
  "Identidade visual (Branding)":
    "A CONTRATADA desenvolverá a identidade visual da marca — logotipo, paleta de cores e tipografia — com base no briefing aprovado. Estão incluídas as rodadas de ajuste previstas no escopo; após a aprovação final, os arquivos são entregues nos formatos padrão de uso. A cessão do direito de uso da identidade visual à CONTRATANTE se dá com a quitação integral do serviço.",
  "Manual da marca":
    "A CONTRATADA produzirá o manual da marca com as diretrizes de aplicação da identidade visual (usos corretos, cores, tipografia, espaçamentos e exemplos). O entregável é o documento do manual em formato digital. Este serviço pressupõe uma identidade visual já definida, própria ou desenvolvida pela CONTRATADA.",
  "Desenvolvimento de site":
    "A CONTRATADA desenvolverá o site/página conforme o escopo e o briefing aprovados — layout responsivo, otimização básica para busca (SEO) e publicação. Domínio, hospedagem e licenças de terceiros correm por conta da CONTRATANTE, salvo ajuste em contrário. A CONTRATANTE fornecerá textos, imagens e acessos necessários; alterações fora do escopo aprovado poderão ser orçadas à parte.",
  "Gestão de redes sociais":
    "A CONTRATADA fará a gestão das redes sociais conforme o plano contratado — planejamento de pauta, criação e publicação de conteúdo e acompanhamento de resultados. A CONTRATANTE aprovará o calendário de postagens e observará as normas dos conselhos (CFM/CRO) sobre publicidade na área da saúde. Custos de mídia paga não estão incluídos, salvo previsão expressa.",
  "Conteúdo & SEO":
    "A CONTRATADA produzirá conteúdo e executará ações de otimização para busca (SEO) conforme o plano contratado, visando aumentar a relevância e o alcance orgânico. O posicionamento nos mecanismos de busca depende de fatores externos; a CONTRATADA não garante posição específica. A CONTRATANTE aprovará as pautas e fornecerá as informações necessárias.",
  "Tráfego pago":
    "A CONTRATADA planejará, configurará e gerenciará campanhas de tráfego pago (anúncios) conforme o plano contratado, com acompanhamento e otimização dos resultados. O investimento em mídia (verba dos anúncios) é custeado diretamente pela CONTRATANTE e não integra os honorários da CONTRATADA. Os resultados dependem das plataformas e do mercado; não há garantia de retorno específico.",
};

const CONTEUDO_SERVICOS: ServicoSeed[] = [
  {
    nome: "Gestão Operacional",
    categoria: "Gestão",
    valor: 3500,
    valorRecorrencia: "MENSAL",
    descricao:
      "Organizamos a operação da clínica de ponta a ponta — da agenda ao pagamento: mapeamento de processos, redução de gargalos, treinamento da equipe e indicadores para acompanhar os resultados.",
    requisitos: [
      { titulo: "Lista da equipe atual", tipo: "DOCUMENTO", obrigatorio: true, descricao: "Quem faz o quê hoje (funções e responsáveis)." },
      { titulo: "Organograma da equipe", tipo: "DOCUMENTO", obrigatorio: true, descricao: "Estrutura hierárquica e funções de cada membro da equipe." },
      { titulo: "Fluxo de atendimento atual (se houver)", tipo: "DOCUMENTO", obrigatorio: false },
      { titulo: "Tabela de horários e escalas da equipe", tipo: "DOCUMENTO", obrigatorio: false },
      { titulo: "Qual o horário de funcionamento da clínica?", tipo: "INFORMACAO", obrigatorio: true, descricao: "Dias e horários de atendimento, incluindo intervalos." },
      { titulo: "Quais os principais gargalos que você percebe hoje?", tipo: "INFORMACAO", obrigatorio: true, descricao: "Onde a operação trava: agenda, faturamento, atendimento, no-show…" },
      { titulo: "Quantos atendimentos, em média, por dia?", tipo: "INFORMACAO", obrigatorio: false },
      { titulo: "Quais sistemas a clínica usa hoje?", tipo: "INFORMACAO", obrigatorio: false, descricao: "Agenda, prontuário, financeiro — cite os nomes (sem senhas)." },
    ],
    passos: [
      { titulo: "Mapear os processos atuais da clínica", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Levantar equipe e ferramentas em uso", etapaChave: "qualificacao", obrigatorio: false },
      { titulo: "Aplicar diagnóstico operacional (da agenda ao pagamento)", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Montar plano de organização operacional", etapaChave: "proposta", obrigatorio: true },
      { titulo: "Apresentar indicadores e metas de melhoria", etapaChave: "proposta", obrigatorio: true },
      { titulo: "Definir escopo e cronograma de implantação", etapaChave: "negociacao", obrigatorio: true },
      { titulo: "Alinhar responsáveis e rotina de acompanhamento", etapaChave: "negociacao", obrigatorio: false },
      { titulo: "Kickoff de implantação com a equipe", etapaChave: "fechado", obrigatorio: true },
      { titulo: "Configurar a rotina de monitoramento de resultados", etapaChave: "fechado", obrigatorio: false },
    ],
  },
  {
    nome: "Faturamento",
    categoria: "Faturamento",
    // Faturamento de contas médicas: normalmente um % sobre o valor faturado, cobrado por mês.
    // (É o único serviço com opção de %.) A Med pode ajustar para valor fixo + % se quiser.
    valor: null,
    percentual: 5,
    percentualRecorrencia: "MENSAL",
    descricao:
      "Cuidamos do faturamento médico completo: auditoria das guias, processamento, conciliação de pagamentos, recurso de glosas e relatórios gerenciais — para você receber tudo o que é seu, no prazo.",
    requisitos: [
      { titulo: "Relação de guias/atendimentos do período", tipo: "DOCUMENTO", obrigatorio: true, descricao: "Planilha ou relatório dos atendimentos a faturar." },
      { titulo: "Demonstrativos de pagamento das operadoras (últimos 3 meses)", tipo: "DOCUMENTO", obrigatorio: true, descricao: "Extratos/demonstrativos que mostram pagamentos e glosas." },
      { titulo: "Tabelas de procedimentos das operadoras", tipo: "DOCUMENTO", obrigatorio: false },
      { titulo: "Relatório de glosas do período (se houver)", tipo: "DOCUMENTO", obrigatorio: false },
      { titulo: "Quais operadoras você atende?", tipo: "INFORMACAO", obrigatorio: true, descricao: "Liste os convênios (Unimed, Bradesco, Amil, SUS…)." },
      { titulo: "Qual o volume médio de guias por mês?", tipo: "INFORMACAO", obrigatorio: false },
      { titulo: "Como a equipe acessa os portais das operadoras?", tipo: "INFORMACAO", obrigatorio: false, descricao: "Descreva o acesso aos portais de faturamento (sem senhas por escrito)." },
    ],
    passos: [
      { titulo: "Analisar histórico de faturamento e glosas", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Auditar uma amostra de guias e glosas", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Apresentar diagnóstico e plano de recuperação de glosas", etapaChave: "proposta", obrigatorio: true },
      { titulo: "Estimar o valor recuperável de glosas", etapaChave: "proposta", obrigatorio: false },
      { titulo: "Definir a rotina de auditoria e relatórios", etapaChave: "negociacao", obrigatorio: true },
      { titulo: "Implantar a conferência pré-envio das guias", etapaChave: "fechado", obrigatorio: true },
      { titulo: "Definir o relatório gerencial mensal", etapaChave: "fechado", obrigatorio: false },
    ],
  },
  {
    nome: "Credenciamento médico e odontológico",
    categoria: "Networking",
    valor: 1500,
    descricao:
      "Cuidamos de todo o processo de credenciamento de médicos e dentistas junto às operadoras de saúde — da documentação à efetivação, sem burocracia para você.",
    requisitos: [
      { titulo: "RG e CPF do médico", tipo: "DOCUMENTO", obrigatorio: true, descricao: "Documento de identidade e CPF de cada profissional a credenciar." },
      { titulo: "CRM/CRO e comprovante de especialização", tipo: "DOCUMENTO", obrigatorio: true, descricao: "Registro no conselho e certificados de especialidade/RQE." },
      { titulo: "Diploma e certificado de especialização (RQE)", tipo: "DOCUMENTO", obrigatorio: true },
      { titulo: "Comprovante de endereço da clínica", tipo: "DOCUMENTO", obrigatorio: true },
      { titulo: "CNPJ e contrato social da clínica (se PJ)", tipo: "DOCUMENTO", obrigatorio: false, descricao: "Necessário quando o credenciamento é por pessoa jurídica." },
      { titulo: "Alvará de funcionamento e licença sanitária", tipo: "DOCUMENTO", obrigatorio: false },
      { titulo: "Dados bancários para repasse", tipo: "DOCUMENTO", obrigatorio: false, descricao: "Banco, agência e conta para os pagamentos da operadora." },
      { titulo: "Quais operadoras deseja credenciar?", tipo: "INFORMACAO", obrigatorio: true, descricao: "Liste os convênios de interesse (Unimed, Bradesco, Amil…)." },
      { titulo: "Já possui algum credenciamento ativo?", tipo: "INFORMACAO", obrigatorio: false },
    ],
    passos: [
      { titulo: "Levantar operadoras de interesse", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Coletar documentos do profissional/clínica", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Conferir documentação e apontar pendências", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Apresentar proposta de credenciamento", etapaChave: "proposta", obrigatorio: true },
      { titulo: "Definir operadoras-alvo e prioridades", etapaChave: "proposta", obrigatorio: false },
      { titulo: "Negociar tabelas e contrato com a operadora", etapaChave: "negociacao", obrigatorio: true },
      { titulo: "Protocolar a solicitação junto às operadoras", etapaChave: "negociacao", obrigatorio: true },
      { titulo: "Acompanhar a análise e efetivar o credenciamento", etapaChave: "fechado", obrigatorio: true },
    ],
  },
  {
    nome: "Negociação com operadoras",
    categoria: "Networking",
    valor: 1200,
    descricao:
      "Analisamos e renegociamos seus contratos e tabelas com as operadoras para corrigir valores defasados, melhorar prazos e aumentar a sua rentabilidade.",
    requisitos: [
      { titulo: "Contratos vigentes com as operadoras", tipo: "DOCUMENTO", obrigatorio: true, descricao: "Cópia dos contratos atuais a renegociar." },
      { titulo: "Tabelas de valores praticadas hoje", tipo: "DOCUMENTO", obrigatorio: true },
      { titulo: "Histórico de faturamento por operadora", tipo: "DOCUMENTO", obrigatorio: false },
      { titulo: "Quais operadoras deseja renegociar e por quê?", tipo: "INFORMACAO", obrigatorio: true, descricao: "Ex.: valores defasados, glosas recorrentes, prazo de pagamento." },
      { titulo: "Qual seu volume mensal com cada operadora?", tipo: "INFORMACAO", obrigatorio: false },
    ],
    passos: [
      { titulo: "Levantar contratos e tabelas vigentes", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Comparar valores com a média de mercado", etapaChave: "qualificacao", obrigatorio: false },
      { titulo: "Apresentar diagnóstico e metas de reajuste", etapaChave: "proposta", obrigatorio: true },
      { titulo: "Conduzir a negociação com a operadora", etapaChave: "negociacao", obrigatorio: true },
      { titulo: "Formalizar o aditivo / atualização de tabela", etapaChave: "fechado", obrigatorio: true },
    ],
  },
  {
    nome: "Identidade visual (Branding)",
    categoria: "Desenvolvimento",
    valor: 2500,
    descricao:
      "Criamos a identidade visual da sua marca — logotipo, paleta de cores e tipografia — para transmitir confiança e profissionalismo em cada ponto de contato.",
    requisitos: [
      { titulo: "Logo e materiais atuais (se houver)", tipo: "DOCUMENTO", obrigatorio: false, descricao: "Arquivos da marca atual, em qualquer formato." },
      { titulo: "Fotos suas / do consultório (se for usar)", tipo: "DOCUMENTO", obrigatorio: false },
      { titulo: "Como quer que a marca seja percebida em 3 palavras?", tipo: "INFORMACAO", obrigatorio: true, descricao: "Ex.: acolhedora, moderna, confiável." },
      { titulo: "Marcas/concorrentes que você admira", tipo: "INFORMACAO", obrigatorio: false },
    ],
    passos: [
      { titulo: "Enviar e receber o briefing de identidade", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Analisar posicionamento e público", etapaChave: "qualificacao", obrigatorio: false },
      { titulo: "Apresentar proposta e conceito criativo", etapaChave: "proposta", obrigatorio: true },
      { titulo: "Aprovar a direção visual (moodboard)", etapaChave: "negociacao", obrigatorio: true },
      { titulo: "Entregar logo e aplicações finais", etapaChave: "fechado", obrigatorio: true },
    ],
  },
  {
    nome: "Manual da marca",
    categoria: "Desenvolvimento",
    valor: 1500,
    descricao:
      "Produzimos o manual da marca com todas as diretrizes de uso da identidade visual, garantindo consistência em site, redes, impressos e ambiente.",
    requisitos: [
      { titulo: "Arquivos da identidade visual aprovada", tipo: "DOCUMENTO", obrigatorio: true, descricao: "Logo, cores e tipografia já definidos." },
      { titulo: "Onde a marca será mais usada?", tipo: "INFORMACAO", obrigatorio: false, descricao: "Site, redes, fachada, jaleco, papelaria…" },
    ],
    passos: [
      { titulo: "Reunir os elementos da identidade aprovada", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Apresentar a estrutura do manual", etapaChave: "proposta", obrigatorio: true },
      { titulo: "Aprovar as diretrizes de uso", etapaChave: "negociacao", obrigatorio: false },
      { titulo: "Entregar o manual da marca (PDF)", etapaChave: "fechado", obrigatorio: true },
    ],
  },
  {
    nome: "Desenvolvimento de site",
    categoria: "Desenvolvimento",
    valor: 4000,
    descricao:
      "Desenvolvemos sites e páginas rápidos, responsivos e otimizados para SEO, pensados para transformar visitantes em agendamentos.",
    requisitos: [
      { titulo: "Logo em alta resolução (vetor)", tipo: "DOCUMENTO", obrigatorio: true, descricao: "Preferencialmente .SVG, .AI ou .PDF." },
      { titulo: "Materiais de marca atuais (logo, cores)", tipo: "DOCUMENTO", obrigatorio: false, descricao: "Se já tiver identidade visual, envie os arquivos." },
      { titulo: "Fotos do consultório e da equipe", tipo: "DOCUMENTO", obrigatorio: false },
      { titulo: "Referências visuais que você gosta", tipo: "INFORMACAO", obrigatorio: false, descricao: "Cole links de sites/perfis e diga o que gostou em cada um." },
      { titulo: "Já tem domínio e hospedagem?", tipo: "INFORMACAO", obrigatorio: false, descricao: "Ex.: www.suaclinica.com.br — se sim, informe qual e onde está." },
      { titulo: "Quais serviços/textos devem aparecer no site?", tipo: "INFORMACAO", obrigatorio: false },
    ],
    passos: [
      { titulo: "Entender objetivos de marca e presença digital", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Enviar e receber o briefing de site", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Apresentar proposta de site", etapaChave: "proposta", obrigatorio: true },
      { titulo: "Apresentar a estrutura de páginas (sitemap)", etapaChave: "proposta", obrigatorio: false },
      { titulo: "Aprovar escopo criativo e cronograma", etapaChave: "negociacao", obrigatorio: true },
      { titulo: "Publicar o site e configurar o SEO básico", etapaChave: "fechado", obrigatorio: true },
      { titulo: "Treinar o cliente para atualizar o conteúdo", etapaChave: "fechado", obrigatorio: false },
    ],
  },
  {
    nome: "Gestão de redes sociais",
    categoria: "Marketing",
    valor: 1800,
    valorRecorrencia: "MENSAL",
    descricao:
      "Cuidamos das suas redes sociais de ponta a ponta — estratégia, conteúdo e publicação — sempre dentro das normas de publicidade médica do CFM.",
    requisitos: [
      { titulo: "Acesso aos perfis (ou convite de administrador)", tipo: "DOCUMENTO", obrigatorio: true, descricao: "Como daremos entrada nas contas (Meta Business, convite…)." },
      { titulo: "Fotos e vídeos disponíveis", tipo: "DOCUMENTO", obrigatorio: false },
      { titulo: "Quais perfis/@ vamos gerenciar?", tipo: "INFORMACAO", obrigatorio: true, descricao: "Instagram, Facebook, TikTok… informe os @." },
      { titulo: "Frequência de postagem desejada", tipo: "INFORMACAO", obrigatorio: false },
    ],
    passos: [
      { titulo: "Enviar e receber o briefing de redes", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Auditar a presença atual nas redes", etapaChave: "qualificacao", obrigatorio: false },
      { titulo: "Apresentar plano de conteúdo e frequência", etapaChave: "proposta", obrigatorio: true },
      { titulo: "Aprovar a linha editorial e o tom de voz", etapaChave: "negociacao", obrigatorio: true },
      { titulo: "Montar o calendário do 1º mês", etapaChave: "fechado", obrigatorio: true },
    ],
  },
  {
    nome: "Conteúdo & SEO",
    categoria: "Marketing",
    valor: 1500,
    valorRecorrencia: "MENSAL",
    descricao:
      "Produzimos conteúdo relevante e otimizamos seu site para o Google, aumentando sua autoridade e atraindo pacientes que já estão procurando por você.",
    requisitos: [
      { titulo: "Acesso ao site / Google Search Console", tipo: "DOCUMENTO", obrigatorio: false, descricao: "Convite de acesso para acompanharmos o desempenho." },
      { titulo: "Quais assuntos/especialidades quer destacar?", tipo: "INFORMACAO", obrigatorio: true, descricao: "Temas que o seu público mais pesquisa." },
      { titulo: "Cidade/região que você quer atingir", tipo: "INFORMACAO", obrigatorio: true, descricao: "Importante para o SEO local." },
    ],
    passos: [
      { titulo: "Levantar palavras-chave e concorrentes", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Apresentar o plano de conteúdo e SEO", etapaChave: "proposta", obrigatorio: true },
      { titulo: "Aprovar a pauta e o cronograma", etapaChave: "negociacao", obrigatorio: false },
      { titulo: "Publicar os primeiros conteúdos otimizados", etapaChave: "fechado", obrigatorio: true },
    ],
  },
  {
    nome: "Tráfego pago",
    categoria: "Marketing",
    valor: 1200,
    valorRecorrencia: "MENSAL",
    descricao:
      "Criamos e gerimos campanhas de anúncios no Google e nas redes, dentro das normas do CFM, para gerar mais agendamentos com previsibilidade.",
    requisitos: [
      { titulo: "Acesso à conta de anúncios (Meta/Google Ads)", tipo: "DOCUMENTO", obrigatorio: true, descricao: "Convite de administrador no Gerenciador de Negócios." },
      { titulo: "Materiais/criativos disponíveis", tipo: "DOCUMENTO", obrigatorio: false },
      { titulo: "Qual o objetivo da campanha?", tipo: "INFORMACAO", obrigatorio: true, descricao: "Ex.: mais agendamentos, divulgar um serviço, autoridade." },
      { titulo: "Qual a verba mensal de anúncios?", tipo: "INFORMACAO", obrigatorio: true },
      { titulo: "Região e público que quer alcançar", tipo: "INFORMACAO", obrigatorio: false },
    ],
    passos: [
      { titulo: "Definir objetivo e público da campanha", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Verificar a conformidade com o CFM", etapaChave: "qualificacao", obrigatorio: true },
      { titulo: "Apresentar o plano de mídia e a verba", etapaChave: "proposta", obrigatorio: true },
      { titulo: "Aprovar criativos e segmentação", etapaChave: "negociacao", obrigatorio: true },
      { titulo: "Subir a campanha e configurar as métricas", etapaChave: "fechado", obrigatorio: true },
    ],
  },
];

/**
 * Roteiro de execução (por nome de serviço): cada TAREFA vira um cartão do projeto quando o
 * serviço é contratado, com o checklist da tarefa. Ponto de partida editável (ADR-37).
 */
const ROTEIROS_SERVICO: Record<string, { titulo: string; itens: string[] }[]> = {
  "Gestão Operacional": [
    { titulo: "Diagnóstico da operação", itens: ["Mapear os processos atuais", "Levantar equipe e ferramentas em uso", "Aplicar o diagnóstico (da agenda ao pagamento)"] },
    { titulo: "Plano de ação", itens: ["Definir os gargalos prioritários", "Montar o plano de organização", "Definir indicadores e metas"] },
    { titulo: "Implantação", itens: ["Kickoff com a equipe", "Implantar os novos fluxos", "Treinar a equipe"] },
    { titulo: "Acompanhamento", itens: ["Configurar o monitoramento de resultados", "Primeira revisão de resultados"] },
  ],
  Faturamento: [
    { titulo: "Diagnóstico do faturamento", itens: ["Analisar o histórico e as glosas", "Auditar uma amostra de guias"] },
    { titulo: "Plano de recuperação", itens: ["Montar o plano de recuperação de glosas", "Estimar o valor recuperável"] },
    { titulo: "Rotina de faturamento", itens: ["Definir a rotina de auditoria", "Implantar a conferência pré-envio", "Definir o relatório gerencial mensal"] },
  ],
  "Credenciamento médico e odontológico": [
    { titulo: "Preparação", itens: ["Conferir a documentação", "Definir as operadoras-alvo e prioridades"] },
    { titulo: "Submissão às operadoras", itens: ["Apresentar a proposta de credenciamento", "Protocolar a solicitação"] },
    { titulo: "Negociação", itens: ["Negociar tabelas e contrato"] },
    { titulo: "Efetivação", itens: ["Acompanhar a análise", "Efetivar o credenciamento"] },
  ],
  "Negociação com operadoras": [
    { titulo: "Diagnóstico", itens: ["Levantar contratos e tabelas vigentes", "Comparar com a média de mercado"] },
    { titulo: "Negociação", itens: ["Apresentar as metas de reajuste", "Conduzir a negociação"] },
    { titulo: "Fechamento", itens: ["Formalizar o aditivo / atualização de tabela"] },
  ],
  "Identidade visual (Branding)": [
    { titulo: "Imersão", itens: ["Analisar o briefing", "Estudar o posicionamento e o público"] },
    { titulo: "Criação", itens: ["Montar o moodboard / conceito", "Criar propostas de logotipo"] },
    { titulo: "Refinamento", itens: ["Aprovar a direção visual", "Ajustes finais"] },
    { titulo: "Entrega", itens: ["Entregar o logo e as aplicações"] },
  ],
  "Manual da marca": [
    { titulo: "Reunir elementos", itens: ["Reunir a identidade aprovada"] },
    { titulo: "Produção do manual", itens: ["Definir as diretrizes de uso", "Diagramar o manual"] },
    { titulo: "Entrega", itens: ["Revisar e entregar (PDF)"] },
  ],
  "Desenvolvimento de site": [
    { titulo: "Planejamento", itens: ["Receber o briefing", "Definir o mapa do site (sitemap)", "Aprovar o escopo"] },
    { titulo: "Design", itens: ["Wireframe", "Layout", "Aprovação do cliente"] },
    { titulo: "Desenvolvimento", itens: ["Montar as páginas", "Deixar responsivo", "SEO básico"] },
    { titulo: "Publicação", itens: ["Publicar no ar", "Treinar o cliente"] },
  ],
  "Gestão de redes sociais": [
    { titulo: "Setup", itens: ["Auditar a presença atual", "Definir a linha editorial e o tom", "Aprovar o plano"] },
    { titulo: "Produção", itens: ["Montar o calendário do mês", "Produzir artes e textos"] },
    { titulo: "Publicação", itens: ["Agendar e publicar", "Acompanhar métricas"] },
  ],
  "Conteúdo & SEO": [
    { titulo: "Estratégia", itens: ["Levantar palavras-chave", "Analisar concorrentes", "Definir a pauta"] },
    { titulo: "Produção", itens: ["Escrever os conteúdos", "Otimizar para SEO"] },
    { titulo: "Publicação", itens: ["Publicar", "Acompanhar o desempenho"] },
  ],
  "Tráfego pago": [
    { titulo: "Configuração", itens: ["Definir objetivo e público", "Verificar a conformidade com o CFM"] },
    { titulo: "Campanha", itens: ["Montar o plano de mídia", "Organizar os criativos", "Configurar a segmentação"] },
    { titulo: "Gestão", itens: ["Subir a campanha", "Configurar as métricas", "Otimizar"] },
  ],
};

/**
 * Garante o catálogo canônico da Med.
 *
 * Antes isto era tudo-ou-nada (`if (count === 0)`): bastava **um** serviço existir — uma fixture
 * de teste, ou alguém cadastrando um serviço à mão num banco novo — para os 10 serviços reais
 * NUNCA serem criados. Num banco de produção recém-nascido isso é perda permanente do catálogo.
 *
 * Agora falta a falta: semeia **por nome**, só o que ainda não existe. Nunca sobrescreve o que a
 * equipe editou e nunca recria o que foi removido de propósito... — exceto que remover um serviço
 * é `ativo: false` (soft), então o nome continua ocupado e ele não volta.
 */
async function seedIfEmpty() {
  const existentes = new Set((await prisma.servico.findMany({ select: { nome: true } })).map((s) => s.nome));
  const faltando = CONTEUDO_SERVICOS.filter((s) => !existentes.has(s.nome));
  if (faltando.length > 0) {
    await prisma.servico.createMany({
      data: faltando.map((s) => ({
        nome: s.nome,
        categoria: s.categoria,
        valor: s.valor,
        valorRecorrencia: s.valorRecorrencia ?? "AVULSO",
        percentual: s.percentual ?? null,
        percentualRecorrencia: s.percentualRecorrencia ?? "MENSAL",
        descricao: s.descricao,
        roteiro: ROTEIROS_SERVICO[s.nome] ?? undefined,
        clausulasContrato: CLAUSULAS_SERVICOS[s.nome] ?? null,
        // Mantém a ordem canônica do catálogo, independente do que já houvesse no banco.
        ordem: CONTEUDO_SERVICOS.findIndex((c) => c.nome === s.nome),
      })),
    });
  }

  // Backfill idempotente das cláusulas de contrato: preenche só onde ainda está NULL
  // (não sobrescreve o que a equipe editou). Roda barato (guardado por um count).
  if ((await prisma.servico.count({ where: { clausulasContrato: null } })) > 0) {
    for (const [nome, clausula] of Object.entries(CLAUSULAS_SERVICOS)) {
      await prisma.servico.updateMany({ where: { nome, clausulasContrato: null }, data: { clausulasContrato: clausula } });
    }
  }
  // Passos padrão, casando pelo nome do serviço. Também POR SERVIÇO, não tudo-ou-nada: com o
  // guard global (`servicoPasso.count() === 0`), um único passo criado em qualquer serviço
  // impedia todos os outros de receberem os seus.
  const semPassos = await prisma.servico.findMany({
    where: { passos: { none: {} } },
    select: { id: true, nome: true },
  });
  for (const s of semPassos) {
    const def = CONTEUDO_SERVICOS.find((c) => c.nome === s.nome)?.passos;
    if (def?.length) {
      await prisma.servicoPasso.createMany({
        data: def.map((d, i) => ({ servicoId: s.id, titulo: d.titulo, obrigatorio: d.obrigatorio, etapaChave: d.etapaChave, ordem: i })),
      });
    }
  }
}

/**
 * Dinheiro do catálogo sai do banco em `Decimal` e chega à tela em `number` (ADR-118).
 * Todo caminho que devolve um `Servico` passa por aqui — se um novo esquecer, o `valor`
 * chega ao navegador como objeto e o `formatBRL` mostra "R$ NaN".
 */
const mapServico = <
  T extends { valor: Prisma.Decimal | number | null; percentual: Prisma.Decimal | number | null },
>(
  s: T,
) => ({
  ...s,
  valor: emReais(s.valor),
  percentual: emReais(s.percentual),
});

/** Todos os serviços (gestão) — inclui inativos + contagens de exigências e passos. */
export async function listServicos() {
  await seedIfEmpty();
  const servicos = await prisma.servico.findMany({
    orderBy: [{ ativo: "desc" }, { ordem: "asc" }],
    include: { _count: { select: { requisitos: true, passos: true } } },
  });
  return servicos.map(mapServico);
}

/** Serviços ativos para o formulário público / cadastro (sem dados sensíveis). */
export async function listServicosAtivos() {
  await seedIfEmpty();
  const servicos = await prisma.servico.findMany({
    where: { ativo: true },
    orderBy: { ordem: "asc" },
    select: {
      id: true,
      nome: true,
      descricao: true,
      categoria: true,
      valor: true,
      valorRecorrencia: true,
      percentual: true,
      percentualRecorrencia: true,
    },
  });
  return servicos.map(mapServico);
}

export async function criarServico(input: {
  nome: string;
  descricao?: string | null;
  categoria?: string | null;
  valor?: number | null;
  valorRecorrencia?: "AVULSO" | "MENSAL";
  percentual?: number | null;
  percentualRecorrencia?: "AVULSO" | "MENSAL";
}) {
  const max = await prisma.servico.aggregate({ _max: { ordem: true } });
  return mapServico(
    await prisma.servico.create({
      data: {
        nome: input.nome.trim(),
        descricao: input.descricao?.trim() || null,
        categoria: input.categoria?.trim() || null,
        valor: input.valor ?? null,
        valorRecorrencia: input.valorRecorrencia ?? "AVULSO",
        percentual: input.percentual ?? null,
        percentualRecorrencia: input.percentualRecorrencia ?? "MENSAL",
        ordem: (max._max.ordem ?? -1) + 1,
      },
    }),
  );
}

export async function atualizarServico(
  id: string,
  dados: {
    nome?: string;
    descricao?: string | null;
    categoria?: string | null;
    valor?: number | null;
    valorRecorrencia?: "AVULSO" | "MENSAL";
    percentual?: number | null;
    percentualRecorrencia?: "AVULSO" | "MENSAL";
    clausulasContrato?: string | null;
    ativo?: boolean;
  },
) {
  const data: Record<string, unknown> = {};
  if (dados.nome !== undefined) data.nome = dados.nome.trim();
  if (dados.descricao !== undefined) data.descricao = dados.descricao?.trim() || null;
  if (dados.categoria !== undefined) data.categoria = dados.categoria?.trim() || null;
  if (dados.valor !== undefined) data.valor = dados.valor ?? null;
  if (dados.valorRecorrencia !== undefined) data.valorRecorrencia = dados.valorRecorrencia;
  if (dados.percentual !== undefined) data.percentual = dados.percentual ?? null;
  if (dados.percentualRecorrencia !== undefined) data.percentualRecorrencia = dados.percentualRecorrencia;
  if (dados.clausulasContrato !== undefined) data.clausulasContrato = dados.clausulasContrato?.trim() || null;
  if (dados.ativo !== undefined) data.ativo = dados.ativo;
  try {
    return mapServico(await prisma.servico.update({ where: { id }, data }));
  } catch {
    throw new TRPCError({ code: "NOT_FOUND", message: "Serviço não encontrado." });
  }
}

/** Salva o roteiro do projeto de um serviço (tarefas + checklist de cada) — ADR-37. */
export async function setRoteiro(servicoId: string, roteiro: { titulo: string; itens: string[] }[]) {
  await prisma.servico.update({ where: { id: servicoId }, data: { roteiro } }).catch(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Serviço não encontrado." });
  });
  return { ok: true };
}

export async function removerServico(id: string) {
  // Remoção física; a relação N–N com leads e os passos são removidos em cascata.
  await prisma.servico.delete({ where: { id } }).catch(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Serviço não encontrado." });
  });
  return { ok: true };
}

/** Reordena o catálogo de serviços: grava `ordem` = posição de cada id. */
export async function reordenarServicos(ids: string[]) {
  await prisma.$transaction(ids.map((id, ordem) => prisma.servico.update({ where: { id }, data: { ordem } })));
  return { ok: true };
}

// ── Passos padrão de um serviço (por etapa) ──────────────
export async function listPassosDoServico(servicoId: string) {
  await seedIfEmpty();
  return prisma.servicoPasso.findMany({ where: { servicoId }, orderBy: [{ etapaChave: "asc" }, { ordem: "asc" }] });
}

export async function addServicoPasso(servicoId: string, titulo: string, etapaChave: string, obrigatorio: boolean) {
  const max = await prisma.servicoPasso.aggregate({ where: { servicoId, etapaChave }, _max: { ordem: true } });
  return prisma.servicoPasso.create({
    data: { servicoId, titulo: titulo.trim(), etapaChave, obrigatorio, ordem: (max._max.ordem ?? -1) + 1 },
  });
}

export async function atualizarServicoPasso(id: string, dados: { titulo?: string; obrigatorio?: boolean; etapaChave?: string }) {
  const data: Record<string, unknown> = {};
  if (dados.titulo !== undefined) data.titulo = dados.titulo.trim();
  if (dados.obrigatorio !== undefined) data.obrigatorio = dados.obrigatorio;
  if (dados.etapaChave !== undefined) data.etapaChave = dados.etapaChave;
  return prisma.servicoPasso.update({ where: { id }, data }).catch(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Passo não encontrado." });
  });
}

export async function removerServicoPasso(id: string) {
  await prisma.servicoPasso.deleteMany({ where: { id } });
  return { ok: true };
}

/** Reordena os passos (ids na nova ordem — usado por etapa). Grava `ordem` = posição. */
export async function reordenarServicoPassos(ids: string[]) {
  await prisma.$transaction(ids.map((id, ordem) => prisma.servicoPasso.update({ where: { id }, data: { ordem } })));
  return { ok: true };
}

// ── Exigências (requisitos) de um serviço ────────────────

/**
 * Semeia as exigências (documentos + informações) de cada serviço, a partir do
 * conteúdo canônico (`CONTEUDO_SERVICOS`). Ponto de partida editável — a Thaís
 * aceita/ajusta. Semeadas uma única vez. As exigências do tipo BRIEFING (formulário
 * do catálogo) são adicionadas à parte, junto com os formulários (`formularios.service`).
 */
export async function seedRequisitosSeVazio() {
  if ((await prisma.servicoRequisito.count()) > 0) return;
  const servicos = await prisma.servico.findMany({ select: { id: true, nome: true } });
  for (const s of servicos) {
    const itens = CONTEUDO_SERVICOS.find((c) => c.nome === s.nome)?.requisitos;
    if (!itens?.length) continue;
    let ordem = 0;
    for (const it of itens) {
      // INFORMACAO = formulário interno de pergunta única (reaproveita o fluxo de briefing).
      let formularioId: string | null = null;
      if (it.tipo === "INFORMACAO") {
        const form = await prisma.formulario.create({
          data: {
            titulo: it.titulo,
            descricao: it.descricao ?? null,
            interno: true,
            campos: { create: { rotulo: it.titulo, tipo: "TEXTO_LONGO", obrigatorio: it.obrigatorio, ordem: 0 } },
          },
        });
        formularioId = form.id;
      }
      await prisma.servicoRequisito.create({
        data: {
          servicoId: s.id,
          titulo: it.titulo,
          descricao: it.descricao ?? null,
          tipo: it.tipo,
          obrigatorio: it.obrigatorio,
          formularioId,
          ordem: ordem++,
        },
      });
    }
  }
}

export async function listRequisitos(servicoId: string) {
  await seedRequisitosSeVazio();
  return prisma.servicoRequisito.findMany({ where: { servicoId }, orderBy: { ordem: "asc" } });
}

export async function addRequisito(input: {
  servicoId: string;
  titulo: string;
  descricao?: string | null;
  tipo: "DOCUMENTO" | "INFORMACAO" | "BRIEFING";
  obrigatorio: boolean;
  formularioId?: string | null;
}) {
  const max = await prisma.servicoRequisito.aggregate({ where: { servicoId: input.servicoId }, _max: { ordem: true } });
  const titulo = input.titulo.trim();

  let formularioId: string | null = null;
  if (input.tipo === "BRIEFING") {
    formularioId = input.formularioId || null;
  } else if (input.tipo === "INFORMACAO") {
    // Uma "informação escrita" é um formulário INTERNO de pergunta única (texto), gerido
    // junto com o requisito — reaproveita todo o fluxo de preenchimento/visualização.
    const form = await prisma.formulario.create({
      data: {
        titulo,
        descricao: input.descricao?.trim() || null,
        interno: true,
        campos: { create: { rotulo: titulo, tipo: "TEXTO_LONGO", obrigatorio: input.obrigatorio, ordem: 0 } },
      },
    });
    formularioId = form.id;
  }

  return prisma.servicoRequisito.create({
    data: {
      servicoId: input.servicoId,
      titulo,
      descricao: input.descricao?.trim() || null,
      tipo: input.tipo,
      obrigatorio: input.obrigatorio,
      formularioId,
      ordem: (max._max.ordem ?? -1) + 1,
    },
  });
}

export async function atualizarRequisito(
  id: string,
  dados: { titulo?: string; descricao?: string | null; tipo?: "DOCUMENTO" | "INFORMACAO" | "BRIEFING"; obrigatorio?: boolean; formularioId?: string | null },
) {
  const data: Record<string, unknown> = {};
  if (dados.titulo !== undefined) data.titulo = dados.titulo.trim();
  if (dados.descricao !== undefined) data.descricao = dados.descricao?.trim() || null;
  if (dados.tipo !== undefined) data.tipo = dados.tipo;
  if (dados.obrigatorio !== undefined) data.obrigatorio = dados.obrigatorio;
  if (dados.formularioId !== undefined) data.formularioId = dados.formularioId || null;
  return prisma.servicoRequisito.update({ where: { id }, data }).catch(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Exigência não encontrada." });
  });
}

export async function removerRequisito(id: string) {
  // Se for uma "informação" (formulário interno), remove o formulário auto-gerado junto.
  const req = await prisma.servicoRequisito.findUnique({
    where: { id },
    select: { formularioId: true, formulario: { select: { interno: true } } },
  });
  await prisma.servicoRequisito.deleteMany({ where: { id } });
  if (req?.formularioId && req.formulario?.interno) {
    await prisma.formulario.delete({ where: { id: req.formularioId } }).catch(() => {});
  }
  return { ok: true };
}

/** Reordena as exigências de um serviço (ids na nova ordem). Grava `ordem` = posição. */
export async function reordenarRequisitos(ids: string[]) {
  await prisma.$transaction(ids.map((id, ordem) => prisma.servicoRequisito.update({ where: { id }, data: { ordem } })));
  return { ok: true };
}
