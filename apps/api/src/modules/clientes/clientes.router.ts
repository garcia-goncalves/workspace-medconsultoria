import { z } from "zod";
import {
  createClienteSchema,
  updateClienteSchema,
  createContatoSchema,
  createNotaSchema,
  setAtivoClienteSchema,
  ativarServicoClienteSchema,
  cancelarServicoClienteSchema,
  atualizarContratacaoClienteSchema,
  hasRoleLevel,
  convidarPessoaPortalSchema,
  papelDaPessoaPortalSchema,
  pessoaPortalSchema,
} from "@app/shared";
import { router, funcionarioProcedure, adminProcedure, rootProcedure } from "../../trpc/trpc.js";
import * as service from "./clientes.service.js";
import * as servicosCliente from "../servicos/servicos-cliente.service.js";
import * as arquivos from "../arquivos/arquivos.service.js";
import { listChamadosDoCliente } from "../mensagens/mensagens.service.js";
import * as pessoas from "../portal/pessoas.service.js";

export const clientesRouter = router({
  // Chamados de suporte do cliente (lista na ficha; a conversa fica em Mensagens).
  chamados: funcionarioProcedure
    .input(z.object({ clienteId: z.string() }))
    .query(({ input, ctx }) => listChamadosDoCliente(input.clienteId, ctx.user.id)),

  list: funcionarioProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(({ input }) => service.listClientes(input?.search)),

  // KPIs da base (topo da lista de clientes).
  resumo: funcionarioProcedure.query(() => service.resumoClientes()),

  get: funcionarioProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => service.getCliente(input.id)),

  // Projetos, documentos, reuniões e (p/ admin) contas do cliente — o hub da ficha.
  relacionados: funcionarioProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input, ctx }) =>
      service.relacionadosCliente(input.id, hasRoleLevel(ctx.user.role, "ADMIN")),
    ),

  create: funcionarioProcedure
    .input(createClienteSchema.extend({ enviarAcessoPortal: z.boolean().optional() }))
    .mutation(({ input, ctx }) => {
      const { enviarAcessoPortal, ...dados } = input;
      return service.createCliente(dados, ctx.user.id, enviarAcessoPortal ?? false);
    }),

  update: funcionarioProcedure
    .input(updateClienteSchema)
    .mutation(({ input }) => service.updateCliente(input)),

  // Ativar/desativar cliente (toggle manual na ficha) — só ADMIN+ (RBAC).
  setAtivo: adminProcedure
    .input(setAtivoClienteSchema)
    .mutation(({ input, ctx }) => service.setAtivoCliente(input.id, input.ativo, ctx.user.id)),

  // Enviar/reenviar o acesso ao Portal do Cliente (igual ao convite do Funil).
  convidarPortal: funcionarioProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => service.convidarPortalCliente(ctx.user, input.id)),

  // AS PESSOAS DA CLÍNICA NO PORTAL (ADR-131) — médicos e secretárias, cada um com o acesso
  // dele. Aqui é o lado da EQUIPE DA MED: a Thaís convida e revoga pela ficha do cliente. O
  // responsável da própria clínica faz o mesmo por `portal.pessoas`, chamando as MESMAS funções.
  //
  // ⚠️ Convidar e revogar acesso é `funcionarioProcedure` como o resto da ficha, mas note que
  // `pessoas.service` confere o vínculo com o cliente em toda função: a rota diz quem é da casa,
  // o serviço diz de qual clínica é a pessoa. As duas perguntas são diferentes.
  pessoas: router({
    list: funcionarioProcedure
      .input(z.object({ clienteId: z.string() }))
      .query(({ input }) => pessoas.listarPessoasDoPortal(input.clienteId)),
    convidar: funcionarioProcedure
      .input(convidarPessoaPortalSchema.extend({ clienteId: z.string() }))
      .mutation(({ input, ctx }) => pessoas.convidarPessoaDoPortal({ ...input, autorId: ctx.user.id })),
    alterarPapel: funcionarioProcedure
      .input(papelDaPessoaPortalSchema.extend({ clienteId: z.string() }))
      .mutation(({ input, ctx }) => pessoas.alterarPapelDaPessoa({ ...input, autorId: ctx.user.id })),
    revogar: funcionarioProcedure
      .input(pessoaPortalSchema.extend({ clienteId: z.string() }))
      .mutation(({ input, ctx }) => pessoas.revogarAcessoDaPessoa({ ...input, autorId: ctx.user.id })),
    devolver: funcionarioProcedure
      .input(pessoaPortalSchema.extend({ clienteId: z.string() }))
      .mutation(({ input, ctx }) => pessoas.devolverAcessoDaPessoa({ ...input, autorId: ctx.user.id })),
    reenviarConvite: funcionarioProcedure
      .input(pessoaPortalSchema.extend({ clienteId: z.string() }))
      .mutation(({ input, ctx }) => pessoas.reenviarConviteDaPessoa({ ...input, autorId: ctx.user.id })),
  }),

  // Arquivar cliente (exclusão LÓGICA: some das listas, preserva histórico) — só ADMIN+.
  remove: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => service.removeCliente(input.id, ctx.user.id)),

  // Exclusão DEFINITIVA (física) — só ROOT e apenas se não houver vínculos que a tornem
  // insegura (projetos, documentos, financeiro, serviços, agenda, acessos, arquivos…).
  excluirDefinitivo: rootProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => service.excluirDefinitivoCliente(input.id, ctx.user.id)),

  addContato: funcionarioProcedure
    .input(createContatoSchema)
    .mutation(({ input }) => service.addContato(input)),

  removeContato: funcionarioProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => service.removeContato(input.id)),

  addNota: funcionarioProcedure
    .input(createNotaSchema)
    .mutation(({ input, ctx }) => service.addNota(input, ctx.user.id)),

  /** Arquiva/desarquiva uma nota (histórico imutável — nunca edita/apaga o conteúdo). */
  arquivarNota: funcionarioProcedure
    .input(z.object({ notaId: z.string().min(1), arquivar: z.boolean() }))
    .mutation(({ input, ctx }) => service.arquivarNota(input.notaId, ctx.user.id, input.arquivar)),

  // ── Serviços contratados do cliente (ficha) ──
  servicos: funcionarioProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => servicosCliente.servicosDoCliente(input.id)),
  ativarServico: funcionarioProcedure
    .input(ativarServicoClienteSchema)
    .mutation(({ input, ctx }) =>
      servicosCliente.ativarServicoCliente(
        input.clienteId,
        input.servicoId,
        { valor: input.valor ?? null, observacao: input.observacao || null, avisarCliente: input.avisarCliente },
        { id: ctx.user.id },
      ),
    ),
  cancelarServico: funcionarioProcedure
    .input(cancelarServicoClienteSchema)
    .mutation(({ input, ctx }) =>
      servicosCliente.cancelarServicoCliente(input.clienteId, input.servicoId, "EQUIPE", input.motivo || undefined, ctx.user.id),
    ),
  atualizarContratacao: funcionarioProcedure
    .input(atualizarContratacaoClienteSchema)
    .mutation(({ input }) => {
      const { clienteId, servicoId, ...dados } = input;
      return servicosCliente.atualizarContratacaoCliente(clienteId, servicoId, dados);
    }),

  // ── Arquivos do cliente (upload chega pelo endpoint /upload) ──
  arquivos: funcionarioProcedure
    .input(z.object({ id: z.string(), servicoId: z.string().optional() }))
    .query(({ input }) => arquivos.listarArquivos(input.id, input.servicoId)),
  // Remover arquivo (lixeira/soft-delete) — só ADMIN+ (FUNCIONARIO envia/atualiza, não exclui).
  removerArquivo: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => arquivos.removerArquivo(input.id, undefined, ctx.user.id)),
});
