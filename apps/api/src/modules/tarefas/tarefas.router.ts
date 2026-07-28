import { z } from "zod";
import { createTarefaSchema, updateTarefaSchema, listTarefasSchema, setTarefaStatusSchema } from "@app/shared";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import * as tarefas from "./tarefas.service.js";

// Delegação entre a equipe interna → funcionarioProcedure (exclui o Portal/CLIENTE).
const ctxDe = (ctx: { user: { id: string; role: string } }): tarefas.Ctx => ({ userId: ctx.user.id, role: ctx.user.role });

export const tarefasRouter = router({
  list: funcionarioProcedure.input(listTarefasSchema).query(({ input, ctx }) => tarefas.listTarefas(input, ctxDe(ctx))),
  contar: funcionarioProcedure.query(({ ctx }) => tarefas.contarTarefas(ctxDe(ctx))),
  create: funcionarioProcedure.input(createTarefaSchema).mutation(({ input, ctx }) => tarefas.createTarefa(input, ctxDe(ctx))),
  update: funcionarioProcedure.input(updateTarefaSchema).mutation(({ input, ctx }) => tarefas.updateTarefa(input, ctxDe(ctx))),
  setStatus: funcionarioProcedure.input(setTarefaStatusSchema).mutation(({ input, ctx }) => tarefas.setStatus(input.id, input.status, ctxDe(ctx))),
  remove: funcionarioProcedure.input(z.object({ id: z.string() })).mutation(({ input, ctx }) => tarefas.removeTarefa(input.id, ctxDe(ctx))),
});
