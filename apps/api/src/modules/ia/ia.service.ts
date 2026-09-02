import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { hasRoleLevel, type Role } from "@app/shared";
import { aiService } from "../../lib/ai.js";
import { isAiEnabled } from "../../config.js";
import { listEventos } from "../agenda/agenda.service.js";
import { emReaisOu } from "../../lib/dinheiro.js";

/** Persona da assistente do Workspace — guia de uso + apoio geral, em PT-BR. */
const SYSTEM = `Você é a assistente virtual do "Workspace MedConsultoria", o sistema operacional interno da consultoria MedConsultoria (não é um SaaS).
Responda SEMPRE em português do Brasil, de forma breve, prática e cordial.

O sistema tem estas áreas: Dashboard (visão do dia), Funil de vendas (leads em kanban), Clientes, Projetos (kanban com tarefas, checklist, prioridade e cronômetro), Agenda (compromissos, retornos e reuniões por link), Mensagens (chat interno), Documentos (gerados de modelos com variáveis ou com IA; fluxo rascunho → em revisão → aprovado → enviado; export PDF/Word), Financeiro (contas a pagar/receber, categorias — só administradores), Configurações (perfil e senha) e Usuários (equipe e criação de acessos ao Portal do Cliente).

Ajude a pessoa a usar o sistema (onde clicar, como fazer) e responda dúvidas gerais de gestão/consultoria.
Nunca invente dados específicos de clientes, valores ou registros que você não recebeu — se não souber um dado concreto do sistema, oriente onde encontrá-lo na tela.`;

/** Faz uma pergunta ao assistente. Lança erro claro se a IA não estiver configurada. */
export function perguntar(pergunta: string): Promise<string> {
  return aiService.gerarRascunho(SYSTEM, pergunta.trim());
}

// ── Sugestões de IA (a IA propõe; o usuário aprova) ──────────────

function exigirIA() {
  if (!isAiEnabled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "IA não configurada (OPENAI_API_KEY)." });
}

const SYSTEM_SUGESTAO =
  "Você é uma assistente da consultoria MedConsultoria (setor de saúde: clínicas, consultórios, médicos). Seja prática, objetiva e em português do Brasil. Quando pedirem JSON, responda APENAS com o JSON válido — sem markdown, sem comentários, sem cercas de código.";

const dataBR = () => new Date().toLocaleDateString("pt-BR");

/**
 * Extrai o primeiro array/objeto JSON de um texto (tolerante a cercas/markdown).
 *
 * ⚠️ **LANÇA quando o texto não é JSON** — e quem chama tem de decidir o que fazer com isso.
 * A resposta vem de um modelo de linguagem: nada garante o formato, e uma frase de explicação
 * antes do array já basta para o recorte por `indexOf`/`lastIndexOf` sair torto. Deixar o
 * `SyntaxError` subir cru pelo tRPC é o defeito da ADR-135 de novo: vira
 * `INTERNAL_SERVER_ERROR`, entope `SISTEMA → Erros` com um estado ESPERADO e ainda entrega a
 * mensagem técnica do parser para quem está na tela.
 *
 * Use `extrairJsonOu`, abaixo, sempre que houver um resultado neutro possível.
 */
function extrairJson<T>(texto: string): T {
  const limpo = texto.replace(/```json/gi, "").replace(/```/g, "").trim();
  const ini = Math.min(...["[", "{"].map((c) => (limpo.indexOf(c) < 0 ? Infinity : limpo.indexOf(c))));
  const fim = Math.max(limpo.lastIndexOf("]"), limpo.lastIndexOf("}"));
  const slice = ini !== Infinity && fim >= 0 ? limpo.slice(ini, fim + 1) : limpo;
  return JSON.parse(slice) as T;
}

/**
 * O mesmo, com rede: devolve `alternativa` quando a IA não respondeu JSON.
 *
 * Sugestão é ajuda, não contrato — a tela pede "sugira as exigências deste serviço" e a pessoa
 * aceita ou digita as dela. Uma lista vazia é um resultado ruim; um erro vermelho por causa de
 * uma vírgula do modelo é pior, e mente sobre a saúde do sistema.
 */
function extrairJsonOu<T>(texto: string, alternativa: T): T {
  try {
    return extrairJson<T>(texto);
  } catch {
    return alternativa;
  }
}

