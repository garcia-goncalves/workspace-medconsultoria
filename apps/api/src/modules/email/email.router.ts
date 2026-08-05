import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { plugarCaixaSchema, enviarEmailSchema } from "@app/shared";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import { isEmailAppEnabled } from "../../config.js";
import * as caixas from "./caixas.service.js";
import * as pastas from "./pastas.service.js";
import * as sync from "./sync.service.js";
import * as leitura from "./leitura.service.js";
import * as envio from "./envio.service.js";
import * as rascunhos from "./rascunhos.service.js";
import * as vinculo from "./vinculo.service.js";
import * as acoes from "./acoes.service.js";

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
    .input(
      z.object({
        caixaId: z.string().min(1),
        pastaId: z.string().min(1),
        // Redescobrir a lista de pastas custa uma conexão IMAP a mais, então o front pede isso
        // só ao abrir a caixa — nunca a cada ciclo do polling. Sem isso, a lista de pastas
        // congelava no dia em que a caixa foi plugada: pasta criada, renomeada ou desinscrita
        // no webmail nunca aparecia (nem sumia) aqui.
        descobrirPastas: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // A checagem de posse acontece aqui, antes de tocar no IMAP: `listarPastas` estoura
      // NOT_FOUND se a caixa não for desta pessoa.
      await pastas.listarPastas(ctx.user.id, input.caixaId);

      if (input.descobrirPastas) {
        // Servidor fora do ar não pode derrubar a sincronização — a próxima abertura tenta de novo.
        await pastas.sincronizarPastas(input.caixaId).catch(() => {});
        // A pasta aberta pode ter acabado de sumir (apagada ou desinscrita no webmail). Sair
        // aqui evita estourar; o front relê as pastas e cai na Caixa de entrada.
        const aindaExiste = await pastas.pastaExiste(input.caixaId, input.pastaId);
        if (!aindaExiste) return { ok: true };
      }

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

  enviar: funcionarioProcedure.input(enviarEmailSchema).mutation(({ ctx, input }) => {
    exigirModuloLigado();
    return envio.enviarMensagem(ctx.user.id, input);
  }),

  prepararResposta: funcionarioProcedure
    .input(z.object({ mensagemId: z.string().min(1), aTodos: z.boolean().default(false) }))
    .query(({ ctx, input }) => {
      exigirModuloLigado();
      return envio.prepararResposta(ctx.user.id, input.mensagemId, input.aTodos);
    }),

  prepararEncaminhamento: funcionarioProcedure
    .input(z.object({ mensagemId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      exigirModuloLigado();
      return envio.prepararEncaminhamento(ctx.user.id, input.mensagemId);
    }),

  /**
   * Grava o que a pessoa está escrevendo na pasta Drafts do SERVIDOR (não só no navegador dela).
   * Sem `.email()` nos destinatários de propósito: a pessoa pode estar no meio de digitar um
   * endereço, e um rascunho não pode falhar em salvar por causa disso.
   *
   * Devolve `{ uid, gravacaoDesligada }` (`SalvarRascunhoResultado`, em `rascunhos.service.ts`):
   * `gravacaoDesligada: true` significa "pare de reagendar a gravação automática nesta composição"
   * — insistir a cada 5 s ali é inútil ou vai enchendo a pasta Rascunhos sem teto. Falha comum de
   * rede NÃO liga esse sinal: essa é transitória e tentar de novo é o certo.
   */
  salvarRascunho: funcionarioProcedure
    .input(
      z.object({
        caixaId: z.string().min(1),
        para: z.array(z.string()).default([]),
        cc: z.array(z.string()).default([]),
        cco: z.array(z.string()).default([]),
        assunto: z.string().max(500).default(""),
        corpoHtml: z.string().max(500_000).default(""),
        uidAnterior: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      exigirModuloLigado();
      return rascunhos.salvarRascunho(ctx.user.id, input);
    }),

  /** Apaga um rascunho específico da pasta Drafts — chamado depois de um envio bem-sucedido. */
  descartarRascunho: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1), uid: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      exigirModuloLigado();
      return rascunhos.descartarRascunho(ctx.user.id, input);
    }),

  // ── A ficha do cliente/lead (ADR-95: "a caixa é privada, a correspondência é da empresa") ──
  //
  // Estas quatro são as ÚNICAS procedures do módulo que não filtram por `ctx.user.id`: elas
  // mostram o que a equipe trocou com um cliente, e o filtro é o CLIENTE, não o dono da caixa.
  // O que as torna aceitáveis é o que elas NÃO devolvem — corpo nenhum, só metadado e o trecho
  // — mais a válvula do `marcarParticular` logo abaixo. Ver `vinculo.service.ts`.

  doCliente: funcionarioProcedure
    .input(z.object({ clienteId: z.string().min(1), limite: z.number().int().min(1).max(200).optional() }))
    .query(({ input }) => vinculo.mensagensDoCliente(input.clienteId, input.limite)),

  doLead: funcionarioProcedure
    .input(z.object({ leadId: z.string().min(1), limite: z.number().int().min(1).max(200).optional() }))
    .query(({ input }) => vinculo.mensagensDoLead(input.leadId, input.limite)),

  /** Linha do tempo unificada: o log dos e-mails automáticos + o que saiu/entrou pelas caixas. */
  conversaDoCliente: funcionarioProcedure
    .input(z.object({ clienteId: z.string().min(1), limite: z.number().int().min(1).max(200).optional() }))
    .query(({ input }) => vinculo.conversaDoCliente(input.clienteId, input.limite)),

  conversaDoLead: funcionarioProcedure
    .input(z.object({ leadId: z.string().min(1), limite: z.number().int().min(1).max(200).optional() }))
    .query(({ input }) => vinculo.conversaDoLead(input.leadId, input.limite)),

  /**
   * A válvula: tira da ficha um e-mail que é da vida particular de quem o recebeu. Só o dono da
   * caixa — a posse é conferida dentro do próprio `UPDATE` (não numa leitura antes dele), então
   * para quem não é dono não existe caminho em que algo seja gravado.
   */
  marcarParticular: funcionarioProcedure
    .input(z.object({ mensagemId: z.string().min(1), particular: z.boolean() }))
    .mutation(({ ctx, input }) =>
      vinculo.marcarParticular(ctx.user.id, input.mensagemId, input.particular),
    ),

  // ── O que a equipe faz A PARTIR de um e-mail (fases 2D-2 e 2D-3) ──────────────────────────
  //
  // As duas voltam a filtrar por `ctx.user.id`: são ações da caixa de quem clicou, e a posse vai
  // no `where` da consulta dentro do serviço. Ver `acoes.service.ts`.

  /** Diz à tela o que oferecer nesta mensagem: de qual cliente é, e se o remetente é conhecido. */
  contextoDaMensagem: funcionarioProcedure
    .input(z.object({ mensagemId: z.string().min(1) }))
    .query(({ ctx, input }) => acoes.contextoDaMensagem(ctx.user.id, input.mensagemId)),

  /** 2D-2: guarda o anexo recebido como documento do cliente. */
  arquivarAnexo: funcionarioProcedure
    .input(
      z.object({
        mensagemId: z.string().min(1),
        anexoId: z.string().min(1),
        clienteId: z.string().min(1).optional(),
      }),
    )
    .mutation(({ ctx, input }) => acoes.arquivarAnexoComoDocumento(ctx.user.id, input)),

  /** 2D-3: transforma o remetente desconhecido em lead do funil. */
  criarLeadDoRemetente: funcionarioProcedure
    .input(z.object({ mensagemId: z.string().min(1) }))
    .mutation(({ ctx, input }) => acoes.criarLeadDoRemetente(ctx.user.id, input)),
});
