import { TRPCError } from "@trpc/server";
import { mensagemDeLinkExpirado, situacaoDoLinkPublico } from "@app/shared";
import { prisma } from "@app/db";
import { destinatarioDeAssinatura } from "../documentos/destinatario-de-assinatura.js";
import type { AssinarInput } from "@app/shared";
import { hashConteudo } from "../../lib/hash.js";
import { gerarTokenPublico } from "../../lib/tokens.js";
import { enviarEmailTemplate } from "../emails/enviados.service.js";
import { notificar } from "../notificacoes/notificacoes.service.js";
import { reconciliarPassosAuto, avancarSeChecklistCompleto } from "../leads/leads.service.js";
import { config } from "../../config.js";

const linkAssinatura = (token: string) => `${config.WEB_ORIGIN}/assinar/${token}`;

/** Se o documento está ligado a um lead (passo com acaoDoc), reconcilia os passos automáticos dele. */
async function reconciliarLeadDoDocumento(documentoId: string): Promise<void> {
  const passo = await prisma.leadPasso.findFirst({ where: { documentoId }, select: { leadId: true } });
  if (passo) {
    await reconciliarPassosAuto(passo.leadId);
    // Assinar pode concluir o último passo obrigatório da etapa → o card anda sozinho.
    await avancarSeChecklistCompleto(passo.leadId, null).catch(() => {});
  }
}

/**
 * Solicita as assinaturas de um documento: cria uma assinatura para o CLIENTE do
 * documento e outra para a MEDCONSULTORIA (quem solicitou), congela o hash do
 * conteúdo atual e envia por e-mail o link de assinatura a cada signatário.
 */
export async function solicitar(
  documentoId: string,
  ator: { id: string; nome: string; email: string },
  avisarPorEmail = true,
) {
  const doc = await prisma.documento.findFirst({
    where: { id: documentoId, deletedAt: null },
    include: { cliente: { select: { id: true, nome: true, email: true } } },
  });
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });
  if (!doc.cliente) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Vincule um cliente ao documento antes de solicitar assinatura." });
  }
  if (!doc.cliente.email) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "O cliente precisa ter um e-mail cadastrado para assinar." });
  }

  const hash = hashConteudo(doc.conteudo);

  // O link vai para QUEM FALA PELA CLÍNICA, não para a caixa da recepção (ADR-137) — sem isso a
  // trava das rotas de token seria só estética: quem está proibido de assinar abriria a caixa
  // compartilhada e clicaria no link deslogado, que é o caminho do signatário legítimo.
  const assinante = await destinatarioDeAssinatura(doc.cliente.id, { nome: doc.cliente.nome, email: doc.cliente.email });

  // ⚠️ RECOMEÇAR O FLUXO NÃO PODE APAGAR UMA ASSINATURA QUE JÁ FOI DADA.
  //
  // O `deleteMany` abaixo é o que permite reenviar o pedido quando ninguém assinou ainda — e
  // isso continua valendo. O que ele NÃO pode fazer é destruir a prova: `Assinatura` guarda IP,
  // user-agent, data, hash do conteúdo assinado, a imagem do traço e quem assinou. Nada disso é
  // versionado em outro lugar (o `DocumentoVersao` guarda o TEXTO, nunca a assinatura), então
  // apagar era perda definitiva — e o pedido novo devolvia o contrato ao estado "não assinado",
  // sem uma linha no histórico dizendo que existiu uma assinatura ali.
  //
  // Recusar é o certo: quem precisa mesmo de um documento novo emite um documento novo.
  const jaAssinada = await prisma.assinatura.findFirst({
    where: { documentoId, status: "ASSINADO" },
    select: { nome: true, assinadoEm: true },
  });
  if (jaAssinada) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `Este documento já foi assinado por ${jaAssinada.nome}. Pedir assinatura de novo apagaria essa ` +
        "assinatura e a prova dela. Gere um documento novo se as condições mudaram.",
    });
  }

  // Recomeça o fluxo: remove assinaturas anteriores deste documento (nenhuma foi dada).
  await prisma.assinatura.deleteMany({ where: { documentoId } });
  const tkCliente = gerarTokenPublico();
  const tkMed = gerarTokenPublico();
  await prisma.$transaction([
    prisma.assinatura.create({
      data: { documentoId, papel: "CLIENTE", nome: assinante.nome, email: assinante.email, ordem: 0, hashDocumento: hash, token: tkCliente },
    }),
    prisma.assinatura.create({
      data: { documentoId, papel: "MEDCONSULTORIA", nome: ator.nome, email: ator.email, ordem: 1, hashDocumento: hash, token: tkMed },
    }),
    prisma.documento.update({ where: { id: documentoId }, data: { assinaturaSolicitadaEm: new Date(), assinadoEm: null } }),
  ]);

  const assinaturas = await prisma.assinatura.findMany({ where: { documentoId }, orderBy: { ordem: "asc" } });

  // E-mail com o link para cada signatário — só se a equipe optar por avisar (checkbox).
  // Se não enviar, o link fica disponível no painel do documento ("Abrir link").
  if (avisarPorEmail) {
    for (const a of assinaturas) {
      if (!a.email) continue;
      void enviarEmailTemplate("assinatura_solicitada", a.email, {
        nome: a.nome,
        documento: doc.titulo,
        link: linkAssinatura(a.token),
      }).catch(() => {});
    }
  }

  await prisma.activityLog.create({
    data: { userId: ator.id, acao: "documento.assinatura_solicitada", entidadeTipo: "documento", entidadeId: documentoId },
  });

  // Funil: o passo "Elaborar e enviar a proposta/contrato" conclui ao solicitar a assinatura.
  await reconciliarLeadDoDocumento(documentoId);

  return assinaturas.map((a) => ({ id: a.id, papel: a.papel, nome: a.nome, token: a.token, status: a.status }));
}

