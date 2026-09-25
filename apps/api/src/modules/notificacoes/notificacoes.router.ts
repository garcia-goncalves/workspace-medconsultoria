import { z } from "zod";
import { router, protectedProcedure } from "../../trpc/trpc.js";
import * as service from "./notificacoes.service.js";

export const notificacoesRouter = router({
  list: protectedProcedure.query(({ ctx }) => service.listNotificacoes(ctx.user.id)),
  /** "Ver mais antigos" e filtro "não lidas" do sininho — o `list` acima continua sendo o padrão. */
  historico: protectedProcedure
    .input(
      z.object({
        antesDe: z.object({ createdAt: z.date(), id: z.string().min(1).max(64) }).optional(),
        apenasNaoLidas: z.boolean().default(false),
      }),
    )
    .query(({ ctx, input }) => service.historicoNotificacoes(ctx.user.id, input)),
  markAllRead: protectedProcedure.mutation(({ ctx }) => service.markAllRead(ctx.user.id)),
  markRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => service.markRead(ctx.user.id, input.id)),

  /** Preferências de e-mail do usuário (categorias com estado ligado/desligado). */
  preferenciasEmail: protectedProcedure.query(({ ctx }) =>
    service.listarPreferenciasEmail(ctx.user.id, ctx.user.role),
  ),
  setPreferenciaEmail: protectedProcedure
    .input(z.object({ tipo: z.string().min(1), ativo: z.boolean() }))
    .mutation(({ ctx, input }) => service.setPreferenciaEmail(ctx.user.id, input.tipo, input.ativo)),
});
