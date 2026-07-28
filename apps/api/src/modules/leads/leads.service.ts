import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { CreateLeadInput, UpdateLeadInput, MoveLeadInput, CapturaLeadInput } from "@app/shared";
import { situacaoDocumento } from "@app/shared";
import { listStages } from "../pipeline/pipeline.service.js";
import { notificar } from "../notificacoes/notificacoes.service.js";
import { convidarUsuario, reenviarConvite, garantirAcessoPortal } from "../usuarios/usuarios.service.js";
import { garantirCardDoServicoContratado } from "../projetos/projetos.service.js";
import { enviarEmailTemplate } from "../emails/enviados.service.js";
import { config } from "../../config.js";
import type { Role } from "@app/shared";

const clean = (v?: string | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

function hostDe(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Rastreio de atribuição: a partir dos sinais capturados na página (UTM, referrer,
 * clique de anúncio), identifica automaticamente a ORIGEM do lead e monta um resumo
 * legível de "de onde veio". Se nada for identificável, assume "Página de Captura".
 */
export function derivarRastreioOrigem(t: {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  gclid?: string;
  fbclid?: string;
  referrer?: string;
}): { origem: string; rastreio: string } {
  const refHost = hostDe(t.referrer);
  const s = (t.utmSource ?? "").toLowerCase();
  const m = (t.utmMedium ?? "").toLowerCase();
  const r = (refHost ?? "").toLowerCase();
  const tem = (...ks: string[]) => ks.some((k) => s.includes(k) || r.includes(k));

  let origem = "Página de Captura";
  if (t.fbclid || tem("facebook", "instagram", "fbclid") || s === "fb" || s === "ig") origem = "Facebook/Instagram";
  else if (tem("linkedin")) origem = "LinkedIn";
  else if (tem("whatsapp", "wa.me", "whats")) origem = "WhatsApp";
  else if (tem("tiktok")) origem = "TikTok";
  else if (tem("telegram", "t.me")) origem = "Telegram";
  else if (t.gclid || tem("google", "bing", "duckduckgo", "yahoo", "ecosia", "search")) origem = "Google";
  else if (tem("youtube", "youtu.be")) origem = "YouTube";
  else if (tem("t.co", "twitter", "x.com")) origem = "Twitter/X";
  else if (m.includes("email") || m.includes("e-mail") || m.includes("newsletter") || tem("mailchimp", "rdstation")) origem = "E-mail marketing";
  else if (t.utmSource) origem = t.utmSource;
  else if (refHost) origem = "Site";

  const partes: string[] = [];
  if (t.utmSource) partes.push(`Fonte (utm_source): ${t.utmSource}`);
  if (t.utmMedium) partes.push(`Meio (utm_medium): ${t.utmMedium}`);
  if (t.utmCampaign) partes.push(`Campanha: ${t.utmCampaign}`);
  if (t.gclid) partes.push("Clique de anúncio do Google (gclid)");
  if (t.fbclid) partes.push("Clique de anúncio do Facebook/Instagram (fbclid)");
  if (refHost) partes.push(`Veio de: ${refHost}`);
  else if (!t.utmSource) partes.push("Acesso direto (digitou o link ou favorito)");

  return { origem, rastreio: `Recebido pelo formulário de captação do site.\n${partes.join("\n")}`.trim() };
}

/** Nome do usuário (para compor o rastreio de cadastro manual). Best-effort. */
async function nomeUsuario(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { nome: true } });
  return u?.nome ?? null;
}

/** Data N dias úteis à frente, no horário `hora` (para agendar o kickoff). */
function proximoDiaUtil(dias: number, hora: number): Date {
  const d = new Date();
  let restantes = dias;
  while (restantes > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) restantes--;
  }
  d.setHours(hora, 0, 0, 0);
  return d;
}

// Rate-limit em memória para o formulário público (por IP): no máx. 5 por hora.
const CAPTURA_MAX = 5;
const CAPTURA_JANELA_MS = 60 * 60 * 1000;
const capturasPorIp = new Map<string, { count: number; ate: number }>();

function capturaBloqueada(ip: string): boolean {
  const reg = capturasPorIp.get(ip);
  const agora = Date.now();
  if (!reg || agora >= reg.ate) {
    capturasPorIp.set(ip, { count: 1, ate: agora + CAPTURA_JANELA_MS });
    return false;
  }
  reg.count += 1;
  return reg.count > CAPTURA_MAX;
}

/**
 * Avança um lead automaticamente para a etapa de `chaveDestino` — mas SÓ para frente
 * (nunca regride, respeitando um movimento manual mais adiantado) e nunca em leads já
 * convertidos/removidos. Registra na atividade. Best-effort: nunca lança.
 */
export async function avancarLeadAuto(leadId: string, chaveDestino: string, motivo: string): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { pipelineStage: { select: { ordem: true, nome: true } } },
    });
    if (!lead || lead.deletedAt || lead.convertidoEmClienteId) return;

    const destino = await prisma.pipelineStage.findFirst({ where: { chaveAuto: chaveDestino } });
    if (!destino || destino.id === lead.pipelineStageId || destino.ordem <= lead.pipelineStage.ordem) return;

    const max = await prisma.lead.aggregate({
      where: { pipelineStageId: destino.id, deletedAt: null, convertidoEmClienteId: null },
      _max: { ordem: true },
    });
    await prisma.lead.update({
      where: { id: leadId },
      data: { pipelineStageId: destino.id, ordem: (max._max.ordem ?? -1) + 1 },
    });
    await prisma.activityLog.create({
      data: {
        acao: "lead.auto_avancou",
        entidadeTipo: "lead",
        entidadeId: leadId,
        dados: { de: lead.pipelineStage.nome, para: destino.nome, motivo },
      },
    });
  } catch {
    /* automação é best-effort — não deve quebrar o fluxo principal */
  }
}

