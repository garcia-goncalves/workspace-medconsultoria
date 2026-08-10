import { z } from "zod";
import {
  createProfissionalSchema,
  mudarStatusCredenciamentoSchema,
  novaTentativaCredenciamentoSchema,
  salvarGradeSchema,
  updateProfissionalSchema,
} from "@app/shared";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import * as service from "./credenciamento.service.js";
import * as grade from "./credenciamento-grade.service.js";

/**
 * Credenciamento visto pela EQUIPE: os profissionais do cliente, a triagem de
 * elegibilidade e o estado da papelada. O recorte que o CLIENTE vê fica no
 * `portalRouter` (`credenciamento`), sem o veredito comercial.
 */
export const credenciamentoRouter = router({
  porCliente: funcionarioProcedure
    .input(z.object({ clienteId: z.string().min(1) }))
    .query(({ input }) => service.credenciamentoDoCliente(input.clienteId)),

  profissionais: funcionarioProcedure
    .input(z.object({ clienteId: z.string().min(1) }))
    .query(({ input }) => service.listProfissionais(input.clienteId)),

  criarProfissional: funcionarioProcedure
    .input(createProfissionalSchema)
    .mutation(({ input }) => service.criarProfissional(input)),

  atualizarProfissional: funcionarioProcedure
    .input(updateProfissionalSchema)
    .mutation(({ input }) => service.atualizarProfissional(input)),

  removerProfissional: funcionarioProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => service.removerProfissional(input.id)),

  // ── A grade médico × operadora (Bloco B) ───────────────────────────────────

  grade: funcionarioProcedure
    .input(z.object({ clienteId: z.string().min(1) }))
    .query(({ input }) => grade.gradeDoCliente(input.clienteId)),

  salvarGrade: funcionarioProcedure
    .input(salvarGradeSchema)
    .mutation(({ input, ctx }) => grade.salvarGrade(input, { id: ctx.user.id })),

  mudarStatus: funcionarioProcedure
    .input(mudarStatusCredenciamentoSchema)
    .mutation(({ input, ctx }) => grade.mudarStatusCredenciamento(input, { id: ctx.user.id })),

  novaTentativa: funcionarioProcedure
    .input(novaTentativaCredenciamentoSchema)
    .mutation(({ input, ctx }) => grade.abrirNovaTentativa(input, { id: ctx.user.id })),
});
