import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import {
  basesPorMes,
  calcularHonorarioCentavos,
  contratacaoValeNoMes,
  mesEncerrado,
  rotuloDoMes,
  situacaoDoHonorario,
  vencimentoPadrao,
  type SituacaoDoHonorario,
} from "@app/shared";
import { hojeBRT } from "../../lib/datas.js";
import { emReais, emReaisOu } from "../../lib/dinheiro.js";
import { garantirCategoriaHonorarios } from "../servicos/credenciamento.service.js";

/**
 * O HONORÁRIO DO FATURAMENTO — a ponte entre a Conciliação e o Financeiro (Onda 2).
 *
 * O Faturamento é cobrado só por percentual do que a clínica RECEBE (decisão do dono), e até aqui
 * nenhuma conta a receber nascia para ele: conversão, aceite e ficha pulam o percentual de
 * propósito, porque não há número a lançar antes de o dinheiro entrar. A Thaís lançava à mão, todo
 * mês, sem lembrete. A Conciliação já sabia quanto cada clínica recebeu — o repasse importado —, e
 * os dois módulos não se falavam. Este serviço é a conversa.
 *
 * ⚠️ **O VALOR DE HOJE É SEMPRE RECALCULADO.** O que se grava ao lançar é um RETRATO
 * (`HonorarioFaturamento`), como no fechamento de competência: ele serve para dizer "lançado sobre
 * R$ X; hoje o repasse do mês soma R$ Y", nunca como valor corrente.
 *
 * ⚠️ **A BASE É SÓ O REPASSE IMPORTADO**, não o recebido digitado à mão numa cirurgia. O manual é
 * uma correção pontual da conciliação por cirurgia, e ela já é descontada do repasse antes de
 * repartir (ADR-155) — somá-lo aqui contaria o mesmo dinheiro duas vezes. O repasse é o documento
 * do crédito; é sobre ele que o contrato manda cobrar.
 *
 * Nenhuma função daqui devolve dado de paciente: só somas por mês.
 */

/** O serviço marcado como "o faturamento" (ADR-145 — a marca, nunca o nome). */
async function servicoDeFaturamento() {
  return prisma.servico.findFirst({ where: { ehFaturamento: true }, select: { id: true, nome: true } });
}

export interface MesDoHonorario {
  /** Mês do crédito, `AAAA-MM`. */
  mes: string;
  rotulo: string;
  /** Soma do repasse com crédito no mês, em reais. */
  baseRecebida: number;
  linhasDeRepasse: number;
  /** Percentual que vale HOJE para o mês (o da contratação); `null` se não há. */
  percentual: number | null;
  /** Honorário de hoje, em reais; `null` quando não há percentual aplicável. */
  honorario: number | null;
  situacao: SituacaoDoHonorario;
  divergiu: boolean;
  vencimentoSugerido: string;
  /** O que foi lançado — o RETRATO, com a conta. `contaExcluida` = a conta sumiu do Financeiro. */
  lancamento: {
    base: number;
    percentual: number;
    valor: number;
    lancadoEm: Date;
    lancadoPor: string | null;
    atualizadoEm: Date | null;
    contaExcluida: boolean;
    contaPaga: boolean;
    contaVencimento: Date | null;
  } | null;
}

export interface HonorarioDoCliente {
  servico: { id: string; nome: string } | null;
  contratacao: { status: string; percentual: number | null; contratadoEm: Date; canceladoEm: Date | null } | null;
  /** Por que a tela não tem o que mostrar — `null` quando há. */
  motivo: string | null;
  meses: MesDoHonorario[];
  /** Repasse sem data de pagamento: não entra em mês nenhum, e a tela avisa. */
  repasseSemData: { linhas: number; total: number };
  /** Soma do honorário dos meses "a lançar" — a coluna da visão geral e o número do lembrete. */
  aLancarTotal: number;
}

const reais = (centavos: number) => centavos / 100;

/**
 * Os meses com repasse (e os já lançados) de um cliente, cada um com o honorário de hoje e a
 * situação. `hoje` é parâmetro para o teste poder fixar o relógio.
 */
