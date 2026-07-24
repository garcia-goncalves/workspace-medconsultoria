import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type {
  CreateDocumentoInput,
  CriarPropostaInput,
  CriarContratoInput,
  ContextoClienteDocInput,
  DocumentoServicoItem,
  StatusDocumento,
  GerarComIAInput,
  ResumirReuniaoInput,
  GerarPautaInput,
} from "@app/shared";
import type { TipoModelo } from "@app/shared";
import { qualificacaoContratada } from "@app/shared";
import { aiService } from "../../lib/ai.js";
import { avancarLeadPorClienteAuto, garantirClienteDoLead } from "../leads/leads.service.js";
import { listModelos } from "./modelos.service.js";
import { getIdentidade } from "../identidade/identidade.service.js";
import { notificar } from "../notificacoes/notificacoes.service.js";
import { isAiEnabled } from "../../config.js";

type ClienteMin = {
  nome: string;
  email: string | null;
  documento: string | null;
  telefone: string | null;
} | null;

/** Substitui {{chave}} pelas variáveis + campos do cliente + data. */
function render(corpo: string, variaveis: Record<string, string>, cliente: ClienteMin): string {
  const ctx: Record<string, string> = { ...variaveis };
  if (cliente) {
    ctx["cliente.nome"] = cliente.nome;
    ctx["cliente.email"] = cliente.email ?? "";
    ctx["cliente.documento"] = cliente.documento ?? "";
    ctx["cliente.telefone"] = cliente.telefone ?? "";
  }
  ctx["data"] = new Date().toLocaleDateString("pt-BR");
  // Escapa HTML nos VALORES (dados do cliente/form são não confiáveis) — o corpo é Markdown
  // renderizado; assim nenhum valor injeta HTML ativo. O template em si é confiável (admin).
  const escVal = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Campo sem valor: placeholder claro de "a preencher" (nunca deixa `[campo]` com cara de bug).
  return corpo.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) =>
    ctx[k] != null ? escVal(ctx[k]) : "*(a preencher)*",
  );
}

export function listDocumentos(status?: StatusDocumento) {
  return prisma.documento.findMany({
    where: { deletedAt: null, ...(status ? { status } : {}) },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      titulo: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      // Sinais para a faixa "Precisa de atenção" no arquivo.
      propostaStatus: true,
      assinaturaSolicitadaEm: true,
      assinadoEm: true,
      modelo: { select: { nome: true, tipo: true } },
      cliente: { select: { nome: true } },
      criadoPor: { select: { nome: true } },
    },
  });
}

export async function getDocumento(id: string) {
  const doc = await prisma.documento.findFirst({
    where: { id, deletedAt: null },
    include: {
      modelo: { select: { nome: true, tipo: true } },
      cliente: { select: { id: true, nome: true } },
      criadoPor: { select: { nome: true } },
      aprovadoPor: { select: { nome: true } },
      versoes: { orderBy: { createdAt: "desc" }, include: { autor: { select: { nome: true } } } },
    },
  });
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
  return doc;
}

