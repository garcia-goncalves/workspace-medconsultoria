import { prisma } from "@app/db";
import { linhasDadosPagamento } from "@app/shared";
import { emReaisOu } from "../../lib/dinheiro.js";
import { hojeBRT } from "../../lib/datas.js";

/**
 * "QUANTO EU DEVO E QUANDO VENCE?" — o que a clínica deve à MedConsultoria, visto pelo Portal.
 *
 * Era pergunta de WhatsApp: a resposta morava no Financeiro, que o cliente não vê. Aqui ele vê
 * as contas a RECEBER da Med que são DELE — em aberto (com as vencidas destacadas), as pagas dos
 * últimos meses e o PIX para pagar.
 *
 * ⚠️ **As três travas do recorte, e cada uma fecha uma porta diferente:**
 * 1. `clienteId` vem SEMPRE da sessão (`portalProcedure`), nunca do pedido — a mesma escolha de
 *    todo o Portal. Esta função nem aceita outro parâmetro de filtro.
 * 2. `tipo: RECEBER` **e** `escopo: EMPRESA` **e** `donoId: null`: a carteira PESSOAL também tem
 *    `clienteId` anulável e poderia, por engano de quem lança, apontar para uma clínica — e um
 *    lançamento pessoal da Thaís na tela de um cliente é o pior vazamento possível desta tela.
 *    Conta a PAGAR (o que a Med deve a alguém) não é assunto do cliente, mesmo com `clienteId`.
 * 3. `select` fechado: `observacoes` (anotação interna — "cliente enrolou", "negociar desconto"),
 *    categoria, série e origem **não saem daqui**. Há teste varrendo o JSON atrás de cada um.
 *
 * Por que a consulta mora no módulo do Portal e não reaproveita `contas.service`: aquele serviço
 * é a régua da EQUIPE (carteiras, permissões por papel, soft-delete de série). Pendurar nele um
 * modo "visto pelo cliente" misturaria dois públicos na mesma função — e a próxima mudança feita
 * para a equipe (um campo a mais no retorno) vazaria para o Portal sem ninguém perceber.
 */

/** Pagas mais antigas que isso saem da tela: o cliente pergunta do recente, não do histórico. */
export const MESES_DE_PAGAS_NO_PORTAL = 6;
/** Teto de linhas por lista — rede contra série descontrolada, não paginação. */
const TETO = 100;

/**
 * "Faturamento — Clínica Vida Plena" → "Faturamento". As contas geradas antes da ADR-136
 * levam o nome do cliente no fim; na tela DELE, repeti-lo em cada linha é ruído.
 */
export function descricaoParaOCliente(descricao: string, clienteNome: string | null): string {
  const d = descricao.trim();
  if (!clienteNome) return d;
  const sufixo = ` — ${clienteNome.trim()}`;
  return d.endsWith(sufixo) && d.length > sufixo.length ? d.slice(0, -sufixo.length).trim() : d;
}

/** Soma em CENTAVOS inteiros — somar reais em ponto flutuante erra o centavo na 3ª parcela. */
function somar(valores: number[]): number {
  return valores.reduce((t, v) => t + Math.round(v * 100), 0) / 100;
}

export async function pagamentosDoCliente(clienteId: string) {
  const hoje = hojeBRT();
  const desdePagas = new Date(
    Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - MESES_DE_PAGAS_NO_PORTAL, hoje.getUTCDate()),
  );
  const doCliente = { clienteId, tipo: "RECEBER" as const, escopo: "EMPRESA" as const, donoId: null, deletedAt: null };
  const campos = { id: true, descricao: true, valor: true, vencimento: true, pagoEm: true, recorrencia: true } as const;

  const [cliente, abertas, pagas, identidade] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } }),
    prisma.conta.findMany({
      where: { ...doCliente, pago: false },
      orderBy: [{ vencimento: "asc" }, { createdAt: "asc" }],
      take: TETO,
      select: campos,
    }),
    prisma.conta.findMany({
      // `pagoEm` pode faltar em conta marcada paga antes de o campo existir: aí vale o vencimento.
      where: {
        ...doCliente,
        pago: true,
        OR: [{ pagoEm: { gte: desdePagas } }, { pagoEm: null, vencimento: { gte: desdePagas } }],
      },
      orderBy: [{ pagoEm: "desc" }, { vencimento: "desc" }],
      take: TETO,
      select: campos,
    }),
    prisma.identidadeInstitucional.findUnique({
      where: { id: "default" },
      select: { bancoNome: true, bancoAgencia: true, bancoConta: true, bancoTitular: true, pixChave: true },
    }),
  ]);

  const nome = cliente?.nome ?? null;
  // Vencida = venceu ANTES de hoje (dia de Brasília). Vence hoje ainda não é atraso: o cliente
  // tem o dia inteiro para pagar, e chamá-lo de "vencido" de manhã é cobrança antes da hora.
  const emAberto = abertas.map((c) => ({
    id: c.id,
    descricao: descricaoParaOCliente(c.descricao, nome),
    valor: emReaisOu(c.valor),
    vencimento: c.vencimento,
    mensal: c.recorrencia === "MENSAL",
    vencida: c.vencimento < hoje,
  }));
  const vencidas = emAberto.filter((c) => c.vencida);
  const aVencer = emAberto.filter((c) => !c.vencida);

  return {
    emAberto,
    pagas: pagas.map((c) => ({
      id: c.id,
      descricao: descricaoParaOCliente(c.descricao, nome),
      valor: emReaisOu(c.valor),
      vencimento: c.vencimento,
      pagoEm: c.pagoEm,
    })),
    totalEmAberto: somar(emAberto.map((c) => c.valor)),
    totalVencido: somar(vencidas.map((c) => c.valor)),
    quantidadeVencidas: vencidas.length,
    // O próximo a vencer é o que ainda NÃO venceu — o vencido já tem destaque próprio, e dizer
    // "próximo vencimento: 3 meses atrás" confunde mais do que ajuda.
    proximoVencimento: aVencer[0] ?? null,
    // O mesmo bloco da proposta (ADR-127): com Ajustes em branco a lista vem vazia, e a tela não
    // desenha um "Chave PIX:" sem chave.
    dadosPagamento: identidade ? linhasDadosPagamento(identidade) : [],
  };
}