export async function honorariosDoCliente(clienteId: string, hoje: Date = hojeBRT()): Promise<HonorarioDoCliente> {
  const servico = await servicoDeFaturamento();
  const [contratacaoRaw, repasses, retratos] = await Promise.all([
    servico
      ? prisma.clienteServico.findUnique({
          where: { clienteId_servicoId: { clienteId, servicoId: servico.id } },
          select: { status: true, percentual: true, contratadoEm: true, canceladoEm: true },
        })
      : null,
    prisma.repasseLinha.findMany({ where: { clienteId }, select: { valor: true, dataPagamento: true } }),
    prisma.honorarioFaturamento.findMany({
      where: { clienteId },
      select: {
        mes: true,
        base: true,
        percentual: true,
        valor: true,
        lancadoEm: true,
        atualizadoEm: true,
        lancadoPor: { select: { nome: true } },
        conta: { select: { pago: true, deletedAt: true, vencimento: true } },
      },
    }),
  ]);

  const contratacao = contratacaoRaw ? { ...contratacaoRaw, percentual: emReais(contratacaoRaw.percentual) } : null;
  const { meses: bases, semData } = basesPorMes(repasses.map((r) => ({ valor: r.valor.toNumber(), dataPagamento: r.dataPagamento })));
  const porMes = new Map(retratos.map((r) => [r.mes, r]));

  // Todo mês com repasse, e todo mês já lançado — mesmo que o repasse tenha sido trocado depois e
  // o mês tenha ficado sem linha: o lançamento existe, e sumir com ele seria esconder uma cobrança.
  const todos = [...new Set([...bases.keys(), ...porMes.keys()])].sort().reverse();

  const meses: MesDoHonorario[] = todos.map((mes) => {
    const b = bases.get(mes) ?? { baseCentavos: 0, linhas: 0 };
    const vale = !!contratacao && contratacaoValeNoMes(contratacao, mes);
    const pct = contratacao?.percentual ?? null;
    const percentual = vale && pct !== null && pct > 0 ? pct : null;
    const honorarioCentavos = percentual !== null ? calcularHonorarioCentavos(b.baseCentavos, percentual) : null;
    const r = porMes.get(mes);
    // Conta apagada de verdade (`SetNull`) e conta excluída no Financeiro (soft-delete) são a MESMA
    // coisa para quem olha: a cobrança não existe mais.
    const contaViva = r?.conta && !r.conta.deletedAt ? r.conta : null;
    const { situacao, divergiu } = situacaoDoHonorario({
      honorarioCentavos,
      encerrado: mesEncerrado(mes, hoje),
      valeNoMes: vale,
      percentualDefinido: percentual !== null,
      lancamento: r && contaViva ? { valorCentavos: Math.round(emReaisOu(r.valor) * 100), pago: contaViva.pago } : null,
    });
    return {
      mes,
      rotulo: rotuloDoMes(mes),
      baseRecebida: reais(b.baseCentavos),
      linhasDeRepasse: b.linhas,
      percentual,
      honorario: honorarioCentavos === null ? null : reais(honorarioCentavos),
      situacao,
      divergiu,
      vencimentoSugerido: vencimentoPadrao(mes),
      lancamento: r
        ? {
            base: emReaisOu(r.base),
            percentual: emReaisOu(r.percentual),
            valor: emReaisOu(r.valor),
            lancadoEm: r.lancadoEm,
            lancadoPor: r.lancadoPor?.nome ?? null,
            atualizadoEm: r.atualizadoEm,
            contaExcluida: !contaViva,
            contaPaga: !!contaViva?.pago,
            contaVencimento: contaViva?.vencimento ?? null,
          }
        : null,
    };
  });

  const motivo = !servico
    ? "Nenhum serviço está marcado como o de faturamento em Ajustes → Serviços."
    : !contratacao
      ? `Este cliente não tem o serviço "${servico.nome}" contratado.`
      : todos.length === 0
        ? "Nenhum relatório de repasse importado ainda. Importe o repasse na aba Cirurgias para calcular o honorário."
        : null;

  return {
    servico,
    contratacao,
    motivo,
    meses,
    repasseSemData: { linhas: semData.linhas, total: reais(semData.totalCentavos) },
    aLancarTotal: reais(meses.filter((m) => m.situacao === "A_LANCAR").reduce((s, m) => s + Math.round((m.honorario ?? 0) * 100), 0)),
  };
}

