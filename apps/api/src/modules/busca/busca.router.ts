import { z } from "zod";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import { buscaGlobal } from "./busca.service.js";

// Busca interna (equipe) — exclui CLIENTE (Portal tem escopo próprio). Quem busca vai junto:
// tarefa, agenda e conversa só devolvem o que a tela de cada um mostraria a essa pessoa.
export const buscaRouter = router({
  global: funcionarioProcedure
    .input(z.object({ termo: z.string() }))
    .query(({ input, ctx }) => buscaGlobal(input.termo, { userId: ctx.user.id, role: ctx.user.role })),
});
