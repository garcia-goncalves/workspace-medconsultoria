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
import {
  ehServicoSomentePercentual,
  fraseDoRepasse,
  montarDadosPagamento,
  formatarCNPJ,
  formatarNumeroProposta,
  NUMERO_PROPOSTA_INICIAL,
  qualificacaoContratada,
  totalDaGrade,
  valorPorExtenso,
  UMA_OPERADORA_POR_PROPOSTA,
  SITUACOES_CLIENTE,
} from "@app/shared";
import { aiService } from "../../lib/ai.js";
import { avancarLeadPorClienteAuto, garantirClienteDoLead } from "../leads/leads.service.js";
import { listModelos } from "./modelos.service.js";
import { getIdentidade } from "../identidade/identidade.service.js";
import { notificar } from "../notificacoes/notificacoes.service.js";
import { isAiEnabled } from "../../config.js";
import { emReais, emReaisOu } from "../../lib/dinheiro.js";

type ClienteMin = {
  nome: string;
  email: string | null;
  cnpj: string | null;
  telefone: string | null;
} | null;

/**
 * O próximo número da proposta, continuando a contagem MANUAL da Thaís (§5.5): ela estava em
 * 224, então a primeira emitida pelo sistema é a 225. Recomeçar do 1 faria conviverem duas
 * propostas "0034" no arquivo dela.
 *
 * Não usa contador em tabela à parte de propósito: o maior número já emitido É o estado, e
 * ele não pode divergir do que está nos documentos. A corrida entre duas emissões simultâneas
 * é resolvida pelo índice único de `Documento.numero` — quem perder tenta o número seguinte.
 */
async function proximoNumeroProposta(): Promise<number> {
  const maior = await prisma.documento.aggregate({ _max: { numero: true } });
  return Math.max(maior._max.numero ?? 0, NUMERO_PROPOSTA_INICIAL - 1) + 1;
}

/**
 * Os profissionais escritos como a proposta da Thaís os escreve: "Dr. Marcos Lottenberg,
 * cardiologista, e Dra. Carina Lottenberg, ginecologista e obstetra" — vírgula entre eles e
 * "e" antes do último. Alimenta o marcador `{{profissionais}}` do modelo de credenciamento.
 */