/** Avança o lead ativo ligado a um cliente (usado por Portal aceito / proposta enviada). */
export async function avancarLeadPorClienteAuto(clienteId: string, chaveDestino: string, motivo: string): Promise<void> {
  const lead = await prisma.lead.findFirst({
    where: { clienteId, deletedAt: null, convertidoEmClienteId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (lead) await avancarLeadAuto(lead.id, chaveDestino, motivo);
}

/**
 * Playbook padrão de cada etapa (por chaveAuto) — os "próximos passos" do funil de
 * VENDAS (do primeiro contato ao fechamento). Semeados por lead ao entrar na etapa;
 * `obrigatorio` = critério de saída. Cada passo é de um tipo:
 *  - manual: a equipe conclui na mão;
 *  - `autoRegra` ("servicos"|"valor"): o sistema conclui/reabre sozinho conforme o
 *    estado do lead (derivado e reversível — a equipe não tica na mão);
 *  - `acaoDoc` (proposta|contrato): gera o documento e conclui sozinho quando ele é
 *    assinado (a equipe também pode concluir na mão, se fechou por fora).
 * Observação: o "briefing" é pós-venda (onboarding do CLIENTE), então NÃO fica no
 * funil do lead — vira tarefa do projeto de Onboarding criado na conversão.
 */
type PassoModelo = { titulo: string; obrigatorio: boolean; acaoDoc?: string; autoRegra?: string };
const PLAYBOOK: Record<string, PassoModelo[]> = {
  novo: [
    { titulo: "Fazer o primeiro contato", obrigatorio: true },
    { titulo: "Confirmar os serviços de interesse", obrigatorio: true, autoRegra: "servicos" },
    { titulo: "Descobrir quem decide, o orçamento e o prazo", obrigatorio: true },
  ],
  qualificacao: [
    { titulo: "Entender a necessidade e os requisitos", obrigatorio: false },
    { titulo: "Registrar o valor estimado da oportunidade", obrigatorio: true, autoRegra: "valor" },
  ],
  proposta: [
    { titulo: "Elaborar e enviar a proposta", obrigatorio: true, acaoDoc: "proposta", autoRegra: "proposta_enviada" },
    { titulo: "Confirmar o aceite do cliente", obrigatorio: true, autoRegra: "proposta_assinada" },
  ],
  negociacao: [
    { titulo: "Alinhar ajustes finais", obrigatorio: false },
    { titulo: "Elaborar e enviar o contrato", obrigatorio: true, acaoDoc: "contrato", autoRegra: "contrato_enviado" },
    { titulo: "Confirmar a assinatura do contrato", obrigatorio: true, autoRegra: "contrato_assinado" },
  ],
  fechado: [{ titulo: "Converter em cliente", obrigatorio: true }],
};

/**
 * Cria os passos da etapa para o lead (se ainda não existirem): os passos gerais
 * da etapa MAIS os passos de cada serviço escolhido pelo lead para aquela etapa.
 */
async function seedPassosSeVazio(leadId: string, stageId: string, chaveAuto: string | null) {
  if (!chaveAuto) return;
  const existe = await prisma.leadPasso.count({ where: { leadId, stageId } });
  if (existe > 0) return;

  const dados: {
    leadId: string;
    stageId: string;
    servicoId: string | null;
    titulo: string;
    obrigatorio: boolean;
    acaoDoc: string | null;
    autoRegra: string | null;
    ordem: number;
  }[] = [];

  const modelo = PLAYBOOK[chaveAuto];
  if (modelo)
    modelo.forEach((m, i) =>
      dados.push({ leadId, stageId, servicoId: null, titulo: m.titulo, obrigatorio: m.obrigatorio, acaoDoc: m.acaoDoc ?? null, autoRegra: m.autoRegra ?? null, ordem: i }),
    );

  const servicos = await prisma.servico.findMany({
    where: { leads: { some: { id: leadId } } },
    orderBy: { ordem: "asc" },
    include: { passos: { where: { etapaChave: chaveAuto }, orderBy: { ordem: "asc" } } },
  });
  let ordem = dados.length;
  for (const s of servicos) {
    for (const sp of s.passos) {
      dados.push({ leadId, stageId, servicoId: s.id, titulo: sp.titulo, obrigatorio: sp.obrigatorio, acaoDoc: null, autoRegra: null, ordem: ordem++ });
    }
  }

  if (dados.length) await prisma.leadPasso.createMany({ data: dados });
}

/**
 * Sincroniza os passos de SERVIÇO do lead na etapa atual quando os serviços mudam:
 * ADICIONA os passos (daquela etapa) dos serviços recém-escolhidos que ainda não
 * estão no checklist e REMOVE os passos pendentes de serviços que foram desmarcados.
 * Não toca nos passos gerais (servicoId null) nem nos já concluídos. Idempotente.
 */
async function sincronizarPassosServicos(leadId: string, stageId: string, chaveAuto: string | null) {
  if (!chaveAuto) return;

  const servicos = await prisma.servico.findMany({
    where: { leads: { some: { id: leadId } } },
    orderBy: { ordem: "asc" },
    include: { passos: { where: { etapaChave: chaveAuto }, orderBy: { ordem: "asc" } } },
  });
  const servicoIds = new Set(servicos.map((s) => s.id));

  const existentes = await prisma.leadPasso.findMany({
    where: { leadId, stageId, NOT: { servicoId: null } },
  });

  // Remove os passos pendentes de serviços que não estão mais no lead (preserva os concluídos).
  const orfaos = existentes.filter((p) => p.servicoId && !servicoIds.has(p.servicoId) && !p.concluido);
  if (orfaos.length) {
    await prisma.leadPasso.deleteMany({ where: { id: { in: orfaos.map((o) => o.id) } } });
  }

  // Adiciona os passos de serviço que ainda não existem (identificados por serviço + título).
  const jaTem = new Set(existentes.map((p) => `${p.servicoId}::${p.titulo}`));
  const agg = await prisma.leadPasso.aggregate({ where: { leadId, stageId }, _max: { ordem: true } });
  let ordem = (agg._max.ordem ?? -1) + 1;
  const novos: {
    leadId: string;
    stageId: string;
    servicoId: string;
    titulo: string;
    obrigatorio: boolean;
    acaoDoc: null;
    ordem: number;
  }[] = [];
  for (const s of servicos) {
    for (const sp of s.passos) {
      if (jaTem.has(`${s.id}::${sp.titulo}`)) continue;
      novos.push({ leadId, stageId, servicoId: s.id, titulo: sp.titulo, obrigatorio: sp.obrigatorio, acaoDoc: null, ordem: ordem++ });
    }
  }
  if (novos.length) await prisma.leadPasso.createMany({ data: novos });
}

// Regras DERIVADAS (duas vias): acompanham o estado do lead — o sistema conclui E
// reabre, e a equipe não tica na mão (checkbox travado + selo "automático" na UI).
const REGRAS_DERIVADAS = new Set(["servicos", "valor"]);
// Regras de EVENTO (uma via): concluem sozinhas quando o marco acontece (documento
// enviado/assinado) e nunca reabrem sozinhas — a equipe ainda pode ticar/reabrir na mão
// (ex.: fechou por fora do sistema).
const REGRAS_EVENTO = new Set(["proposta_enviada", "proposta_assinada", "contrato_enviado", "contrato_assinado"]);

/**
 * Reconcilia os passos AUTOMÁTICOS do lead (autoRegra) com o estado real. Roda a cada
 * abertura do painel e após eventos (serviços/valor, documento solicitado/assinado):
 *  - regras DERIVADAS (servicos/valor): seguem o estado, ticam e desticam;
 *  - regras de EVENTO (proposta/contrato enviado/assinado): só concluem, respeitando
 *    ajuste manual.
 * Passos manuais não são tocados. Best-effort — nunca lança.
 */
export async function reconciliarPassosAuto(leadId: string): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { valorEstimado: true, _count: { select: { servicos: true } } },
    });
    if (!lead) return;

    // Marcos de documento (proposta/contrato) do lead — detectados pelos passos com
    // acaoDoc que já geraram documento. "enviado" = assinatura solicitada; "assinado" = concluído.
    const docSteps = await prisma.leadPasso.findMany({
      where: { leadId, acaoDoc: { in: ["proposta", "contrato"] }, NOT: { documentoId: null } },
      select: { acaoDoc: true, documentoId: true },
    });
    const docIds = docSteps.map((d) => d.documentoId).filter((x): x is string => !!x);
    const docs = docIds.length
      ? await prisma.documento.findMany({
          where: { id: { in: docIds }, deletedAt: null },
          select: { id: true, assinaturaSolicitadaEm: true, assinadoEm: true },
        })
      : [];
    const docById = new Map(docs.map((d) => [d.id, d]));
    const marco = { proposta_enviada: false, proposta_assinada: false, contrato_enviado: false, contrato_assinado: false };
    for (const ds of docSteps) {
      const d = ds.documentoId ? docById.get(ds.documentoId) : undefined;
      if (!d) continue;
      if (ds.acaoDoc === "proposta") {
        if (d.assinaturaSolicitadaEm) marco.proposta_enviada = true;
        if (d.assinadoEm) marco.proposta_assinada = true;
      } else if (ds.acaoDoc === "contrato") {
        if (d.assinaturaSolicitadaEm) marco.contrato_enviado = true;
        if (d.assinadoEm) marco.contrato_assinado = true;
      }
    }

    const cumprida: Record<string, boolean> = {
      servicos: lead._count.servicos > 0,
      valor: lead.valorEstimado != null && lead.valorEstimado > 0,
      ...marco,
    };

    const autos = await prisma.leadPasso.findMany({
      where: { leadId, NOT: { autoRegra: null } },
      select: { id: true, autoRegra: true, concluido: true },
    });
    for (const p of autos) {
      const regra = p.autoRegra ?? "";
      const alvo = cumprida[regra] ?? false;
      if (REGRAS_DERIVADAS.has(regra)) {
        if (p.concluido !== alvo) {
          await prisma.leadPasso.update({
            where: { id: p.id },
            data: { concluido: alvo, concluidoEm: alvo ? new Date() : null, concluidoPorId: null },
          });
        }
      } else if (REGRAS_EVENTO.has(regra)) {
        if (alvo && !p.concluido) {
          await prisma.leadPasso.update({
            where: { id: p.id },
            data: { concluido: true, concluidoEm: new Date(), concluidoPorId: null },
          });
        }
      }
    }
  } catch {
    /* automação é best-effort — não deve quebrar o fluxo principal */
  }
}