/** Lê o mês de novo, do banco — nunca o que a tela mandou. */
async function mesAtual(clienteId: string, mes: string) {
  const h = await honorariosDoCliente(clienteId);
  const m = h.meses.find((x) => x.mes === mes);
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: `Não há repasse nem lançamento em ${rotuloDoMes(mes)} para este cliente.` });
  return { h, m };
}

/**
 * ⚠️ O que a pessoa CONFERIU na tela tem de ser o que vai para o Financeiro. Entre abrir a tela e
 * clicar, um repasse novo pode ter sido importado (por outra pessoa, noutra aba); lançar o valor
 * novo sem mostrá-lo seria lançar um número que ninguém viu.
 */
function exigirValorConferido(atual: number | null, conferido: number) {
  if (atual === null || Math.round(atual * 100) !== Math.round(conferido * 100)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "O repasse deste mês mudou desde que a tela foi aberta. Confira o novo valor e tente de novo.",
    });
  }
}

const ehUnico = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";

const jaLancadoErro = (mes: string) =>
  new TRPCError({
    code: "CONFLICT",
    message: `O honorário de ${rotuloDoMes(mes)} já foi lançado — confira no Financeiro. Nada foi criado de novo.`,
  });

const POR_QUE_NAO_LANCA: Partial<Record<SituacaoDoHonorario, string>> = {
  LANCADO: "já foi lançado",
  DIVERGENTE: "já foi lançado (use “Atualizar valor”)",
  PAGO: "já foi lançado e pago",
  MES_EM_CURSO: "é do mês em curso — ainda pode chegar repasse",
  SEM_PERCENTUAL: "não tem percentual definido na contratação",
  FORA_DO_CONTRATO: "é de um mês em que o serviço não estava contratado",
  NADA_A_COBRAR: "não tem repasse positivo — nada a cobrar",
};

/**
 * Lança o honorário de um mês: cria a conta a receber E o retrato, na mesma transação.
 *
 * ⚠️ **A trava contra lançar duas vezes é o índice único (clienteId, mes)**, não a conferência de
 * situação: duas abas clicando juntas passam as duas por ela. Quem perde a corrida leva `P2002`
 * dentro da transação, e a transação desfaz a conta que ele criou — nenhuma conta órfã chega ao
 * Financeiro. Mês RELANÇADO (a conta anterior foi excluída) troca o elo por um `updateMany` que
 * exige o elo antigo no `WHERE`: das duas gravações simultâneas, só uma o encontra.
 *
 * ⚠️ A conta é AVULSA (`recorrencia: NENHUMA`) de propósito: é um mês de honorário, com valor
 * próprio. Isso também a deixa de fora do encerramento de cobrança ao cancelar o serviço
 * (`planejarEncerramentoDaCobranca` pula avulsa) — o honorário de um mês já recebido continua
 * devido mesmo que o contrato acabe.
 */
