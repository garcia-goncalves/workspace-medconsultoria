import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import {
  aplicarMolduraPersonalizada,
  ehServicoSomentePercentual,
  formatarNumeroProposta,
  fraseDoRepasse,
  MARCADOR_PERSONALIZADO,
  montarBlocoPersonalizado,
  montarDadosPagamento,
  NUMERO_PROPOSTA_INICIAL,
  percentualForaDoFaturamento,
  PRECO_PERCENTUAL_SO_NO_FATURAMENTO,
  resumoInvestimentoPersonalizado,
  type AssistentePersonalizadoInput,
  type CriarPropostaPersonalizadaInput,
  type ItemPersonalizadoResolvido,
  type ItemPropostaPersonalizada,
} from "@app/shared";
import { aiService } from "../../lib/ai.js";
import { isAiEnabled } from "../../config.js";
import { listModelos } from "./modelos.service.js";

/**
 * PROPOSTA PERSONALIZADA — o coringa (ADR-156).
 *
 * Tudo livre: serviços do catálogo e linhas avulsas, seções e cláusulas escritas à mão. Continua
 * sendo um Documento de modelo tipo PROPOSTA — por isso o aceite, o funil, a ficha e a numeração
 * da Thaís funcionam com ele sem saber que ele existe.
 *
 * Arquivo próprio, e não mais uma trilha dentro de `criarProposta`: aquela função já tem três
 * formatos (comercial, credenciamento por pessoa, credenciamento por operadora) e um quarto com
 * regras opostas (linha sem catálogo, texto livre) tornaria cada uma delas mais difícil de ler.
 */

/** Valor que entra no papel vindo de cadastro (nome de clínica nasce no formulário público). */
const escapar = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * O próximo número de proposta. A MESMA regra de `documentos.service.ts` (§5.5): o maior número
 * já emitido é o estado, e a contagem continua a da Thaís. Lê a mesma coluna, então as duas não
 * têm como divergir — e o índice único de `Documento.numero` resolve a corrida.
 */
async function proximoNumeroProposta(): Promise<number> {
  const maior = await prisma.documento.aggregate({ _max: { numero: true } });
  return Math.max(maior._max.numero ?? 0, NUMERO_PROPOSTA_INICIAL - 1) + 1;
}

/** O cliente de destino: o informado, ou o PROSPECT por trás do lead (ADR-132). */
async function clienteDoDestino(input: { clienteId?: string; leadId?: string }, userId: string): Promise<string> {
  if (input.clienteId) return input.clienteId;
  // Import dinâmico: `documentos.service` puxa o funil inteiro, e este arquivo não precisa dele
  // para mais nada.
  const { clienteDoLeadParaDocumento } = await import("./documentos.service.js");
  return (await clienteDoLeadParaDocumento(input.leadId!, userId)).clienteId;
}

type ServicoDoItem = {
  id: string;
  nome: string;
  descricao: string | null;
  condicaoPagamento: string | null;
  ehFaturamento: boolean;
};

/**
 * Resolve os itens: nome do catálogo (do BANCO, não da tela — o papel que vai ao cliente não pode
 * depender do estado de uma tela) ou a descrição avulsa. Confere a regra do percentual AQUI, na
 * emissão: deixá-la para o aceite faria a proposta ser aceita e a automação recusar depois.
 */
