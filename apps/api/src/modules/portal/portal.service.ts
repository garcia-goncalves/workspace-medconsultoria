import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { podeAssinarPelaClinica, type SessaoQueAssina } from "@app/shared";
import { notificationService } from "../../realtime/socket.js";
import { notificar } from "../notificacoes/notificacoes.service.js";

/**
 * Dados cadastrais do PRÓPRIO cliente (Portal) — só os campos que ele pode ver/editar.
 * Escopado por clienteId (LGPD: direito de acesso aos próprios dados).
 */
export async function meusDados(clienteId: string) {
  const c = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { nome: true, cnpj: true, email: true, telefone: true },
  });
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Cadastro não encontrado." });
  return c;
}

/**
 * O cliente atualiza os PRÓPRIOS dados cadastrais pelo Portal (LGPD: direito de retificação).
 * Escopado por clienteId; sincroniza o nome de exibição do usuário do Portal com o cadastro.
 */
export async function atualizarMeusDados(
  clienteId: string,
  userId: string,
  dados: { nome: string; cnpj?: string; telefone?: string },
) {
  const nome = dados.nome.trim();
  // `email` NÃO entra aqui de propósito: o endereço do cadastro é chave de consulta
  // (`chaveDeEndereco`/`clientesPorEnderecos`), então deixar o cliente escolhê-lo é
  // deixá-lo escolher o que a própria consulta devolve — inclusive e-mail de outro
  // cliente. Ver o comentário do `portalMeusDadosSchema`. Retificação: pela equipe.
  await prisma.cliente.update({
    where: { id: clienteId },
    data: {
      nome,
      cnpj: dados.cnpj?.trim() || null,
      telefone: dados.telefone?.trim() || null,
    },
  });
  // Mantém o nome de exibição do usuário do Portal em sincronia com o cadastro.
  await prisma.user.update({ where: { id: userId }, data: { nome } }).catch(() => {});
  await prisma.activityLog
    .create({ data: { userId, acao: "cliente.dados_atualizados_portal", entidadeTipo: "cliente", entidadeId: clienteId } })
    .catch(() => {});
  return { ok: true, nome };
}

/**
 * Resumo do Portal — SEMPRE filtrado por clienteId (isolamento). O cliente vê
 * apenas seus projetos, seus documentos ENVIADOS e suas reuniões futuras.
 */