export async function createDocumento(input: CreateDocumentoInput, userId: string) {
  const modelo = await prisma.modeloDocumento.findUnique({ where: { id: input.modeloId } });
  if (!modelo) throw new TRPCError({ code: "NOT_FOUND", message: "Modelo não encontrado" });

  const clienteId = input.clienteId?.trim() || null;
  const cliente = clienteId
    ? await prisma.cliente.findUnique({
        where: { id: clienteId },
        select: { nome: true, email: true, documento: true, telefone: true },
      })
    : null;

  const conteudo = render(modelo.corpo, input.variaveis ?? {}, cliente);
  const titulo = input.titulo?.trim() || `${modelo.nome}${cliente ? " - " + cliente.nome : ""}`;

  return prisma.documento.create({
    data: {
      modeloId: modelo.id,
      clienteId,
      titulo,
      conteudo,
      status: "RASCUNHO",
      criadoPorId: userId,
      versoes: { create: { conteudo, autorId: userId, origem: "MANUAL" } },
    },
  });
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

type ItemServico = { servicoId: string; valor?: number; quantidade?: number; recorrencia: "AVULSO" | "MENSAL"; percentual?: number | null };
type ServicoInfo = { id: string; nome: string; descricao?: string | null };

/**
 * Monta, a partir dos itens escolhidos + info do catálogo, a TABELA Markdown de serviços e as
 * linhas de INVESTIMENTO (à vista / mensal / % do faturamento). Reaproveitado pela proposta
 * comercial e pelo contrato inteligente — fonte única do cálculo de preços. Ver ADR-81.
 */
function montarServicos(itens: ItemServico[], servicos: ServicoInfo[]): { tabela: string; investimento: string; nomes: string[] } {
  const sufixo = (r: string) => (r === "MENSAL" ? "/mês" : "");
  let totalAvulso = 0;
  let totalMensal = 0;
  const percentuais: string[] = [];
  const linhasTabela = itens.map((it) => {
    const s = servicos.find((x) => x.id === it.servicoId);
    const qtd = it.quantidade ?? 1;
    const sub = (it.valor ?? 0) * qtd;
    if (it.recorrencia === "MENSAL") totalMensal += sub;
    else totalAvulso += sub;
    const partes: string[] = [];
    if (sub > 0) {
      const base = qtd > 1 ? `${qtd} × ${brl(it.valor ?? 0)} = ${brl(sub)}` : brl(sub);
      partes.push(base + sufixo(it.recorrencia));
    }
    if (it.percentual != null && it.percentual > 0) {
      partes.push(`${fmtPct(it.percentual)} do faturamento/mês`);
      percentuais.push(`${fmtPct(it.percentual)} do faturamento (${s?.nome ?? "serviço"})`);
    }
    const preco = partes.length ? partes.join(" + ") : "a combinar";
    const nome = s?.nome ?? "Serviço";
    const desc = s?.descricao ? ` — ${s.descricao}` : "";
    return `| **${nome}**${desc} | ${preco} |`;
  });
  const investimento: string[] = [];
  if (totalAvulso > 0) investimento.push(`- **À vista (1x):** ${brl(totalAvulso)}`);
  if (totalMensal > 0) investimento.push(`- **Mensal:** ${brl(totalMensal)}/mês`);
  for (const p of percentuais) investimento.push(`- **${p}** — por mês`);
  if (investimento.length === 0) investimento.push("- A combinar");
  return {
    tabela: `| Serviço | Investimento |\n| --- | --- |\n${linhasTabela.join("\n")}`,
    investimento: investimento.join("\n"),
    nomes: itens.map((it) => servicos.find((x) => x.id === it.servicoId)?.nome ?? "Serviço"),
  };
}

/**
 * Proposta INTELIGENTE: monta o documento a partir dos serviços escolhidos do catálogo
 * (com preços editáveis), calcula o total e — opcionalmente — usa a IA para escrever a
 * apresentação. Fica como RASCUNHO editável, ligado ao tipo PROPOSTA (empurra o funil ao
 * ser enviado).
 */
export async function criarProposta(input: CriarPropostaInput, userId: string) {
  const clienteId = input.clienteId?.trim() || null;
  const cliente = clienteId
    ? await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, email: true, documento: true, telefone: true } })
    : null;

  // Prazo/condições/observações entram nos dois formatos.
  const extras = [
    input.prazo?.trim() ? `**Prazo estimado:** ${input.prazo.trim()}` : "",
    input.condicoes?.trim() ? `**Condições de pagamento:** ${input.condicoes.trim()}` : "",
  ].filter(Boolean);

  // Duas trilhas de investimento: COMERCIAL (catálogo de serviços) × CREDENCIAMENTO (por operadora).
  const ehCredenciamento = (input.operadoras?.length ?? 0) > 0;
  let servicosNomes: string[] = [];
  let blocoServicos: string;

  if (ehCredenciamento) {
    // CREDENCIAMENTO: o investimento é POR OPERADORA (não passa pelo catálogo de serviços).
    const ops = input.operadoras ?? [];
    const fee = input.valorPorOperadora ?? 0;
    const total = fee * ops.length;
    const investeTxt =
      fee > 0
        ? `**${brl(total)}** para o credenciamento em **${ops.length} operadora(s)** — ${brl(fee)} por operadora.`
        : "Investimento a combinar conforme as operadoras selecionadas.";
    const bloco = [`## Investimento\n\n${investeTxt}`];
    if (extras.length) bloco.push(extras.join("  \n"));
    if (input.observacoes?.trim()) bloco.push(input.observacoes.trim());
    blocoServicos = bloco.join("\n\n");
  } else {
    // COMERCIAL: catálogo de serviços com preços (tabela + investimento total).
    const servicos = await prisma.servico.findMany({
      where: { id: { in: input.itens.map((i) => i.servicoId) } },
      select: { id: true, nome: true, descricao: true },
    });
    const r = montarServicos(input.itens, servicos);
    servicosNomes = r.nomes;

    const bloco = [
      `## Serviços propostos\n\n${r.tabela}`,
      `## Investimento\n\n${r.investimento}`,
    ];
    if (extras.length) bloco.push(extras.join("  \n"));
    if (input.observacoes?.trim()) bloco.push(input.observacoes.trim());
    blocoServicos = bloco.join("\n\n");
  }

  // Operadoras selecionadas → {{operadoras}} (só o modelo de credenciamento tem esse marcador).
  const operadorasBloco =
    (input.operadoras?.length ?? 0) > 0
      ? (input.operadoras ?? []).map((o) => `- **${o}**`).join("\n")
      : "_(a definir com você)_";

  // Usa o CORPO do modelo escolhido como moldura (proposta comercial ≠ credenciamento):
  // {{servicos}} = tabela/investimento; {{operadoras}} = operadoras; {{apresentacao}} = abertura.
  const modelo = input.modeloId
    ? await prisma.modeloDocumento.findUnique({ where: { id: input.modeloId } })
    : await prisma.modeloDocumento.findFirst({ where: { tipo: "PROPOSTA", ativo: true }, orderBy: { createdAt: "asc" } });

  // Apresentação (abertura) só é montada quando o modelo tem {{apresentacao}} — a proposta de
  // credenciamento já traz a própria abertura no corpo, então NÃO recebe a genérica. Pode ser IA.
  const usaApresentacao = modelo?.corpo?.includes("{{apresentacao}}") ?? false;
  const nomeCliente = cliente?.nome ?? "cliente";
  let apresentacao =
    `A MedConsultoria cuida de todos os processos da sua clínica para lhe dar mais tempo e ` +
    `tranquilidade para fazer o que mais importa: cuidar de vidas. Apresentamos a seguir a ` +
    `proposta pensada para as suas necessidades.`;
  if (usaApresentacao && input.usarIA && isAiEnabled) {
    try {
      const user = [
        `Escreva um parágrafo de APRESENTAÇÃO (2-4 frases) para uma proposta comercial da MedConsultoria ao cliente "${nomeCliente}".`,
        `Serviços propostos: ${servicosNomes.join(", ")}.`,
        "Tom profissional e acolhedor, foco em saúde/clínicas. Responda apenas com o parágrafo, sem título.",
      ].join("\n");
      apresentacao = (await aiService.gerarRascunho(SYSTEM_IA, user)).trim() || apresentacao;
    } catch {
      /* IA best-effort — mantém o texto padrão */
    }
  }

  let conteudo: string;
  if (modelo?.corpo?.includes("{{servicos}}")) {
    const comMarcadores = modelo.corpo
      .replace(/\{\{\s*servicos\s*\}\}/g, blocoServicos)
      .replace(/\{\{\s*operadoras\s*\}\}/g, operadorasBloco)
      .replace(/\{\{\s*apresentacao\s*\}\}/g, apresentacao);
    conteudo = render(comMarcadores, {}, cliente);
  } else {
    const secoes = [
      `Prezado(a) ${cliente?.nome ?? ""},`.trim(),
      apresentacao,
      blocoServicos,
      "Ficamos à disposição para esclarecimentos.",
      "Atenciosamente,  \n**Equipe MedConsultoria**",
    ];
    conteudo = secoes.join("\n\n");
  }

  const titulo = input.titulo?.trim() || `${modelo?.nome ?? "Proposta"}${cliente ? " - " + cliente.nome : ""}`;

  const doc = await prisma.documento.create({
    data: {
      modeloId: modelo?.id ?? null,
      clienteId,
      titulo,
      conteudo,
      status: "RASCUNHO",
      criadoPorId: userId,
      // Itens estruturados (só na proposta comercial) — o aceite os sincroniza com os serviços
      // contratados do cliente. Credenciamento (operadoras) não mapeia para o catálogo.
      itens: ehCredenciamento ? undefined : (input.itens as object[]),
      versoes: { create: { conteudo, autorId: userId, origem: input.usarIA ? "IA" : "MANUAL" } },
    },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "documento.proposta_gerada", entidadeTipo: "documento", entidadeId: doc.id },
  });
  return doc;
}

