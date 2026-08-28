import { z } from "zod";
import { router, funcionarioProcedure, adminProcedure, publicProcedure } from "../../trpc/trpc.js";
import { getIdentidade, atualizarIdentidade, getPrivacidadePublica } from "./identidade.service.js";

const texto = z.string().trim().max(300);
const juridico = z.string().trim().max(500).nullish();

/** Identidade institucional (Ajustes → Dados da empresa). Equipe consulta; administrar é ADMIN+. */
export const identidadeRouter = router({
  get: funcionarioProcedure.query(() => getIdentidade()),
  // Página pública /privacidade (ADR-141). NÃO devolve dado bancário — ver o serviço.
  privacidade: publicProcedure.query(() => getPrivacidadePublica()),
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
        // DADOS PARA PAGAMENTO. Nulável como os jurídicos: enquanto em branco, o bloco some do
        // papel em vez de sair pela metade na frente do cliente.
        bancoNome: juridico,
        bancoAgencia: juridico,
        bancoConta: juridico,
        bancoTitular: juridico,
        pixChave: juridico,
        // Prazo do painel de credenciamentos. O teto de 365 evita desligar o alerta sem
        // querer digitando um número grande — para desligar de verdade, existe o filtro.
        credenciamentoPrazoDias: z.number().int().min(1).max(365),
        // LGPD (ADR-141). Mínimo de 30 dias no e-mail: abaixo disso o monitor de entrega
        // perde a janela de 7 dias que a equipe usa para diagnosticar. Teto de 10 anos no
        // acervo, que é o limite de guarda fiscal com folga.
        retencaoCorpoEmailDias: z.number().int().min(30).max(3650),
        retencaoAcervoAnos: z.number().int().min(1).max(10),
        encarregadoNome: juridico,
        encarregadoEmail: juridico,
      }),
    )
    .mutation(({ input }) =>
      atualizarIdentidade({
        ...input,
        razaoSocial: input.razaoSocial ?? null,
        cnpj: input.cnpj ?? null,
        enderecoCompleto: input.enderecoCompleto ?? null,
        foro: input.foro ?? null,
        bancoNome: input.bancoNome ?? null,
        bancoAgencia: input.bancoAgencia ?? null,
        bancoConta: input.bancoConta ?? null,
        bancoTitular: input.bancoTitular ?? null,
        pixChave: input.pixChave ?? null,
        encarregadoNome: input.encarregadoNome ?? null,
        encarregadoEmail: input.encarregadoEmail ?? null,
      }),
    ),
});
