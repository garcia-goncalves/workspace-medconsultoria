import { z } from "zod";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import { isConciliacaoEnabled } from "../../config.js";
import * as service from "./conciliacao.service.js";
import * as painel from "./conciliacao-painel.service.js";
import * as cirurgias from "./cirurgias.service.js";
import * as financeira from "./conciliacao-financeira.service.js";
import * as recebido from "./recebido.service.js";
import * as exportacao from "./exportacao.js";

/**
 * CONCILIAÇÃO — Fase 1: a produção de consultas, vista pela EQUIPE.
 *
 * ⚠️ **Nenhuma rota daqui devolve CPF, telefone ou e-mail do paciente.** Os serviços não os
 * incluem nos `select`, e há teste que varre estes retornos atrás dessas chaves. Ampliar isso é
 * decisão de privacidade (spec §5), não refatoração.
 *
 * O arquivo NÃO trafega por aqui: ele sobe por `POST /upload` (que já tem allowlist de tipo, teto
 * de 20 MB e checagem de posse) e o que chega ao tRPC é o `arquivoId`. Assim o original fica
 * guardado no acervo do cliente, como a spec exige, e binário não passa por JSON.
 *
 * RBAC: `funcionarioProcedure` (FUNCIONARIO+). A Thaís precisa operar isto no dia a dia; o
 * Financeiro é ADMIN por lidar com dinheiro. Como há NOME de paciente na tela, subir para ADMIN é
 * uma palavra — é a pergunta 3 da §11 da spec, aguardando o Sérgio.
 */

const clienteId = z.string().min(1);
/** `AAAA-MM`. Validar aqui evita que um mês inventado crie um lote órfão que ninguém acha. */
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência deve ser no formato AAAA-MM (ex.: 2026-08).");
/** Reais, com teto: um número absurdo é engano de digitação, não uma cirurgia de R$ 10 bilhões. */
const dinheiro = z.number().finite().min(0, "Valor não pode ser negativo.").max(99_999_999.99);
const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser AAAA-MM-DD.");
const statusConciliacao = z
  .enum([
    "NAO_REALIZADA",
    "NAO_COBRAR",
    "SEM_ATENDIMENTO",
    "SEM_VALOR",
    "A_RECEBER",
    "PAGO",
    "GLOSA_PARCIAL",
    "GLOSA_TOTAL",
    "PAGO_A_MAIS",
    "RECEBIDO_SEM_VALOR",
  ])
  .optional();

