import { z } from "zod";
import {
  createContaSchema,
  updateContaSchema,
  listContasSchema,
  marcarPagaSchema,
  createCategoriaSchema,
  updateCategoriaSchema,
  listCategoriasSchema,
  carteiraInputSchema,
  filtroContasSchema,
  relatorioMensalSchema,
  projecaoCaixaSchema,
} from "@app/shared";
import { router, adminProcedure } from "../../trpc/trpc.js";
import * as contas from "./contas.service.js";
import * as categorias from "./categorias.service.js";
import * as relatorios from "./relatorios.service.js";

// Financeiro é sensível → acesso ADMIN/ROOT (adminProcedure). Carteira PESSOAL é privada por usuário.
// ⚠️ Rota nova deste router nasce `adminProcedure` — há teste que percorre o router inteiro e
// reprova qualquer rota que um FUNCIONARIO consiga chamar (`financeiro-relatorios.integration`).
const ctxDe = (ctx: { user: { id: string; role: string } }): contas.Ctx => ({ userId: ctx.user.id, role: ctx.user.role });

export const financeiroRouter = router({
  categorias: router({
    list: adminProcedure
      .input(listCategoriasSchema)
      .query(({ input, ctx }) => categorias.listCategorias(input.escopo, ctxDe(ctx))),
    create: adminProcedure
      .input(createCategoriaSchema)
      .mutation(({ input, ctx }) => categorias.createCategoria(input, ctxDe(ctx))),
    update: adminProcedure
      .input(updateCategoriaSchema)
      .mutation(({ input, ctx }) => categorias.updateCategoria(input, ctxDe(ctx))),
    remove: adminProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input, ctx }) => categorias.removeCategoria(input.id, ctxDe(ctx))),
  }),
  contas: router({
    resumo: adminProcedure
      .input(carteiraInputSchema)
      .query(({ input, ctx }) => contas.resumo(input.carteira, ctxDe(ctx))),
    porCategoria: adminProcedure
      .input(carteiraInputSchema)
      .query(({ input, ctx }) => contas.porCategoria(input.carteira, ctxDe(ctx))),
    agenda: adminProcedure
      .input(carteiraInputSchema)
      .query(({ input, ctx }) => contas.agendaFinanceira(input.carteira, ctxDe(ctx))),
    list: adminProcedure.input(listContasSchema).query(({ input, ctx }) => contas.listContas(input, ctxDe(ctx))),
    create: adminProcedure.input(createContaSchema).mutation(({ input, ctx }) => contas.createConta(input, ctxDe(ctx))),
    update: adminProcedure.input(updateContaSchema).mutation(({ input, ctx }) => contas.updateConta(input, ctxDe(ctx))),
    remove: adminProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input, ctx }) => contas.removeConta(input.id, ctxDe(ctx))),
    marcarPaga: adminProcedure
      .input(marcarPagaSchema)
      .mutation(({ input, ctx }) => contas.marcarPaga(input.id, input.pago, ctxDe(ctx))),
    // Mutação (e não consulta) como a exportação da Conciliação: é um gesto, não algo para o
    // React Query guardar em cache e refazer sozinho ao focar a janela.
    exportar: adminProcedure
      .input(filtroContasSchema)
      .mutation(({ input, ctx }) => relatorios.exportarContas(input, ctxDe(ctx))),
  }),
  relatorios: router({
    mensal: adminProcedure
      .input(relatorioMensalSchema)
      .query(({ input, ctx }) => relatorios.relatorioMensal(input.carteira, input.meses, ctxDe(ctx))),
    projecao: adminProcedure
      .input(projecaoCaixaSchema)
      .query(({ input, ctx }) => relatorios.projecaoCaixa(input.carteira, input.meses, ctxDe(ctx))),
    inadimplencia: adminProcedure
      .input(carteiraInputSchema)
      .query(({ input, ctx }) => relatorios.inadimplencia(input.carteira, ctxDe(ctx))),
  }),
});
