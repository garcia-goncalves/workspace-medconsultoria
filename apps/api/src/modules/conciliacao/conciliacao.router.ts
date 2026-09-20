import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { hasRoleLevel, SITUACOES_CLIENTE, type Role } from "@app/shared";
import { registrarErro } from "../sistema/sistema.service.js";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import { assertClienteSobSuaResponsabilidade, filtroDeClientesVisiveis } from "../auth/painel-cliente.service.js";
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
 * RBAC: `conciliacaoProcedure` — FUNCIONARIO+ **e** dono daquele cliente. Ver logo abaixo.
 */

/**
 * FUNCIONARIO+ e responsável por AQUELE cliente.
 *
 * ⚠️ Era `funcionarioProcedure` puro, e isso dava a qualquer pessoa da equipe o dinheiro de
 * TODOS os clientes — quanto cada clínica cobrou, recebeu e teve glosado, com nome de paciente
 * ao lado. A régua nova não é nova: é a mesma do Painel do Cliente (ADR-128), que já vale para
 * o dado pessoal, chegando à tela que tem o dado financeiro.
 *
 * ⚠️ **Mora no PROCEDURE, não dentro de cada serviço.** Espalhada pelos serviços, ela exigiria
 * ser lembrada em toda rota nova — e a esquecida seria justamente a que vaza. Aqui rota nova
 * nasce coberta, e há teste que reprova rota deste router escrita com `funcionarioProcedure`.
 *
 * A conferência lê o input CRU, antes do Zod da rota: depender do input já validado faria uma
 * rota que mudasse o próprio formato rodar sem trava, sem erro e sem log. Rota SEM `clienteId`
 * (a visão geral) passa por aqui e filtra por conta própria — ela lista vários clientes.
 */
/**
 * As rotas que legitimamente NÃO falam de um cliente só.
 *
 * ⚠️ Lista fechada, padrão NEGAR — o mesmo molde de `ACOES_LIBERADAS_PARA_EQUIPE` (ADR-131) e
 * `MODELO_ACEITA_LEAD` (ADR-132). Rota nova que não traga `clienteId` é **recusada** até alguém
 * decidir, por escrito, que ela pode existir sem cliente. O contrário — deixar passar — é o que
 * transforma um esquecimento em vazamento silencioso.
 */
const ROTAS_SEM_CLIENTE = new Set(["disponivel", "clientes", "visaoGeral"]);

/** O que fazer com um pedido, olhando só a rota e o input cru. Pura, para poder ser testada. */
export function decidirConferenciaDeCliente(rota: string, inputCru: unknown): { conferir: string } | "liberado" | "recusado" {
  const bruto = z.object({ clienteId: z.string().min(1) }).safeParse(inputCru);
  if (bruto.success) return { conferir: bruto.data.clienteId };
  return ROTAS_SEM_CLIENTE.has(rota) ? "liberado" : "recusado";
}

/**
 * FUNCIONARIO+ e responsável por AQUELE cliente.
 *
 * ⚠️ Era `funcionarioProcedure` puro, e isso dava a qualquer pessoa da equipe o dinheiro de
 * TODOS os clientes — quanto cada clínica cobrou, recebeu e teve glosado, com nome de paciente
 * ao lado. A régua nova não é nova: é a mesma do Painel do Cliente (ADR-128), que já vale para
 * o dado pessoal, chegando à tela que tem o dado financeiro.
 *
 * ⚠️ **Mora no PROCEDURE, não dentro de cada serviço.** Espalhada pelos serviços, ela exigiria
 * ser lembrada em toda rota nova — e a esquecida seria justamente a que vaza.
 *
 * ⚠️ **E RECUSA em vez de deixar passar.** A 1ª versão só conferia quando achava `clienteId` no
 * topo do input; qualquer outro formato — `{ filtro: { clienteId } }`, um LOTE de edições
 * `[{ cirurgiaId, clienteId }]` (que a planilha reimportada pede cedo ou tarde), uma rota dentro
 * de um sub-router — **pulava a conferência em silêncio**. Hoje não era explorável, porque o Zod
 * de cada rota exige `clienteId` no topo; seria o próximo commit. A cura é em tempo de execução,
 * não por leitura de texto: fora da lista fechada acima, sem `clienteId` legível, o pedido é
 * recusado.
 *
 * A conferência lê o input CRU, antes do Zod da rota: depender do input já validado faria uma
 * rota que mudasse o próprio formato rodar sem trava, sem erro e sem log.
 */
