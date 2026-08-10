import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import {
  motivoDaTransicaoRecusada,
  proximaTentativa,
  totalDaGrade,
  type CelulaGrade,
  type StatusCredenciamento,
} from "@app/shared";

/**
 * A GRADE médico × operadora (spec §5.4) — a peça que monta o preço da proposta, acompanha
 * o andamento de cada cruzamento e, no Bloco C, dispara a cobrança na aprovação.
 *
 * Por que uma linha por cruzamento, e não um valor por operadora: a operadora credencia
 * PESSOAS. Dois médicos numa clínica podem ser aprovados em operadoras diferentes, em datas
 * diferentes, e uma negativa vale só para aquele médico naquela operadora. Guardar isso como
 * "valor × quantidade" perde exatamente o que a Thaís precisa acompanhar.
 */

/** Uma célula como a tela e o documento a leem — dinheiro já em número, não em Decimal. */
export type CelulaDaGrade = {
  id: string;
  profissionalId: string;
  operadoraId: string;
  valor: number;
  status: StatusCredenciamento;
  tentativa: number;
  documentoId: string | null;
  contaId: string | null;
  motivoNegativa: string | null;
  observacoes: string | null;
  protocoladoEm: Date | null;
  emAnaliseEm: Date | null;
  aprovadoEm: Date | null;
  negadoEm: Date | null;
  encerradoEm: Date | null;
};

const paraCelula = (c: {
  id: string;
  profissionalId: string;
  operadoraId: string;
  valor: unknown;
  status: string;
  tentativa: number;
  documentoId: string | null;
  contaId: string | null;
  motivoNegativa: string | null;
  observacoes: string | null;
  protocoladoEm: Date | null;
  emAnaliseEm: Date | null;
  aprovadoEm: Date | null;
  negadoEm: Date | null;
  encerradoEm: Date | null;
}): CelulaDaGrade => ({
  ...c,
  valor: Number(c.valor),
  status: c.status as StatusCredenciamento,
});

/**
 * A grade inteira de um cliente: as linhas (médicos ativos), as colunas (o catálogo de
 * operadoras) e o que já existe em cada cruzamento. É o que a tela desenha e o construtor da
 * proposta preenche.
 *
 * Mostra TODAS as tentativas: a negativa de 2025 é o que justifica a tentativa de 2026, e
 * esconder o histórico faria a Thaís reabrir um caso que ela já sabe que foi negado.
 */
