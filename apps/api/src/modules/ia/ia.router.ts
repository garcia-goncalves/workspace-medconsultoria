import { z } from "zod";
import { resumoAgendaSchema } from "@app/shared";
import { router, funcionarioProcedure, rootProcedure } from "../../trpc/trpc.js";
import { isAiEnabled } from "../../config.js";
import {
  perguntar,
  resumoDoDia,
  resumoAgenda,
  sugerirRequisitos,
  sugerirCampos,
  resumirCliente,
  sugerirProximoPassoLead,
  escreverMensagem,
  diagnosticoSistema,
  explicarErro,
  explicarIncidente,
} from "./ia.service.js";

// Assistente de IA (Gemini) — disponível só com GEMINI_API_KEY; acesso da equipe.
// Todas as sugestões seguem o padrão "a IA propõe, o usuário aprova".
export const iaRouter = router({
  disponivel: funcionarioProcedure.query(() => ({ disponivel: isAiEnabled })),
  perguntar: funcionarioProcedure
    .input(z.object({ pergunta: z.string().min(1, "Escreva sua pergunta").max(1000) }))
    .mutation(({ input }) => perguntar(input.pergunta)),

  resumoDoDia: funcionarioProcedure.mutation(({ ctx }) => resumoDoDia(ctx.user.id, ctx.user.role)),
  resumoAgenda: funcionarioProcedure
    .input(resumoAgendaSchema)
    .mutation(({ input, ctx }) => resumoAgenda(ctx.user.id, input.inicio, input.fim, input.rotulo)),

  sugerirRequisitos: funcionarioProcedure
    .input(z.object({ servicoId: z.string() }))
    .mutation(({ input }) => sugerirRequisitos(input.servicoId)),
  sugerirCampos: funcionarioProcedure
    .input(z.object({ titulo: z.string().min(1), descricao: z.string().optional() }))
    .mutation(({ input }) => sugerirCampos(input.titulo, input.descricao)),
  resumirCliente: funcionarioProcedure
    .input(z.object({ clienteId: z.string() }))
    .mutation(({ input }) => resumirCliente(input.clienteId)),
  sugerirProximoPassoLead: funcionarioProcedure
    .input(z.object({ leadId: z.string() }))
    .mutation(({ input }) => sugerirProximoPassoLead(input.leadId)),
  escreverMensagem: funcionarioProcedure
    .input(z.object({ leadId: z.string().optional(), clienteId: z.string().optional(), objetivo: z.string().max(500).optional() }))
    .mutation(({ input }) => escreverMensagem(input)),

  // IA do painel SISTEMA (só ROOT/devs): diagnóstico geral + explicar erro/incidente.
  diagnosticoSistema: rootProcedure.mutation(() => diagnosticoSistema()),
  explicarErro: rootProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => explicarErro(input.id)),
  explicarIncidente: rootProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => explicarIncidente(input.id)),
});
