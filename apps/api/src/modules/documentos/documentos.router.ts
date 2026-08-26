import { z } from "zod";
import {
  createModeloSchema,
  updateModeloSchema,
  createDocumentoSchema,
  criarPropostaSchema,
  criarContratoSchema,
  contextoClienteDocSchema,
  updateConteudoSchema,
  setStatusDocumentoSchema,
  statusDocumentoEnum,
  gerarComIASchema,
  melhorarComIASchema,
  resumirReuniaoSchema,
  gerarPautaSchema,
  usoOperadoraEnum,
} from "@app/shared";
import { router, funcionarioProcedure, adminProcedure } from "../../trpc/trpc.js";
import * as modelos from "./modelos.service.js";
import * as documentos from "./documentos.service.js";
import * as operadoras from "./operadoras.service.js";

const nomeOperadora = z.string().trim().min(1, "Informe o nome").max(80);

export const documentosRouter = router({
  // Catálogo de modelos: FUNCIONARIO usa (list/get); administrar (criar/editar/remover) é ADMIN+.
  modelos: router({
    list: funcionarioProcedure.query(() => modelos.listModelos()),
    get: funcionarioProcedure.input(z.object({ id: z.string() })).query(({ input }) => modelos.getModelo(input.id)),
    create: adminProcedure
      .input(createModeloSchema)
      .mutation(({ input }) => modelos.createModelo(input)),
    update: adminProcedure
      .input(updateModeloSchema)
      .mutation(({ input }) => modelos.updateModelo(input)),
    remove: adminProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => modelos.removeModelo(input.id)),
  }),

  // Catálogo de operadoras: FUNCIONARIO consulta (list); administrar é ADMIN+.
  // `uso` filtra pela marcação por serviço (ADR-126) — a proposta de credenciamento pede
  // CREDENCIAMENTO, a de faturamento pede FATURAMENTO, a tela de gestão não filtra nada.
  operadoras: router({
    list: funcionarioProcedure
      .input(z.object({ uso: usoOperadoraEnum.optional() }).optional())
      .query(({ input }) => operadoras.listOperadoras(input?.uso)),
    criar: adminProcedure
      .input(z.object({ nome: nomeOperadora, usoCredenciamento: z.boolean().optional(), usoFaturamento: z.boolean().optional() }))
      .mutation(({ input }) => operadoras.criarOperadora(input)),
    atualizar: adminProcedure
      .input(
        z.object({
          id: z.string().min(1),
          nome: nomeOperadora.optional(),
          usoCredenciamento: z.boolean().optional(),
          usoFaturamento: z.boolean().optional(),
        }),
      )
      .mutation(({ input }) => operadoras.atualizarOperadora(input)),
    remover: adminProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ input }) => operadoras.removerOperadora(input.id)),
  }),

  list: funcionarioProcedure
    .input(z.object({ status: statusDocumentoEnum.optional() }).optional())
    .query(({ input }) => documentos.listDocumentos(input?.status)),

  get: funcionarioProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => documentos.getDocumento(input.id)),

  create: funcionarioProcedure
    .input(createDocumentoSchema)
    .mutation(({ input, ctx }) => documentos.createDocumento(input, ctx.user.id)),

  /** Proposta inteligente: monta a proposta a partir dos serviços (com preços) do catálogo. */
  criarProposta: funcionarioProcedure
    .input(criarPropostaSchema)
    .mutation(({ input, ctx }) => documentos.criarProposta(input, ctx.user.id)),

  /** Contrato inteligente: monta o contrato a partir dos serviços contratados + vigência. */
  criarContrato: funcionarioProcedure
    .input(criarContratoSchema)
    .mutation(({ input, ctx }) => documentos.criarContrato(input, ctx.user.id)),

  /** Contexto do cliente (serviços contratados, investimento, proposta aceita) p/ auto-preencher. */
  contextoCliente: funcionarioProcedure
    .input(contextoClienteDocSchema)
    .query(({ input }) => documentos.contextoClienteDoc(input)),

  /** Gera um documento (briefing/proposta/contrato) do modelo com os dados do lead. */
  gerarParaLead: funcionarioProcedure
    .input(z.object({ leadId: z.string(), tipo: z.enum(["briefing", "proposta", "contrato"]) }))
    .mutation(({ input, ctx }) => documentos.gerarParaLead(input.leadId, input.tipo, { id: ctx.user.id })),

  updateConteudo: funcionarioProcedure
    .input(updateConteudoSchema)
    .mutation(({ input, ctx }) => documentos.updateConteudo(input.id, input.conteudo, ctx.user.id)),

  setStatus: funcionarioProcedure
    .input(setStatusDocumentoSchema)
    .mutation(({ input, ctx }) => documentos.setStatus(input.id, input.status, ctx.user.id)),

  remove: funcionarioProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => documentos.removeDocumento(input.id)),

  // ── IA (OpenAI) — a disponibilidade é consultada via `ia.disponivel` ──
  gerarComIA: funcionarioProcedure
    .input(gerarComIASchema)
    .mutation(({ input, ctx }) => documentos.gerarComIA(input, ctx.user.id)),

  melhorarComIA: funcionarioProcedure
    .input(melhorarComIASchema)
    .mutation(({ input, ctx }) => documentos.melhorarComIA(input.id, input.instrucao, ctx.user.id)),

  resumirReuniao: funcionarioProcedure
    .input(resumirReuniaoSchema)
    .mutation(({ input, ctx }) => documentos.resumirReuniao(input, ctx.user.id)),

  gerarPauta: funcionarioProcedure
    .input(gerarPautaSchema)
    .mutation(({ input, ctx }) => documentos.gerarPautaReuniao(input, ctx.user.id)),
});
