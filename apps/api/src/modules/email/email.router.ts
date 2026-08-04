import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { plugarCaixaSchema } from "@app/shared";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import { isEmailAppEnabled } from "../../config.js";
import * as caixas from "./caixas.service.js";
import * as pastas from "./pastas.service.js";
import * as sync from "./sync.service.js";
import * as leitura from "./leitura.service.js";

/**
 * E-mail dentro da aplicação. TODO procedure é `funcionarioProcedure` (equipe; o Portal do
 * Cliente não entra) e TODA consulta filtra pelo dono da caixa: ninguém vê caixa de ninguém.
 */
/**
 * Sem `EMAIL_CRYPTO_KEY` não há como guardar a senha da caixa. Barrar ANTES de qualquer coisa:
 * sem esta guarda, `plugarCaixa` mandava a senha digitada pela rede ao servidor IMAP, e só
 * DEPOIS estourava ao cifrar — devolvendo um erro técnico e enchendo o ErrorLog.
 */
function exigirModuloLigado() {
  if (!isEmailAppEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "O e-mail dentro da aplicação não está configurado neste servidor (falta EMAIL_CRYPTO_KEY).",
    });
  }
}

export const emailRouter = router({
  caixas: funcionarioProcedure.query(({ ctx }) => caixas.listarCaixas(ctx.user.id)),

  plugarCaixa: funcionarioProcedure
    .input(plugarCaixaSchema)
    .mutation(({ ctx, input }) => {
      exigirModuloLigado();
      return caixas.plugarCaixa(ctx.user.id, input);
    }),

  reconectarCaixa: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1), senha: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      exigirModuloLigado();
      return caixas.reconectarCaixa(ctx.user.id, input.caixaId, input.senha);
    }),

  removerCaixa: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1) }))
    .mutation(({ ctx, input }) => caixas.removerCaixa(ctx.user.id, input.caixaId)),

  pastas: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1) }))
    .query(({ ctx, input }) => pastas.listarPastas(ctx.user.id, input.caixaId)),

  /** Chamado ao abrir a página e pelo polling. Devolve o que mudou para o front decidir avisar. */
  sincronizar: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1), pastaId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // A checagem de posse acontece aqui, antes de tocar no IMAP: `listarPastas` estoura
      // NOT_FOUND se a caixa não for desta pessoa.
      await pastas.listarPastas(ctx.user.id, input.caixaId);
      await sync.sincronizarPasta(input.caixaId, input.pastaId);
      return { ok: true };
    }),

  mensagens: funcionarioProcedure
    .input(
      z.object({
        pastaId: z.string().min(1),
        // Teto no termo: cada busca abre conexão IMAP e faz varredura de CORPO no servidor.
        busca: z.string().max(200).optional(),
        limite: z.number().int().min(1).max(200).optional(),
        antesDe: z.date().optional(),
      }),
    )
    .query(({ ctx, input }) => leitura.listarMensagens(ctx.user.id, input)),

  abrir: funcionarioProcedure
    .input(z.object({ mensagemId: z.string().min(1) }))
    .query(({ ctx, input }) => leitura.abrirMensagem(ctx.user.id, input.mensagemId)),
});