/** Detalhe completo do lead para o painel (central de comando do card). */
export async function getLeadDetalhe(id: string) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      servicos: { select: { id: true, nome: true }, orderBy: { ordem: "asc" } },
      responsavel: { select: { nome: true } },
      pipelineStage: true,
    },
  });
  if (!lead || lead.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado" });

  await seedPassosSeVazio(lead.id, lead.pipelineStageId, lead.pipelineStage.chaveAuto);
  await reconciliarPassosAuto(lead.id);
  const passos = await prisma.leadPasso.findMany({
    where: { leadId: id, stageId: lead.pipelineStageId },
    orderBy: [{ ordem: "asc" }],
  });
  const servIds = [...new Set(passos.map((p) => p.servicoId).filter((x): x is string => !!x))];
  const servMap = new Map(
    servIds.length
      ? (await prisma.servico.findMany({ where: { id: { in: servIds } }, select: { id: true, nome: true } })).map((s) => [s.id, s.nome])
      : [],
  );
  const docIds = [...new Set(passos.map((p) => p.documentoId).filter((x): x is string => !!x))];
  const docMap = new Map(
    docIds.length
      ? (
          await prisma.documento.findMany({
            where: { id: { in: docIds } },
            select: {
              id: true,
              status: true,
              propostaStatus: true,
              assinaturaSolicitadaEm: true,
              assinadoEm: true,
              deletedAt: true,
            },
          })
        ).map((d) => [d.id, d])
      : [],
  );
  // Situação COERENTE do documento ligado ao passo (mesma da app toda).
  const docSituacao = (docId: string | null) => {
    if (!docId) return null;
    const d = docMap.get(docId);
    if (!d || d.deletedAt) return null;
    const s = situacaoDocumento(d);
    return { key: s.key, label: s.label, variant: s.variant };
  };

  const stages = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
  const idx = stages.findIndex((s) => s.id === lead.pipelineStageId);
  const proxima = idx >= 0 && idx < stages.length - 1 ? stages[idx + 1]! : null;
  const faltamObrig = passos.filter((p) => p.obrigatorio && !p.concluido).length;

  const timeline = await prisma.activityLog.findMany({
    where: { entidadeTipo: "lead", entidadeId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { user: { select: { nome: true } } },
  });

  // "De onde veio (detectado)" — SEMPRE preenchido. Usa o rastreio persistido (captação
  // ou cadastro manual) e, para leads antigos sem rastreio, deriva do log de criação.
  let deOndeVeio = lead.rastreio;
  if (!deOndeVeio) {
    const criacao = await prisma.activityLog.findFirst({
      where: { entidadeTipo: "lead", entidadeId: id, acao: { in: ["lead.capturado", "lead.criado"] } },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { nome: true } } },
    });
    deOndeVeio =
      criacao?.acao === "lead.capturado"
        ? "Recebido pelo formulário de captação do site."
        : `Cadastrado manualmente no sistema${criacao?.user?.nome ? ` por ${criacao.user.nome}` : ""}.`;
  }

  return {
    id: lead.id,
    nome: lead.nome,
    empresa: lead.empresa,
    email: lead.email,
    telefone: lead.telefone,
    origem: lead.origem,
    valorEstimado: lead.valorEstimado,
    observacoes: lead.observacoes,
    rastreio: deOndeVeio,
    clienteId: lead.clienteId,
    responsavel: lead.responsavel,
    stage: { id: lead.pipelineStage.id, nome: lead.pipelineStage.nome, cor: lead.pipelineStage.cor },
    servicos: lead.servicos,
    passos: passos.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      obrigatorio: p.obrigatorio,
      concluido: p.concluido,
      grupo: p.servicoId ? servMap.get(p.servicoId) ?? "Serviço" : "Geral",
      acaoDoc: p.acaoDoc,
      documentoId: p.documentoId,
      docSituacao: docSituacao(p.documentoId),
      // Passo derivado do estado (servicos/valor): a UI mostra selo e trava o toque.
      // Passos de evento (documento) continuam ticáveis na mão, então não travam.
      auto: p.autoRegra != null && REGRAS_DERIVADAS.has(p.autoRegra),
    })),
    proxima: proxima ? { id: proxima.id, nome: proxima.nome } : null,
    faltamObrig,
    prontoParaAvancar: !!proxima && faltamObrig === 0 && passos.length > 0,
    timeline: timeline.map((a) => ({
      id: a.id,
      acao: a.acao,
      createdAt: a.createdAt,
      usuario: a.user?.nome ?? null,
      dados: a.dados as Record<string, unknown> | null,
    })),
  };
}

/**
 * AUTOMAÇÃO do card: quando TODOS os passos obrigatórios da etapa atual estão concluídos, o
 * lead avança sozinho para a próxima etapa — SÓ PARA FRENTE, nunca em lead perdido/convertido,
 * e em CASCATA (se a próxima etapa já estiver com tudo cumprido — ex.: valor já definido — segue
 * avançando). Ao entrar em cada etapa, semeia o checklist, gera documentos (Proposta/Negociação)
 * e reconcilia os passos derivados. Devolve a etapa final (para o front avisar) ou null.
 */
export async function avancarSeChecklistCompleto(leadId: string, userId: string | null): Promise<{ id: string; nome: string } | null> {
  let destino: { id: string; nome: string } | null = null;
  for (let i = 0; i < 6; i++) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { pipelineStage: true } });
    if (!lead || lead.deletedAt || lead.convertidoEmClienteId || lead.perdidoEm) break;

    const faltam = await prisma.leadPasso.count({
      where: { leadId, stageId: lead.pipelineStageId, obrigatorio: true, concluido: false },
    });
    if (faltam > 0) break; // ainda tem tarefa obrigatória pendente na etapa atual

    const stages = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
    const idx = stages.findIndex((s) => s.id === lead.pipelineStageId);
    const proxima = idx >= 0 && idx < stages.length - 1 ? stages[idx + 1]! : null;
    if (!proxima) break; // já na última etapa (a conversão em cliente é uma ação deliberada)

    const max = await prisma.lead.aggregate({
      where: { pipelineStageId: proxima.id, deletedAt: null, convertidoEmClienteId: null },
      _max: { ordem: true },
    });
    await prisma.lead.update({ where: { id: leadId }, data: { pipelineStageId: proxima.id, ordem: (max._max.ordem ?? -1) + 1 } });
    await prisma.activityLog.create({
      data: { userId: userId ?? undefined, acao: "lead.auto_avancou_checklist", entidadeTipo: "lead", entidadeId: leadId, dados: { de: lead.pipelineStage.nome, para: proxima.nome } },
    });
    await seedPassosSeVazio(leadId, proxima.id, proxima.chaveAuto);
    // Geração automática de documento exige um autor (equipe); ações do sistema não geram.
    if (userId) await docsAoEntrarEtapa(leadId, proxima.chaveAuto, userId);
    await reconciliarPassosAuto(leadId);
    await reconciliarSituacaoCliente(lead.clienteId);
    destino = { id: proxima.id, nome: proxima.nome };
  }
  return destino;
}

export async function togglePasso(passoId: string, userId: string) {
  const p = await prisma.leadPasso.findUnique({ where: { id: passoId } });
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Passo não encontrado" });
  // Passos derivados (servicos/valor) são geridos pelo sistema, não na mão. Os de
  // evento (documento) podem ser ticados/reabertos manualmente.
  if (p.autoRegra && REGRAS_DERIVADAS.has(p.autoRegra)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Este passo é automático — ele conclui sozinho quando a condição é atendida.",
    });
  }
  const concluido = !p.concluido;
  await prisma.leadPasso.update({
    where: { id: passoId },
    data: { concluido, concluidoEm: concluido ? new Date() : null, concluidoPorId: concluido ? userId : null },
  });
  // Ao CONCLUIR, o card pode andar sozinho (todas as tarefas obrigatórias feitas → avança).
  const avancou = concluido ? await avancarSeChecklistCompleto(p.leadId, userId) : null;
  return { ok: true, avancou };
}

export async function addPasso(leadId: string, titulo: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { pipelineStageId: true } });
  if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado" });
  const max = await prisma.leadPasso.aggregate({
    where: { leadId, stageId: lead.pipelineStageId },
    _max: { ordem: true },
  });
  await prisma.leadPasso.create({
    data: { leadId, stageId: lead.pipelineStageId, titulo: titulo.trim(), ordem: (max._max.ordem ?? -1) + 1 },
  });
  return { ok: true };
}

export async function removePasso(passoId: string) {
  const p = await prisma.leadPasso.findUnique({ where: { id: passoId }, select: { obrigatorio: true } });
  // Tarefas obrigatórias fazem parte do funil (critério de saída da etapa) e não podem
  // ser removidas — só os passos opcionais/adicionados à mão.
  if (p?.obrigatorio) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Esta tarefa é obrigatória e não pode ser removida. Conclua-a para avançar.",
    });
  }
  await prisma.leadPasso.deleteMany({ where: { id: passoId } });
  return { ok: true };
}

/** Avança o lead para a PRÓXIMA etapa (por ordem), se os passos obrigatórios estão feitos. */
/**
 * AUTOMAÇÃO: gera documentos ao ENTRAR em certas etapas do funil. Hoje: ao entrar em
 * "Proposta", gera uma proposta a partir dos serviços do lead (EM_REVISÃO, para a equipe
 * validar antes de enviar). Import dinâmico evita dependência circular; best-effort.
 */
