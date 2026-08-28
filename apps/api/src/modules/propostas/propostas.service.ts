import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { destinatarioDeAssinatura } from "../documentos/destinatario-de-assinatura.js";
import type { ResponderPropostaInput } from "@app/shared";
import { hashConteudo } from "../../lib/hash.js";
import { enviarEmailTemplate } from "../emails/enviados.service.js";
import { notificar } from "../notificacoes/notificacoes.service.js";
import { avancarLeadPorClienteAuto } from "../leads/leads.service.js";
import { config } from "../../config.js";

const linkProposta = (token: string) => `${config.WEB_ORIGIN}/proposta/${token}`;

/** Quem deve ser avisado sobre a resposta da proposta: o responsável do cliente + a gestão. */
async function alvosDaEquipe(clienteId: string): Promise<string[]> {
  const [cliente, admins] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { responsavelId: true } }),
    prisma.user.findMany({
      where: { ativo: true, deletedAt: null, role: { in: ["ADMIN", "ROOT"] } },
      select: { id: true },
    }),
  ]);
  const alvos = new Set<string>(admins.map((a) => a.id));
  if (cliente?.responsavelId) alvos.add(cliente.responsavelId);
  return [...alvos];
}

/**
 * Habilita o aceite online de uma proposta: congela o hash do conteúdo atual, gera um
 * token público e (opcionalmente) envia o link ao cliente por e-mail. Reinicia qualquer
 * resposta anterior. Avança o funil (etapa "proposta") por ser o envio ao cliente.
 */
export async function habilitarAceite(
  documentoId: string,
  ator: { id: string; nome: string },
  avisarPorEmail = true,
) {
  const doc = await prisma.documento.findFirst({
    where: { id: documentoId, deletedAt: null },
    include: { cliente: { select: { id: true, nome: true, email: true } } },
  });
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });
  if (!doc.cliente) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Vincule um cliente à proposta antes de habilitar o aceite." });
  }

  const token = randomUUID();
  await prisma.documento.update({
    where: { id: documentoId },
    data: {
      propostaToken: token,
      propostaStatus: "PENDENTE",
      propostaHash: hashConteudo(doc.conteudo),
      propostaSolicitadaEm: new Date(),
      propostaRespondidaEm: null,
      propostaRespIp: null,
      propostaMotivoRecusa: null,
    },
  });

  if (avisarPorEmail && doc.cliente.email) {
    // Para QUEM FALA PELA CLÍNICA, não para a caixa da recepção (ADR-137) — ver
    // `destinatarioDeAssinatura`. Aceitar proposta é ação de responsável.
    const destino = await destinatarioDeAssinatura(doc.cliente.id, { nome: doc.cliente.nome, email: doc.cliente.email });
    void enviarEmailTemplate("proposta_para_aceite", destino.email, {
      nome: destino.nome,
      documento: doc.titulo,
      link: linkProposta(token),
    }).catch(() => {});
  }

  await prisma.activityLog.create({
    data: { userId: ator.id, acao: "proposta.aceite_habilitado", entidadeTipo: "documento", entidadeId: documentoId },
  });

  // O envio da proposta empurra o funil para a etapa "Proposta" (só avança, nunca regride).
  void avancarLeadPorClienteAuto(doc.cliente.id, "proposta", "Proposta enviada ao cliente para aceite").catch(() => {});

  return { token, link: linkProposta(token) };
}

/** Estado do aceite (painel do documento, uso interno). */
export async function statusDoDocumento(documentoId: string) {
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: {
      conteudo: true,
      propostaToken: true,
      propostaStatus: true,
      propostaHash: true,
      propostaSolicitadaEm: true,
      propostaRespondidaEm: true,
      propostaMotivoRecusa: true,
      propostaRespIp: true,
    },
  });
  if (!doc || !doc.propostaToken) return null;
  return {
    token: doc.propostaToken,
    link: linkProposta(doc.propostaToken),
    status: doc.propostaStatus,
    solicitadaEm: doc.propostaSolicitadaEm,
    respondidaEm: doc.propostaRespondidaEm,
    motivoRecusa: doc.propostaMotivoRecusa,
    ip: doc.propostaRespIp,
    // Se o conteúdo mudou depois de habilitar, o cliente não consegue aceitar (integridade).
    conteudoAlterado: doc.propostaStatus === "PENDENTE" && doc.propostaHash !== hashConteudo(doc.conteudo),
  };
}

/** Dados públicos da proposta (acesso por token, sem login). */
export async function getPorToken(token: string) {
  const doc = await prisma.documento.findFirst({
    where: { propostaToken: token, deletedAt: null },
    select: {
      titulo: true,
      conteudo: true,
      propostaStatus: true,
      propostaHash: true,
      propostaRespondidaEm: true,
      propostaMotivoRecusa: true,
      cliente: { select: { nome: true } },
      modelo: { select: { tipo: true } },
    },
  });
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Link de proposta inválido." });
  return {
    documento: { titulo: doc.titulo, conteudo: doc.conteudo },
    clienteNome: doc.cliente?.nome ?? null,
    tipo: doc.modelo?.tipo ?? "PROPOSTA",
    status: doc.propostaStatus,
    respondidaEm: doc.propostaRespondidaEm,
    motivoRecusa: doc.propostaMotivoRecusa,
    conteudoAlterado: doc.propostaStatus === "PENDENTE" && doc.propostaHash !== hashConteudo(doc.conteudo),
  };
}

