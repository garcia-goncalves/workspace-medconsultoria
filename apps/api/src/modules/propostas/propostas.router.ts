import { z } from "zod";
import { responderPropostaSchema } from "@app/shared";
import { router, aceiteProcedure, funcionarioProcedure, publicProcedure } from "../../trpc/trpc.js";
import * as service from "./propostas.service.js";

export const propostasRouter = router({
  // Interno (equipe): habilita o aceite e acompanha o estado da proposta.
  habilitar: funcionarioProcedure
    .input(z.object({ documentoId: z.string(), avisarPorEmail: z.boolean().optional() }))
    .mutation(({ input, ctx }) =>
      service.habilitarAceite(input.documentoId, { id: ctx.user.id, nome: ctx.user.nome }, input.avisarPorEmail ?? true),
    ),
  doDocumento: funcionarioProcedure
    .input(z.object({ documentoId: z.string() }))
    .query(({ input }) => service.statusDoDocumento(input.documentoId)),

  // Público (por token, sem login) — página de aceite/recusa da proposta.
  porToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(({ input }) => service.getPorToken(input.token)),
  // Público por token, MAS com as travas do Portal valendo quando há sessão (ver `aceiteProcedure`):
  // a secretária EQUIPE e a sessão de suporte da Med não aceitam proposta pela clínica.
  responder: aceiteProcedure
    .input(responderPropostaSchema)
    .mutation(({ input, ctx }) => service.responder(input, ctx.req.ip, ctx.user?.id ?? null)),
});
