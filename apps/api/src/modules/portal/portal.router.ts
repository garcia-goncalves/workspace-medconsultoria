import { z } from "zod";
import { solicitarServicosSchema, salvarRespostaSchema, portalAbrirChamadoSchema, portalEnviarChamadoSchema, portalMeusDadosSchema } from "@app/shared";
import { router, portalProcedure } from "../../trpc/trpc.js";
import * as service from "./portal.service.js";
import { desistenciaPeloCliente, retomarPeloCliente, solicitarServicosPeloCliente } from "../leads/leads.service.js";
import { listServicosAtivos } from "../servicos/servicos.service.js";
import { confirmarPresencaCliente } from "../agenda/agenda.service.js";
import { portalListChamados, portalAbrirChamado, portalMensagens, portalEnviar } from "../mensagens/mensagens.service.js";
import { servicosDoClientePortal, cancelarServicoCliente } from "../servicos/servicos-cliente.service.js";
import { credenciamentoParaOPortal } from "../servicos/credenciamento.service.js";
import { listarArquivos, removerArquivo } from "../arquivos/arquivos.service.js";
import { getFormularioDoRequisito, salvarResposta } from "../formularios/formularios.service.js";
import { listPorCliente } from "../emails/enviados.service.js";

export const portalRouter = router({
  resumo: portalProcedure.query(({ ctx }) => service.resumo(ctx.clienteId)),

  // Dados cadastrais do próprio cliente (LGPD: acesso + retificação dos próprios dados).
  meusDados: portalProcedure.query(({ ctx }) => service.meusDados(ctx.clienteId)),
  atualizarMeusDados: portalProcedure
    .input(portalMeusDadosSchema)
    .mutation(({ input, ctx }) => service.atualizarMeusDados(ctx.clienteId, ctx.user.id, input)),

  // E-mails que o cliente recebeu — para ele acompanhar tudo pelo Portal.
  emails: portalProcedure.query(({ ctx }) => listPorCliente(ctx.clienteId)),

  // Credenciamento: a papelada agrupada por médico e o que ainda falta. Recorte SEM o
  // veredito comercial — o cliente nunca lê "inapto" nem o motivo de uma recusa.
  credenciamento: portalProcedure.query(({ ctx }) => credenciamentoParaOPortal(ctx.clienteId)),

  // Confirmar presença numa reunião (escopado ao clienteId da sessão).
  confirmarReuniao: portalProcedure
    .input(z.object({ eventoId: z.string() }))
    .mutation(({ input, ctx }) => confirmarPresencaCliente(input.eventoId, ctx.clienteId)),

  // Livre-arbítrio do prospect: desistir do atendimento (vira lead perdido) ou retomar.
  // Sempre escopado ao clienteId da sessão — nunca recebe id de lead do cliente.
  desistir: portalProcedure
    .input(z.object({ motivo: z.string().trim().max(500).optional() }))
    .mutation(({ input, ctx }) => desistenciaPeloCliente(ctx.clienteId, input.motivo)),
  retomar: portalProcedure.mutation(({ ctx }) => retomarPeloCliente(ctx.clienteId)),

  // Autosserviço: catálogo de serviços + solicitar (vira oportunidade no funil).
  servicosDisponiveis: portalProcedure.query(() => listServicosAtivos()),
  solicitarServicos: portalProcedure
    .input(solicitarServicosSchema)
    .mutation(({ input, ctx }) => solicitarServicosPeloCliente(ctx.clienteId, input.servicoIds, input.mensagem)),
  documento: portalProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input, ctx }) => service.getDocumento(input.id, ctx.clienteId)),

  // Serviços contratados do próprio cliente + exigências de documentos (o que falta enviar).
  meusServicos: portalProcedure.query(({ ctx }) => servicosDoClientePortal(ctx.clienteId)),
  cancelarServico: portalProcedure
    .input(z.object({ servicoId: z.string(), motivo: z.string().trim().max(500).optional() }))
    .mutation(({ input, ctx }) => cancelarServicoCliente(ctx.clienteId, input.servicoId, "CLIENTE", input.motivo, ctx.user.id)),

  // Briefings/formulários online: o cliente preenche na tela (rascunho ou envia).
  briefing: router({
    get: portalProcedure
      .input(z.object({ requisitoId: z.string() }))
      .query(({ input, ctx }) => getFormularioDoRequisito(ctx.clienteId, input.requisitoId)),
    salvar: portalProcedure
      .input(salvarRespostaSchema)
      .mutation(({ input, ctx }) => salvarResposta(ctx.clienteId, input.requisitoId, input.respostas, input.enviar)),
  }),

  // Documentos que o cliente enviou (o upload em si chega pelo endpoint /upload).
  arquivos: portalProcedure.query(({ ctx }) => listarArquivos(ctx.clienteId)),
  removerArquivo: portalProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => removerArquivo(input.id, ctx.clienteId)),

  // Suporte = helpdesk de chamados/tickets. Sempre escopado ao clienteId da sessão.
  suporte: router({
    listChamados: portalProcedure.query(({ ctx }) => portalListChamados(ctx.clienteId, ctx.user.id)),
    abrir: portalProcedure.input(portalAbrirChamadoSchema).mutation(({ input, ctx }) => portalAbrirChamado(ctx.clienteId, ctx.user.id, input.assunto, input.mensagem)),
    mensagens: portalProcedure.input(z.object({ conversaId: z.string() })).query(({ input, ctx }) => portalMensagens(ctx.clienteId, ctx.user.id, input.conversaId)),
    enviar: portalProcedure.input(portalEnviarChamadoSchema).mutation(({ input, ctx }) => portalEnviar(ctx.clienteId, ctx.user.id, input.conversaId, input.corpo)),
  }),
});