/**
 * Registra a resposta do cliente (página pública / Portal). Aceite avança o funil e
 * avisa a equipe; recusa grava o motivo e avisa a equipe. Trilha de auditoria (IP/quando).
 * Idempotente: se já respondida, não sobrescreve.
 */
export async function responder(input: ResponderPropostaInput, ip?: string, respondidoPorId?: string | null) {
  const doc = await prisma.documento.findFirst({
    where: { propostaToken: input.token, deletedAt: null },
    select: { id: true, titulo: true, conteudo: true, propostaStatus: true, propostaHash: true, clienteId: true, criadoPorId: true, itens: true, cliente: { select: { nome: true } } },
  });
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Link de proposta inválido." });
  if (doc.propostaStatus !== "PENDENTE") {
    return { ok: true, jaRespondida: true, decisao: doc.propostaStatus };
  }
  if (doc.propostaHash !== hashConteudo(doc.conteudo)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A proposta foi alterada após o envio. Peça um novo link à MedConsultoria.",
    });
  }

  const aceita = input.decisao === "ACEITA";
  await prisma.documento.update({
    where: { id: doc.id },
    data: {
      propostaStatus: aceita ? "ACEITA" : "RECUSADA",
      propostaRespondidaEm: new Date(),
      propostaRespIp: ip ?? null,
      // Quem clicou, se estava logado (ADR-137). Nulo no link de e-mail, que é anônimo.
      propostaRespPorId: respondidoPorId ?? null,
      propostaMotivoRecusa: aceita ? null : input.motivo?.trim() || null,
    },
  });
  await prisma.activityLog.create({
    data: {
      userId: respondidoPorId ?? null,
      acao: aceita ? "proposta.aceita" : "proposta.recusada",
      entidadeTipo: "documento",
      entidadeId: doc.id,
      dados: aceita ? undefined : { motivo: input.motivo?.trim() ?? "" },
    },
  });

  const nomeCliente = doc.cliente?.nome ?? "O cliente";
  if (doc.clienteId) {
    if (aceita) {
      // Aceite fecha a proposta → avança o funil para a Negociação (rumo ao fechamento).
      void avancarLeadPorClienteAuto(doc.clienteId, "negociacao", "Proposta aceita pelo cliente").catch(() => {});
      // AUTOMAÇÃO: gera o CONTRATO automaticamente (em REVISÃO) com os serviços contratados e as
      // cláusulas de cada um, para a equipe revisar e enviar para o cliente assinar. Import
      // dinâmico p/ evitar ciclo de módulos; o autor é quem criou a proposta.
      const clienteId = doc.clienteId;
      const criadoPorId = doc.criadoPorId;
      // Itens estruturados congelados na proposta (serviços + valores aceitos).
      const itensAceitos = Array.isArray(doc.itens)
        ? (doc.itens as {
            servicoId: string;
            valor?: number | null;
            recorrencia?: "AVULSO" | "MENSAL";
            percentual?: number | null;
            /** Convênios atendidos naquele serviço (ADR-126) — viajam dentro do item aceito. */
            conveniosIds?: string[];
          }[])
        : [];
      void (async () => {
        // Ator das automações: quem criou a proposta; se o criador foi removido (criadoPorId nulo),
        // cai no responsável do cliente e, por fim, num ADMIN/ROOT ativo (para a atribuição/FK valer).
        const atorId =
          criadoPorId ??
          (await prisma.cliente.findUnique({ where: { id: clienteId }, select: { responsavelId: true } }))?.responsavelId ??
          (await prisma.user.findFirst({ where: { role: { in: ["ADMIN", "ROOT"] }, ativo: true, deletedAt: null }, select: { id: true } }))?.id ??
          null;
        if (!atorId) return;
        // 1) Sincroniza os serviços ACEITOS com os serviços contratados do cliente (valores reais)
        // → o contrato e a ficha passam a refletir exatamente o que o cliente aceitou. Ver ADR-81.
        if (itensAceitos.length) {
          const { sincronizarServicosContratados } = await import("../servicos/servicos-cliente.service.js");
          await sincronizarServicosContratados(clienteId, itensAceitos, { id: atorId });
        }
        // 2) Gera o CONTRATO automaticamente (EM_REVISÃO) já com esses serviços/valores + cláusulas.
        // Por CLIENTE (não exige lead ativo) → funciona também para cliente já convertido.
        const lead = await prisma.lead.findFirst({
          where: { clienteId, deletedAt: null, convertidoEmClienteId: null },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        const { gerarContratoAutoParaCliente } = await import("../documentos/documentos.service.js");
        await gerarContratoAutoParaCliente(clienteId, atorId, { leadId: lead?.id });
      })().catch(() => {});
    }
    for (const userId of await alvosDaEquipe(doc.clienteId)) {
      void notificar(
        userId,
        aceita ? "proposta_aceita" : "proposta_recusada",
        aceita
          ? { cliente: nomeCliente, documento: doc.titulo }
          : { cliente: nomeCliente, documento: doc.titulo, motivo: input.motivo?.trim() || "(não informado)" },
        { entidadeTipo: "documento", entidadeId: doc.id },
      ).catch(() => {});
    }
  }

  return { ok: true, decisao: aceita ? "ACEITA" : "RECUSADA" };
}