/**
 * Serviços que o cliente JÁ TEM, de forma estruturada, para pré-preencher documentos.
 * Prioridade: serviços contratados (ClienteServico ATIVO, com preços reais) → serviços do lead
 * ativo (catálogo, para prospects sem contratação ainda) → vazio. Ver ADR-81.
 */
type ItemContexto = DocumentoServicoItem & { nome: string; categoria: string | null };
async function itensDoCliente(clienteId: string): Promise<{ itens: ItemContexto[]; origem: "CONTRATADO" | "LEAD" | "VAZIO" }> {
  const contratados = await prisma.clienteServico.findMany({
    where: { clienteId, status: "ATIVO" },
    select: {
      valor: true,
      valorRecorrencia: true,
      percentual: true,
      servico: { select: { id: true, nome: true, categoria: true } },
    },
    orderBy: { contratadoEm: "asc" },
  });
  if (contratados.length) {
    return {
      origem: "CONTRATADO",
      itens: contratados.map((c) => ({
        servicoId: c.servico.id,
        nome: c.servico.nome,
        categoria: c.servico.categoria,
        valor: c.valor ?? 0,
        quantidade: 1,
        recorrencia: (c.valorRecorrencia ?? "AVULSO") as "AVULSO" | "MENSAL",
        percentual: c.servico.categoria === "Faturamento" ? c.percentual ?? null : null,
      })),
    };
  }
  // Prospect ainda sem contratação: usa os serviços do lead ativo (preços de catálogo).
  const lead = await prisma.lead.findFirst({
    where: { clienteId, deletedAt: null, convertidoEmClienteId: null },
    orderBy: { createdAt: "desc" },
    select: { servicos: { select: { id: true, nome: true, valor: true, valorRecorrencia: true, percentual: true, categoria: true } } },
  });
  if (lead?.servicos.length) {
    return {
      origem: "LEAD",
      itens: lead.servicos.map((s) => ({
        servicoId: s.id,
        nome: s.nome,
        categoria: s.categoria,
        valor: s.valor ?? 0,
        quantidade: 1,
        recorrencia: (s.valorRecorrencia ?? "AVULSO") as "AVULSO" | "MENSAL",
        percentual: s.categoria === "Faturamento" ? s.percentual ?? null : null,
      })),
    };
  }
  return { origem: "VAZIO", itens: [] };
}

/**
 * CONTEXTO do cliente para o "Novo documento" se preencher sozinho. Devolve os serviços que o
 * cliente já tem (valores reais), o investimento agregado, a proposta aceita e sugestões de
 * campos (valor mensal, objeto/escopo, referente, prazo) — o dialog usa para pré-preencher.
 */