const conciliacaoProcedure = funcionarioProcedure.use(async ({ ctx, next, getRawInput, path, type }) => {
  const rota = path.replace(/^conciliacao\./, "");
  const decisao = decidirConferenciaDeCliente(rota, await getRawInput());
  if (decisao === "recusado") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        `A rota "${rota}" da Conciliação não diz de qual cliente ela fala, então não há como conferir ` +
        "quem pode abri-la. Ponha `clienteId` no topo do input, ou declare a rota em `ROTAS_SEM_CLIENTE`.",
    });
  }
  if (decisao !== "liberado") await assertClienteSobSuaResponsabilidade(ctx.user, decisao.conferir, "abrir a conciliação");

  const resultado = await next({ ctx });

  // ⚠️ QUEM MEXEU NO DINHEIRO DE QUEM.
  //
  // A trava acima foi emprestada da ADR-128 porque o risco é o mesmo — dado de terceiro. Mas lá a
  // régua tem DUAS metades: a trava e o REGISTRO (`painel_cliente.entrou`), que é o que permite
  // responder "quem viu o quê, e quando". Sem a segunda, não havia como saber quem mudou o valor
  // de um procedimento, importou um repasse ou marcou uma cirurgia como "não cobrar".
  //
  // Só MUTAÇÃO, e só depois de dar certo: registrar leitura encheria a tabela (que já precisou de
  // expurgo, ADR-148) e registrar tentativa que falhou diria que alguém fez o que não fez.
  //
  // Melhor esforço, mas NÃO calado: falhar aqui não pode derrubar uma importação que já gravou,
  // e sumir em silêncio é o defeito que a ADR-140 corrigiu — então o erro vai para SISTEMA → Erros.
  if (type === "mutation" && decisao !== "liberado" && resultado.ok) {
    void prisma.activityLog
      .create({
        data: { userId: ctx.user.id, acao: `conciliacao.${rota}`, entidadeTipo: "cliente", entidadeId: decisao.conferir },
      })
      .catch((e: unknown) =>
        registrarErro({
          rota: path,
          mensagem: `Falha ao registrar a atividade da Conciliação: ${e instanceof Error ? e.message : String(e)}`,
          stack: e instanceof Error ? e.stack : null,
          userId: ctx.user.id,
        }),
      );
  }
  return resultado;
});