async function resolverItens(itens: ItemPropostaPersonalizada[]) {
  const ids = [...new Set(itens.map((i) => i.servicoId).filter((id): id is string => !!id))];
  const servicos: ServicoDoItem[] = ids.length
    ? await prisma.servico.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true, descricao: true, condicaoPagamento: true, ehFaturamento: true },
      })
    : [];
  const porId = new Map(servicos.map((s) => [s.id, s]));
  const resolvidos: ItemPersonalizadoResolvido[] = [];
  const condicoesDoRepasse: (string | null)[] = [];
  let temSoPercentual = false;
  for (const it of itens) {
    const sv = it.servicoId ? porId.get(it.servicoId) : undefined;
    if (it.servicoId && !sv) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Um dos serviços escolhidos não existe mais no catálogo. Remova-o e escolha de novo." });
    }
    if (sv && percentualForaDoFaturamento({ valor: it.valor, percentual: it.percentual }, sv.ehFaturamento)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: PRECO_PERCENTUAL_SO_NO_FATURAMENTO });
    }
    if (ehServicoSomentePercentual({ valor: it.valor, percentual: it.percentual ?? null })) {
      temSoPercentual = true;
      condicoesDoRepasse.push(sv?.condicaoPagamento ?? null);
    }
    resolvidos.push({
      // A descrição digitada vale como nome da linha também para item do catálogo: é como a
      // Thaís renomeia "Gestão Operacional" para "Gestão Operacional — unidade Mooca" sem mexer
      // no catálogo.
      nome: it.descricao?.trim() || sv?.nome || "Serviço",
      detalhe: sv?.descricao ?? null,
      valor: it.valor,
      quantidade: it.quantidade,
      recorrencia: it.recorrencia,
      percentual: it.percentual ?? null,
    });
  }
  return { resolvidos, fraseRepasse: temSoPercentual ? fraseDoRepasse(condicoesDoRepasse) : null };
}

export async function criarPropostaPersonalizada(input: CriarPropostaPersonalizadaInput, userId: string) {
  const clienteId = await clienteDoDestino(input, userId);
  const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, deletedAt: null }, select: { id: true, nome: true } });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });

  const { resolvidos, fraseRepasse } = await resolverItens(input.itens);

  // `listModelos()` semeia os modelos-padrão antes da busca — sem isto, um banco onde ninguém
  // abriu "Modelos" ainda não teria o Personalizado (o mesmo cuidado de `criarProposta`).
  await listModelos();
  const modelo = input.modeloId
    ? await prisma.modeloDocumento.findFirst({ where: { id: input.modeloId, tipo: "PROPOSTA", ativo: true, corpo: { contains: MARCADOR_PERSONALIZADO } } })
    : await prisma.modeloDocumento.findFirst({
        where: { tipo: "PROPOSTA", ativo: true, corpo: { contains: MARCADOR_PERSONALIZADO } },
        orderBy: { createdAt: "asc" },
      });
  if (!modelo) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "O modelo \"Proposta personalizada\" não está disponível. Reative-o em Documentos → Modelos.",
    });
  }

  const usaNumero = modelo.corpo.includes("{{numero}}");
  const numero = usaNumero ? await proximoNumeroProposta() : null;
  const consultora =
    (await prisma.user.findUnique({ where: { id: userId }, select: { nome: true } }))?.nome ?? "MedConsultoria";
  const dadosBancarios = await prisma.identidadeInstitucional.findUnique({
    where: { id: "default" },
    select: { bancoNome: true, bancoAgencia: true, bancoConta: true, bancoTitular: true, pixChave: true },
  });

  const bloco = montarBlocoPersonalizado({
    secoes: input.secoes,
    itens: resolvidos,
    clausulas: input.clausulas,
    validadeDias: input.validadeDias,
    observacoes: input.observacoes ?? null,
    dadosPagamento: dadosBancarios ? montarDadosPagamento(dadosBancarios) : "",
    fraseRepasse,
  });
  const montar = (n: number | null) =>
    aplicarMolduraPersonalizada(
      modelo.corpo,
      {
        numero: n ? formatarNumeroProposta(n) : "",
        data: new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        clienteNome: escapar(cliente.nome),
        consultora: escapar(consultora),
      },
      bloco,
    );

  // SÓ as linhas do catálogo vão para `Documento.itens`, no formato de sempre
  // (`documentoServicoItemSchema`). É esse campo que o aceite copia para `ClienteServico` e que o
  // contrato do funil relê com `safeParse` do array INTEIRO — uma linha avulsa sem `servicoId`
  // ali reprovaria a lista toda e o contrato sairia sem serviço nenhum. A linha avulsa existe no
  // texto do papel, que é onde ela foi combinada; ela não tem cadastro para virar serviço.
  const itensDoCatalogo = input.itens
    .filter((i) => !!i.servicoId)
    .map((i) => ({
      servicoId: i.servicoId!,
      valor: i.valor,
      quantidade: i.quantidade,
      recorrencia: i.recorrencia,
      percentual: i.percentual ?? null,
    }));

  const tituloBase = input.titulo?.trim() || modelo.nome;
  const dados = (n: number | null, conteudo: string) => ({
    modeloId: modelo.id,
    clienteId,
    // O número entra no título: é por ele que a Thaís procura ("manda de novo a 0231").
    titulo: `${tituloBase}${n ? " " + formatarNumeroProposta(n) : ""} - ${cliente.nome}`,
    conteudo,
    numero: n,
    status: "RASCUNHO" as const,
    criadoPorId: userId,
    itens: itensDoCatalogo.length ? (itensDoCatalogo as object[]) : undefined,
    versoes: { create: { conteudo, autorId: userId, origem: "MANUAL" as const } },
  });

  // Duas emissões no mesmo instante disputam o número; quem perde tenta o seguinte (mesma regra
  // de `criarProposta`). O corpo é remontado com o número novo — trocar só a coluna deixaria o
  // papel mentindo.
  let doc: Awaited<ReturnType<typeof prisma.documento.create>> | null = null;
  let numeroAtual = numero;
  for (let tentativa = 0; tentativa < 3 && !doc; tentativa++) {
    try {
      doc = await prisma.documento.create({ data: dados(numeroAtual, montar(numeroAtual)) });
    } catch (e) {
      const erro = e as { code?: string; meta?: { target?: unknown } };
      const alvo = Array.isArray(erro.meta?.target) ? erro.meta.target.join(",") : String(erro.meta?.target ?? "");
      if (!(erro.code === "P2002" && alvo.includes("numero")) || !numeroAtual) throw e;
      numeroAtual = await proximoNumeroProposta();
    }
  }
  if (!doc) throw new TRPCError({ code: "CONFLICT", message: "Não foi possível reservar o número da proposta. Tente de novo." });

  await prisma.activityLog.create({
    data: { userId, acao: "documento.proposta_personalizada_gerada", entidadeTipo: "documento", entidadeId: doc.id },
  });
  return doc;
}

