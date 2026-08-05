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

/**
 * Endereços para os quais é permitido enviar de verdade fora de produção. Existe porque o envio
 * da Fase 2A usa o SMTP REAL da caixa da pessoa: sem esta trava, um teste de desenvolvimento
 * manda e-mail de verdade para um cliente de verdade.
 */
export const DESTINOS_TESTE_PERMITIDOS = [
  "tibamooca@gmail.com",
  "contato@medconsultoria.com.br",
] as const;

/** Teto do servidor de e-mail (SMTP anuncia RCPTMAX=200). */
export const MAX_DESTINATARIOS = 200;

const listaDeEmails = z
  .array(z.string().email("Endereço de e-mail inválido"))
  .max(MAX_DESTINATARIOS, `São no máximo ${MAX_DESTINATARIOS} destinatários por e-mail.`)
  .default([]);

export const enviarEmailSchema = z
  .object({
    caixaId: z.string().min(1),
    para: listaDeEmails,
    cc: listaDeEmails,
    cco: listaDeEmails,
    assunto: z.string().max(500).default(""),
    corpoHtml: z.string().max(500_000, "O texto do e-mail ficou grande demais.").default(""),
    /** Mensagem sendo respondida ou encaminhada — define os cabeçalhos de conversa. */
    emRespostaA: z.string().optional(),
    encaminhando: z.string().optional(),
    /** Anexos já enviados pela rota multipart: `id` do temporário + nome original do arquivo. */
    anexos: z
      .array(z.object({ id: z.string().uuid(), nome: z.string().min(1).max(255) }))
      .max(20)
      .default([]),
    /**
     * Anexos do e-mail ORIGINAL que vão junto no encaminhamento: só os ids de `EmailAnexo`
     * devolvidos por `prepararEncaminhamento`. Ficam separados de `anexos` porque não são
     * arquivo no nosso disco — o servidor os rebaixa do IMAP na hora de enviar. O nome NÃO vem
     * do cliente de propósito: sai do banco, junto com a parte MIME.
     */
    anexosOriginais: z.array(z.string().min(1).max(64)).max(20).default([]),
  })
  .refine((v) => v.para.length + v.cc.length + v.cco.length > 0, {
    message: "Informe pelo menos um destinatário.",
    path: ["para"],
  })
  .refine((v) => v.para.length + v.cc.length + v.cco.length <= MAX_DESTINATARIOS, {
    message: `São no máximo ${MAX_DESTINATARIOS} destinatários por e-mail.`,
    path: ["para"],
  });
export type EnviarEmailInput = z.infer<typeof enviarEmailSchema>;