export async function gradeDoCliente(clienteId: string) {
  const [profissionais, operadoras, linhas] = await Promise.all([
    prisma.profissional.findMany({
      where: { clienteId, ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, especialidade: true, conselho: true, conselhoNumero: true, conselhoUf: true },
    }),
    prisma.operadora.findMany({ orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } }),
    prisma.credenciamento.findMany({
      where: { clienteId },
      orderBy: [{ tentativa: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const celulas = linhas.map(paraCelula);
  return {
    profissionais,
    operadoras,
    celulas,
    // O total da grade é o que vai para a proposta: só o que está EM CURSO ou aprovado conta.
    // Negado e encerrado ficam à vista para o histórico, mas não somam no investimento.
    total: totalDaGrade(
      celulas
        .filter((c) => c.status !== "NEGADO" && c.status !== "ENCERRADO")
        .map((c) => ({ profissionalId: c.profissionalId, operadoraId: c.operadoraId, valor: c.valor })),
    ),
  };
}

/**
 * Grava a grade montada no construtor da proposta. Cria o que falta, ajusta o valor do que
 * ainda está `A_PROTOCOLAR` e **apaga só o que nunca saiu do papel**.
 *
 * Desmarcar na tela um cruzamento que já foi protocolado NÃO o apaga: aquele processo existe
 * no mundo, correndo na operadora, e sumir com ele por um clique de edição perderia o
 * histórico (e o vínculo com uma cobrança já emitida). O serviço devolve o que ignorou para
 * a tela poder avisar.
 */
export async function salvarGrade(
  input: { clienteId: string; celulas: CelulaGrade[]; documentoId?: string | null },
  ator: { id: string },
) {
  const profissionaisDoCliente = new Set(
    (await prisma.profissional.findMany({ where: { clienteId: input.clienteId }, select: { id: true } })).map((p) => p.id),
  );
  // Um id de profissional de OUTRO cliente na grade escreveria o credenciamento de um médico
  // alheio na ficha deste. A posse é conferida aqui, não confiada ao que a tela mandou.
  for (const c of input.celulas) {
    if (!profissionaisDoCliente.has(c.profissionalId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Há um profissional que não pertence a este cliente na grade." });
    }
  }

  const existentes = await prisma.credenciamento.findMany({ where: { clienteId: input.clienteId } });
  // A tentativa VIGENTE de cada par é a maior — é nela que a edição mexe.
  const vigentePorPar = new Map<string, (typeof existentes)[number]>();
  for (const e of existentes) {
    const par = `${e.profissionalId}|${e.operadoraId}`;
    const atual = vigentePorPar.get(par);
    if (!atual || e.tentativa > atual.tentativa) vigentePorPar.set(par, e);
  }

  const marcados = new Set(input.celulas.map((c) => `${c.profissionalId}|${c.operadoraId}`));
  let criados = 0;
  let atualizados = 0;
  let removidos = 0;
  let preservados = 0;

  for (const c of input.celulas) {
    const par = `${c.profissionalId}|${c.operadoraId}`;
    const vigente = vigentePorPar.get(par);
    if (!vigente) {
      await prisma.credenciamento.create({
        data: {
          clienteId: input.clienteId,
          profissionalId: c.profissionalId,
          operadoraId: c.operadoraId,
          valor: c.valor,
          tentativa: 1,
          documentoId: input.documentoId ?? null,
        },
      });
      criados++;
      continue;
    }
    // Já saiu do papel: o valor combinado está congelado no que foi protocolado/cobrado.
    if (vigente.status !== "A_PROTOCOLAR") {
      preservados++;
      continue;
    }
    await prisma.credenciamento.update({
      where: { id: vigente.id },
      data: { valor: c.valor, documentoId: input.documentoId ?? vigente.documentoId },
    });
    atualizados++;
  }

  // Desmarcado na tela: só some quem nunca foi protocolado.
  for (const [par, vigente] of vigentePorPar) {
    if (marcados.has(par)) continue;
    if (vigente.status !== "A_PROTOCOLAR") {
      preservados++;
      continue;
    }
    await prisma.credenciamento.delete({ where: { id: vigente.id } });
    removidos++;
  }

  await prisma.activityLog.create({
    data: {
      userId: ator.id,
      acao: "credenciamento.grade_salva",
      entidadeTipo: "cliente",
      entidadeId: input.clienteId,
      dados: { criados, atualizados, removidos, preservados },
    },
  });

  /** `preservados` = cruzamentos que a edição NÃO tocou por já estarem em curso. */
  return { criados, atualizados, removidos, preservados };
}

/**
 * Move um cruzamento no fluxo, carimbando a data daquele estado. A transição é validada por
 * `transicaoCredenciamentoPermitida` (regra pura, testada) — negar por edição um caso já
 * aprovado, ou aprovar um negado, apagaria o fato que sustenta a cobrança.
 */
export async function mudarStatusCredenciamento(
  input: { id: string; status: StatusCredenciamento; motivoNegativa?: string | null; observacoes?: string | null },
  ator: { id: string },
) {
  const atual = await prisma.credenciamento.findUnique({ where: { id: input.id } });
  if (!atual) throw new TRPCError({ code: "NOT_FOUND", message: "Credenciamento não encontrado." });

  const de = atual.status as StatusCredenciamento;
  const recusa = motivoDaTransicaoRecusada(de, input.status);
  if (recusa) throw new TRPCError({ code: "BAD_REQUEST", message: recusa });

  const motivoNegativa = input.motivoNegativa?.trim() ?? "";
  if (input.status === "NEGADO" && !motivoNegativa) {
    // Sem o motivo, a negativa não ensina nada — e é ele que sustenta pedir a 2ª tentativa.
    throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o motivo da negativa da operadora." });
  }

  const agora = new Date();
  const carimbo: Record<StatusCredenciamento, Record<string, Date>> = {
    A_PROTOCOLAR: {},
    PROTOCOLADO: { protocoladoEm: agora },
    EM_ANALISE: { emAnaliseEm: agora },
    APROVADO: { aprovadoEm: agora },
    NEGADO: { negadoEm: agora },
    ENCERRADO: { encerradoEm: agora },
  };

  const atualizado = await prisma.credenciamento.update({
    where: { id: input.id },
    data: {
      status: input.status,
      ...carimbo[input.status],
      motivoNegativa: input.status === "NEGADO" ? motivoNegativa : atual.motivoNegativa,
      observacoes: input.observacoes !== undefined ? input.observacoes?.trim() || null : atual.observacoes,
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: ator.id,
      acao: "credenciamento.status",
      entidadeTipo: "cliente",
      entidadeId: atual.clienteId,
      dados: { credenciamentoId: input.id, de, para: input.status },
    },
  });

  return paraCelula(atualizado);
}

/**
 * Abre a 2ª (ou 3ª…) tentativa daquele par — o "salvo acordo expresso" do §3.4. É ação
 * deliberada e exige o motivo do acordo: sem isso, uma negativa viraria retentativa
 * automática, e a operadora que já disse não receberia o mesmo processo de novo.
 *
 * A linha anterior fica intacta, com a negativa e a data. A nova nasce `A_PROTOCOLAR`, com o
 * valor da anterior como ponto de partida (editável na grade).
 */
export async function abrirNovaTentativa(input: { id: string; motivo: string }, ator: { id: string }) {
  const anterior = await prisma.credenciamento.findUnique({ where: { id: input.id } });
  if (!anterior) throw new TRPCError({ code: "NOT_FOUND", message: "Credenciamento não encontrado." });

  const tentativa = proximaTentativa(anterior.status as StatusCredenciamento, anterior.tentativa);
  if (!tentativa) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Só dá para abrir nova tentativa de um credenciamento negado ou encerrado.",
    });
  }
  const motivo = input.motivo.trim();
  if (!motivo) throw new TRPCError({ code: "BAD_REQUEST", message: "Registre o acordo que autoriza a nova tentativa." });

  const nova = await prisma.credenciamento.create({
    data: {
      clienteId: anterior.clienteId,
      profissionalId: anterior.profissionalId,
      operadoraId: anterior.operadoraId,
      valor: anterior.valor,
      tentativa,
      observacoes: `Nova tentativa (${tentativa}ª) — acordo: ${motivo}`,
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: ator.id,
      acao: "credenciamento.nova_tentativa",
      entidadeTipo: "cliente",
      entidadeId: anterior.clienteId,
      dados: { de: input.id, para: nova.id, tentativa },
    },
  });

  return paraCelula(nova);
}