async function docsAoEntrarEtapa(leadId: string, chaveAuto: string | null, userId: string): Promise<void> {
  if (chaveAuto !== "proposta" && chaveAuto !== "negociacao") return;
  try {
    const m = await import("../documentos/documentos.service.js");
    if (chaveAuto === "proposta") await m.gerarPropostaAutoParaLead(leadId, userId);
    else if (chaveAuto === "negociacao") await m.gerarContratoAutoParaLead(leadId, userId);
  } catch {
    /* automação best-effort — nunca quebra o fluxo do funil */
  }
}

export async function avancarEtapa(leadId: string, userId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { pipelineStage: true } });
  if (!lead || lead.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado" });

  const faltam = await prisma.leadPasso.count({
    where: { leadId, stageId: lead.pipelineStageId, obrigatorio: true, concluido: false },
  });
  if (faltam > 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Conclua os passos obrigatórios antes de avançar." });
  }

  const stages = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
  const idx = stages.findIndex((s) => s.id === lead.pipelineStageId);
  const proxima = idx >= 0 && idx < stages.length - 1 ? stages[idx + 1]! : null;
  if (!proxima) throw new TRPCError({ code: "BAD_REQUEST", message: "Este lead já está na última etapa." });

  const max = await prisma.lead.aggregate({
    where: { pipelineStageId: proxima.id, deletedAt: null, convertidoEmClienteId: null },
    _max: { ordem: true },
  });
  await prisma.lead.update({
    where: { id: leadId },
    data: { pipelineStageId: proxima.id, ordem: (max._max.ordem ?? -1) + 1 },
  });
  await prisma.activityLog.create({
    data: {
      userId,
      acao: "lead.avancou_etapa",
      entidadeTipo: "lead",
      entidadeId: leadId,
      dados: { de: lead.pipelineStage.nome, para: proxima.nome },
    },
  });
  await seedPassosSeVazio(leadId, proxima.id, proxima.chaveAuto);
  await docsAoEntrarEtapa(leadId, proxima.chaveAuto, userId);
  await reconciliarSituacaoCliente(lead.clienteId);
  return { ok: true, para: { id: proxima.id, nome: proxima.nome } };
}

/** Leads ativos (não removidos, não convertidos, não perdidos) para o board. */
export async function listLeads() {
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
    orderBy: [{ pipelineStageId: "asc" }, { ordem: "asc" }],
    include: {
      responsavel: { select: { nome: true } },
      servicos: { select: { id: true, nome: true }, orderBy: { ordem: "asc" } },
      // "Portal ativo" fiel = tem usuário de Portal que consegue entrar (senha definida) —
      // mesmo critério da lista de clientes. Evita o falso-positivo de só ter clienteId.
      clientePortal: {
        select: { _count: { select: { usuariosPortal: { where: { role: "CLIENTE", ativo: true, passwordHash: { not: null } } } } } },
      },
    },
  });
  return leads.map(({ clientePortal, ...l }) => ({
    ...l,
    portalAtivo: (clientePortal?._count.usuariosPortal ?? 0) > 0,
  }));
}

/** Leads perdidos (para o relatório de ganho/perda e a reabertura). */
export function listPerdidos() {
  return prisma.lead.findMany({
    where: { deletedAt: null, NOT: { perdidoEm: null } },
    orderBy: { perdidoEm: "desc" },
    take: 50,
    include: {
      responsavel: { select: { nome: true } },
      pipelineStage: { select: { nome: true, cor: true } },
    },
  });
}

/**
 * Resumo de ganho/perda do funil — alimenta os indicadores. "Ganhos" = leads
 * convertidos; "perdidos" = marcados como perdidos; a taxa de conversão considera
 * apenas os fechados (ganhos + perdidos).
 */
export async function funilResumo() {
  const [ganhos, perdidos] = await Promise.all([
    prisma.lead.count({ where: { deletedAt: null, NOT: { convertidoEmClienteId: null } } }),
    prisma.lead.count({ where: { deletedAt: null, NOT: { perdidoEm: null } } }),
  ]);
  const fechados = ganhos + perdidos;
  return { ganhos, perdidos, taxaConversao: fechados ? ganhos / fechados : 0 };
}

/**
 * Marca o lead como PERDIDO (com o motivo) — sai do funil ativo, mas fica no relatório
 * de ganho/perda e pode ser reaberto. Se houver uma conta/cliente ligada ainda em
 * prospecção, reflete a perda na situação comercial.
 */
export async function marcarPerdido(id: string, motivo: string, userId: string) {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { convertidoEmClienteId: true, perdidoEm: true, clienteId: true } });
  if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado" });
  if (lead.convertidoEmClienteId) throw new TRPCError({ code: "BAD_REQUEST", message: "Este lead já foi convertido — não pode ser marcado como perdido." });
  if (lead.perdidoEm) throw new TRPCError({ code: "BAD_REQUEST", message: "Este lead já está marcado como perdido." });

  await prisma.lead.update({ where: { id }, data: { perdidoEm: new Date(), motivoPerda: motivo.trim() } });
  await prisma.activityLog.create({
    data: { userId, acao: "lead.perdido", entidadeTipo: "lead", entidadeId: id, dados: { motivo: motivo.trim() } },
  });
  // A situação do cliente é o placar do funil: reconcilia (won-cliente segue ATIVO;
  // se esta era a única oportunidade, vai a PERDIDO).
  await reconciliarSituacaoCliente(lead.clienteId);
  return { ok: true };
}

/** Reabre um lead perdido — volta ao funil ativo (no fim da coluna atual). */
export async function reabrirLead(id: string, userId: string) {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { perdidoEm: true, pipelineStageId: true, clienteId: true } });
  if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado" });
  if (!lead.perdidoEm) throw new TRPCError({ code: "BAD_REQUEST", message: "Este lead não está perdido." });

  const max = await prisma.lead.aggregate({
    where: { pipelineStageId: lead.pipelineStageId, deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
    _max: { ordem: true },
  });
  await prisma.lead.update({
    where: { id },
    data: { perdidoEm: null, motivoPerda: null, ordem: (max._max.ordem ?? -1) + 1 },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "lead.reaberto", entidadeTipo: "lead", entidadeId: id },
  });
  await reconciliarSituacaoCliente(lead.clienteId);
  return { ok: true };
}

/** Avisa responsável + gestão (ADMIN/ROOT) sobre um movimento do lead pelo Portal. */
async function avisarEquipeSobreLead(
  tipo: "lead_desistiu" | "lead_retomou",
  lead: { id: string; nome: string; empresa: string | null; responsavelId: string | null },
) {
  const contato = lead.empresa ? `${lead.nome} · ${lead.empresa}` : lead.nome;
  const gestao = await prisma.user.findMany({
    where: { ativo: true, deletedAt: null, role: { in: ["ADMIN", "ROOT"] } },
    select: { id: true },
  });
  const avisar = new Set<string>(gestao.map((g) => g.id));
  if (lead.responsavelId) avisar.add(lead.responsavelId);
  for (const uid of avisar) {
    void notificar(uid, tipo, { contato }, { entidadeTipo: "lead", entidadeId: lead.id }).catch(() => {});
  }
}

/**
 * Desistência pelo Portal: o próprio prospect declara que não deseja mais avançar.
 * Encontra o lead ativo ligado a ESTE cliente (escopo da sessão, nunca do input),
 * marca como perdido com o motivo do cliente e avisa a equipe (possível reconquista).
 */
export async function desistenciaPeloCliente(clienteId: string, motivoCliente?: string) {
  const lead = await prisma.lead.findFirst({
    where: { clienteId, deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, nome: true, empresa: true, responsavelId: true },
  });
  if (!lead) throw new TRPCError({ code: "BAD_REQUEST", message: "Não há atendimento em andamento para encerrar." });

  const motivo = ["Desistência pelo Portal", motivoCliente?.trim() || null].filter(Boolean).join(" — ");
  await prisma.lead.update({ where: { id: lead.id }, data: { perdidoEm: new Date(), motivoPerda: motivo } });
  await prisma.activityLog.create({
    data: { acao: "lead.perdido", entidadeTipo: "lead", entidadeId: lead.id, dados: { motivo, origem: "portal" } },
  });
  await reconciliarSituacaoCliente(clienteId);
  await avisarEquipeSobreLead("lead_desistiu", lead);
  return { ok: true };
}

