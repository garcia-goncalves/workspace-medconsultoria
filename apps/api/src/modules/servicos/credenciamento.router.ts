import { z } from "zod";
import {
  createProfissionalSchema,
  mudarStatusCredenciamentoSchema,
  novaTentativaCredenciamentoSchema,
  salvarGradeSchema,
  updateProfissionalSchema,
} from "@app/shared";
import { statusCredenciamentoEnum } from "@app/shared";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import * as service from "./credenciamento.service.js";
import * as grade from "./credenciamento-grade.service.js";
import * as painel from "./credenciamento-painel.service.js";

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

  // ⚠️ `salvarGrade` e `mudarStatus` continuam `funcionarioProcedure` — a rota atende também
  // quem só protocola/pede análise/nega. A trava de ADMIN+ da APROVAÇÃO (§ decisão do dono:
  // aprovar é o que lança a cobrança) mora DENTRO do serviço, condicionada ao status pedido —
  // travar a rota inteira tiraria do funcionário as ações que ele continua podendo fazer.
  salvarGrade: funcionarioProcedure
    .input(salvarGradeSchema)
    .mutation(({ input, ctx }) => grade.salvarGrade(input, { id: ctx.user.id, role: ctx.user.role })),

  mudarStatus: funcionarioProcedure
    .input(mudarStatusCredenciamentoSchema)
    .mutation(({ input, ctx }) => grade.mudarStatusCredenciamento(input, { id: ctx.user.id, role: ctx.user.role })),

  novaTentativa: funcionarioProcedure
    .input(novaTentativaCredenciamentoSchema)
    .mutation(({ input, ctx }) => grade.abrirNovaTentativa(input, { id: ctx.user.id })),

  // ── O painel: todos os credenciamentos, de todos os clientes ───────────────
  //
  // Mudar a situação a partir do painel usa a MESMA `mudarStatus` acima, de propósito:
  // as travas (negado não vira aprovado; aprovar cria a conta a receber e falha junto se
  // a conta falhar) moram num lugar só. Regra de dinheiro escrita duas vezes são dois
  // relógios — nunca se sabe qual está certo.

  painel: funcionarioProcedure
    .input(
      z
        .object({
          clienteId: z.string().min(1).nullish(),
          operadoraId: z.string().min(1).nullish(),
          status: z.array(statusCredenciamentoEnum).nullish(),
          somenteAtencao: z.boolean().nullish(),
        })
        .optional(),
    )
    .query(({ input }) => painel.painelCredenciamentos(input ?? {})),

  painelOpcoes: funcionarioProcedure.query(() => painel.opcoesDoPainel()),
});