export async function contextoClienteDoc(input: ContextoClienteDocInput) {
  const cliente = await prisma.cliente.findUnique({
    where: { id: input.clienteId },
    select: { nome: true, tipo: true, documento: true, email: true, telefone: true },
  });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });

  const { itens, origem } = await itensDoCliente(input.clienteId);

  // Totais agregados (para sugerir valor/mensalidade e o resumo de investimento).
  let totalAvulso = 0;
  let totalMensal = 0;
  for (const it of itens) {
    const sub = (it.valor ?? 0) * (it.quantidade ?? 1);
    if (it.recorrencia === "MENSAL") totalMensal += sub;
    else totalAvulso += sub;
  }
  const nomes = itens.map((i) => i.nome);

  // Proposta aceita mais recente (referência comercial do que foi fechado).
  const propostaAceita = await prisma.documento.findFirst({
    where: { clienteId: input.clienteId, deletedAt: null, propostaStatus: "ACEITA" },
    orderBy: { propostaRespondidaEm: "desc" },
    select: { id: true, titulo: true, propostaRespondidaEm: true },
  });

  // Sugestões de texto para campos genéricos (preenchidas por inferência no dialog).
  const sugestoes = {
    // "objeto"/"escopo"/"servicos": lista dos serviços.
    servicos: nomes.length ? nomes.map((n) => `- ${n}`).join("\n") : "",
    // "referente": nomes em linha (recibo).
    referente: nomes.join(", "),
    // "valor"/"mensalidade": prioriza o mensal; senão o à vista.
    valor: totalMensal > 0 ? totalMensal : totalAvulso,
  };

  return {
    cliente,
    itens,
    origem, // CONTRATADO | LEAD | VAZIO — o dialog explica de onde veio
    investimento: { avulso: totalAvulso, mensal: totalMensal },
    propostaAceita: propostaAceita
      ? { id: propostaAceita.id, titulo: propostaAceita.titulo, em: propostaAceita.propostaRespondidaEm }
      : null,
    vigenciaSugerida: 12,
    sugestoes,
  };
}

/**
 * Texto de vigência/prazo do contrato a partir do número de meses (padrão 12). Renovação
 * automática por iguais períodos, com aviso de 30 dias — cláusula padrão editável.
 */
function textoVigencia(meses: number): string {
  const extenso: Record<number, string> = { 6: "seis", 12: "doze", 24: "vinte e quatro", 36: "trinta e seis" };
  const porExtenso = extenso[meses] ? ` (${extenso[meses]})` : "";
  return (
    `Vigência de ${meses}${porExtenso} ${meses === 1 ? "mês" : "meses"} a contar da assinatura, ` +
    `renovável automaticamente por iguais períodos, salvo manifestação em contrário com 30 (trinta) dias de antecedência.`
  );
}

/**
 * CONTRATO INTELIGENTE: monta o contrato a partir dos serviços contratados (valores reais) +
 * vigência. Preenche `{{objeto}}` (serviço + cláusula de cada um), a tabela de `{{valor}}` e o
 * `{{prazo}}` do modelo de contrato. Fica RASCUNHO editável, ligado ao tipo CONTRATO. Ver ADR-81.
 */
export async function criarContrato(input: CriarContratoInput, userId: string) {
  const cliente = await prisma.cliente.findUnique({
    where: { id: input.clienteId },
    select: { nome: true, email: true, documento: true, telefone: true },
  });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });

  const servicos = await prisma.servico.findMany({
    where: { id: { in: input.itens.map((i) => i.servicoId) } },
    select: { id: true, nome: true, descricao: true, clausulasContrato: true },
  });

  // {{objeto}} = LISTA enxuta dos serviços contratados + o preço acordado de cada um.
  const sufixo = (rec: string) => (rec === "MENSAL" ? "/mês" : "");
  const precoDoItem = (it: (typeof input.itens)[number]) => {
    const sub = (it.valor ?? 0) * (it.quantidade ?? 1);
    const partes: string[] = [];
    if (sub > 0) partes.push(brl(sub) + sufixo(it.recorrencia));
    if (it.percentual != null && it.percentual > 0) partes.push(`${fmtPct(it.percentual)} do faturamento/mês`);
    return partes.join(" + ");
  };
  const objeto = input.itens
    .map((it) => {
      const s = servicos.find((x) => x.id === it.servicoId);
      const preco = precoDoItem(it);
      return `- **${s?.nome ?? "Serviço"}**${preco ? ` — ${preco}` : ""}`;
    })
    .join("\n");

  // {{clausulas_servicos}} = seção PERSONALIZADA: cada serviço contratado como subtítulo + a sua
  // cláusula específica (editável em Ajustes → Serviços). Só entram os serviços deste contrato.
  const clausulasServicos = input.itens
    .map((it) => {
      const s = servicos.find((x) => x.id === it.servicoId);
      const cl = s?.clausulasContrato?.trim();
      return `### ${s?.nome ?? "Serviço"}\n\n${cl || "Serviço prestado conforme a proposta comercial e o escopo de trabalho aprovados pela CONTRATANTE."}`;
    })
    .join("\n\n");

  // {{valor}} = a tabela de investimento real (mesmo cálculo da proposta).
  const r = montarServicos(input.itens, servicos);
  const valorBloco = [r.investimento, input.observacoes?.trim() ? `\n${input.observacoes.trim()}` : ""].filter(Boolean).join("");
  const prazoTxt = textoVigencia(input.vigenciaMeses);
  // Identidade da CONTRATADA e foro vêm de Ajustes → Dados da empresa (editáveis pela Thaís).
  const identidade = await getIdentidade();
  const foroTxt = identidade.foro?.trim() || "da comarca do domicílio da CONTRATANTE";

  const modelo = input.modeloId
    ? await prisma.modeloDocumento.findUnique({ where: { id: input.modeloId } })
    : await prisma.modeloDocumento.findFirst({ where: { tipo: "CONTRATO", ativo: true }, orderBy: { createdAt: "asc" } });
  if (!modelo) throw new TRPCError({ code: "NOT_FOUND", message: "Nenhum modelo de contrato cadastrado." });

  // Injeta os blocos ricos (Markdown preservado) e depois resolve {{cliente.*}}/{{data}}.
  const comMarcadores = modelo.corpo
    .replace(/\{\{\s*objeto\s*\}\}/g, objeto)
    .replace(/\{\{\s*clausulas_servicos\s*\}\}/g, clausulasServicos)
    .replace(/\{\{\s*valor\s*\}\}/g, valorBloco)
    .replace(/\{\{\s*prazo\s*\}\}/g, prazoTxt)
    .replace(/\{\{\s*foro\s*\}\}/g, foroTxt)
    .replace(/\{\{\s*contratada\s*\}\}/g, qualificacaoContratada(identidade));
  const conteudo = render(comMarcadores, {}, cliente);
  const titulo = input.titulo?.trim() || `${modelo.nome} — ${cliente.nome}`;

  const doc = await prisma.documento.create({
    data: {
      modeloId: modelo.id,
      clienteId: input.clienteId,
      titulo,
      conteudo,
      status: "RASCUNHO",
      criadoPorId: userId,
      itens: input.itens as object[],
      versoes: { create: { conteudo, autorId: userId, origem: "MANUAL" } },
    },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "documento.contrato_gerado", entidadeTipo: "documento", entidadeId: doc.id },
  });
  return doc;
}