export async function lancarHonorario(e: {
  clienteId: string;
  mes: string;
  vencimento: string;
  valorConferido: number;
  observacao?: string | null;
  usuarioId: string;
}) {
  const { h, m } = await mesAtual(e.clienteId, e.mes);
  if (m.situacao !== "A_LANCAR") {
    const jaLancado = m.situacao === "LANCADO" || m.situacao === "DIVERGENTE" || m.situacao === "PAGO";
    throw new TRPCError({
      code: jaLancado ? "CONFLICT" : "PRECONDITION_FAILED",
      message: `O honorário de ${m.rotulo} ${POR_QUE_NAO_LANCA[m.situacao] ?? "não pode ser lançado agora"}.`,
    });
  }
  exigirValorConferido(m.honorario, e.valorConferido);
  const servicoId = h.servico!.id;
  const valor = m.honorario!;
  const percentual = m.percentual!;

  const [cliente, categoriaId, anterior] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: e.clienteId }, select: { nome: true } }),
    garantirCategoriaHonorarios(),
    // Só existe quando a conta de um lançamento anterior foi excluída (senão a situação não seria
    // "a lançar") — é o caso do RELANÇAMENTO.
    prisma.honorarioFaturamento.findUnique({
      where: { clienteId_mes: { clienteId: e.clienteId, mes: e.mes } },
      select: { id: true, contaId: true },
    }),
  ]);
  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const obs = e.observacao?.trim() || null;
  const observacoes =
    `Honorário do faturamento: ${String(percentual).replace(".", ",")}% sobre ${brl(m.baseRecebida)} recebidos dos ` +
    `convênios com crédito em ${m.rotulo} (relatório de repasse importado na Conciliação). ` +
    `Cliente: ${cliente?.nome ?? "—"}.${obs ? ` ${obs}` : ""}`;
  const retrato = { base: m.baseRecebida, percentual, valor };

  try {
    return await prisma.$transaction(async (tx) => {
      const conta = await tx.conta.create({
        data: {
          tipo: "RECEBER",
          escopo: "EMPRESA",
          descricao: `Faturamento — honorário de ${m.rotulo}`,
          valor,
          vencimento: new Date(`${e.vencimento}T00:00:00Z`),
          clienteId: e.clienteId,
          categoriaId,
          origemServicoId: servicoId,
          observacoes,
        },
        select: { id: true },
      });
      const agora = new Date();
      if (anterior) {
        // Relançar: a conta anterior foi excluída. O elo antigo no WHERE é a trava da corrida.
        const { count } = await tx.honorarioFaturamento.updateMany({
          where: { id: anterior.id, contaId: anterior.contaId },
          data: { ...retrato, contaId: conta.id, lancadoPorId: e.usuarioId, lancadoEm: agora, atualizadoEm: null, observacao: obs },
        });
        if (count === 0) throw jaLancadoErro(e.mes);
      } else {
        await tx.honorarioFaturamento.create({
          data: { clienteId: e.clienteId, mes: e.mes, ...retrato, contaId: conta.id, lancadoPorId: e.usuarioId, lancadoEm: agora, observacao: obs },
        });
      }
      // O mesmo registro que as outras contas automáticas deixam (credenciamento, upsell) — é
      // assim que "quem criou esta cobrança?" tem resposta depois.
      await tx.activityLog.create({
        data: {
          userId: e.usuarioId,
          acao: "conta.criada",
          entidadeTipo: "cliente",
          entidadeId: e.clienteId,
          dados: { origem: "honorario_faturamento", mes: e.mes, contaId: conta.id, valor },
        },
      });
      return { contaId: conta.id, mes: e.mes, valor };
    });
  } catch (err) {
    if (ehUnico(err)) throw jaLancadoErro(e.mes);
    throw err;
  }
}

/**
 * O repasse do mês mudou depois do lançamento e a conta ainda está EM ABERTO: atualiza a conta e o
 * retrato para o valor de hoje, na mesma transação.
 *
 * ⚠️ Conta PAGA não é tocada — mudar o valor de um recebimento já baixado reescreveria o que entrou
 * no caixa. A tela mostra a diferença e sugere um ajuste manual no Financeiro; esta rota recusa.
 * ⚠️ A trava contra "pagou entre a leitura e a gravação" é o `pago: false` no WHERE do `updateMany`.
 */