export async function resumo(
  clienteId: string,
  /**
   * Quem está vendo. O token de aceite/assinatura só sai daqui para quem pode agir com ele
   * (ADR-137): a secretária EQUIPE e a sessão de suporte da Med veem que existe uma proposta
   * — a trava é sobre assinar, não sobre ver —, mas o link não é entregue. Sem isto o
   * servidor recusaria a assinatura e a tela ainda mostraria o botão, que é o modo de falha
   * da ADR-133 (a tela dizendo uma coisa e o servidor fazendo outra).
   */
  sessao?: SessaoQueAssina | null,
) {
  const podeAssinar = podeAssinarPelaClinica(sessao).pode;
  const agora = new Date();
  const [cliente, projetos, documentos, reunioes, leadAtivo, totalEtapas, paraAssinar, leadPerdido, cardsAguardando, propostasPendentes] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } }),
    prisma.projeto.findMany({
      where: { clienteId, deletedAt: null },
      select: {
        id: true,
        nome: true,
        status: true,
        previsaoFim: true,
        // Só o status dos cartões (para calcular progresso) — nada interno vaza.
        cards: { where: { deletedAt: null }, select: { status: true } },
        // Próxima reunião do projeto (mesmo filtro seguro dos eventos do Portal).
        eventos: {
          where: { inicio: { gte: agora }, escopo: "EMPRESA", tipo: { in: ["REUNIAO", "COMPROMISSO"] } },
          orderBy: { inicio: "asc" },
          take: 1,
          select: { titulo: true, inicio: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.documento.findMany({
      where: { clienteId, deletedAt: null, status: "ENVIADO" },
      // Campos p/ a situação coerente (o cliente vê "Aceita"/"Assinado"/"Disponível"…).
      select: {
        id: true,
        titulo: true,
        updatedAt: true,
        status: true,
        propostaStatus: true,
        assinaturaSolicitadaEm: true,
        assinadoEm: true,
        modelo: { select: { tipo: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.evento.findMany({
      // Só eventos voltados ao cliente: escopo EMPRESA e tipos de encontro
      // (reunião/compromisso). Lembretes/eventos pessoais internos NUNCA vazam.
      where: {
        clienteId,
        deletedAt: null,
        inicio: { gte: agora },
        escopo: "EMPRESA",
        tipo: { in: ["REUNIAO", "COMPROMISSO"] },
      },
      select: {
        id: true,
        titulo: true,
        inicio: true,
        fim: true,
        linkReuniao: true,
        tipo: true,
        local: true,
        descricao: true,
        clienteConfirmadoEm: true,
      },
      orderBy: { inicio: "asc" },
      take: 10,
    }),
    // Lead ativo ligado a este cliente (prospect ainda no funil, não desistido) → andamento.
    prisma.lead.findFirst({
      where: { clienteId, deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
      orderBy: { createdAt: "desc" },
      select: {
        pipelineStage: { select: { nome: true, chaveAuto: true, ordem: true } },
        servicos: { select: { id: true, nome: true }, orderBy: { ordem: "asc" } },
      },
    }),
    prisma.pipelineStage.count(),
    // Documentos aguardando a assinatura DESTE cliente — CTA "Assinar" direto no Portal.
    prisma.assinatura.findMany({
      where: { status: "PENDENTE", papel: "CLIENTE", documento: { clienteId, deletedAt: null } },
      select: { id: true, token: true, documento: { select: { titulo: true } } },
      orderBy: { criadoEm: "desc" },
    }),
    // Lead perdido ligado a este cliente (desistência/perda) → oferece retomar no Portal.
    prisma.lead.findFirst({
      where: { clienteId, deletedAt: null, convertidoEmClienteId: null, NOT: { perdidoEm: null } },
      select: { id: true },
    }),
    // "O que depende de você": cartões em AGUARDANDO_CLIENTE nos projetos do cliente.
    prisma.card.findMany({
      where: { status: "AGUARDANDO_CLIENTE", deletedAt: null, projeto: { clienteId, deletedAt: null } },
      select: { id: true, titulo: true, prazo: true, projeto: { select: { nome: true } } },
      orderBy: [{ prazo: "asc" }, { createdAt: "asc" }],
    }),
    // Propostas aguardando o aceite/recusa DESTE cliente — CTA direto no Portal.
    prisma.documento.findMany({
      where: { clienteId, deletedAt: null, propostaStatus: "PENDENTE", propostaToken: { not: null } },
      select: { id: true, titulo: true, propostaToken: true },
      orderBy: { propostaSolicitadaEm: "desc" },
    }),
  ]);

  // Projeta só o que é seguro para o cliente ver: progresso agregado + próxima reunião.
  const projetosView = projetos.map((p) => {
    const total = p.cards.length;
    const concluidos = p.cards.filter((c) => c.status === "CONCLUIDO").length;
    return {
      id: p.id,
      nome: p.nome,
      status: p.status,
      previsaoFim: p.previsaoFim,
      total,
      concluidos,
      progresso: total ? Math.round((concluidos / total) * 100) : 0,
      proximaReuniao: p.eventos[0] ?? null,
    };
  });
  const aguardandoVoce = cardsAguardando.map((c) => ({ id: c.id, titulo: c.titulo, prazo: c.prazo, projeto: c.projeto.nome }));

  const atendimento = leadAtivo
    ? {
        etapa: leadAtivo.pipelineStage.nome,
        chave: leadAtivo.pipelineStage.chaveAuto,
        passo: leadAtivo.pipelineStage.ordem + 1,
        total: totalEtapas,
      }
    : null;

  return {
    clienteNome: cliente?.nome ?? "Cliente",
    projetos: projetosView,
    aguardandoVoce,
    documentos,
    reunioes,
    atendimento,
    // O prospect pode desistir enquanto há atendimento ativo; se já desistiu (e não há
    // atendimento ativo), pode retomar. Cliente pleno (sem lead no funil) não vê nada disso.
    podeDesistir: !!leadAtivo,
    atendimentoEncerrado: !leadAtivo && !!leadPerdido,
    // Serviços que o cliente já pediu (pré-marca no autosserviço e mostra no atendimento).
    servicosAtuais: leadAtivo?.servicos ?? [],
    podeAssinar,
    paraAssinar: paraAssinar.map((a) => ({ id: a.id, token: podeAssinar ? a.token : null, titulo: a.documento.titulo })),
    propostas: propostasPendentes.map((p) => ({ id: p.id, token: podeAssinar ? p.propostaToken! : null, titulo: p.titulo })),
  };
}

/**
 * Conteúdo de um documento — só retorna se for do próprio cliente e ENVIADO.
 * Usa NOT_FOUND (não FORBIDDEN) para não revelar a existência de documentos alheios.
 */
export async function getDocumento(id: string, clienteId: string) {
  const doc = await prisma.documento.findFirst({
    where: { id, clienteId, status: "ENVIADO", deletedAt: null },
    select: { id: true, titulo: true, conteudo: true },
  });
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
  return doc;
}

// ── Suporte (canal de mensagens Portal ↔ equipe, isolado por clienteId) ──

/** Histórico do canal de suporte do cliente (usado pelos dois lados). */
export function suporteList(clienteId: string) {
  return prisma.suporteMensagem.findMany({
    where: { clienteId },
    orderBy: { createdAt: "asc" },
    include: { autor: { select: { nome: true } } },
  });
}

/** Cliente (Portal) envia uma mensagem → avisa a equipe. */
export async function suporteEnviarCliente(clienteId: string, autorId: string, corpo: string) {
  const msg = await prisma.suporteMensagem.create({
    data: { clienteId, autorId, corpo: corpo.trim(), daEquipe: false },
    include: { autor: { select: { nome: true } } },
  });
  await prisma.suporteMensagem.updateMany({
    where: { clienteId, daEquipe: true, lida: false },
    data: { lida: true },
  });

  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { nome: true, responsavelId: true },
  });
  const admins = await prisma.user.findMany({
    where: { ativo: true, deletedAt: null, role: { in: ["ADMIN", "ROOT"] } },
    select: { id: true },
  });
  const alvos = new Set<string>(admins.map((a) => a.id));
  if (cliente?.responsavelId) alvos.add(cliente.responsavelId);
  for (const userId of alvos) {
    await notificar(
      userId,
      "suporte",
      { cliente: cliente?.nome ?? "cliente", mensagem: corpo.trim().slice(0, 120) },
      { entidadeTipo: "cliente", entidadeId: clienteId },
    );
    notificationService.emitToUser(userId, "suporte", { clienteId });
  }
  return msg;
}

/** Equipe responde (pela ficha do cliente) → atualiza o Portal do cliente em tempo real. */
export async function suporteResponderEquipe(clienteId: string, autorId: string, corpo: string) {
  const msg = await prisma.suporteMensagem.create({
    data: { clienteId, autorId, corpo: corpo.trim(), daEquipe: true },
    include: { autor: { select: { nome: true } } },
  });
  await prisma.suporteMensagem.updateMany({
    where: { clienteId, daEquipe: false, lida: false },
    data: { lida: true },
  });
  const portalUsers = await prisma.user.findMany({
    where: { clienteId, role: "CLIENTE", ativo: true, deletedAt: null },
    select: { id: true },
  });
  for (const u of portalUsers) notificationService.emitToUser(u.id, "suporte", { clienteId });
  return msg;
}