/** "Plano do dia": o que a pessoa deve fazer hoje, a partir das suas pendências reais. */
export async function resumoDoDia(userId: string, role: Role): Promise<string> {
  exigirIA();
  const isAdmin = hasRoleLevel(role, "ADMIN");
  const hoje0 = new Date();
  hoje0.setHours(0, 0, 0, 0);
  const hojeFim = new Date();
  hojeFim.setHours(23, 59, 59, 999);
  const [atrasadas, tarefasHoje, eventosHoje, docsRevisao, contasVencidas] = await Promise.all([
    prisma.card.findMany({
      where: { deletedAt: null, status: { not: "CONCLUIDO" }, responsavelId: userId, prazo: { lt: hoje0 } },
      select: { titulo: true, projeto: { select: { nome: true } } },
      orderBy: { prazo: "asc" },
      take: 8,
    }),
    prisma.card.count({ where: { deletedAt: null, status: { not: "CONCLUIDO" }, responsavelId: userId, prazo: { gte: hoje0, lte: hojeFim } } }),
    listEventos(hoje0, hojeFim, userId),
    isAdmin ? prisma.documento.count({ where: { deletedAt: null, status: "EM_REVISAO" } }) : Promise.resolve(0),
    isAdmin ? prisma.conta.count({ where: { pago: false, vencimento: { lt: hoje0 } } }) : Promise.resolve(0),
  ]);
  const horaEv = (d: Date) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const ctx = [
    `Tarefas atrasadas (${atrasadas.length}): ${atrasadas.map((t) => `${t.titulo} [${t.projeto.nome}]`).join("; ") || "nenhuma"}.`,
    `Tarefas que vencem hoje: ${tarefasHoje}.`,
    `Compromissos de hoje (${eventosHoje.length}): ${eventosHoje.map((e) => `${e.diaInteiro ? "" : horaEv(e.inicio) + " "}${e.titulo}`).join("; ") || "nenhum"}.`,
    isAdmin ? `Gestão — documentos aguardando revisão: ${docsRevisao}; contas vencidas: ${contasVencidas}.` : "",
  ].filter(Boolean).join("\n");
  const user = `Data de hoje: ${dataBR()}. Ajude a pessoa a saber o que fazer HOJE.
Com base nos dados, escreva um "plano do dia" curto e priorizado (comece pelo mais urgente), em até 6 tópicos objetivos e motivadores. Se estiver tudo em dia, diga isso e sugira 1-2 ações proativas. Não invente dados nem tarefas que não estão aqui.

${ctx}`;
  return aiService.gerarRascunho(SYSTEM_SUGESTAO, user);
}

/** Resumo/preparo da agenda de um período (dia ou semana). */
export async function resumoAgenda(userId: string, inicio: Date, fim: Date, rotulo?: string): Promise<string> {
  exigirIA();
  const eventos = await listEventos(inicio, fim, userId);
  const tz = "America/Sao_Paulo";
  const quando = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
  const linhas = eventos.map((e) => {
    const partes = [
      e.diaInteiro ? `${new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", timeZone: tz }).format(e.inicio)} (dia inteiro)` : quando(e.inicio),
      e.titulo,
      e.cliente ? `cliente: ${e.cliente.nome}` : "",
      e.local ? `local: ${e.local}` : "",
      e.linkReuniao ? "online" : "",
    ].filter(Boolean);
    return `- ${partes.join(" · ")}`;
  });
  const ctx = eventos.length
    ? `Compromissos do período (${eventos.length}):\n${linhas.join("\n")}`
    : "Nenhum compromisso no período.";
  const user = `Data de hoje: ${dataBR()}. Período: ${rotulo ?? "selecionado"}.
Com base na agenda abaixo, escreva um resumo curto e prático para a pessoa se preparar: quantos compromissos, os horários de pico, o que exige preparação (reuniões com cliente/link), e 1-2 dicas objetivas. Se estiver vazia, sugira 1-2 ações proativas. Máximo 6 tópicos. Não invente compromissos que não estão aqui.

${ctx}`;
  return aiService.gerarRascunho(SYSTEM_SUGESTAO, user);
}