/** Retomada pelo Portal: o prospect que havia desistido decide voltar ao funil. */
export async function retomarPeloCliente(clienteId: string) {
  const lead = await prisma.lead.findFirst({
    where: { clienteId, deletedAt: null, convertidoEmClienteId: null, NOT: { perdidoEm: null } },
    orderBy: { perdidoEm: "desc" },
    select: { id: true, nome: true, empresa: true, responsavelId: true, pipelineStageId: true },
  });
  if (!lead) throw new TRPCError({ code: "BAD_REQUEST", message: "Não há atendimento para retomar." });

  const max = await prisma.lead.aggregate({
    where: { pipelineStageId: lead.pipelineStageId, deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
    _max: { ordem: true },
  });
  await prisma.lead.update({
    where: { id: lead.id },
    data: { perdidoEm: null, motivoPerda: null, ordem: (max._max.ordem ?? -1) + 1 },
  });
  await prisma.activityLog.create({
    data: { acao: "lead.reaberto", entidadeTipo: "lead", entidadeId: lead.id, dados: { origem: "portal" } },
  });
  await reconciliarSituacaoCliente(clienteId);
  await avisarEquipeSobreLead("lead_retomou", lead);
  return { ok: true };
}

/**
 * Autosserviço do Portal: o próprio cliente escolhe os serviços que precisa. Vira uma
 * OPORTUNIDADE no funil (com esses serviços e o checklist certo). Se já há um negócio
 * aberto, adiciona os serviços a ele; senão, abre um novo na 1ª etapa. Avisa a equipe.
 * Escopado ao clienteId da sessão (nunca id de lead do cliente).
 */
export async function solicitarServicosPeloCliente(clienteId: string, servicoIds: string[], mensagem?: string) {
  const servicos = await prisma.servico.findMany({ where: { id: { in: servicoIds }, ativo: true }, select: { id: true, nome: true } });
  if (servicos.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione ao menos um serviço válido." });
  const nomes = servicos.map((s) => s.nome).join(", ");
  const msg = clean(mensagem ?? null);
  const nota = [msg && `Pedido pelo Portal: ${msg}`, `Serviços pedidos pelo Portal: ${nomes}`].filter(Boolean).join("\n");

  const existente = await prisma.lead.findFirst({
    where: { clienteId, deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
    orderBy: { createdAt: "desc" },
    include: { pipelineStage: { select: { id: true, chaveAuto: true } } },
  });

  let alvo: { id: string; nome: string; empresa: string | null; responsavelId: string | null };

  if (existente) {
    // Adiciona os serviços ao negócio aberto (connect é idempotente — não duplica).
    await prisma.lead.update({
      where: { id: existente.id },
      data: {
        servicos: { connect: servicos.map((s) => ({ id: s.id })) },
        observacoes: [existente.observacoes, nota].filter(Boolean).join("\n\n") || existente.observacoes,
      },
    });
    await sincronizarPassosServicos(existente.id, existente.pipelineStage.id, existente.pipelineStage.chaveAuto);
    await reconciliarPassosAuto(existente.id);
    alvo = { id: existente.id, nome: existente.nome, empresa: existente.empresa, responsavelId: existente.responsavelId };
  } else {
    // Sem negócio aberto: abre uma nova oportunidade na 1ª etapa com os serviços.
    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, deletedAt: null },
      select: { nome: true, tipo: true, email: true, telefone: true, responsavelId: true },
    });
    if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
    const stages = await listStages();
    const stage = stages[0];
    if (!stage) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Pipeline não configurado" });
    const max = await prisma.lead.aggregate({
      where: { pipelineStageId: stage.id, deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
      _max: { ordem: true },
    });
    const criado = await prisma.lead.create({
      data: {
        nome: cliente.nome,
        empresa: cliente.tipo === "PJ" ? cliente.nome : null,
        email: cliente.email,
        telefone: cliente.telefone,
        origem: "Portal do cliente",
        rastreio: "Serviços solicitados pelo próprio cliente no Portal.",
        observacoes: nota,
        pipelineStageId: stage.id,
        ordem: (max._max.ordem ?? -1) + 1,
        responsavelId: cliente.responsavelId,
        clienteId,
        servicos: { connect: servicos.map((s) => ({ id: s.id })) },
      },
    });
    await seedPassosSeVazio(criado.id, stage.id, stage.chaveAuto);
    await reconciliarPassosAuto(criado.id);
    alvo = { id: criado.id, nome: criado.nome, empresa: criado.empresa, responsavelId: criado.responsavelId };
  }

  await prisma.activityLog.create({
    data: { acao: "lead.servicos_portal", entidadeTipo: "lead", entidadeId: alvo.id, dados: { origem: "portal", servicos: nomes } },
  });
  await reconciliarSituacaoCliente(clienteId);

  // Avisa responsável + gestão que o cliente pediu serviços pelo Portal.
  const contato = alvo.empresa ? `${alvo.nome} · ${alvo.empresa}` : alvo.nome;
  const gestao = await prisma.user.findMany({
    where: { ativo: true, deletedAt: null, role: { in: ["ADMIN", "ROOT"] } },
    select: { id: true },
  });
  const avisar = new Set<string>(gestao.map((g) => g.id));
  if (alvo.responsavelId) avisar.add(alvo.responsavelId);
  for (const uid of avisar) {
    void notificar(uid, "servico_solicitado", { contato, servicos: nomes }, { entidadeTipo: "lead", entidadeId: alvo.id }).catch(() => {});
  }
  return { ok: true };
}

// ── Situação do cliente = placar do funil (ADR-22) ──

/**
 * Recalcula a situação comercial do cliente a partir das SUAS oportunidades no funil —
 * o funil é a fonte da verdade; a situação apenas o reflete. Regra de ouro:
 * **cliente ATIVO nunca é rebaixado** (quem já é cliente — ganhou um negócio ou foi
 * cadastrado direto — segue cliente; uma oportunidade nova é upsell, "não vira lead").
 * Para quem ainda NÃO é cliente:
 *  - tem oportunidade aberta → NEGOCIACAO (se em negociação) senão PROSPECT;
 *  - só tem oportunidade perdida → PERDIDO;
 *  - sem nenhuma oportunidade → não mexe.
 * Best-effort — nunca lança.
 */
export async function reconciliarSituacaoCliente(clienteId: string | null): Promise<void> {
  if (!clienteId) return;
  try {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { situacaoComercial: true } });
    if (!cliente) return;

    const leads = await prisma.lead.findMany({
      where: { clienteId, deletedAt: null },
      select: { convertidoEmClienteId: true, perdidoEm: true, pipelineStage: { select: { chaveAuto: true } } },
    });

    // Ganhou um negócio → vira/segue ATIVO (uma vitória reativa até um cliente inativo).
    const ganhou = leads.some((l) => l.convertidoEmClienteId);
    if (ganhou) {
      if (cliente.situacaoComercial !== "ATIVO") {
        await prisma.cliente.update({ where: { id: clienteId }, data: { situacaoComercial: "ATIVO" } });
      }
      return;
    }
    // Já é CLIENTE de verdade (ativo/inativo) → gerido na mão; o funil não mexe (nunca vira lead).
    if (cliente.situacaoComercial === "ATIVO" || cliente.situacaoComercial === "INATIVO") return;

    if (leads.length === 0) return; // não é cliente e não tem oportunidade → não mexe

    const abertos = leads.filter((l) => !l.perdidoEm);
    const nova = abertos.length
      ? abertos.some((l) => l.pipelineStage.chaveAuto === "negociacao")
        ? "NEGOCIACAO"
        : "PROSPECT"
      : "PERDIDO";
    await prisma.cliente.updateMany({ where: { id: clienteId, NOT: { situacaoComercial: nova } }, data: { situacaoComercial: nova } });
  } catch {
    /* reflexo da situação é best-effort — não pode travar o funil */
  }
}

/**
 * Abre uma NOVA oportunidade (Lead) no funil para um cliente que já existe, já com os
 * SERVIÇOS que ele quer (o card e o checklist nascem inteligentes). O cliente segue
 * cliente — isto é um novo negócio, não "o cliente virou lead". Começa na 1ª etapa.
 */
