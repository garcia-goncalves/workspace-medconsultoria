import { z } from "zod";
import { createEventoSchema, updateEventoSchema, listEventosSchema, conflitoEventoSchema } from "@app/shared";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import * as service from "./agenda.service.js";

export const agendaRouter = router({
  list: funcionarioProcedure
    .input(listEventosSchema)
    .query(({ input, ctx }) => service.listEventos(input.inicio, input.fim, ctx.user.id)),

  create: funcionarioProcedure
    .input(createEventoSchema.and(z.object({ avisarCliente: z.boolean().optional() })))
    .mutation(({ input, ctx }) => {
      const { avisarCliente, ...dados } = input;
      return service.createEvento(dados, ctx.user.id, avisarCliente ?? false);
    }),

  update: funcionarioProcedure
    .input(updateEventoSchema.and(z.object({ avisarCliente: z.boolean().optional() })))
    .mutation(({ input, ctx }) => {
      const { avisarCliente, ...dados } = input;
      return service.updateEvento(dados, ctx.user.id, avisarCliente ?? false);
    }),

  remove: funcionarioProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => service.removeEvento(input.id, ctx.user.id)),

  // Conflitos de horário na agenda do usuário (para avisar ao criar/editar).
  conflitos: funcionarioProcedure
    .input(conflitoEventoSchema)
    .query(({ input, ctx }) => service.verificarConflitos(input, ctx.user.id)),
});
