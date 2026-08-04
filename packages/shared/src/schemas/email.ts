import { z } from "zod";

/** Plugar uma caixa. O MESMO schema valida o formulário no front e a procedure no back. */
export const plugarCaixaSchema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  senha: z.string().min(1, "Informe a senha da caixa"),
  nomeExibicao: z.string().min(1, "Informe o nome que aparece para quem recebe"),
  rotulo: z.string().optional(),
  importarMeses: z.coerce.number().int().min(1).max(60).default(3),
});
export type PlugarCaixaInput = z.infer<typeof plugarCaixaSchema>;