export async function criarOportunidadeParaCliente(
  clienteId: string,
  ator: string,
  opts?: { servicoIds?: string[]; valorEstimado?: number | null; observacoes?: string | null },
): Promise<{ leadId: string }> {
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, deletedAt: null },
    select: { id: true, nome: true, tipo: true, email: true, telefone: true, responsavelId: true },
  });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });

  const stages = await listStages();
  const stage = stages[0];
  if (!stage) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Pipeline não configurado" });
  const max = await prisma.lead.aggregate({
    where: { pipelineStageId: stage.id, deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
    _max: { ordem: true },
  });
  const servicoIds = opts?.servicoIds ?? [];
  const lead = await prisma.lead.create({
    data: {
      nome: cliente.nome,
      empresa: cliente.tipo === "PJ" ? cliente.nome : null,
      email: cliente.email,
      telefone: cliente.telefone,
      origem: "Cliente existente",
      rastreio: "Nova oportunidade aberta a partir da ficha de um cliente existente.",
      valorEstimado: opts?.valorEstimado ?? null,
      observacoes: clean(opts?.observacoes ?? null),
      pipelineStageId: stage.id,
      ordem: (max._max.ordem ?? -1) + 1,
      responsavelId: cliente.responsavelId ?? ator,
      clienteId: cliente.id,
      servicos: servicoIds.length ? { connect: servicoIds.map((id) => ({ id })) } : undefined,
    },
  });
  await prisma.activityLog.create({
    data: { userId: ator, acao: "lead.criado", entidadeTipo: "lead", entidadeId: lead.id, dados: { origem: "cliente_existente" } },
  });
  // Semeia já o checklist da 1ª etapa (com os passos dos serviços) e reconcilia os passos
  // automáticos — o card nasce inteligente, sem esperar a abertura do painel.
  await seedPassosSeVazio(lead.id, stage.id, stage.chaveAuto);
  await reconciliarPassosAuto(lead.id);
  await reconciliarSituacaoCliente(clienteId);
  return { leadId: lead.id };
}

export async function createLead(input: CreateLeadInput, userId: string) {
  let stageId = input.pipelineStageId;
  if (!stageId) {
    const stages = await listStages();
    stageId = stages[0]?.id;
  }
  if (!stageId) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Pipeline não configurado" });
  }

  const max = await prisma.lead.aggregate({
    where: { pipelineStageId: stageId, deletedAt: null, convertidoEmClienteId: null },
    _max: { ordem: true },
  });
  const ordem = (max._max.ordem ?? -1) + 1;

  // Rastreio de atribuição para cadastro MANUAL: registra que veio da equipe (quem e a
  // origem informada). Completa o "de onde veio (detectado)" para leads não capturados.
  const origemManual = clean(input.origem);
  const criador = await nomeUsuario(userId);
  const rastreioManual = [
    `Cadastrado manualmente no sistema${criador ? ` por ${criador}` : ""}.`,
    origemManual ? `Origem informada: ${origemManual}.` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const lead = await prisma.lead.create({
    data: {
      nome: input.nome.trim(),
      empresa: clean(input.empresa),
      email: clean(input.email),
      telefone: clean(input.telefone),
      origem: origemManual,
      rastreio: rastreioManual,
      valorEstimado: input.valorEstimado ?? null,
      observacoes: clean(input.observacoes),
      pipelineStageId: stageId,
      ordem,
      responsavelId: input.responsavelId || userId,
      servicos: input.servicoIds?.length ? { connect: input.servicoIds.map((id) => ({ id })) } : undefined,
    },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "lead.criado", entidadeTipo: "lead", entidadeId: lead.id },
  });
  // Se o lead nasceu sob responsabilidade de OUTRA pessoa, avisa-a.
  if (lead.responsavelId && lead.responsavelId !== userId) {
    const contato = lead.empresa ? `${lead.nome} · ${lead.empresa}` : lead.nome;
    void notificar(lead.responsavelId, "lead_atribuido", { contato }, { entidadeTipo: "lead", entidadeId: lead.id }).catch(() => {});
  }
  return lead;
}

export async function updateLead(input: UpdateLeadInput, userId: string) {
  const { id, pipelineStageId, ...rest } = input;
  const data: Record<string, unknown> = {};
  if (rest.nome !== undefined) data.nome = rest.nome.trim();
  if (rest.empresa !== undefined) data.empresa = clean(rest.empresa);
  if (rest.email !== undefined) data.email = clean(rest.email);
  if (rest.telefone !== undefined) data.telefone = clean(rest.telefone);
  if (rest.origem !== undefined) data.origem = clean(rest.origem);
  if (rest.valorEstimado !== undefined) data.valorEstimado = rest.valorEstimado ?? null;
  if (rest.observacoes !== undefined) data.observacoes = clean(rest.observacoes);
  if (rest.responsavelId !== undefined) data.responsavelId = rest.responsavelId || null;
  if (pipelineStageId !== undefined) data.pipelineStageId = pipelineStageId;
  if (rest.servicoIds !== undefined) data.servicos = { set: rest.servicoIds.map((sid) => ({ id: sid })) };

  // Detecta troca de responsável (para avisar o novo dono) ANTES de aplicar a mudança.
  let novoResponsavel: string | null = null;
  if (rest.responsavelId !== undefined) {
    const antes = await prisma.lead.findUnique({ where: { id }, select: { responsavelId: true } });
    const novo = rest.responsavelId || null;
    if (novo && novo !== antes?.responsavelId && novo !== userId) novoResponsavel = novo;
  }

  const lead = await prisma.lead.update({ where: { id }, data, include: { pipelineStage: true } });

  if (novoResponsavel) {
    const contato = lead.empresa ? `${lead.nome} · ${lead.empresa}` : lead.nome;
    void notificar(novoResponsavel, "lead_atribuido", { contato }, { entidadeTipo: "lead", entidadeId: lead.id }).catch(() => {});
  }

  // Ao mudar os serviços do lead, o checklist da etapa atual acompanha automaticamente:
  // semeia a etapa se estiver vazia e sincroniza os passos dos serviços (add/remove).
  if (rest.servicoIds !== undefined) {
    await seedPassosSeVazio(lead.id, lead.pipelineStageId, lead.pipelineStage.chaveAuto);
    await sincronizarPassosServicos(lead.id, lead.pipelineStageId, lead.pipelineStage.chaveAuto);
  }
  // Serviços e valor alimentam passos automáticos — reconcilia após a mudança.
  if (rest.servicoIds !== undefined || rest.valorEstimado !== undefined) {
    await reconciliarPassosAuto(lead.id);
  }
  return lead;
}

/**
 * Move um lead para uma coluna/posição. Renumbera a coluna de destino para
 * manter a ordem contígua e estável.
 */
export async function moveLead(input: MoveLeadInput, userId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: input.id },
    include: { pipelineStage: { select: { nome: true } } },
  });
  if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado" });
  const mudouEtapa = lead.pipelineStageId !== input.pipelineStageId;

  const destino = await prisma.lead.findMany({
    where: {
      pipelineStageId: input.pipelineStageId,
      deletedAt: null,
      convertidoEmClienteId: null,
      id: { not: input.id },
    },
    orderBy: { ordem: "asc" },
    select: { id: true },
  });

  const idsOrdenados = destino.map((l) => l.id);
  const alvo = Math.max(0, Math.min(input.ordem, idsOrdenados.length));
  idsOrdenados.splice(alvo, 0, input.id);

  await prisma.$transaction(
    idsOrdenados.map((leadId, i) =>
      prisma.lead.update({
        where: { id: leadId },
        data: { ordem: i, pipelineStageId: input.pipelineStageId },
      }),
    ),
  );

  // Arrastar para outra etapa é um movimento manual: registra na timeline e prepara a
  // etapa de destino (semeia o checklist + reconcilia os passos automáticos).
  if (mudouEtapa) {
    const stage = await prisma.pipelineStage.findUnique({
      where: { id: input.pipelineStageId },
      select: { nome: true, chaveAuto: true },
    });
    await prisma.activityLog.create({
      data: {
        userId,
        acao: "lead.moveu_etapa",
        entidadeTipo: "lead",
        entidadeId: input.id,
        dados: { de: lead.pipelineStage.nome, para: stage?.nome ?? null },
      },
    });
    await seedPassosSeVazio(input.id, input.pipelineStageId, stage?.chaveAuto ?? null);
    await reconciliarPassosAuto(input.id);
    await docsAoEntrarEtapa(input.id, stage?.chaveAuto ?? null, userId);
    await reconciliarSituacaoCliente(lead.clienteId);
  }
  return { ok: true };
}

