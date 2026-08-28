import type { EmailTemplateChave } from "./emails.registry.js";

/**
 * Qual texto de boas-vindas cabe a quem acabou de ativar o acesso.
 *
 * Existe porque `aceitarConvite` mandava o mesmo e-mail para todo mundo, e o cliente do Portal
 * também é `User`: o médico recebia "Bem-vindo ao Workspace MedConsultoria", com um botão para o
 * sistema interno da Med.
 *
 * ⚠️ **O padrão é o do CLIENTE, não o da equipe.** Papel novo, ou nulo de conta antiga, cai no
 * texto neutro do Portal — errar para esse lado tira do colega um link que ele já tem na tela;
 * errar para o outro manda o endereço do sistema interno para fora da empresa. É a mesma lógica
 * de padrão seguro das listas da ADR-131 e da ADR-132, com o "seguro" apontando para cá.
 */
const PAPEIS_DA_CASA = new Set(["ROOT", "ADMIN", "FUNCIONARIO"]);

export function templateDeBoasVindas(papel: string | null | undefined): EmailTemplateChave {
  return papel && PAPEIS_DA_CASA.has(papel) ? "boas_vindas" : "boas_vindas_portal";
}
