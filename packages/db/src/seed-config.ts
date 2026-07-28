/**
 * CONFIGURAÇÃO ESSENCIAL — estrutura mínima para a aplicação ser utilizável.
 *
 * Difere dos dados de EXEMPLO (`demo-seed.ts`): isto entra em QUALQUER banco, inclusive
 * produção, porque sem as etapas do funil a página Vendas nasce sem colunas.
 */
export const STAGE_DEFAULTS = [
  { nome: "Novo", ordem: 0, cor: "#2DA8E1" },
  { nome: "Qualificação", ordem: 1, cor: "#003591" },
  { nome: "Proposta", ordem: 2, cor: "#30AD73" },
  { nome: "Negociação", ordem: 3, cor: "#F59E0B" },
  { nome: "Fechado", ordem: 4, cor: "#30AD73" },
];

/**
 * CONTAS REAIS DA EQUIPE — pessoas de verdade da MedConsultoria, não dados de exemplo.
 *
 * Diferente dos usuários fictícios do `demo-seed` ("Funcionário Exemplo"): estas contas
 * são as documentadas em `docs/ACESSOS.md` e precisam **sobreviver à limpeza de dados**.
 * A senha vem do ambiente (`SEED_ROOT_PASSWORD`) — nunca fica no repositório.
 *
 * O seed só CRIA quem não existe: nunca sobrescreve a senha de uma conta já em uso.
 */
export const EQUIPE_REAL = [
  { chaveEmail: "SEED_ROOT_EMAIL", emailPadrao: "root@medconsultoria.com.br", nome: "Root", role: "ROOT" as const },
  // Roots nominais (Thiago e André). Senha inicial = SEED_ROOT_PASSWORD; eles trocam no 1º login.
  // O seed só CRIA quem falta — nunca sobrescreve a senha de quem já entrou.
  { chaveEmail: "SEED_ROOT2_EMAIL", emailPadrao: "thiago.garcia@medconsultoria.com.br", nome: "Thiago Garcia", role: "ROOT" as const },
  { chaveEmail: "SEED_ROOT3_EMAIL", emailPadrao: "andre.cintra@medconsultoria.com.br", nome: "André Cintra", role: "ROOT" as const },
  {
    chaveEmail: "SEED_ADMIN_EMAIL",
    emailPadrao: "thais.garcia@medconsultoria.com.br",
    nome: "Thaís Garcia",
    role: "ADMIN" as const,
  },
];