// ── IA do painel SISTEMA (dev/root): detectar, explicar e corrigir problemas ──
const SYSTEM_TECNICO =
  "Você é um engenheiro de software/SRE sênior responsável por manter o Workspace MedConsultoria 100% saudável e seguro. Stack: Node 20 + Fastify + tRPC + Prisma/MySQL + Socket.IO no back; React + Vite + TanStack no front; app de UM processo (sem cluster). Responda SEMPRE em português do Brasil, técnico, direto e ACIONÁVEL (diga o que verificar/rodar/corrigir). Não invente dados nem arquivos que não foram informados.";

/** Diagnóstico geral do sistema: lê o estado real e devolve avaliação + causas + correções. */
export async function diagnosticoSistema(): Promise<string> {
  exigirIA();
  const { saude, erros, incidentes, metricas, banco } = await import("../sistema/sistema.service.js");
  const [s, errs, incs, m, db] = await Promise.all([saude(), erros(), incidentes(), metricas(), banco()]);
  const errosAbertos = errs.filter((e) => !e.resolvido);
  const incAbertos = incs.filter((i) => i.status !== "RESOLVIDO");
  const ctx = [
    `SAÚDE: ${JSON.stringify(s).slice(0, 1500)}`,
    `ERROS ABERTOS (${errosAbertos.length}): ${errosAbertos.slice(0, 12).map((e) => `[${e.ocorrencias}x] ${e.mensagem}${e.rota ? ` @${e.rota}` : ""}`).join(" | ") || "nenhum"}`,
    `INCIDENTES ABERTOS (${incAbertos.length}): ${incAbertos.map((i) => `${i.titulo} [${i.severidade}] ${i.componente}: ${i.detalhe}`).join(" | ") || "nenhum"}`,
    `BANCO: ${JSON.stringify(db).slice(0, 800)}`,
    `MÉTRICAS: ${JSON.stringify(m).slice(0, 600)}`,
  ].join("\n");
  const user = `Data/hora: ${new Date().toLocaleString("pt-BR")}. Faça um DIAGNÓSTICO técnico do sistema a partir do estado abaixo:
1) Avaliação geral — está saudável? O que preocupa? (1-2 frases)
2) Os problemas mais prováveis, com a causa-raiz de cada um.
3) Correções recomendadas, passo a passo (o que investigar/rodar/corrigir, e quais botões deste painel usar: Resolver erro/incidente, Revogar sessão, Limpar sessões, Rodar varredura).
Se estiver tudo saudável, diga isso e sugira 1-2 verificações preventivas. Máximo ~8 tópicos.

${ctx}`;
  return aiService.gerarRascunho(SYSTEM_TECNICO, user);
}

/** Explica um erro específico (ErrorLog) e sugere a correção. */
export async function explicarErro(id: string): Promise<string> {
  exigirIA();
  const e = await prisma.errorLog.findUnique({ where: { id } });
  if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Erro não encontrado." });
  const user = `Erro registrado na aplicação (agrupado por fingerprint):
Mensagem: ${e.mensagem}
Rota: ${e.rota ?? "—"}
Ocorrências: ${e.ocorrencias}${e.regrediu ? " (REGREDIU — já tinha sido resolvido)" : ""}
Stack:
${(e.stack ?? "sem stack").slice(0, 2500)}

Explique de forma direta: (1) a causa mais provável, (2) como corrigir (passos concretos no código/config), (3) é crítico ou é ruído que pode ser ignorado?`;
  return aiService.gerarRascunho(SYSTEM_TECNICO, user);
}

/** Explica um incidente (regra de alerta) e sugere a mitigação. */
export async function explicarIncidente(id: string): Promise<string> {
  exigirIA();
  const i = await prisma.incidente.findUnique({ where: { id } });
  if (!i) throw new TRPCError({ code: "NOT_FOUND", message: "Incidente não encontrado." });
  const user = `Incidente aberto pelo motor de alertas:
Regra: ${i.regra}
Título: ${i.titulo}
Severidade: ${i.severidade}
Componente: ${i.componente}
Detalhe: ${i.detalhe}${i.valorPico != null ? `\nValor de pico: ${i.valorPico}` : ""}

Explique: (1) o que este alerta significa, (2) a causa mais provável, (3) como mitigar/corrigir passo a passo, (4) como prevenir a recorrência.`;
  return aiService.gerarRascunho(SYSTEM_TECNICO, user);
}