function listarProfissionais(profissionais: { nome: string; especialidade: string | null }[]): string {
  const partes = profissionais.map((p) => (p.especialidade ? `${p.nome}, ${p.especialidade}` : p.nome));
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join("; ")} e ${partes[partes.length - 1]}`;
}

/** Substitui {{chave}} pelas variáveis + campos do cliente + data. */
function render(corpo: string, variaveis: Record<string, string>, cliente: ClienteMin): string {
  const ctx: Record<string, string> = { ...variaveis };
  if (cliente) {
    ctx["cliente.nome"] = cliente.nome;
    ctx["cliente.email"] = cliente.email ?? "";
    // Sai formatado (11.222.333/0001-81), não como foi digitado — é isto que vai impresso
    // no contrato. `cliente.documento` continua valendo como APELIDO: modelos salvos antes
    // da ADR-119 usam esse nome, e renomear em silêncio deixaria o campo vazio no papel.
    const cnpjFormatado = formatarCNPJ(cliente.cnpj);
    ctx["cliente.cnpj"] = cnpjFormatado;
    ctx["cliente.documento"] = cnpjFormatado;
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
        select: { nome: true, email: true, cnpj: true, telefone: true },
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
      // "5% do faturamento (Faturamento) — por mês" punha o nome do serviço entre parênteses no
      // meio do valor e repetia "por mês" logo depois de "do faturamento/mês". Vira rótulo.
      percentuais.push(`**${s?.nome ?? "Serviço"}:** ${fmtPct(it.percentual)} do faturamento mensal`);
    }
    const preco = partes.length ? partes.join(" + ") : "a combinar";
    const nome = s?.nome ?? "Serviço";
    // A descrição vai numa LINHA PRÓPRIA dentro da célula. Emendada ao nome com travessão, ela
    // fazia a coluna "Serviço" ocupar quatro linhas enquanto a de investimento ficava com duas
    // palavras espremidas — a tabela saía torta no papel que vai ao médico.
    const desc = s?.descricao ? `<br>${s.descricao}` : "";
    return `| **${nome}**${desc} | ${preco} |`;
  });
  const investimento: string[] = [];
  if (totalAvulso > 0) investimento.push(`- **À vista (1x):** ${brl(totalAvulso)}`);
  if (totalMensal > 0) investimento.push(`- **Mensal:** ${brl(totalMensal)}/mês`);
  for (const p of percentuais) investimento.push(`- ${p}`);
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
    ? await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, email: true, cnpj: true, telefone: true } })
    : null;

  // Prazo/condições/observações entram nos dois formatos.
  // **"Condições de pagamento" NÃO entra mais na proposta** (ADR-127): não há condição a
  // negociar — é sempre PIX, e o PIX sai no bloco `{{dadosPagamento}}`, vindo de Ajustes. O que
  // o cliente precisa saber sobre QUANDO o repasse do faturamento é pago virou frase própria,
  // montada na seção do investimento.
  const extras = [input.prazo?.trim() ? `**Prazo estimado:** ${input.prazo.trim()}` : ""].filter(Boolean);

  // Três trilhas de investimento: COMERCIAL (catálogo de serviços) × CREDENCIAMENTO POR PESSOA
  // (a grade médico × operadora, ADR-104) × CREDENCIAMENTO POR OPERADORA (o formato antigo, que
  // segue valendo para o cliente que ainda não tem médico cadastrado).
  const grade = input.grade ?? [];
  const ehGrade = grade.length > 0;
  const ehCredenciamento = ehGrade || (input.operadoras?.length ?? 0) > 0;

  // UMA OPERADORA POR PROPOSTA (ADR-126). O schema já barra, mas o servidor confere de novo:
  // quem chama a API direto não passa pela tela, e uma proposta com duas operadoras dentro não
  // pode ser aceita "pela metade".
  if (new Set(grade.map((c) => c.operadoraId)).size > 1 || (input.operadoras?.length ?? 0) > 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: UMA_OPERADORA_POR_PROPOSTA });
  }

  // O faturamento mensal informado (proposta de faturamento) e o percentual somado dos itens.
  // `0` é um número informado tão válido quanto outro, então o que separa "não informou" de
  // "informou zero" é `undefined`, não a falsidade do valor.
  const faturamentoMensal = input.faturamentoMensal ?? null;
  const percentualDaProposta = input.itens.reduce((s, i) => s + (i.percentual ?? 0), 0);
  let servicosNomes: string[] = [];
  let blocoServicos: string;
  /** Nomes das operadoras que entram no corpo — da grade, quando há grade. */
  let operadorasDoCorpo: string[] = input.operadoras ?? [];
  /** "Dr. Fulano, cardiologista, e Dra. Beltrana, ginecologista" — marcador {{profissionais}}. */
  let profissionaisDoCorpo = "";
  /** Só os nomes, para a cláusula de confidencialidade — marcador {{profissionais_nomes}}. */
  let nomesDosProfissionais = "";
  let totalCredenciamento = 0;

  if (ehGrade) {
    // CREDENCIAMENTO POR PESSOA: uma linha por cruzamento médico × operadora, com o valor da
    // célula. Os nomes vêm do BANCO, não do que a tela mandou — o documento é o papel que vai
    // ao cliente, e nome de médico nele não pode depender do estado de uma tela.
    const [profissionais, operadoras] = await Promise.all([
      prisma.profissional.findMany({
        where: { id: { in: [...new Set(grade.map((c) => c.profissionalId))] } },
        select: { id: true, nome: true, especialidade: true },
      }),
      prisma.operadora.findMany({
        where: { id: { in: [...new Set(grade.map((c) => c.operadoraId))] } },
        orderBy: [{ ordem: "asc" }, { nome: "asc" }],
        select: { id: true, nome: true },
      }),
    ]);
    const nomeProf = new Map(profissionais.map((p) => [p.id, p]));
    const nomeOp = new Map(operadoras.map((o) => [o.id, o.nome]));

    totalCredenciamento = totalDaGrade(grade);
    const linhas = grade
      .filter((c) => nomeProf.has(c.profissionalId) && nomeOp.has(c.operadoraId))
      .map((c) => {
        const p = nomeProf.get(c.profissionalId)!;
        const quem = p.especialidade ? `**${p.nome}** — ${p.especialidade}` : `**${p.nome}**`;
        return `| ${quem} | ${nomeOp.get(c.operadoraId)} | ${c.valor > 0 ? brl(c.valor) : "a combinar"} |`;
      });
    const tabela = [
      "| Profissional | Operadora | Investimento |",
      "| --- | --- | --- |",
      ...linhas,
      `| | **Total** | **${totalCredenciamento > 0 ? brl(totalCredenciamento) : "a combinar"}** |`,
    ].join("\n");

    operadorasDoCorpo = operadoras.map((o) => o.nome);
    profissionaisDoCorpo = listarProfissionais(profissionais);
    // Na cláusula de confidencialidade o papel cita só os nomes — "informações de propriedade
    // dos médicos Fulano e Beltrano" —, sem a especialidade.
    nomesDosProfissionais = listarProfissionais(profissionais.map((p) => ({ nome: p.nome, especialidade: null })));

    const bloco = [`## Investimento\n\n${tabela}`];
    if (totalCredenciamento > 0) {
      bloco.push(`Investimento total: **${brl(totalCredenciamento)}** (${valorPorExtenso(totalCredenciamento)}).`);
    }
    if (extras.length) bloco.push(extras.join("  \n"));
    if (input.observacoes?.trim()) bloco.push(input.observacoes.trim());
    blocoServicos = bloco.join("\n\n");
  } else if (ehCredenciamento) {
    // CREDENCIAMENTO POR OPERADORA (sem médico cadastrado): uma operadora, um investimento.
    const ops = input.operadoras ?? [];
    const fee = input.valorPorOperadora ?? 0;
    totalCredenciamento = fee;
    const investeTxt =
      fee > 0
        ? `**${brl(fee)}** para o credenciamento junto à operadora **${ops[0] ?? ""}**.`
        : "Investimento a combinar.";
    const bloco = [`## Investimento\n\n${investeTxt}`];
    if (extras.length) bloco.push(extras.join("  \n"));
    if (input.observacoes?.trim()) bloco.push(input.observacoes.trim());
    blocoServicos = bloco.join("\n\n");
  } else {
    // COMERCIAL: catálogo de serviços com preços (tabela + investimento total).
    const servicos = await prisma.servico.findMany({
      where: { id: { in: input.itens.map((i) => i.servicoId) } },
      select: { id: true, nome: true, descricao: true, condicaoPagamento: true },
    });
    const r = montarServicos(input.itens, servicos);
    servicosNomes = r.nomes;

    const bloco = [
      `## Serviços propostos\n\n${r.tabela}`,
      `## Investimento\n\n${r.investimento}`,
    ];
    // A FRASE DO REPASSE (ADR-127). Sempre que a proposta inclui um serviço cobrado **só por
    // percentual** — o Faturamento de contas médicas —, o papel precisa dizer QUANDO o repasse é
    // pago. Vale também na proposta misturada: quem contrata Faturamento + Gestão lê a frase do
    // mesmo jeito.
    //
    // Quem decide o que é "só percentual" é o PREÇO DO ITEM desta proposta, nunca a categoria do
    // catálogo — é a quarta vez que essa comparação precisa sair daqui (ADR-125/126/127). O item
    // manda, e não o catálogo, porque a porcentagem se negocia proposta a proposta.
    //
    // O que NÃO sai mais: a conta impressa "R$ 6.000,00/mês (5% de R$ 120.000,00)". Era uma
    // promessa que envelhece no mês seguinte — o faturamento da clínica sobe e desce, o papel
    // assinado não. O documento passa a dizer o percentual sobre o efetivamente faturado e
    // recebido; o faturamento médio informado continua vivo, mas só do lado de dentro,
    // alimentando o valor do negócio no funil (ADR-125).
    const condicaoDoServico = new Map(servicos.map((sv) => [sv.id, sv.condicaoPagamento]));
    const itensSoPercentual = input.itens.filter((i) => ehServicoSomentePercentual({ valor: i.valor, percentual: i.percentual ?? null }));
    if (itensSoPercentual.length) {
      bloco.push(fraseDoRepasse(itensSoPercentual.map((i) => condicaoDoServico.get(i.servicoId))));
    }
    if (extras.length) bloco.push(extras.join("  \n"));
    if (input.observacoes?.trim()) bloco.push(input.observacoes.trim());
    blocoServicos = bloco.join("\n\n");
  }

  // CONVÊNIOS ATENDIDOS (ADR-126) — a lista que o cliente confere na proposta de faturamento.
  // Os nomes vêm do BANCO, pelos ids: nome copiado da tela não sobrevive a um "renomear" no
  // catálogo, e este documento é o papel que vai ao cliente.
  const conveniosIds = [...new Set(input.conveniosIds ?? [])];
  const conveniosDoCorpo = conveniosIds.length
    ? await prisma.operadora.findMany({
        where: { id: { in: conveniosIds } },
        orderBy: [{ ordem: "asc" }, { nome: "asc" }],
        select: { id: true, nome: true },
      })
    : [];
  const conveniosBloco = conveniosDoCorpo.length
    ? conveniosDoCorpo.map((o) => `- **${o.nome}**`).join("\n")
    : "_(a definir com você)_";

  // Os convênios entram no ITEM do serviço percentual, e não soltos no documento (ADR-126): é
  // assim que eles atravessam o aceite e chegam ao `ClienteServico` pelo mesmo caminho que
  // serviço e preço já percorrem. Uma segunda costura ficaria para trás no primeiro caso de borda.
  const idsValidados = conveniosDoCorpo.map((o) => o.id);
  const itensParaGravar = input.itens.map((i) =>
    idsValidados.length && (i.percentual ?? 0) > 0 ? { ...i, conveniosIds: idsValidados } : i,
  );

  // Operadoras selecionadas → {{operadoras}} (só o modelo de credenciamento tem esse marcador).
  const operadorasBloco = operadorasDoCorpo.length
    ? operadorasDoCorpo.map((o) => `- **${o}**`).join("\n")
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

  // NUMERAÇÃO (§5.5): só a proposta que declara {{numero}} entra na sequência da Thaís — o
  // resto dos documentos continua sem número, como sempre foi.
  const usaNumero = modelo?.corpo?.includes("{{numero}}") ?? false;
  const numero = usaNumero ? await proximoNumeroProposta() : null;

  // A consultora responsável é quem está emitindo a proposta. O nome sai do cadastro, não de
  // uma constante: a Thaís não é a única pessoa da casa que emite proposta.
  const consultora =
    (await prisma.user.findUnique({ where: { id: userId }, select: { nome: true } }))?.nome ?? "MedConsultoria";

  // DADOS PARA PAGAMENTO (ADR-127). Saem em toda proposta cujo modelo declare o marcador — a
  // comercial padrão e a de faturamento. A de CREDENCIAMENTO **não** o declara, de propósito:
  // ali a Thaís só cobra depois do sucesso do credenciamento na operadora, e a conta a receber
  // nasce na aprovação, não no aceite (ADR-104).
  //
  // Sem nada cadastrado em Ajustes, `montarDadosPagamento` devolve "" e o TÍTULO some junto —
  // uma seção "Dados para pagamento" vazia no papel do cliente é pior que seção nenhuma.
  const dadosBancarios = await prisma.identidadeInstitucional.findUnique({
    where: { id: "default" },
    select: { bancoNome: true, bancoAgencia: true, bancoConta: true, bancoTitular: true, pixChave: true },
  });
  const tabelaPagamento = dadosBancarios ? montarDadosPagamento(dadosBancarios) : "";
  const dadosPagamentoBloco = tabelaPagamento ? `## Dados para pagamento

${tabelaPagamento}` : "";

  let conteudo: string;
  if (modelo?.corpo?.includes("{{servicos}}")) {
    const comMarcadores = modelo.corpo
      .replace(/\{\{\s*servicos\s*\}\}/g, blocoServicos)
      .replace(/\{\{\s*operadoras\s*\}\}/g, operadorasBloco)
      .replace(/\{\{\s*convenios\s*\}\}/g, conveniosBloco)
      .replace(
        /\{\{\s*percentual\s*\}\}/g,
        percentualDaProposta > 0 ? fmtPct(percentualDaProposta) : "_(a combinar)_",
      )
      .replace(/\{\{\s*profissionais\s*\}\}/g, profissionaisDoCorpo || "_(a definir com você)_")
      .replace(/\{\{\s*profissionais_nomes\s*\}\}/g, nomesDosProfissionais || "_(a definir com você)_")
      .replace(/\{\{\s*numero\s*\}\}/g, numero ? formatarNumeroProposta(numero) : "—")
      .replace(/\{\{\s*consultora\s*\}\}/g, consultora)
      .replace(/\{\{\s*valor\s*\}\}/g, totalCredenciamento > 0 ? brl(totalCredenciamento) : "_(a combinar)_")
      .replace(
        /\{\{\s*valor_extenso\s*\}\}/g,
        totalCredenciamento > 0 ? valorPorExtenso(totalCredenciamento) : "_(a combinar)_",
      )
      .replace(/\{\{\s*dadosPagamento\s*\}\}/g, dadosPagamentoBloco)
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

  // O número entra no TÍTULO, e não só no corpo: é por ele que a Thaís procura a proposta na
  // lista ("manda de novo a 0225"), e a busca da página de Documentos olha o título. Fica dentro
  // da função porque a retentativa abaixo pode trocar o número — e aí o título muda junto.
  const dadosDoDocumento = (n: number | null, corpo: string) => ({
    modeloId: modelo?.id ?? null,
    clienteId,
    titulo:
      input.titulo?.trim() ||
      `${modelo?.nome ?? "Proposta"}${n ? " " + formatarNumeroProposta(n) : ""}${cliente ? " - " + cliente.nome : ""}`,
    conteudo: corpo,
    numero: n,
    status: "RASCUNHO" as const,
    criadoPorId: userId,
    // Itens estruturados (só na proposta comercial) — o aceite os sincroniza com os serviços
    // contratados do cliente. Credenciamento (operadoras) não mapeia para o catálogo.
    itens: ehCredenciamento ? undefined : (itensParaGravar as object[]),
    versoes: { create: { conteudo: corpo, autorId: userId, origem: input.usarIA ? ("IA" as const) : ("MANUAL" as const) } },
  });

  // Duas propostas emitidas no mesmo instante disputam o mesmo número. O índice único derruba
  // a segunda (P2002); em vez de mostrar erro de banco a quem só clicou em "Gerar", tenta o
  // número seguinte. Três tentativas cobrem qualquer concorrência real desta casa.
  let doc: Awaited<ReturnType<typeof prisma.documento.create>> | null = null;
  let numeroAtual = numero;
  for (let tentativa = 0; tentativa < 3 && !doc; tentativa++) {
    try {
      doc = await prisma.documento.create({ data: dadosDoDocumento(numeroAtual, conteudo) });
    } catch (e) {
      // Só o choque de NÚMERO justifica retentar. Qualquer outra violação de unicidade é
      // outro problema, e engoli-la aqui trocaria um erro claro por um comportamento estranho.
      const erro = e as { code?: string; meta?: { target?: unknown } };
      const alvo = Array.isArray(erro.meta?.target) ? erro.meta.target.join(",") : String(erro.meta?.target ?? "");
      const numeroDuplicado = erro.code === "P2002" && alvo.includes("numero");
      if (!numeroDuplicado || !numeroAtual) throw e;
      // O corpo já traz o número escrito: trocar só a coluna deixaria o papel mentindo.
      const anterior = formatarNumeroProposta(numeroAtual);
      numeroAtual = await proximoNumeroProposta();
      conteudo = conteudo.replace(anterior, formatarNumeroProposta(numeroAtual));
    }
  }
  if (!doc) throw new TRPCError({ code: "CONFLICT", message: "Não foi possível reservar o número da proposta. Tente de novo." });
  // A grade vira LINHAS de acompanhamento, presas a esta proposta. É o que transforma o preço
  // combinado no papel em processo que a Thaís consegue seguir — e, na aprovação, em cobrança.
  // Import dinâmico para não fechar ciclo de módulos com o serviço de credenciamento.
  if (ehGrade && clienteId) {
    const { salvarGrade } = await import("../servicos/credenciamento-grade.service.js");
    // ⚠️ `somenteOperadorasDaGrade`: a proposta é de UMA operadora (ADR-126). Sem esta marca,
    // emitir a 2ª proposta apagaria os cruzamentos `A_PROTOCOLAR` da 1ª — eles simplesmente não
    // vêm nesta carga, e a grade os leria como "desmarcados".
    await salvarGrade(
      { clienteId, celulas: grade, documentoId: doc.id, somenteOperadorasDaGrade: true },
      { id: userId },
    );
  }

  // O NÚMERO ANDA PARA FRENTE (ADR-126): corrigir o faturamento mensal aqui corrige o LEAD.
  //
  // O lead existe antes da proposta, e o passo obrigatório da Qualificação pergunta esse mesmo
  // número. Sem a escrita de volta, quem descobrisse o valor certo montando a proposta teria de
  // ir digitar de novo no funil — e, esquecendo, o card mostraria um valor velho ao lado de um
  // documento com o valor novo. Um número só, num lugar só.
  //
  // `reconciliarPassosAuto` recalcula o `valorEstimado` derivado e tica o passo — é a mesma
  // função que a edição do lead chama, para as duas portas não divergirem.
  if (clienteId && faturamentoMensal !== null) {
    await escreverFaturamentoNoLead(clienteId, faturamentoMensal).catch(() => {});
  }

  await prisma.activityLog.create({
    data: { userId, acao: "documento.proposta_gerada", entidadeTipo: "documento", entidadeId: doc.id },
  });
  return doc;
}