/** Converte o lead em Cliente. A UI depois pode navegar para a ficha criada. */
export async function convertLead(id: string, userId: string, enviarEmail = true) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      servicos: {
        select: { id: true, nome: true, valor: true, valorRecorrencia: true, percentual: true, percentualRecorrencia: true },
        orderBy: { ordem: "asc" },
      },
    },
  });
  if (!lead || lead.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado" });
  if (lead.convertidoEmClienteId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Este lead já foi convertido" });
  }

  const nomeCliente = lead.empresa?.trim() || lead.nome.trim();

  // Garante o Cliente reaproveitando por vínculo/e-mail (nunca duplica) e marca ATIVO.
  const clienteId = lead.clienteId ?? (await garantirClienteDoLead(lead, userId));
  await prisma.cliente.update({ where: { id: clienteId }, data: { situacaoComercial: "ATIVO" } });

  await prisma.lead.update({
    where: { id },
    data: { convertidoEmClienteId: clienteId, clienteId, convertidoEm: new Date() },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "lead.convertido", entidadeTipo: "cliente", entidadeId: clienteId, dados: { leadId: id } },
  });

  // Os serviços do lead viram serviços CONTRATADOS do cliente (origem FUNIL) — passam a
  // ser a fonte da verdade dos "serviços contratados" na ficha. Herdam a precificação de
  // referência do serviço (valor + recorrência + %), editável depois na ficha. Idempotente.
  for (const s of lead.servicos) {
    await prisma.clienteServico.upsert({
      where: { clienteId_servicoId: { clienteId, servicoId: s.id } },
      update: { status: "ATIVO", canceladoEm: null, canceladoPorTipo: null },
      create: {
        clienteId,
        servicoId: s.id,
        status: "ATIVO",
        origem: "FUNIL",
        valor: s.valor ?? null,
        valorRecorrencia: s.valorRecorrencia,
        percentual: s.percentual ?? null,
        percentualRecorrencia: s.percentualRecorrencia,
      },
    });
  }

  // Integração: cria UM PROJETO POR SERVIÇO contratado (ADR-38), nome "<Serviço> — <Cliente>",
  // já com o roteiro (tarefas + checklists) e o card de entregas do cliente. Sem serviços →
  // um projeto geral vazio, para trabalho manual.
  const resp = lead.responsavelId ?? userId;
  let projetoId: string | null = null;
  for (const s of lead.servicos) {
    const pid = await garantirCardDoServicoContratado(clienteId, s.id, s.nome, resp).catch(() => null);
    if (pid && !projetoId) projetoId = pid;
  }
  if (!projetoId) {
    const geral = await prisma.projeto.create({ data: { clienteId, nome: `Projeto — ${nomeCliente}`, responsavelId: resp }, select: { id: true } });
    await prisma.activityLog.create({ data: { userId, acao: "projeto.criado", entidadeTipo: "projeto", entidadeId: geral.id } });
    projetoId = geral.id;
  }

  // Integração Financeiro: provisiona contas A RECEBER a partir da precificação dos
  // serviços contratados — separando o que é MENSAL (conta recorrente) do que é AVULSO
  // (conta única). O % do faturamento (Faturamento) não vira valor fixo (depende do
  // faturado do mês) — fica registrado nas observações. Fallback: se os serviços não têm
  // preço mas o funil registrou uma estimativa, provisiona uma conta única com ela.
  // Tudo revisável (valor/vencimento). Best-effort: não bloqueia a conversão.
  try {
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 30);
    vencimento.setHours(12, 0, 0, 0);

    let avulso = 0;
    let mensal = 0;
    const percentuais: string[] = [];
    for (const s of lead.servicos) {
      if (s.valor && s.valor > 0) {
        if (s.valorRecorrencia === "MENSAL") mensal += s.valor;
        else avulso += s.valor;
      }
      if (s.percentual && s.percentual > 0) percentuais.push(`${s.percentual}% do faturamento (${s.nome})`);
    }
    const obsPct = percentuais.length ? ` Cobranças por % (variam com o faturamento do mês): ${percentuais.join("; ")}.` : "";
    const criarConta = (valor: number, recorrencia: "NENHUMA" | "MENSAL", descricao: string, obs: string) =>
      prisma.conta.create({ data: { tipo: "RECEBER", descricao, valor, vencimento, clienteId, recorrencia, observacoes: obs } });

    if (avulso > 0 || mensal > 0) {
      if (avulso > 0) {
        await criarConta(avulso, "NENHUMA", `Contrato (serviços avulsos) — ${nomeCliente}`, `Provisionado na conversão do lead.${obsPct} Revise o valor e o vencimento.`);
      }
      if (mensal > 0) {
        await criarConta(mensal, "MENSAL", `Mensalidade — ${nomeCliente}`, `Mensalidade dos serviços recorrentes, provisionada na conversão.${avulso > 0 ? "" : obsPct} Revise o valor e o vencimento.`);
      }
      await prisma.activityLog.create({
        data: { userId, acao: "conta.criada", entidadeTipo: "cliente", entidadeId: clienteId, dados: { origem: "conversao_lead", avulso, mensal } },
      });
    } else if (lead.valorEstimado && lead.valorEstimado > 0) {
      await criarConta(lead.valorEstimado, "NENHUMA", `Contrato — ${nomeCliente}`, `Provisionado na conversão do lead a partir da estimativa do funil.${obsPct} Revise o valor e o vencimento.`);
      await prisma.activityLog.create({
        data: { userId, acao: "conta.criada", entidadeTipo: "cliente", entidadeId: clienteId, dados: { origem: "conversao_lead" } },
      });
    }
  } catch {
    /* provisão financeira é best-effort — não bloqueia a conversão */
  }

  // Integração Agenda: agenda a reunião de kickoff do onboarding (~3 dias úteis à frente,
  // 10h), do responsável, vinculada ao cliente e ao projeto. Best-effort.
  try {
    const inicio = proximoDiaUtil(3, 10);
    await prisma.evento.create({
      data: {
        titulo: `Reunião de kickoff — ${nomeCliente}`,
        descricao: "Alinhamento inicial do onboarding após o fechamento. Ajuste a data/hora conforme a agenda do cliente.",
        tipo: "REUNIAO",
        escopo: "EMPRESA",
        inicio,
        fim: new Date(inicio.getTime() + 60 * 60 * 1000),
        donoId: resp,
        clienteId,
        projetoId,
      },
    });
  } catch {
    /* agendamento do kickoff é best-effort — não bloqueia a conversão */
  }

  // Avisa o responsável e a gestão (ADMIN/ROOT) que a venda foi fechada — evento de
  // alto valor que não pode passar em silêncio. Não avisa quem fez a conversão.
  const gestao = await prisma.user.findMany({
    where: { ativo: true, deletedAt: null, role: { in: ["ADMIN", "ROOT"] } },
    select: { id: true },
  });
  const avisar = new Set<string>(gestao.map((g) => g.id));
  if (lead.responsavelId) avisar.add(lead.responsavelId);
  avisar.delete(userId);
  for (const uid of avisar) {
    void notificar(uid, "lead_convertido", { cliente: nomeCliente }, { entidadeTipo: "cliente", entidadeId: clienteId }).catch(() => {});
  }

  // Acesso ao Portal + boas-vindas — só quando a equipe optar por avisar o cliente
  // (checkbox na confirmação). Continuidade: se o lead JÁ tinha acesso (veio da
  // captação/convite), ele o mantém e recebe só as boas-vindas de cliente. Se ainda não
  // tinha (ex.: lead antigo), cria o acesso e as boas-vindas já saem com o link.
  if (enviarEmail) {
    try {
      const acesso = await garantirAcessoPortal(clienteId, nomeCliente, lead.email);
      if (acesso.jaTinhaAcesso && lead.email) {
        void enviarEmailTemplate("cliente_boas_vindas", lead.email, { nome: nomeCliente, link: config.WEB_ORIGIN }).catch(() => {});
      }
    } catch {
      /* boas-vindas é best-effort — não bloqueia a conversão */
    }
  }

  // Automação: garante um contrato para revisão (se ainda não houver) ao fechar a venda.
  try {
    const m = await import("../documentos/documentos.service.js");
    await m.gerarContratoAutoParaLead(id, userId);
  } catch {
    /* best-effort — nunca bloqueia a conversão */
  }

  return { clienteId, projetoId };
}

/**
 * Captura pública (formulário do site). Cria o lead na 1ª etapa do funil, sem
 * responsável, e avisa a equipe (ADMIN/ROOT). Honeypot + rate-limit anti-spam.
 */