export async function atualizarHonorario(e: { clienteId: string; mes: string; valorConferido: number; usuarioId: string }) {
  const { m } = await mesAtual(e.clienteId, e.mes);
  if (m.situacao === "PAGO") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `A conta do honorário de ${m.rotulo} já foi paga. Lance a diferença como ajuste no Financeiro.`,
    });
  }
  if (m.situacao !== "DIVERGENTE") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `O honorário de ${m.rotulo} não tem diferença a atualizar.` });
  }
  if (!m.honorario || m.honorario <= 0 || m.percentual === null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `O honorário de ${m.rotulo} hoje é zero. Se a cobrança não vale mais, exclua a conta no Financeiro.`,
    });
  }
  exigirValorConferido(m.honorario, e.valorConferido);
  const valor = m.honorario;
  const percentual = m.percentual;

  const retrato = await prisma.honorarioFaturamento.findUnique({
    where: { clienteId_mes: { clienteId: e.clienteId, mes: e.mes } },
    select: { id: true, contaId: true, valor: true },
  });
  if (!retrato?.contaId) throw new TRPCError({ code: "NOT_FOUND", message: "Lançamento não encontrado." });
  const contaId = retrato.contaId;

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.conta.updateMany({
      where: { id: contaId, clienteId: e.clienteId, pago: false, deletedAt: null },
      data: { valor },
    });
    if (count === 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A conta foi paga ou excluída enquanto isso — nada foi alterado. Recarregue a tela.",
      });
    }
    await tx.honorarioFaturamento.update({
      where: { id: retrato.id },
      data: { base: m.baseRecebida, percentual, valor, atualizadoEm: new Date() },
    });
    await tx.activityLog.create({
      data: {
        userId: e.usuarioId,
        acao: "conta.atualizada",
        entidadeTipo: "cliente",
        entidadeId: e.clienteId,
        dados: { origem: "honorario_faturamento", mes: e.mes, contaId, de: emReaisOu(retrato.valor), para: valor },
      },
    });
  });
  return { contaId, mes: e.mes, valor };
}

/** Os clientes que têm (ou tiveram) o faturamento contratado — quem o lembrete precisa olhar. */
export async function clientesComFaturamento(): Promise<{ id: string; nome: string }[]> {
  const servico = await servicoDeFaturamento();
  if (!servico) return [];
  const linhas = await prisma.clienteServico.findMany({
    where: { servicoId: servico.id, cliente: { deletedAt: null } },
    select: { cliente: { select: { id: true, nome: true } } },
  });
  return linhas.map((l) => l.cliente);
}

/** Os dois últimos meses ENCERRADOS, `AAAA-MM`, a partir de `hoje` (meia-noite UTC do dia BRT). */
export function mesesDoLembrete(hoje: Date): string[] {
  const ano = hoje.getUTCFullYear();
  const m = hoje.getUTCMonth(); // 0-based: o mês corrente
  return [1, 2].map((k) => {
    const d = new Date(Date.UTC(ano, m - k, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/**
 * O que o lembrete precisa avisar: honorário calculável e não lançado nos DOIS últimos meses
 * encerrados, de cada cliente com faturamento contratado.
 *
 * ⚠️ **Só os dois últimos meses, de propósito.** Na primeira varredura depois de publicar, todo mês
 * antigo com repasse importado e nunca lançado viraria aviso de uma vez — dezenas de sininhos e
 * e-mails de meses que a Thaís já cobrou à mão, fora do sistema. Aviso que vira ruído deixa de ser
 * lido (ADR-134), inclusive o que importa. O que é mais antigo continua visível na tela.
 */
export async function honorariosALembrar(hoje: Date = hojeBRT()) {
  const janela = new Set(mesesDoLembrete(hoje));
  const saida: { clienteId: string; cliente: string; mes: string; rotulo: string; valor: number }[] = [];
  // Um cliente por vez: o pool é de 13 conexões e já esgotou em produção.
  for (const c of await clientesComFaturamento()) {
    const h = await honorariosDoCliente(c.id, hoje);
    for (const m of h.meses) {
      if (janela.has(m.mes) && m.situacao === "A_LANCAR" && m.honorario) {
        saida.push({ clienteId: c.id, cliente: c.nome, mes: m.mes, rotulo: m.rotulo, valor: m.honorario });
      }
    }
  }
  return saida;
}
