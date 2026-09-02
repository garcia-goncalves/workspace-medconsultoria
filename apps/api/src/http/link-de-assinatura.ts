import type { FastifyInstance } from "fastify";
import { prisma } from "@app/db";
import { usuarioDaRequest } from "./uploads.js";
import { config } from "../config.js";

/**
 * ABRE O LINK DE ASSINATURA PELO PAINEL DO DOCUMENTO — registrando QUEM abriu.
 *
 * O painel do documento precisa mesmo entregar esse link: é assim que a equipe reenvia a
 * assinatura por WhatsApp quando o e-mail não chegou. O problema era o CAMINHO. O token vinha
 * no corpo da consulta `assinaturas.doDocumento`, em claro, para qualquer FUNCIONARIO — e a
 * rota de assinar é pública de propósito (quem assina clica num link de e-mail, sem login).
 *
 * ⚠️ **O risco não é o acesso, é a ATRIBUIÇÃO.** Quem assina deslogado grava
 * `assinadoPorId: null`, que é o caso NORMAL do médico assinando pelo link. Então uma
 * assinatura fabricada por alguém da casa, numa janela anônima, ficava **indistinguível** da
 * legítima: mesmo formato, mesmo nulo. O contrato perdia o valor de prova sem que nada no
 * sistema registrasse a diferença.
 *
 * A cura mantém a função e fecha o silêncio: o token sai do corpo da resposta e passa a ser
 * entregue só por aqui, atrás da sessão, deixando linha no `activityLog`. Se um dia uma
 * assinatura for contestada, existe o registro de quem tinha o link aberto e quando.
 *
 * ⚠️ Redirecionamento, e não uma mutação que abre janela: `window.open` depois de `await` é
 * barrado como pop-up. Um `<a href>` comum atravessa, e o desvio acontece no servidor.
 */
export function registrarRotaLinkDeAssinatura(app: FastifyInstance) {
  app.get<{ Params: { assinaturaId: string } }>("/ir/assinar/:assinaturaId", async (req, reply) => {
    const user = await usuarioDaRequest(req);
    if (!user) return reply.code(401).send({ error: "Não autenticado." });
    // Esta porta é do painel interno do documento. O cliente chega pelo link do e-mail dele.
    if (user.role === "CLIENTE") return reply.code(403).send({ error: "Sem acesso." });

    const assinatura = await prisma.assinatura.findUnique({
      where: { id: req.params.assinaturaId },
      select: { id: true, token: true, papel: true, status: true, documentoId: true, nome: true },
    });
    if (!assinatura) return reply.code(404).send({ error: "Assinatura não encontrada." });
    if (assinatura.status === "ASSINADO") {
      return reply.code(409).send({ error: "Este documento já foi assinado." });
    }

    // A assinatura da própria MedConsultoria é a pessoa assinando o que é dela — registrar quem
    // abriu ali não diz nada. O que interessa é o link do CLIENTE saindo das nossas mãos.
    if (assinatura.papel !== "MEDCONSULTORIA") {
      await prisma.activityLog
        .create({
          data: {
            userId: user.id,
            acao: "documento.link_de_assinatura_aberto",
            entidadeTipo: "documento",
            entidadeId: assinatura.documentoId,
            dados: { assinaturaId: assinatura.id, papel: assinatura.papel, signatario: assinatura.nome },
          },
        })
        // O registro não pode impedir a equipe de trabalhar; se ele falhar, a falha é do banco,
        // e o painel de erros já a mostra por outro caminho.
        .catch(() => {});
    }

    return reply.redirect(`${config.WEB_ORIGIN}/assinar/${assinatura.token}`, 302);
  });
}
