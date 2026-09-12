import { z } from "zod";

/**
 * Caracteres INVISÍVEIS que vêm colados quando se copia texto de documento, PDF, planilha,
 * e-mail ou página web: espaço de largura zero (U+200B/C/D), BOM (U+FEFF), marcas de direção
 * (U+200E/F) e espaço rígido (U+00A0).
 *
 * Não aparecem na tela — a pessoa vê `root@medconsultoria.com.br`, digita/cola isso, e o
 * validador recusa com "E-mail inválido" sem nenhuma pista do porquê. Foi exatamente o que
 * impediu o dono de entrar: o e-mail chegava com U+200B nas duas pontas.
 */
// Montada a partir de string com escapes de propósito: escrever os caracteres literalmente
// deixa a linha ilegível, quebra o lint (no-irregular-whitespace) e qualquer editor pode
// "limpá-los" sem querer.
const INVISIVEIS = new RegExp("[\\u200B-\\u200F\\uFEFF\\u00A0]", "g");

/** Limpa invisíveis e normaliza — use em TODO campo que a pessoa possa colar. */
export const textoColavel = () => z.string().transform((s) => s.replace(INVISIVEIS, "").trim());

/** E-mail tolerante a cópia/cola: limpa invisíveis ANTES de validar o formato. */
export const emailColavel = (mensagem = "E-mail inválido") =>
  textoColavel()
    .transform((s) => s.toLowerCase())
    .pipe(z.string().email(mensagem));

/** Login por e-mail + senha. Reusado no form do front e no input da procedure. */
export const loginSchema = z.object({
  email: emailColavel(),
  // A senha também: colar de um gerenciador costuma trazer espaço rígido ou BOM na ponta.
  // ⚠️ O `.max` é freio, não regra de produto: sem ele cada tentativa de login carrega texto
  // arbitrário até o limite do corpo da requisição, e o servidor paga a conferência argon2 em
  // cima. 200 é folga larga para qualquer senha real.
  password: z
    .string()
    .transform((s) => s.replace(INVISIVEIS, ""))
    .pipe(z.string().min(1, "Informe a senha").max(200, "Senha longa demais")),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Regra única de força de senha — reusada em perfil e gestão de usuários. */
export const senhaForte = z
  .string()
  .min(8, "A senha deve ter ao menos 8 caracteres")
  .max(200, "Senha muito longa");

/** Edição do próprio perfil (o e-mail não é editável por aqui). */
export const updateProfileSchema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome"),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Troca da própria senha: confirma a atual e valida a nova. */
export const changePasswordSchema = z
  .object({
    senhaAtual: z.string().min(1, "Informe a senha atual"),
    novaSenha: senhaForte,
    confirmar: z.string().min(1, "Confirme a nova senha"),
  })
  .refine((d) => d.novaSenha === d.confirmar, {
    message: "A confirmação não confere",
    path: ["confirmar"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Aceite de convite: a pessoa define a própria senha a partir do token do link. */
export const aceitarConviteSchema = z
  .object({
    token: z.string().min(1),
    novaSenha: senhaForte,
    confirmar: z.string().min(1, "Confirme a senha"),
  })
  .refine((d) => d.novaSenha === d.confirmar, {
    message: "A confirmação não confere",
    path: ["confirmar"],
  });
export type AceitarConviteInput = z.infer<typeof aceitarConviteSchema>;

/** Solicitação de redefinição de senha (informa o e-mail). */
export const solicitarResetSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido"),
});
export type SolicitarResetInput = z.infer<typeof solicitarResetSchema>;

/** Redefinição de senha via token do link. */
export const redefinirSenhaSchema = z
  .object({
    token: z.string().min(1),
    novaSenha: senhaForte,
    confirmar: z.string().min(1, "Confirme a senha"),
  })
  .refine((d) => d.novaSenha === d.confirmar, {
    message: "A confirmação não confere",
    path: ["confirmar"],
  });
export type RedefinirSenhaInput = z.infer<typeof redefinirSenhaSchema>;