export async function capturarLead(input: CapturaLeadInput, ip?: string) {
  // Honeypot: bots preenchem o campo escondido. Fingimos sucesso e ignoramos.
  if (input.website && input.website.trim()) return { ok: true };

  if (capturaBloqueada(ip ?? "?")) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Muitos envios. Tente novamente mais tarde.",
    });
  }

  const stages = await listStages();
  const stageId = stages[0]?.id;
  if (!stageId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Pipeline não configurado" });

  const max = await prisma.lead.aggregate({
    where: { pipelineStageId: stageId, deletedAt: null, convertidoEmClienteId: null },
    _max: { ordem: true },
  });

  // Recaptura: se já existe um lead ativo com este e-mail, atualiza-o em vez de criar
  // um duplicado (evita cards repetidos e mantém a automação coerente).
  const emailLimpo = clean(input.email);
  if (emailLimpo) {
    const existente = await prisma.lead.findFirst({
      where: { email: emailLimpo, deletedAt: null, convertidoEmClienteId: null },
      orderBy: { createdAt: "desc" },
      include: { pipelineStage: { select: { id: true, chaveAuto: true } } },
    });
    if (existente) {
      const msg = clean(input.mensagem);
      await prisma.lead.update({
        where: { id: existente.id },
        data: {
          observacoes:
            [existente.observacoes, msg && `Novo contato pelo site: ${msg}`].filter(Boolean).join("\n\n") ||
            existente.observacoes,
          servicos: input.servicoIds?.length ? { connect: input.servicoIds.map((sid) => ({ id: sid })) } : undefined,
        },
      });
      await sincronizarPassosServicos(existente.id, existente.pipelineStage.id, existente.pipelineStage.chaveAuto);
      await reconciliarPassosAuto(existente.id);
      await prisma.activityLog.create({ data: { acao: "lead.recapturado", entidadeTipo: "lead", entidadeId: existente.id } });
      const contato = existente.empresa ? `${existente.nome} · ${existente.empresa}` : existente.nome;
      const equipe = await prisma.user.findMany({
        where: { ativo: true, deletedAt: null, role: { in: ["ADMIN", "ROOT"] } },
        select: { id: true },
      });
      for (const u of equipe) {
        void notificar(u.id, "lead_novo", { contato }, { entidadeTipo: "lead", entidadeId: existente.id }).catch(() => {});
      }
      return { ok: true };
    }
  }

  const { origem, rastreio } = derivarRastreioOrigem(input);
  const lead = await prisma.lead.create({
    data: {
      nome: input.nome.trim(),
      empresa: clean(input.empresa),
      email: clean(input.email),
      telefone: clean(input.telefone),
      origem,
      rastreio: rastreio || null,
      observacoes: clean(input.mensagem),
      pipelineStageId: stageId,
      ordem: (max._max.ordem ?? -1) + 1,
      responsavelId: null,
      servicos: input.servicoIds?.length ? { connect: input.servicoIds.map((id) => ({ id })) } : undefined,
    },
  });
  await prisma.activityLog.create({
    data: { acao: "lead.capturado", entidadeTipo: "lead", entidadeId: lead.id },
  });

  // Acesso imediato ao Portal do Cliente: cria a conta (PROSPECT) + acesso e manda as
  // boas-vindas COM o link de acesso, para o lead já acompanhar tudo por lá. Best-effort:
  // nunca deixa a captação falhar. Se já houver acesso (e-mail conhecido), manda só a
  // confirmação simples de recebimento.
  try {
    const clienteId = await garantirClienteDoLead(lead, null);
    const acesso = await garantirAcessoPortal(clienteId, lead.nome, lead.email);
    if (!acesso.criou && lead.email) {
      void enviarEmailTemplate("lead_confirmacao", lead.email, { nome: input.nome.trim() }).catch(() => {});
    }
  } catch {
    /* provisão de acesso ao Portal é best-effort — a captação do lead não pode falhar */
  }

  // Avisa a equipe (ADMIN/ROOT) — notificação + e-mail.
  const contato = lead.empresa ? `${lead.nome} · ${lead.empresa}` : lead.nome;
  const equipe = await prisma.user.findMany({
    where: { ativo: true, deletedAt: null, role: { in: ["ADMIN", "ROOT"] } },
    select: { id: true },
  });
  for (const u of equipe) {
    void notificar(u.id, "lead_novo", { contato }, { entidadeTipo: "lead", entidadeId: lead.id }).catch(() => {});
  }

  return { ok: true };
}

/**
 * Garante uma conta Cliente (PROSPECT) ligada ao lead — cria se ainda não existir,
 * a partir dos dados do lead. Usado pelo convite ao Portal e pela geração de documentos.
 * O lead segue no funil (independe de conversão). Retorna o clienteId.
 */
export async function garantirClienteDoLead(
  lead: { id: string; nome: string; empresa: string | null; email: string | null; telefone: string | null; observacoes: string | null; responsavelId: string | null; clienteId: string | null },
  atorId?: string | null,
): Promise<string> {
  // Só reaproveita o cliente ligado se ele ainda existir (não removido) — senão religa/recria.
  if (lead.clienteId) {
    const atual = await prisma.cliente.findFirst({ where: { id: lead.clienteId, deletedAt: null }, select: { id: true } });
    if (atual) return atual.id;
  }

  // Reusa um cliente existente com o mesmo e-mail (evita duplicar em recapturas / conversões).
  if (lead.email) {
    const existente = await prisma.cliente.findFirst({ where: { email: lead.email, deletedAt: null }, select: { id: true } });
    if (existente) {
      await prisma.lead.update({ where: { id: lead.id }, data: { clienteId: existente.id } });
      return existente.id;
    }
  }

  const temEmpresa = !!lead.empresa?.trim();
  const cliente = await prisma.cliente.create({
    data: {
      // Com empresa, a CONTA é a empresa (PJ); a pessoa do lead vira o contato principal
      // logo abaixo (não se perde). Sem empresa, o cliente é a própria pessoa (PF).
      nome: temEmpresa ? lead.empresa!.trim() : lead.nome.trim(),
      tipo: temEmpresa ? "PJ" : "PF",
      email: lead.email,
      telefone: lead.telefone,
      observacoes: lead.observacoes,
      responsavelId: lead.responsavelId ?? atorId ?? null,
      situacaoComercial: "PROSPECT",
    },
  });
  // PJ: preserva a pessoa do lead como CONTATO PRINCIPAL da empresa.
  if (temEmpresa && lead.nome.trim()) {
    await prisma.contato.create({
      data: { clienteId: cliente.id, nome: lead.nome.trim(), email: lead.email, telefone: lead.telefone, principal: true },
    });
  }
  await prisma.lead.update({ where: { id: lead.id }, data: { clienteId: cliente.id } });
  return cliente.id;
}

/**
 * Convida o lead para o Portal do Cliente: cria (se ainda não existe) a conta
 * Cliente com situação PROSPECT ligada ao lead — que **segue no funil** — e envia
 * o convite de acesso (papel CLIENTE). Reusa a infra de convite dos usuários.
 */
export async function convidarPortal(leadId: string, ator: { id: string; role: Role }) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado" });
  if (!lead.email) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cadastre um e-mail no lead para convidá-lo ao Portal.",
    });
  }

  const clienteId = await garantirClienteDoLead(lead, ator.id);

  // Já existe usuário de Portal para essa conta?
  const jaTem = await prisma.user.findFirst({
    where: { clienteId, role: "CLIENTE", deletedAt: null },
  });
  if (jaTem) {
    if (jaTem.passwordHash === null) {
      const r = await reenviarConvite(ator.role, jaTem.id);
      await avancarLeadAuto(leadId, "qualificacao", "Convite ao Portal enviado");
      return { clienteId, conviteUrl: r.conviteUrl, emailEnviado: r.emailEnviado, email: r.email };
    }
    throw new TRPCError({ code: "CONFLICT", message: "Este cliente já tem acesso ativo ao Portal." });
  }

  const { usuario, conviteUrl, emailEnviado } = await convidarUsuario(ator.role, {
    nome: lead.nome,
    email: lead.email,
    role: "CLIENTE",
    clienteId,
  });
  await avancarLeadAuto(leadId, "qualificacao", "Convite ao Portal enviado");
  return { clienteId, conviteUrl, emailEnviado, email: usuario.email };
}

export async function removeLead(id: string, userId: string) {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { clienteId: true } });
  await prisma.lead.update({ where: { id }, data: { deletedAt: new Date() } });
  await prisma.activityLog.create({
    data: { userId, acao: "lead.removido", entidadeTipo: "lead", entidadeId: id },
  });
  // A situação do cliente é o placar do funil: se esta era a oportunidade que a sustentava,
  // reconcilia (respeita a regra de ouro — ATIVO nunca rebaixa).
  await reconciliarSituacaoCliente(lead?.clienteId ?? null);
  return { ok: true };
}