// ── Assistente de IA ─────────────────────────────────────

const SYSTEM_PERSONALIZADO =
  "Você é um assistente da MedConsultoria, consultoria que cuida da gestão de clínicas e consultórios médicos. " +
  "Escreva em português do Brasil, com tom profissional, claro e acolhedor. " +
  "Responda APENAS com o texto pedido — sem comentários sobre a tarefa, sem cercas de código e sem chaves duplas.";

/** A mesma porta de `documentos.service` (ADR-135): IA desligada é estado esperado, não erro interno. */
function exigirIA() {
  if (!isAiEnabled) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "IA não configurada (GEMINI_API_KEY)." });
  }
}

/**
 * Limpa o que o modelo de linguagem devolve: cerca de código e chave dupla. Chave dupla ficaria
 * barrada pelo schema na hora de gerar, e a pessoa não saberia de onde veio.
 */
function limparSaidaDaIA(texto: string): string {
  return texto
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .replace(/\{\{|\}\}/g, "")
    .trim();
}

/** "## Título\n\ncorpo" → seções. Sem título nenhum, o texto inteiro vira uma seção só. */
export function secoesDoMarkdown(texto: string): { titulo: string; corpo: string }[] {
  if (!/^##\s+/m.test(texto)) return texto.trim() ? [{ titulo: "Sugestão", corpo: texto.trim() }] : [];
  // O que vem antes do primeiro "## " é preâmbulo da IA ("Segue a proposta:"), não seção.
  return texto
    .split(/^##\s+/m)
    .slice(/^##\s+/.test(texto) ? 0 : 1)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [primeira, ...resto] = p.split("\n");
      return { titulo: (primeira ?? "").replace(/^#+\s*/, "").trim().slice(0, 200), corpo: resto.join("\n").trim() };
    })
    .filter((s) => s.titulo && s.corpo);
}

/**
 * O assistente do Personalizado. TODA chamada passa por `aiService.gerarRascunho` — a porta única
 * onde mora a peneira de dado pessoal (ADR-141). Nenhuma ação grava nada: devolve a sugestão, e a
 * pessoa decide se ela entra no papel.
 */
export async function assistentePersonalizado(input: AssistentePersonalizadoInput) {
  exigirIA();

  if (input.acao === "sugerirSecoes") {
    let quem = "";
    if (input.clienteId || input.leadId) {
      const nome = input.clienteId
        ? (await prisma.cliente.findFirst({ where: { id: input.clienteId, deletedAt: null }, select: { nome: true } }))?.nome
        : await prisma.lead
            .findFirst({ where: { id: input.leadId, deletedAt: null }, select: { nome: true, empresa: true } })
            .then((l) => l?.empresa?.trim() || l?.nome);
      if (nome) quem = `Cliente: ${nome}.`;
    }
    const user = [
      "Monte de 3 a 6 seções para uma proposta comercial PERSONALIZADA da MedConsultoria.",
      "Cada seção começa numa linha própria com '## ' seguido do título, e depois o texto (parágrafos ou listas em Markdown).",
      "NÃO escreva seção de valores, preços nem dados bancários — o investimento é montado à parte.",
      quem,
      `O que o cliente precisa, nas palavras de quem atende: ${input.resumo}`,
    ]
      .filter(Boolean)
      .join("\n");
    const texto = limparSaidaDaIA(await aiService.gerarRascunho(SYSTEM_PERSONALIZADO, user));
    return { acao: input.acao, secoes: secoesDoMarkdown(texto) };
  }

  if (input.acao === "redigirClausula") {
    const user = [
      "Redija UMA cláusula para uma proposta comercial de consultoria em gestão de clínicas.",
      "Um parágrafo só, objetivo, sem numeração e sem título.",
      `O que a cláusula deve garantir: ${input.pedido}`,
    ].join("\n");
    return { acao: input.acao, texto: limparSaidaDaIA(await aiService.gerarRascunho(SYSTEM_PERSONALIZADO, user)) };
  }

  if (input.acao === "revisarTexto") {
    const user = [
      "Revise o texto abaixo: corrija gramática e ortografia, deixe-o mais claro e objetivo, mantenha o sentido e a formatação Markdown.",
      "Devolva só o texto revisado.",
      "",
      input.texto,
    ].join("\n");
    return { acao: input.acao, texto: limparSaidaDaIA(await aiService.gerarRascunho(SYSTEM_PERSONALIZADO, user)) };
  }

  // resumirInvestimento — a CONTA é do código; a IA só escreve a frase em volta dela. Número
  // calculado por modelo de linguagem é número que ninguém conferiu.
  const { resolvidos } = await resolverItens(input.itens);
  const r = resumoInvestimentoPersonalizado(resolvidos);
  const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fatos = [
    ...resolvidos.map(
      (i) =>
        `- ${i.nome}: ${i.quantidade} × ${reais(i.valor)} ${i.recorrencia === "MENSAL" ? "por mês" : "(uma vez)"}` +
        (i.percentual ? ` + ${i.percentual}% do faturamento mensal` : ""),
    ),
    r.avulso > 0 ? `Total à vista: ${reais(r.avulso)}` : "",
    r.mensal > 0 ? `Total mensal: ${reais(r.mensal)}` : "",
  ].filter(Boolean);
  const user = [
    "Escreva um parágrafo curto (2 a 3 frases) apresentando o investimento desta proposta ao cliente.",
    "Use EXATAMENTE os valores abaixo, sem arredondar nem calcular nada novo.",
    ...fatos,
  ].join("\n");
  return {
    acao: input.acao,
    texto: limparSaidaDaIA(await aiService.gerarRascunho(SYSTEM_PERSONALIZADO, user)),
    totais: r,
  };
}