export const conciliacaoRouter = router({
  /** A tela pergunta antes de oferecer o botão de importar. */
  disponivel: funcionarioProcedure.query(() => ({ ligado: isConciliacaoEnabled })),

  previsualizar: funcionarioProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input }) => {
    const { bytes } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
    return service.previsualizarImportacao({ clienteId: input.clienteId, bytes });
  }),

  importar: funcionarioProcedure
    .input(
      z.object({
        clienteId,
        competencia,
        arquivoId: z.string().min(1),
        /** Só `true` depois de a pessoa confirmar o aviso de substituição. */
        substituir: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { bytes, nome } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
      return service.importarProducao({
        clienteId: input.clienteId,
        competencia: input.competencia,
        bytes,
        nomeArquivo: nome,
        arquivoId: input.arquivoId,
        usuarioId: ctx.user.id,
        substituir: input.substituir,
      });
    }),

  competencias: funcionarioProcedure.input(z.object({ clienteId })).query(({ input }) => painel.competenciasImportadas(input.clienteId)),

  producao: funcionarioProcedure
    .input(
      z.object({
        clienteId,
        competencia: competencia.optional(),
        operadoraId: z.string().optional(),
        profissionalId: z.string().optional(),
        tipoAtendimento: z.enum(["CONSULTA", "CORTESIA", "SEM_VINCULO_AGENDA", "OUTRO"]).optional(),
        busca: z.string().trim().max(120).optional(),
        pagina: z.number().int().min(1).optional(),
      }),
    )
    .query(({ input }) => painel.listarProducao(input)),

  resumo: funcionarioProcedure
    .input(z.object({ clienteId, competencia }))
    .query(({ input }) => painel.resumoDaCompetencia(input.clienteId, input.competencia)),

  pendencias: funcionarioProcedure.input(z.object({ clienteId })).query(({ input }) => painel.pendenciasDePara(input.clienteId)),

  ligarConvenio: funcionarioProcedure
    .input(
      z.object({
        clienteId,
        textoBruto: z.string().min(1),
        operadoraId: z.string().nullable(),
        plano: z.string().trim().max(120).nullable().optional(),
        particular: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) => service.ligarConvenio(input)),

  ligarProfissional: funcionarioProcedure
    .input(z.object({ clienteId, textoBruto: z.string().min(1), profissionalId: z.string().min(1) }))
    .mutation(({ input }) => service.ligarProfissional(input)),

  // ─── Fase 2a: o mapa cirúrgico do TASY (spec 2026-09-18) ───────────────────────────────────
  // Mesmas regras de acesso e de privacidade das consultas. Sem competência na importação: o
  // TASY manda um PERÍODO e a cirurgia é identificada pelo próprio número.

  previsualizarCirurgias: funcionarioProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input }) => {
    const { bytes } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
    return cirurgias.previsualizarCirurgias({ clienteId: input.clienteId, bytes });
  }),

  importarCirurgias: funcionarioProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input, ctx }) => {
    const { bytes, nome } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
    return cirurgias.importarCirurgias({
      clienteId: input.clienteId,
      bytes,
      nomeArquivo: nome,
      arquivoId: input.arquivoId,
      usuarioId: ctx.user.id,
    });
  }),

  mesesCirurgias: funcionarioProcedure.input(z.object({ clienteId })).query(({ input }) => cirurgias.mesesDasCirurgias(input.clienteId)),

  cirurgias: funcionarioProcedure
    .input(
      z.object({
        clienteId,
        competencia: competencia.optional(),
        operadoraId: z.string().optional(),
        profissionalId: z.string().optional(),
        situacao: z.enum(["SEM_ATENDIMENTO", "AUTORIZACAO_PENDENTE", "NAO_EXECUTADA"]).optional(),
        statusConciliacao,
        busca: z.string().trim().max(120).optional(),
        pagina: z.number().int().min(1).optional(),
      }),
    )
    .query(({ input }) => cirurgias.listarCirurgias(input)),

  resumoCirurgias: funcionarioProcedure
    .input(z.object({ clienteId, competencia: competencia.optional() }))
    .query(({ input }) => cirurgias.resumoDasCirurgias(input.clienteId, input.competencia)),

  // ─── Fase 2b: o dinheiro (spec 2026-09-18-conciliacao-fase-2b-design.md) ───────────────────

  /** Todos os clientes com produção, com o placar de cada um. */
  visaoGeral: funcionarioProcedure.query(() => financeira.visaoGeral()),

  editarCirurgia: funcionarioProcedure
    .input(
      z.object({
        clienteId,
        cirurgiaId: z.string().min(1),
        codigoProcedimento: z.string().trim().max(40).nullable().optional(),
        valorCobrado: dinheiro.nullable().optional(),
        valorRecebido: dinheiro.nullable().optional(),
        dataPagamento: dataISO.nullable().optional(),
        naoCobrar: z.boolean().optional(),
        observacao: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const { clienteId: cid, cirurgiaId, ...edicao } = input;
      return financeira.editarCirurgia(cid, cirurgiaId, edicao);
    }),

  procedimentos: funcionarioProcedure.input(z.object({ clienteId })).query(({ input }) => financeira.listarProcedimentos(input.clienteId)),

  salvarProcedimento: funcionarioProcedure
    .input(
      z.object({
        clienteId,
        textoBruto: z.string().min(1).max(255),
        operadoraId: z.string().min(1).nullable(),
        codigo: z.string().trim().max(40).nullable(),
        valor: dinheiro.nullable(),
      }),
    )
    .mutation(({ input }) => financeira.salvarProcedimento(input)),

  previsualizarRepasse: funcionarioProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input }) => {
    const { bytes } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
    return recebido.previsualizarRepasse({ clienteId: input.clienteId, bytes });
  }),

  importarRepasse: funcionarioProcedure
    .input(z.object({ clienteId, arquivoId: z.string().min(1), substituir: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { bytes, nome } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
      return recebido.importarRepasse({
        clienteId: input.clienteId,
        bytes,
        nomeArquivo: nome,
        arquivoId: input.arquivoId,
        usuarioId: ctx.user.id,
        substituir: input.substituir,
      });
    }),

  recebidoSemProducao: funcionarioProcedure
    .input(z.object({ clienteId }))
    .query(({ input }) => recebido.listarRecebidoSemProducao(input.clienteId)),

  previsualizarPlanilha: funcionarioProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input }) => {
    const { bytes } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
    return recebido.previsualizarPlanilha({ clienteId: input.clienteId, bytes });
  }),

  importarPlanilha: funcionarioProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input, ctx }) => {
    const { bytes, nome } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
    return recebido.importarPlanilha({
      clienteId: input.clienteId,
      bytes,
      nomeArquivo: nome,
      arquivoId: input.arquivoId,
      usuarioId: ctx.user.id,
    });
  }),

  /**
   * As três planilhas, como texto CSV. É MUTATION de propósito: leva nome de paciente, e por
   * query ele sairia na URL (e no log) — a mesma razão das queries daqui irem por POST.
   */
  exportar: funcionarioProcedure
    .input(z.object({ clienteId, competencia: competencia.optional(), statusConciliacao }))
    .mutation(async ({ input }) => {
      const linhas = await cirurgias.linhasParaExportar(input);
      return {
        modelo: exportacao.planilhaModelo(linhas),
        porConvenio: exportacao.resumoPorConvenio(linhas),
        porMesMedico: exportacao.resumoPorMesMedico(linhas),
        linhas: linhas.length,
      };
    }),
});
