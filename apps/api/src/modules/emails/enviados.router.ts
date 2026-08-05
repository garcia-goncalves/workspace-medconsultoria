import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../../trpc/trpc.js";
import * as service from "./enviados.service.js";

/** Histórico de e-mails por destinatário + monitor global (ROOT/ADMIN). */
export const emailsEnviadosRouter = router({
  // Os meus (qualquer usuário logado vê os e-mails que recebeu — em Configurações).
  meus: protectedProcedure.query(({ ctx }) => service.listMeus(ctx.user.id, ctx.user.email)),

  // `doLead`/`doCliente` saíram no ADR-97: a ficha passou a ler `email.conversaDoCliente`, que
  // junta este log ao que a equipe trocou pela própria caixa. `listPorLead`/`listPorCliente`
  // continuam vivos — chamados de lá e do Portal.

  // ── Monitor global (só ADMIN/ROOT): indicadores + lista completa filtrável ──
  resumo: adminProcedure.query(() => service.resumoEnviados()),
  todos: adminProcedure
    .input(
      z.object({
        status: z.enum(["ENVIADO", "FALHOU"]).optional(),
        template: z.string().optional(),
        busca: z.string().optional(),
        dias: z.number().int().optional(),
        limite: z.number().int().min(1).max(500).optional(),
      }),
    )
    .query(({ input }) => service.listTodos(input)),
});