/**
 * AUTOMAÇÃO: gera uma proposta automaticamente quando o lead entra na etapa "Proposta" — a
 * partir dos serviços que o lead já escolheu. Nasce **EM_REVISÃO** (a equipe valida antes de
 * enviar) e avisa o responsável. Não duplica (só se ainda não houver proposta ligada ao lead)
 * e só age se o lead tiver serviços.
 */
export async function gerarPropostaAutoParaLead(leadId: string, userId: string) {
  const jaTem = await prisma.leadPasso.findFirst({
    where: { leadId, acaoDoc: "proposta", documentoId: { not: null } },
    select: { id: true },
  });
  if (jaTem) return;

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
    select: {
      id: true,
      nome: true,
      empresa: true,
      email: true,
      telefone: true,
      observacoes: true,
      responsavelId: true,
      clienteId: true,
      servicos: { select: { id: true, valor: true, valorRecorrencia: true, percentual: true, categoria: true } },
    },
  });
  if (!lead || lead.servicos.length === 0) return; // sem serviços = nada a propor ainda

  const clienteId = await garantirClienteDoLead(lead, userId);
  const itens = lead.servicos.map((s) => ({
    servicoId: s.id,
    valor: s.valor ?? 0,
    quantidade: 1,
    recorrencia: (s.valorRecorrencia ?? "AVULSO") as "AVULSO" | "MENSAL",
    percentual: s.categoria === "Faturamento" ? s.percentual ?? null : null,
  }));

  const doc = await criarProposta({ clienteId, itens, usarIA: false }, userId);
  // Nasce para REVISÃO e liga ao passo do funil (o painel do lead passa a mostrar o doc).
  await prisma.documento.update({ where: { id: doc.id }, data: { status: "EM_REVISAO" } });
  await prisma.leadPasso.updateMany({
    where: { leadId, acaoDoc: "proposta", documentoId: null },
    data: { documentoId: doc.id },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "documento.proposta_auto", entidadeTipo: "documento", entidadeId: doc.id },
  });
  // Avisa que há uma proposta pronta para revisar.
  void notificar(
    lead.responsavelId ?? userId,
    "documento_revisao",
    { documento: doc.titulo },
    { entidadeTipo: "documento", entidadeId: doc.id },
  ).catch(() => {});
  return doc;
}

/**
 * AUTOMAÇÃO (por CLIENTE): gera o contrato automaticamente a partir dos serviços CONTRATADOS
 * do cliente (valores reais + cláusulas de cada serviço + vigência), pelo mesmo construtor da
 * criação manual. Nasce **EM_REVISÃO** e avisa o responsável. **Não exige lead** — funciona
 * inclusive para cliente já convertido (era o furo do aceite do Acme). Não duplica: se já há
 * contrato para o cliente, sai. `opts.leadId` só liga o passo do funil e serve de fallback
 * (gerador genérico) quando o cliente ainda não tem serviços estruturados. Ver ADR-81.
 */
export async function gerarContratoAutoParaCliente(clienteId: string, userId: string, opts?: { leadId?: string }) {
  const jaTem = await prisma.documento.findFirst({
    where: { clienteId, deletedAt: null, modelo: { tipo: "CONTRATO" } },
    select: { id: true },
  });
  if (jaTem) return;

  const { itens } = await itensDoCliente(clienteId);
  let documentoId: string;
  if (itens.length) {
    const doc = await criarContrato(
      {
        clienteId,
        vigenciaMeses: 12,
        itens: itens.map(({ servicoId, valor, quantidade, recorrencia, percentual }) => ({ servicoId, valor, quantidade, recorrencia, percentual })),
      },
      userId,
    );
    documentoId = doc.id;
    if (opts?.leadId) await prisma.leadPasso.updateMany({ where: { leadId: opts.leadId, acaoDoc: "contrato", documentoId: null }, data: { documentoId } });
  } else if (opts?.leadId) {
    ({ documentoId } = await gerarParaLead(opts.leadId, "contrato", { id: userId }));
  } else {
    return; // sem serviços estruturados e sem lead → nada a gerar
  }
  await prisma.documento.update({ where: { id: documentoId }, data: { status: "EM_REVISAO" } });
  await prisma.activityLog.create({
    data: { userId, acao: "documento.contrato_auto", entidadeTipo: "documento", entidadeId: documentoId },
  });
  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { responsavelId: true } });
  void notificar(
    cliente?.responsavelId ?? userId,
    "documento_revisao",
    { documento: "Contrato" },
    { entidadeTipo: "documento", entidadeId: documentoId },
  ).catch(() => {});
  return { documentoId };
}

/**
 * AUTOMAÇÃO (por LEAD): atalho para os gatilhos do funil ("Negociação"/conversão). Garante a
 * conta Cliente e delega para `gerarContratoAutoParaCliente`.
 */
