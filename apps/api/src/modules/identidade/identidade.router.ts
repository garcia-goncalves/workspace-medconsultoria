import { z } from "zod";
import { router, funcionarioProcedure, adminProcedure } from "../../trpc/trpc.js";
import { getIdentidade, atualizarIdentidade } from "./identidade.service.js";

const texto = z.string().trim().max(300);
const juridico = z.string().trim().max(500).nullish();

/** Identidade institucional (Ajustes → Dados da empresa). Equipe consulta; administrar é ADMIN+. */
export const identidadeRouter = router({
  get: funcionarioProcedure.query(() => getIdentidade()),
  atualizar: adminProcedure
    .input(
      z.object({
        nome: texto.min(1, "O nome é obrigatório."),
        tagline: texto,
        site: texto,
        siteUrl: texto,
        email: texto,
        telefone: texto,
        cidade: texto,
        instagram: texto,
        instagramUrl: texto,
        razaoSocial: juridico,
        cnpj: juridico,
        enderecoCompleto: juridico,
        foro: juridico,
      }),
    )
    .mutation(({ input }) =>
      atualizarIdentidade({
        ...input,
        razaoSocial: input.razaoSocial ?? null,
        cnpj: input.cnpj ?? null,
        enderecoCompleto: input.enderecoCompleto ?? null,
        foro: input.foro ?? null,
      }),
    ),
});