/** Sugere as exigências (documentos) de um serviço. */
export async function sugerirRequisitos(servicoId: string): Promise<{ titulo: string; descricao?: string; obrigatorio?: boolean }[]> {
  exigirIA();
  const s = await prisma.servico.findUnique({ where: { id: servicoId }, select: { nome: true, descricao: true } });
  if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Serviço não encontrado." });
  const user = `Serviço da MedConsultoria: "${s.nome}"${s.descricao ? ` — ${s.descricao}` : ""}.
Liste de 3 a 6 DOCUMENTOS ou INFORMAÇÕES que o cliente precisa enviar para executarmos esse serviço.
Responda APENAS um array JSON: [{"titulo":"...","descricao":"breve explicação para o cliente","obrigatorio":true}].`;
  const txt = await aiService.gerarRascunho(SYSTEM_SUGESTAO, user);
  const arr = extrairJsonOu<{ titulo: string; descricao?: string; obrigatorio?: boolean }[]>(txt, []);
  return Array.isArray(arr) ? arr.filter((x) => x?.titulo).slice(0, 8) : [];
}

/** Sugere as perguntas (campos) de um formulário/briefing. */
export async function sugerirCampos(titulo: string, descricao?: string) {
  exigirIA();
  const user = `Crie as perguntas de um formulário/briefing chamado "${titulo}"${descricao ? ` (${descricao})` : ""}, que um cliente de uma consultoria de saúde vai responder.
De 4 a 8 perguntas. Cada item: "rotulo" (a pergunta), "tipo" (um de: TEXTO_CURTO, TEXTO_LONGO, ESCOLHA, MULTIPLA, NUMERO, SIM_NAO, DATA), "obrigatorio" (boolean) e, só para ESCOLHA/MULTIPLA, "opcoes" (array de strings).
Responda APENAS o array JSON.`;
  const txt = await aiService.gerarRascunho(SYSTEM_SUGESTAO, user);
  const tipos = ["TEXTO_CURTO", "TEXTO_LONGO", "ESCOLHA", "MULTIPLA", "NUMERO", "SIM_NAO", "DATA"];
  const arr = extrairJsonOu<{ rotulo: string; tipo: string; obrigatorio?: boolean; opcoes?: string[] }[]>(txt, []);
  return (Array.isArray(arr) ? arr : [])
    .filter((c) => c?.rotulo)
    .map((c) => ({
      rotulo: c.rotulo,
      tipo: tipos.includes(c.tipo) ? c.tipo : "TEXTO_CURTO",
      obrigatorio: !!c.obrigatorio,
      opcoes: Array.isArray(c.opcoes) ? c.opcoes.filter((o) => typeof o === "string") : [],
    }))
    .slice(0, 10);
}

/** Resumo do cliente + próximos passos sugeridos (para a ficha). */
export async function resumirCliente(clienteId: string): Promise<string> {
  exigirIA();
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { nome: true, situacaoComercial: true, createdAt: true },
  });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
  const [servicos, projetos, proxReuniao, oportunidades] = await Promise.all([
    prisma.clienteServico.findMany({ where: { clienteId, status: "ATIVO" }, select: { servico: { select: { nome: true } } } }),
    prisma.projeto.findMany({ where: { clienteId, deletedAt: null }, select: { nome: true, status: true } }),
    prisma.evento.findFirst({ where: { clienteId, inicio: { gte: new Date() } }, orderBy: { inicio: "asc" }, select: { titulo: true, inicio: true } }),
    prisma.lead.findMany({ where: { clienteId, convertidoEmClienteId: null, perdidoEm: null, deletedAt: null }, select: { servicos: { select: { nome: true } } } }),
  ]);

  const ctx = [
    `Cliente: ${cliente.nome} (situação: ${cliente.situacaoComercial}). Cliente desde ${cliente.createdAt.toLocaleDateString("pt-BR")}.`,
    `Serviços contratados: ${servicos.map((s) => s.servico.nome).join(", ") || "nenhum"}.`,
    `Projetos: ${projetos.map((p) => `${p.nome} (${p.status})`).join("; ") || "nenhum"}.`,
    proxReuniao ? `Próxima reunião: ${proxReuniao.titulo} em ${proxReuniao.inicio.toLocaleDateString("pt-BR")}.` : "Sem reunião futura agendada.",
    oportunidades.length
      ? `Oportunidades abertas no funil (quer mais): ${oportunidades.flatMap((o) => o.servicos.map((s) => s.nome)).join(", ") || "sem serviços definidos"}.`
      : "Sem oportunidade aberta no funil.",
    // `observacoes` NÃO vai para a IA (ADR-141): é texto livre onde a migração de 19/08
    // guardou o CPF de quem era pessoa física, e onde cai o que o público digita no site.
  ].filter(Boolean).join("\n");

  const user = `Data de hoje: ${dataBR()}.
Com base nos dados abaixo, escreva um RESUMO curto do cliente (3-5 frases) e, em seguida, uma lista de 3 PRÓXIMOS PASSOS práticos para a equipe. Não invente dados que não estão aqui.

${ctx}`;
  return aiService.gerarRascunho(SYSTEM_SUGESTAO, user);
}