const recursoFiltro = z.enum(["SEM_RECURSO", "ABERTO", "SEM_RESPOSTA", "RESPONDIDO"]).optional();
/** Quem declara o mês conferido. Ver o comentário em `fecharCompetencia`. */
function assertPodeFecharCompetencia(papel: Role) {
  if (!hasRoleLevel(papel, "ADMIN")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Fechar e reabrir uma competência é de quem responde pela conta (ADMIN). Você pode conciliar o mês normalmente.",
    });
  }
}

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
  disponivel: conciliacaoProcedure.query(() => ({ ligado: isConciliacaoEnabled })),

  /**
   * Os clientes que ESTA pessoa pode conciliar — a lista do seletor da tela.
   *
   * ⚠️ Não use `clientes.list` aqui: ela devolve a base inteira para qualquer funcionário (é
   * assim no resto do sistema, de propósito). No seletor da Conciliação isso ofereceria
   * justamente os clientes que o servidor recusa dois cliques depois — e a pessoa leria o
   * "sem permissão" como defeito do sistema, não como regra.
   *
   * Lista TODOS os clientes visíveis, inclusive quem ainda não teve importação nenhuma: é por
   * aqui que se escolhe o cliente para a PRIMEIRA importação. Quem já tem produção aparece na
   * visão geral; quem não tem, só aqui.
   */
  clientes: conciliacaoProcedure.query(({ ctx }) =>
    prisma.cliente.findMany({
      // ⚠️ `situacaoComercial` é o mesmo filtro do `clientes.list`, e tirá-lo NÃO é detalhe: todo
      // lead do funil tem um `Cliente` PROSPECT por trás (ADR-128/132), então sem ele o seletor
      // passaria a oferecer a base de leads inteira misturada com os clientes de verdade, sem
      // nada que os distinga. Concilia-se a produção de quem é cliente.
      where: { deletedAt: null, situacaoComercial: { in: [...SITUACOES_CLIENTE] }, ...(filtroDeClientesVisiveis(ctx.user) ?? {}) },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ),

  previsualizar: conciliacaoProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input }) => {
    const { bytes } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
    return service.previsualizarImportacao({ clienteId: input.clienteId, bytes });
  }),

  importar: conciliacaoProcedure
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

  competencias: conciliacaoProcedure.input(z.object({ clienteId })).query(({ input }) => painel.competenciasImportadas(input.clienteId)),

  producao: conciliacaoProcedure
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

  resumo: conciliacaoProcedure
    .input(z.object({ clienteId, competencia }))
    .query(({ input }) => painel.resumoDaCompetencia(input.clienteId, input.competencia)),

  pendencias: conciliacaoProcedure.input(z.object({ clienteId })).query(({ input }) => painel.pendenciasDePara(input.clienteId)),

  ligarConvenio: conciliacaoProcedure
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

  ligarProfissional: conciliacaoProcedure
    .input(z.object({ clienteId, textoBruto: z.string().min(1), profissionalId: z.string().min(1) }))
    .mutation(({ input }) => service.ligarProfissional(input)),

  // ─── Fase 2a: o mapa cirúrgico do TASY (spec 2026-09-18) ───────────────────────────────────
  // Mesmas regras de acesso e de privacidade das consultas. Sem competência na importação: o
  // TASY manda um PERÍODO e a cirurgia é identificada pelo próprio número.

  previsualizarCirurgias: conciliacaoProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input }) => {
    const { bytes } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
    return cirurgias.previsualizarCirurgias({ clienteId: input.clienteId, bytes });
  }),

  importarCirurgias: conciliacaoProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input, ctx }) => {
    const { bytes, nome } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
    return cirurgias.importarCirurgias({
      clienteId: input.clienteId,
      bytes,
      nomeArquivo: nome,
      arquivoId: input.arquivoId,
      usuarioId: ctx.user.id,
    });
  }),

  mesesCirurgias: conciliacaoProcedure.input(z.object({ clienteId })).query(({ input }) => cirurgias.mesesDasCirurgias(input.clienteId)),

  cirurgias: conciliacaoProcedure
    .input(
      z.object({
        clienteId,
        competencia: competencia.optional(),
        operadoraId: z.string().optional(),
        profissionalId: z.string().optional(),
        situacao: z.enum(["SEM_ATENDIMENTO", "AUTORIZACAO_PENDENTE", "NAO_EXECUTADA"]).optional(),
        statusConciliacao,
        soAtrasadas: z.boolean().optional(),
        recurso: recursoFiltro,
        busca: z.string().trim().max(120).optional(),
        pagina: z.number().int().min(1).optional(),
      }),
    )
    .query(({ input }) => cirurgias.listarCirurgias(input)),

  resumoCirurgias: conciliacaoProcedure
    .input(z.object({ clienteId, competencia: competencia.optional() }))
    .query(({ input }) => cirurgias.resumoDasCirurgias(input.clienteId, input.competencia)),

  // ─── Fase 2b: o dinheiro (spec 2026-09-18-conciliacao-fase-2b-design.md) ───────────────────

  /** Todos os clientes com produção, com o placar de cada um. */
  /**
   * A única rota sem `clienteId` — e por isso a única que filtra por conta própria. ADMIN+ vê
   * todos os clientes; o funcionário vê os dele. Sem este filtro, a tela que existe para dar a
   * visão do conjunto seria o caminho mais curto para contornar a trava de cada cliente.
   */
  visaoGeral: conciliacaoProcedure.query(({ ctx }) => financeira.visaoGeral(filtroDeClientesVisiveis(ctx.user))),

  editarCirurgia: conciliacaoProcedure
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

  procedimentos: conciliacaoProcedure.input(z.object({ clienteId })).query(({ input }) => financeira.listarProcedimentos(input.clienteId)),

  salvarProcedimento: conciliacaoProcedure
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

  previsualizarRepasse: conciliacaoProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input }) => {
    const { bytes } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
    return recebido.previsualizarRepasse({ clienteId: input.clienteId, bytes });
  }),

  importarRepasse: conciliacaoProcedure
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

  recebidoSemProducao: conciliacaoProcedure
    .input(z.object({ clienteId }))
    .query(({ input }) => recebido.listarRecebidoSemProducao(input.clienteId)),

  previsualizarPlanilha: conciliacaoProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input }) => {
    const { bytes } = await painel.carregarArquivoDoCliente(input.clienteId, input.arquivoId);
    return recebido.previsualizarPlanilha({ clienteId: input.clienteId, bytes });
  }),

  importarPlanilha: conciliacaoProcedure.input(z.object({ clienteId, arquivoId: z.string().min(1) })).mutation(async ({ input, ctx }) => {
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
  // ─── Fechar a competência ──────────────────────────────────────────────────────────────────

  competenciasFechadas: conciliacaoProcedure
    .input(z.object({ clienteId }))
    .query(({ input }) => financeira.competenciasFechadas(input.clienteId)),

  /**
   * ⚠️ Fechar e reabrir exigem ADMIN.
   *
   * O funcionário OPERA o mês — importa, concilia, recorre. **Declarar que ele está conferido** é
   * outra coisa: é o ato de quem responde pela conta, e é o que passa a recusar a edição de todo
   * mundo. Mesma régua do Financeiro, que é `adminProcedure` inteiro.
   *
   * A trava de papel é conferida AQUI e a de cliente continua vindo do `conciliacaoProcedure` —
   * as duas valem, e nenhuma substitui a outra.
   */
  fecharCompetencia: conciliacaoProcedure
    .input(z.object({ clienteId, competencia, observacao: z.string().trim().max(2000).nullable().optional() }))
    .mutation(({ input, ctx }) => {
      assertPodeFecharCompetencia(ctx.user.role);
      return financeira.fecharCompetencia(input.clienteId, input.competencia, ctx.user.id, input.observacao);
    }),

  reabrirCompetencia: conciliacaoProcedure.input(z.object({ clienteId, competencia })).mutation(({ input, ctx }) => {
    assertPodeFecharCompetencia(ctx.user.role);
    return financeira.reabrirCompetencia(input.clienteId, input.competencia, ctx.user.id);
  }),

  // ─── Fase 2c: o recurso de glosa ───────────────────────────────────────────────────────────

  recursosDaCirurgia: conciliacaoProcedure
    .input(z.object({ clienteId, cirurgiaId: z.string().min(1) }))
    .query(({ input }) => financeira.recursosDaCirurgia(input.clienteId, input.cirurgiaId)),

  abrirRecurso: conciliacaoProcedure
    .input(
      z.object({
        clienteId,
        cirurgiaId: z.string().min(1),
        abertoEm: dataISO,
        canal: z.string().trim().max(60).nullable().optional(),
        protocolo: z.string().trim().max(60).nullable().optional(),
        motivoDaGlosa: z.string().trim().max(2000).nullable().optional(),
        observacao: z.string().trim().max(2000).nullable().optional(),
      }),
    )
    .mutation(({ input, ctx }) => financeira.abrirRecurso(input.clienteId, ctx.user.id, input)),

  responderRecurso: conciliacaoProcedure
    .input(
      z.object({
        clienteId,
        recursoId: z.string().min(1),
        status: z.enum(["ACATADO", "NEGADO", "ENCERRADO"]),
        respondidoEm: dataISO,
        observacao: z.string().trim().max(2000).nullable().optional(),
      }),
    )
    .mutation(({ input }) => financeira.responderRecurso(input.clienteId, input.recursoId, input)),

  exportar: conciliacaoProcedure
    .input(
      z.object({
        clienteId,
        competencia: competencia.optional(),
        statusConciliacao,
        soAtrasadas: z.boolean().optional(),
        recurso: recursoFiltro,
      }),
    )
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