/** Lista as assinaturas de um documento (uso interno — painel do documento). */
export async function listarDoDocumento(documentoId: string) {
  const doc = await prisma.documento.findUnique({ where: { id: documentoId }, select: { conteudo: true } });
  const hashAtual = doc ? hashConteudo(doc.conteudo) : null;
  const assinaturas = await prisma.assinatura.findMany({ where: { documentoId }, orderBy: { ordem: "asc" } });
  return assinaturas.map((a) => ({
    id: a.id,
    papel: a.papel,
    nome: a.nome,
    email: a.email,
    status: a.status,
    metodo: a.metodo,
    assinadoEm: a.assinadoEm,
    ip: a.ip,
    token: a.token,
    hashDocumento: a.hashDocumento,
    integro: a.status === "ASSINADO" ? a.hashDocumento === hashAtual : true,
  }));
}

/**
 * Recusa link vencido (ADR-141). `PRECONDITION_FAILED`, e não `INTERNAL`, porque isto é
 * estado ESPERADO: erro cru vira "erro do sistema" no painel do ROOT (a lição da ADR-135).
 */
function exigirLinkValido(a: { criadoEm: Date; assinadoEm: Date | null }): void {
  const s = situacaoDoLinkPublico({ emitidoEm: a.criadoEm, respondidoEm: a.assinadoEm, agora: new Date() });
  if (!s.valido) throw new TRPCError({ code: "PRECONDITION_FAILED", message: mensagemDeLinkExpirado(s) });
}

/** Dados públicos para a página de assinatura (acesso por token, sem login). */
export async function getPorToken(token: string) {
  const a = await prisma.assinatura.findUnique({
    where: { token },
    include: { documento: { select: { titulo: true, conteudo: true } } },
  });
  if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Link de assinatura inválido." });
  exigirLinkValido(a);

  // Quem abriu, e quando. Antes disto ninguém sabia — o link é anônimo por natureza,
  // mas o ACESSO precisa deixar rastro (LGPD, ADR-141). Sem usuário: é gente de fora.
  await prisma.activityLog.create({
    data: { acao: "assinatura.link_aberto", entidadeTipo: "documento", entidadeId: a.documentoId },
  });

  const hashAtual = hashConteudo(a.documento.conteudo);
  const outras = await prisma.assinatura.findMany({
    where: { documentoId: a.documentoId },
    orderBy: { ordem: "asc" },
    select: { papel: true, nome: true, status: true, assinadoEm: true },
  });
  return {
    documento: { titulo: a.documento.titulo, conteudo: a.documento.conteudo },
    signatario: { nome: a.nome, papel: a.papel },
    status: a.status,
    assinadoEm: a.assinadoEm,
    metodo: a.metodo,
    nomeDigitado: a.nomeDigitado,
    imagem: a.imagem,
    // Se o conteúdo mudou depois do envio, bloqueia a assinatura (integridade).
    conteudoAlterado: a.hashDocumento !== hashAtual,
    todas: outras,
  };
}

/** Registra a assinatura (página pública). Grava a trilha de auditoria. */
export async function assinar(
  input: AssinarInput,
  ip?: string,
  userAgent?: string,
  assinadoPorId?: string | null,
) {
  const a = await prisma.assinatura.findUnique({
    where: { token: input.token },
    include: { documento: { select: { id: true, titulo: true, conteudo: true, criadoPorId: true } } },
  });
  if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Link de assinatura inválido." });
  if (a.status === "ASSINADO") return { ok: true, concluido: false, jaAssinado: true };
  // ⚠️ Barrar só a LEITURA seria a segunda porta da ADR-140: o link expirado ainda assinaria.
  exigirLinkValido(a);

  if (a.hashDocumento !== hashConteudo(a.documento.conteudo)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "O documento foi alterado após o envio. Peça um novo link de assinatura.",
    });
  }

  await prisma.assinatura.update({
    where: { id: a.id },
    data: {
      status: "ASSINADO",
      metodo: input.metodo,
      imagem: input.metodo === "DESENHO" ? input.imagem ?? null : null,
      nomeDigitado: input.metodo === "DIGITADO" ? input.nomeDigitado?.trim() ?? null : null,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
      // Quem clicou, se estava logado (ADR-137). Nulo no link de e-mail, que é anônimo.
      assinadoPorId: assinadoPorId ?? null,
      assinadoEm: new Date(),
    },
  });

  // Todas assinadas? Conclui o documento e avisa o responsável.
  const pendentes = await prisma.assinatura.count({ where: { documentoId: a.documentoId, status: { not: "ASSINADO" } } });
  const concluido = pendentes === 0;
  if (concluido) {
    await prisma.documento.update({ where: { id: a.documentoId }, data: { assinadoEm: new Date() } });
    await prisma.activityLog.create({
      data: {
        userId: assinadoPorId ?? null,
        acao: "documento.assinado",
        entidadeTipo: "documento",
        entidadeId: a.documentoId,
      },
    });
    // Integração com o funil: reconcilia os passos automáticos do lead — conclui tanto
    // o passo do documento quanto o "Confirmar o aceite/assinatura" (marco "assinado").
    await reconciliarLeadDoDocumento(a.documentoId);
    // Avisa quem criou o documento (se o criador não foi removido). M18: template PRÓPRIO —
    // `documento_revisao` diz "está aguardando sua revisão", o oposto de "assinado por todos".
    if (a.documento.criadoPorId) {
      void notificar(
        a.documento.criadoPorId,
        "documento_assinado",
        { documento: a.documento.titulo },
        { entidadeTipo: "documento", entidadeId: a.documentoId },
      ).catch(() => {});
    }
  }
  return { ok: true, concluido };
}
