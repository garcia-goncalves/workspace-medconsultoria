import { z } from "zod";
import { assinarSchema } from "@app/shared";
import { router, aceiteProcedure, funcionarioProcedure, publicProcedure } from "../../trpc/trpc.js";
import * as service from "./assinaturas.service.js";

export const assinaturasRouter = router({
  // Interno (equipe): solicita e acompanha as assinaturas do documento.
  solicitar: funcionarioProcedure
    .input(z.object({ documentoId: z.string(), avisarPorEmail: z.boolean().optional() }))
    .mutation(({ input, ctx }) =>
      service.solicitar(
        input.documentoId,
        { id: ctx.user.id, nome: ctx.user.nome, email: ctx.user.email },
        input.avisarPorEmail ?? true,
      ),
    ),
  doDocumento: funcionarioProcedure
    .input(z.object({ documentoId: z.string() }))
    .query(({ input }) => service.listarDoDocumento(input.documentoId)),

  // Público (por token, sem login) — página de assinatura.
  porToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(({ input }) => service.getPorToken(input.token)),
  // Público por token, MAS com as travas do Portal valendo quando há sessão (ver `aceiteProcedure`):
  // a secretária EQUIPE e a sessão de suporte da Med não assinam pela clínica.
  assinar: aceiteProcedure.input(assinarSchema).mutation(({ input, ctx }) =>
    service.assinar(input, ctx.req.ip, ctx.req.headers["user-agent"], ctx.user?.id ?? null),
  ),
});
