import { z } from "zod";
import { createProfissionalSchema, updateProfissionalSchema } from "@app/shared";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import * as service from "./credenciamento.service.js";

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
});
