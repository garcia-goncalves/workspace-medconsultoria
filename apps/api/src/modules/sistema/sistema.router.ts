import { z } from "zod";
import { listarArquivadosParaPrivacidade } from "../clientes/anonimizar.service.js";
import { expurgarDadosVencidos } from "./retencao.service.js";
import { router, rootProcedure } from "../../trpc/trpc.js";
import * as sistema from "./sistema.service.js";

/** Painel de operação/dev — só ROOT. */
export const sistemaRouter = router({
  saude: rootProcedure.query(() => sistema.saude()),
  desempenho: rootProcedure.query(() => sistema.desempenho()),
  banco: rootProcedure.query(() => sistema.banco()),
  diagnostico: rootProcedure.query(() => sistema.diagnostico()),
  metricas: rootProcedure.query(() => sistema.metricas()),
  atencao: rootProcedure.query(() => sistema.atencao()),
  sessoes: rootProcedure.query(() => sistema.sessoes()),
  atividade: rootProcedure.query(() => sistema.atividade()),
  erros: rootProcedure
    .input(z.object({ ocultos: z.boolean().optional() }).optional())
    .query(({ input }) => sistema.erros(input?.ocultos)),
  incidentes: rootProcedure.query(() => sistema.incidentes()),
  historicoUptime: rootProcedure.query(() => sistema.historicoUptime()),
  migracoes: rootProcedure.query(() => sistema.migracoes()),
  config: rootProcedure.query(() => sistema.configInfo()),
  operacao: rootProcedure.query(() => sistema.operacao()),
  fazerBackup: rootProcedure.mutation(() => sistema.fazerBackup()),

  revogarSessao: rootProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => sistema.revogarSessao(input.id)),
  resolverErro: rootProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => sistema.resolverErro(input.id)),
  ignorarErro: rootProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => sistema.ignorarErro(input.id)),
  reexibirErro: rootProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => sistema.reexibirErro(input.id)),
  reconhecerIncidente: rootProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => sistema.reconhecerIncidente(input.id)),
  resolverIncidente: rootProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => sistema.resolverIncidente(input.id)),
  limparSessoesExpiradas: rootProcedure.mutation(() => sistema.limparSessoesExpiradas()),

  // PRIVACIDADE (LGPD, ADR-141). A lista de arquivados vive aqui porque toda tela de cliente
  // filtra `deletedAt: null` — sem ela, o direito de eliminação não teria por onde ser exercido.
  clientesArquivados: rootProcedure.query(() => listarArquivadosParaPrivacidade()),
  expurgarAgora: rootProcedure.mutation(() => expurgarDadosVencidos()),

  // Ações em massa + varredura sob demanda.
  resolverTodosErros: rootProcedure.mutation(() => sistema.resolverTodosErros()),
  resolverTodosIncidentes: rootProcedure.mutation(() => sistema.resolverTodosIncidentes()),
  rodarVarredura: rootProcedure.mutation(() => sistema.rodarVarredura()),
});