export async function gerarContratoAutoParaLead(leadId: string, userId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null, perdidoEm: null },
    select: { id: true, nome: true, empresa: true, email: true, telefone: true, observacoes: true, responsavelId: true, clienteId: true },
  });
  if (!lead) return;
  const clienteId = lead.clienteId ?? (await garantirClienteDoLead(lead, userId));
  return gerarContratoAutoParaCliente(clienteId, userId, { leadId });
}

const TIPO_ACAO_DOC: Record<string, TipoModelo> = {
  briefing: "BRIEFING",
  proposta: "PROPOSTA",
  contrato: "CONTRATO",
};

/**
 * Gera um documento (briefing/proposta/contrato) a partir do modelo, já preenchido
 * com os dados do lead — garantindo uma conta Cliente (PROSPECT) para ancorá-lo e
 * ligando-o ao passo do funil. Depois o usuário revisa e envia para assinatura.
 */
export async function gerarParaLead(leadId: string, tipo: string, ator: { id: string }) {
  const tipoModelo = TIPO_ACAO_DOC[tipo];
  if (!tipoModelo) throw new TRPCError({ code: "BAD_REQUEST", message: "Tipo de documento inválido." });

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: {
      id: true, nome: true, empresa: true, email: true, telefone: true, observacoes: true, responsavelId: true, clienteId: true,
      servicos: { select: { id: true, nome: true, valor: true, valorRecorrencia: true, percentual: true, categoria: true, clausulasContrato: true } },
    },
  });
  if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });

  const clienteId = await garantirClienteDoLead(lead, ator.id);

  // PROPOSTA: monta a partir dos serviços escolhidos pelo mesmo construtor da "Nova proposta"
  // (tabela + investimento reais, corpo do modelo como moldura) — nunca deixa {{servicos}} cru.
  if (tipo === "proposta") {
    const itens = lead.servicos.map((s) => ({
      servicoId: s.id,
      valor: s.valor ?? 0,
      quantidade: 1,
      recorrencia: (s.valorRecorrencia ?? "AVULSO") as "AVULSO" | "MENSAL",
      percentual: s.categoria === "Faturamento" ? s.percentual ?? null : null,
    }));
    const doc = await criarProposta({ clienteId, itens, usarIA: false }, ator.id);
    await prisma.leadPasso.updateMany({ where: { leadId, acaoDoc: "proposta", documentoId: null }, data: { documentoId: doc.id } });
    return { documentoId: doc.id };
  }

  await listModelos(); // garante os modelos padrão semeados
  const modelo = await prisma.modeloDocumento.findFirst({ where: { tipo: tipoModelo, ativo: true }, orderBy: { createdAt: "asc" } });
  if (!modelo) throw new TRPCError({ code: "NOT_FOUND", message: `Nenhum modelo de ${tipo} cadastrado.` });

  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { nome: true, email: true, documento: true, telefone: true },
  });

  // CONTRATO: pré-preenche os campos com o que já sabemos (objeto = serviços do lead; valor/
  // prazo/foro com padrões editáveis) para o rascunho não nascer cheio de "a preencher".
  const variaveis: Record<string, string> = {};
  if (tipo === "contrato") {
    // Objeto = LISTA dos serviços; as CLÁUSULAS de cada serviço vão para {{clausulas_servicos}}
    // (seção 9, personalizada pelo que o cliente contratou). Fallback quando não há serviços.
    variaveis.objeto = lead.servicos.length
      ? lead.servicos.map((s) => `- **${s.nome}**`).join("\n")
      : "Serviços de consultoria conforme a proposta comercial aprovada pela CONTRATANTE.";
    variaveis.clausulas_servicos = lead.servicos.length
      ? lead.servicos
          .map((s) => {
            const cl = s.clausulasContrato?.trim();
            return `### ${s.nome}\n\n${cl || "Serviço prestado conforme a proposta comercial e o escopo de trabalho aprovados pela CONTRATANTE."}`;
          })
          .join("\n\n")
      : "Condições conforme a proposta comercial e o escopo de trabalho aprovados pela CONTRATANTE.";
    variaveis.valor = "Conforme os valores da proposta comercial aprovada pela CONTRATANTE.";
    variaveis.prazo = textoVigencia(12);
    // Foro e qualificação da CONTRATADA de Ajustes → Dados da empresa (editáveis pela Thaís).
    const identidade = await getIdentidade();
    variaveis.foro = identidade.foro?.trim() || "da comarca do domicílio da CONTRATANTE";
    variaveis.contratada = qualificacaoContratada(identidade);
  }

  const conteudo = render(modelo.corpo, variaveis, cliente);
  const titulo = `${modelo.nome} — ${cliente?.nome ?? lead.nome}`;

  const doc = await prisma.documento.create({
    data: {
      modeloId: modelo.id,
      clienteId,
      titulo,
      conteudo,
      status: "RASCUNHO",
      criadoPorId: ator.id,
      versoes: { create: { conteudo, autorId: ator.id, origem: "MANUAL" } },
    },
  });

  // Liga o documento ao passo correspondente do lead (para o painel exibir e concluir sozinho).
  await prisma.leadPasso.updateMany({ where: { leadId, acaoDoc: tipo, documentoId: null }, data: { documentoId: doc.id } });
  await prisma.activityLog.create({
    data: { userId: ator.id, acao: `documento.${tipoModelo.toLowerCase()}_gerado`, entidadeTipo: "documento", entidadeId: doc.id },
  });

  return { documentoId: doc.id };
}