/** Sugere o próximo passo de um lead no funil. */
export async function sugerirProximoPassoLead(leadId: string): Promise<string> {
  exigirIA();
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      pipelineStage: { select: { nome: true } },
      servicos: { select: { nome: true } },
      passos: { where: { concluido: false }, select: { titulo: true }, take: 10 },
    },
  });
  if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
  const ctx = [
    `Lead: ${lead.nome}${lead.empresa ? ` (${lead.empresa})` : ""}. Etapa atual: ${lead.pipelineStage.nome}.`,
    `Serviços de interesse: ${lead.servicos.map((s) => s.nome).join(", ") || "não definidos"}.`,
    lead.valorEstimado ? `Valor estimado: R$ ${emReaisOu(lead.valorEstimado).toLocaleString("pt-BR")}.` : "Sem valor estimado.",
    lead.passos.length ? `Passos pendentes: ${lead.passos.map((p) => p.titulo).join("; ")}.` : "Sem passos pendentes registrados.",
  ].filter(Boolean).join("\n");
  const user = `Data de hoje: ${dataBR()}.
Sugira o PRÓXIMO PASSO mais eficaz para avançar este lead no funil (1-3 ações concretas e objetivas, em tópicos). Não invente dados.

${ctx}`;
  return aiService.gerarRascunho(SYSTEM_SUGESTAO, user);
}

/** Escreve um e-mail/mensagem para um lead ou cliente. Devolve { assunto, corpo }. */
export async function escreverMensagem(input: { leadId?: string; clienteId?: string; objetivo?: string }): Promise<{ assunto: string; corpo: string }> {
  exigirIA();
  let nome = "cliente";
  let contexto = "";
  if (input.leadId) {
    const l = await prisma.lead.findUnique({ where: { id: input.leadId }, include: { pipelineStage: { select: { nome: true } }, servicos: { select: { nome: true } } } });
    if (l) {
      nome = l.nome;
      contexto = `Lead na etapa "${l.pipelineStage.nome}", interessado em: ${l.servicos.map((s) => s.nome).join(", ") || "não definido"}.`;
    }
  } else if (input.clienteId) {
    const c = await prisma.cliente.findUnique({ where: { id: input.clienteId }, select: { nome: true } });
    const servicos = await prisma.clienteServico.findMany({ where: { clienteId: input.clienteId, status: "ATIVO" }, select: { servico: { select: { nome: true } } } });
    if (c) {
      nome = c.nome;
      contexto = `Cliente com os serviços: ${servicos.map((s) => s.servico.nome).join(", ") || "nenhum"}.`;
    }
  }
  const user = `Escreva um e-mail profissional e cordial da MedConsultoria para "${nome}".
${contexto}
Objetivo do e-mail: ${input.objetivo?.trim() || "dar sequência ao atendimento de forma proativa"}.
Responda APENAS um JSON: {"assunto":"...","corpo":"..."}. O corpo em texto simples, com saudação e assinatura "Equipe MedConsultoria".`;
  const txt = await aiService.gerarRascunho(SYSTEM_SUGESTAO, user);
  try {
    const o = extrairJson<{ assunto?: string; corpo?: string }>(txt);
    return { assunto: o.assunto ?? "Contato — MedConsultoria", corpo: o.corpo ?? txt };
  } catch {
    return { assunto: "Contato — MedConsultoria", corpo: txt };
  }
}
