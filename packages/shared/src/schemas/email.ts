import { z } from "zod";

/**
 * Domínio das caixas que a Fase 1 aceita. Isto NÃO é só regra de produto — é contenção:
 * o servidor IMAP é deduzido do domínio digitado (`mail.<domínio>`), então sem esta trava
 * alguém apontaria `mail.dominio-que-eu-controlo.com` para um IP da rede interna e usaria a
 * app como sonda de porta. Gmail/Outlook ficam de fora porque exigem OAuth próprio, não senha.
 */
export const DOMINIO_EMAIL_PERMITIDO = "medconsultoria.com.br";

export const emailDaEmpresa = z
  .string()
  .email("Informe um e-mail válido")
  .refine((e) => e.trim().toLowerCase().endsWith(`@${DOMINIO_EMAIL_PERMITIDO}`), {
    message: `Nesta fase só dá para plugar caixas @${DOMINIO_EMAIL_PERMITIDO}. Gmail e Outlook exigem um login próprio deles.`,
  });

/** Plugar uma caixa. O MESMO schema valida o formulário no front e a procedure no back. */
export const plugarCaixaSchema = z.object({
  email: emailDaEmpresa,
  senha: z.string().min(1, "Informe a senha da caixa"),
  nomeExibicao: z.string().min(1, "Informe o nome que aparece para quem recebe"),
  rotulo: z.string().optional(),
  importarMeses: z.coerce.number().int().min(1).max(60).default(3),
});
export type PlugarCaixaInput = z.infer<typeof plugarCaixaSchema>;