export async function updateConteudo(id: string, conteudo: string, userId: string) {
  const doc = await prisma.documento.findUnique({ where: { id } });
  if (!doc || doc.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });
  if (doc.status === "ENVIADO") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Documento já enviado não pode ser editado" });
  }
  await prisma.$transaction([
    prisma.documento.update({ where: { id }, data: { conteudo } }),
    prisma.documentoVersao.create({
      data: { documentoId: id, conteudo, autorId: userId, origem: "MANUAL" },
    }),
  ]);
  return { ok: true };
}

/** Fluxo: rascunho → em revisão → aprovado → enviado. Aprovação/envio são humanos. */
/** Etapa do funil que cada tipo de documento "empurra" ao ser enviado ao cliente. */
const ETAPA_POR_TIPO_DOC: Partial<Record<TipoModelo, string>> = {
  PROPOSTA: "proposta",
  CONTRATO: "negociacao",
};

export async function setStatus(id: string, status: StatusDocumento, userId: string) {
  const doc = await prisma.documento.findUnique({ where: { id }, include: { modelo: { select: { tipo: true } } } });
  if (!doc || doc.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });
  if (status === "ENVIADO" && doc.status !== "APROVADO") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Aprove o documento antes de enviar" });
  }

  const data: Record<string, unknown> = { status };
  if (status === "APROVADO") data.aprovadoPorId = userId;
  if (status === "ENVIADO") data.enviadoEm = new Date();
  if (status === "RASCUNHO") {
    data.aprovadoPorId = null;
    data.enviadoEm = null;
  }

  await prisma.documento.update({ where: { id }, data });
  await prisma.activityLog.create({
    data: {
      userId,
      acao: `documento.${status.toLowerCase()}`,
      entidadeTipo: "documento",
      entidadeId: id,
    },
  });
  // Automação do funil: só proposta/contrato empurram a etapa certa (proposta →
  // "proposta"; contrato → "negociação"). Outros tipos (ata, briefing) não movem o funil.
  const etapa = doc.modelo ? ETAPA_POR_TIPO_DOC[doc.modelo.tipo] : undefined;
  if (status === "ENVIADO" && doc.clienteId && etapa) {
    const motivo = doc.modelo?.tipo === "CONTRATO" ? "Contrato enviado ao cliente" : "Proposta enviada ao cliente";
    void avancarLeadPorClienteAuto(doc.clienteId, etapa, motivo).catch(() => {});
  }
  return { ok: true };
}

export async function removeDocumento(id: string) {
  await prisma.documento.update({ where: { id }, data: { deletedAt: new Date() } });
  // Desvincula o documento dos passos do funil que apontavam para ele — assim o passo
  // volta a oferecer "Gerar {tipo}" em vez de um link para um documento inexistente.
  await prisma.leadPasso.updateMany({ where: { documentoId: id }, data: { documentoId: null } });
  return { ok: true };
}

// ── IA (Fase 9) ──────────────────────────────────────────
const SYSTEM_IA =
  "Você é um assistente da consultoria MedConsultoria. Redija documentos profissionais, claros e objetivos em português do Brasil. Responda APENAS com o texto final do documento — sem comentários, sem markdown, sem cercas de código.";

function exigirIA() {
  if (!isAiEnabled) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "IA não configurada (OPENAI_API_KEY)." });
  }
}

/** Gera um documento com IA a partir de um modelo + instruções. Sempre RASCUNHO (versão origem IA). */
export async function gerarComIA(input: GerarComIAInput, userId: string) {
  exigirIA();
  const modelo = await prisma.modeloDocumento.findUnique({ where: { id: input.modeloId } });
  if (!modelo) throw new TRPCError({ code: "NOT_FOUND", message: "Modelo não encontrado" });

  const clienteId = input.clienteId?.trim() || null;
  const cliente = clienteId
    ? await prisma.cliente.findUnique({
        where: { id: clienteId },
        select: { nome: true, email: true, documento: true, telefone: true },
      })
    : null;

  const user = [
    `Tipo de documento: ${modelo.nome}.`,
    `Modelo de referência (use como base de estrutura; substitua qualquer {{campo}} por conteúdo real):`,
    modelo.corpo,
    "",
    cliente
      ? `Cliente: ${cliente.nome}${cliente.email ? ` (${cliente.email})` : ""}${cliente.documento ? ` — ${cliente.documento}` : ""}.`
      : "Cliente: não informado.",
    `Data de hoje: ${new Date().toLocaleDateString("pt-BR")}.`,
    "",
    `Instruções: ${input.instrucoes}`,
    "",
    "Gere o documento completo e pronto para revisão humana.",
  ].join("\n");

  const conteudo = await aiService.gerarRascunho(SYSTEM_IA, user);
  const titulo = input.titulo?.trim() || `${modelo.nome}${cliente ? " - " + cliente.nome : ""}`;

  const doc = await prisma.documento.create({
    data: {
      modeloId: modelo.id,
      clienteId,
      titulo,
      conteudo,
      status: "RASCUNHO",
      criadoPorId: userId,
      versoes: { create: { conteudo, autorId: userId, origem: "IA" } },
    },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "documento.ia_gerado", entidadeTipo: "documento", entidadeId: doc.id },
  });
  return doc;
}

