import { z } from "zod";
import { plugarCaixaSchema } from "@app/shared";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import * as caixas from "./caixas.service.js";
import * as pastas from "./pastas.service.js";
import * as sync from "./sync.service.js";
import * as leitura from "./leitura.service.js";

/**
 * E-mail dentro da aplicação. TODO procedure é `funcionarioProcedure` (equipe; o Portal do
 * Cliente não entra) e TODA consulta filtra pelo dono da caixa: ninguém vê caixa de ninguém.
 */
export const emailRouter = router({
  caixas: funcionarioProcedure.query(({ ctx }) => caixas.listarCaixas(ctx.user.id)),

  plugarCaixa: funcionarioProcedure
    .input(plugarCaixaSchema)
    .mutation(({ ctx, input }) => caixas.plugarCaixa(ctx.user.id, input)),

  reconectarCaixa: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1), senha: z.string().min(1) }))
    .mutation(({ ctx, input }) => caixas.reconectarCaixa(ctx.user.id, input.caixaId, input.senha)),

  removerCaixa: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1) }))
    .mutation(({ ctx, input }) => caixas.removerCaixa(ctx.user.id, input.caixaId)),

  pastas: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1) }))
    .query(({ ctx, input }) => pastas.listarPastas(ctx.user.id, input.caixaId)),

  /** Chamado ao abrir a página e pelo polling. Devolve o que mudou para o front decidir avisar. */
  sincronizar: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1), pastaId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // A checagem de posse acontece aqui, antes de tocar no IMAP: `listarPastas` estoura
      // NOT_FOUND se a caixa não for desta pessoa.
      await pastas.listarPastas(ctx.user.id, input.caixaId);
      await sync.sincronizarPasta(input.caixaId, input.pastaId);
      return { ok: true };
    }),

  mensagens: funcionarioProcedure
    .input(
      z.object({
        pastaId: z.string().min(1),
        busca: z.string().optional(),
        limite: z.number().int().min(1).max(200).optional(),
        antesDe: z.date().optional(),
      }),
    )
    .query(({ ctx, input }) => leitura.listarMensagens(ctx.user.id, input)),

  abrir: funcionarioProcedure
    .input(z.object({ mensagemId: z.string().min(1) }))
    .query(({ ctx, input }) => leitura.abrirMensagem(ctx.user.id, input.mensagemId)),
});