/**
 * Leva o faturamento mensal informado na proposta de volta ao lead em negociação do cliente.
 *
 * Best-effort de propósito: a proposta já foi emitida e existe: derrubá-la porque o funil não
 * aceitou um número seria trocar um documento pronto por um erro. Só mexe no lead AINDA em
 * negociação (não convertido, não excluído) — lead fechado é histórico.
 */
async function escreverFaturamentoNoLead(clienteId: string, faturamentoMensal: number) {
  const lead = await prisma.lead.findFirst({
    where: { clienteId, deletedAt: null, convertidoEmClienteId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, faturamentoMensalEstimado: true },
  });
  if (!lead) return;
  if (emReais(lead.faturamentoMensalEstimado) === faturamentoMensal) return;
  await prisma.lead.update({ where: { id: lead.id }, data: { faturamentoMensalEstimado: faturamentoMensal } });
  const { reconciliarPassosAuto } = await import("../leads/leads.service.js");
  await reconciliarPassosAuto(lead.id);
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
        valor: emReaisOu(c.valor),
        quantidade: 1,
        recorrencia: (c.valorRecorrencia ?? "AVULSO") as "AVULSO" | "MENSAL",
        percentual: emReais(c.percentual),
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
        valor: emReaisOu(s.valor),
        quantidade: 1,
        recorrencia: (s.valorRecorrencia ?? "AVULSO") as "AVULSO" | "MENSAL",
        percentual: emReais(s.percentual),
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
    select: { nome: true, cnpj: true, email: true, telefone: true },
  });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });

  const { itens, origem } = await itensDoCliente(input.clienteId);

  // Totais agregados (para sugerir valor/mensalidade e o resumo de investimento).
  //
  // ⚠️ **O PERCENTUAL PRECISA ENTRAR AQUI, SENÃO O RESUMO MENTE R$ 0,00 (F9).** Esta soma olhava
  // só o valor FIXO, e o cliente de Faturamento não tem valor fixo nenhum: ele paga um percentual
  // do que fatura (ADR-125/127). Para o serviço que é o carro-chefe da Med, o "Novo documento"
  // abria dizendo **R$ 0,00** de investimento. O corpo do documento sempre esteve certo
  // (`montarServicos` já escreve a linha do percentual) — quem mentia era o resumo que a Thaís lê
  // antes de gerar, e é ele que decide se ela confere ou aprova no automático.
  //
  // O percentual **não vira reais aqui**: ele depende do faturamento do mês, que o documento não
  // conhece. Vai em campo próprio, para quem desenha dizer "5% do faturamento/mês".
  let totalAvulso = 0;
  let totalMensal = 0;
  let percentualMensal = 0;
  for (const it of itens) {
    const sub = (it.valor ?? 0) * (it.quantidade ?? 1);
    if (it.recorrencia === "MENSAL") totalMensal += sub;
    else totalAvulso += sub;
    if (it.percentual != null && it.percentual > 0) percentualMensal += it.percentual;
  }
  const nomes = itens.map((i) => i.nome);

  // O investimento em uma linha, pronto para a tela mostrar em vez de um número solto que não
  // sabe dizer "por mês" nem "do faturamento".
  const partesDoInvestimento: string[] = [];
  if (totalMensal > 0) partesDoInvestimento.push(`${brl(totalMensal)}/mês`);
  if (totalAvulso > 0) partesDoInvestimento.push(`${brl(totalAvulso)} à vista`);
  if (percentualMensal > 0) partesDoInvestimento.push(`${fmtPct(percentualMensal)} do faturamento/mês`);
  const investimentoEmTexto = partesDoInvestimento.join(" + ") || "A combinar";

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
    // "valor"/"mensalidade": prioriza o mensal; senão o à vista. Continua sendo só o valor FIXO —
    // percentual não cabe num campo de reais, e preencher 0 faria alguém aceitar um recibo de
    // R$ 0,00 sem reparar. Quem paga só percentual não tem número aqui, e é o certo.
    valor: totalMensal > 0 ? totalMensal : totalAvulso,
    // O investimento por extenso, que diz o que o número sozinho não consegue.
    investimento: investimentoEmTexto,
  };

  // O que o funil já sabe deste cliente (ADR-126): o faturamento mensal estimado e os convênios
  // já registrados. A proposta de faturamento NASCE preenchida com eles — quem já respondeu na
  // Qualificação não responde de novo, e a correção feita aqui volta para o lead.
  const [leadEmNegociacao, contratacoes] = await Promise.all([
    prisma.lead.findFirst({
      where: { clienteId: input.clienteId, deletedAt: null, convertidoEmClienteId: null },
      orderBy: { createdAt: "desc" },
      select: { faturamentoMensalEstimado: true },
    }),
    prisma.clienteServico.findMany({
      where: { clienteId: input.clienteId, status: "ATIVO" },
      select: { operadoras: { select: { id: true } } },
    }),
  ]);
  const conveniosAtuais = [...new Set(contratacoes.flatMap((c) => c.operadoras.map((o) => o.id)))];

  return {
    cliente,
    itens,
    origem, // CONTRATADO | LEAD | VAZIO — o dialog explica de onde veio
    faturamentoMensal: emReais(leadEmNegociacao?.faturamentoMensalEstimado ?? null),
    conveniosAtuais,
    investimento: { avulso: totalAvulso, mensal: totalMensal, percentualMensal },
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
    select: { nome: true, email: true, cnpj: true, telefone: true },
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
      cnpj: true,
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
    valor: emReaisOu(s.valor),
    quantidade: 1,
    recorrencia: (s.valorRecorrencia ?? "AVULSO") as "AVULSO" | "MENSAL",
    percentual: emReais(s.percentual),
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
    select: { id: true, nome: true, empresa: true, cnpj: true, email: true, telefone: true, observacoes: true, responsavelId: true, clienteId: true },
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
      id: true, nome: true, empresa: true, cnpj: true, email: true, telefone: true, observacoes: true, responsavelId: true, clienteId: true,
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
      valor: emReaisOu(s.valor),
      quantidade: 1,
      recorrencia: (s.valorRecorrencia ?? "AVULSO") as "AVULSO" | "MENSAL",
      percentual: emReais(s.percentual),
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
    select: { nome: true, email: true, cnpj: true, telefone: true },
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
        select: { nome: true, email: true, cnpj: true, telefone: true },
      })
    : null;

  const user = [
    `Tipo de documento: ${modelo.nome}.`,
    `Modelo de referência (use como base de estrutura; substitua qualquer {{campo}} por conteúdo real):`,
    modelo.corpo,
    "",
    cliente
      ? `Cliente: ${cliente.nome}${cliente.email ? ` (${cliente.email})` : ""}${cliente.cnpj ? ` — CNPJ ${formatarCNPJ(cliente.cnpj)}` : ""}.`
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

// ── Destinatário do documento: cliente OU lead (27/08/2026, ordem do dono) ──

/**
 * Quem pode receber um documento: os clientes de verdade **e** os leads ainda em negociação.
 *
 * Até 27/08/2026 o "Novo documento" só oferecia clientes (`clientes.list`, que exclui
 * prospect de propósito — lead vive no Funil, ADR-24). Só que a proposta é justamente o
 * documento que se manda para quem AINDA NÃO É cliente: a saída era converter o lead antes
 * da hora, sujando a base com quem talvez nunca feche.
 *
 * Devolve as duas listas separadas para a tela agrupá-las — misturar num balaio só faria
 * "Clínica X" aparecer duas vezes sem dizer qual é qual.
 */
export async function destinatariosDeDocumento() {
  const [clientes, leads] = await Promise.all([
    prisma.cliente.findMany({
      where: { deletedAt: null, situacaoComercial: { in: [...SITUACOES_CLIENTE] } },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
    prisma.lead.findMany({
      // Lead ativo = não removido, não convertido e não perdido. Lead convertido já tem
      // cliente próprio na lista de cima; oferecê-lo duas vezes seria a mesma armadilha
      // que a ADR-128 pagou com as duas contas de Portal.
      where: { deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
      orderBy: [{ empresa: "asc" }, { nome: "asc" }],
      select: {
        id: true,
        nome: true,
        empresa: true,
        pipelineStage: { select: { nome: true } },
      },
    }),
  ]);

  return {
    clientes,
    leads: leads.map((l) => {
      const empresa = l.empresa?.trim();
      return {
        id: l.id,
        // DUAS coisas diferentes, de propósito:
        // `rotulo` é para ESCOLHER na lista — traz o nome de quem fala entre parênteses,
        //   porque duas clínicas podem ter nome parecido e é a pessoa que desempata.
        // `nomeNoDocumento` é o que sai IMPRESSO — só a clínica. Um papel que abre com
        //   "Prezado(a) MedLar Home Care (Carlos Mendes)" não se manda para ninguém.
        rotulo: empresa ? `${empresa} (${l.nome})` : l.nome,
        nomeNoDocumento: empresa || l.nome,
        etapa: l.pipelineStage?.nome ?? null,
      };
    }),
  };
}

/**
 * Traduz um lead no cliente que o representa, criando-o se ainda não existir.
 *
 * O truque que evita migração: **todo lead já pode ter um `Cliente` PROSPECT por trás** —
 * é o mesmo que dá acesso ao Portal do prospect (`garantirClienteDoLead`, ADR-128). Então o
 * documento continua apontando para `clienteId`, como sempre; quem muda é só quem a tela
 * deixa escolher. Zero coluna nova, zero caminho paralelo de gravação.
 *
 * Idempotente: chamar duas vezes devolve o mesmo cliente.
 */
export async function clienteDoLeadParaDocumento(leadId: string, atorId?: string | null) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: {
      id: true, nome: true, empresa: true, cnpj: true, email: true,
      telefone: true, observacoes: true, responsavelId: true, clienteId: true,
    },
  });
  if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
  const clienteId = await garantirClienteDoLead(lead, atorId ?? null);
  return { clienteId };
}