/** Reescreve/aprimora o conteúdo de um documento com IA (nova versão origem IA). */
export async function melhorarComIA(id: string, instrucao: string, userId: string) {
  exigirIA();
  const doc = await prisma.documento.findUnique({ where: { id } });
  if (!doc || doc.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });
  if (doc.status === "ENVIADO") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Documento já enviado não pode ser editado" });
  }

  const user = [
    "Aprimore/edite o documento abaixo conforme a instrução. Mantenha o tom profissional.",
    `Instrução: ${instrucao}`,
    "",
    "Documento atual:",
    doc.conteudo,
  ].join("\n");

  const conteudo = await aiService.gerarRascunho(SYSTEM_IA, user);
  await prisma.$transaction([
    prisma.documento.update({ where: { id }, data: { conteudo } }),
    prisma.documentoVersao.create({
      data: { documentoId: id, conteudo, autorId: userId, origem: "IA" },
    }),
  ]);
  return { ok: true };
}

/** Resume anotações de reunião numa ATA estruturada (documento RASCUNHO, origem IA). */
export async function resumirReuniao(input: ResumirReuniaoInput, userId: string) {
  exigirIA();
  const clienteId = input.clienteId?.trim() || null;
  const cliente = clienteId
    ? await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } })
    : null;

  const system =
    "Você é um assistente da consultoria MedConsultoria. A partir de anotações de reunião, produza uma ATA clara e estruturada em português do Brasil, com as seções: PARTICIPANTES (se houver), PAUTA, DECISÕES e PRÓXIMOS PASSOS (com responsáveis e prazos quando mencionados). Responda APENAS com o texto da ata — sem markdown, sem comentários.";
  const user = [
    `Título da reunião: ${input.titulo?.trim() || "Reunião"}`,
    `Cliente: ${cliente?.nome ?? "não informado"}`,
    `Data: ${new Date().toLocaleDateString("pt-BR")}`,
    "",
    "Anotações da reunião:",
    input.anotacoes,
  ].join("\n");

  const conteudo = await aiService.gerarRascunho(system, user);
  const titulo = input.titulo?.trim()
    ? `Ata - ${input.titulo.trim()}`
    : `Ata de reunião${cliente ? " - " + cliente.nome : ""}`;
  // Liga ao modelo de ATA para o documento ficar categorizado (tipo) no arquivo.
  const modeloAta = await prisma.modeloDocumento.findFirst({ where: { tipo: "ATA", ativo: true }, orderBy: { createdAt: "asc" } });

  const doc = await prisma.documento.create({
    data: {
      modeloId: modeloAta?.id ?? null,
      clienteId,
      titulo,
      conteudo,
      status: "RASCUNHO",
      criadoPorId: userId,
      versoes: { create: { conteudo, autorId: userId, origem: "IA" } },
    },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "documento.ia_ata", entidadeTipo: "documento", entidadeId: doc.id },
  });
  return doc;
}

/**
 * Pauta de reunião (ANTES): a IA prepara a pauta e os pontos-chave a partir do que se quer
 * tratar + o contexto do cliente (serviços contratados e etapa no funil). Documento RASCUNHO
 * do tipo PAUTA_REUNIAO (origem IA), pronto para revisão.
 */
export async function gerarPautaReuniao(input: GerarPautaInput, userId: string) {
  exigirIA();
  const clienteId = input.clienteId?.trim() || null;
  let clienteNome: string | null = null;
  let contexto = "Cliente: não informado.";
  if (clienteId) {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } });
    if (cliente) {
      clienteNome = cliente.nome;
      const [servs, lead] = await Promise.all([
        prisma.clienteServico.findMany({
          where: { clienteId, status: "ATIVO" },
          select: { servico: { select: { nome: true } } },
        }),
        prisma.lead.findFirst({
          where: { clienteId, deletedAt: null, convertidoEmClienteId: null },
          orderBy: { createdAt: "desc" },
          select: { pipelineStage: { select: { nome: true } } },
        }),
      ]);
      contexto = [
        `Cliente: ${cliente.nome}.`,
        servs.length ? `Serviços contratados: ${servs.map((s) => s.servico.nome).join(", ")}.` : "Ainda sem serviços contratados.",
        lead ? `Etapa no funil de vendas: ${lead.pipelineStage.nome}.` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
  }

  const system =
    "Você é um assistente da consultoria MedConsultoria. Prepare uma PAUTA DE REUNIÃO clara e objetiva em português do Brasil, com as seções: OBJETIVO, TÓPICOS A TRATAR, PONTOS QUE NÃO PODEMOS ESQUECER e PRÓXIMOS PASSOS SUGERIDOS. Seja prático e específico ao contexto. Responda APENAS com o texto da pauta — sem cercas de código, sem comentários.";
  const user = [
    `Contexto:\n${contexto}`,
    `Data de hoje: ${new Date().toLocaleDateString("pt-BR")}.`,
    "",
    `O que se quer tratar / objetivo da reunião:\n${input.topicos}`,
    "",
    "Gere a pauta pronta para conduzir a reunião.",
  ].join("\n");

  const conteudo = await aiService.gerarRascunho(system, user);
  const titulo = input.titulo?.trim() || `Pauta de reunião${clienteNome ? " - " + clienteNome : ""}`;
  const modeloPauta = await prisma.modeloDocumento.findFirst({ where: { tipo: "PAUTA_REUNIAO", ativo: true }, orderBy: { createdAt: "asc" } });

  const doc = await prisma.documento.create({
    data: {
      modeloId: modeloPauta?.id ?? null,
      clienteId,
      titulo,
      conteudo,
      status: "RASCUNHO",
      criadoPorId: userId,
      versoes: { create: { conteudo, autorId: userId, origem: "IA" } },
    },
  });
  await prisma.activityLog.create({
    data: { userId, acao: "documento.ia_pauta", entidadeTipo: "documento", entidadeId: doc.id },
  });
  return doc;
}
