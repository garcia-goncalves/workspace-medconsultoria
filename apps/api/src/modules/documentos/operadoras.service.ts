import { prisma } from "@app/db";
import { OPERADORAS_COMUNS, type UsoOperadora } from "@app/shared";
import { TRPCError } from "@trpc/server";

/** Semeia o catálogo com as operadoras comuns na primeira vez (depois é 100% editável). */
async function seedIfEmpty() {
  if ((await prisma.operadora.count()) === 0) {
    // Nascem marcadas para os DOIS serviços: a mesma Unimed que se credencia é a Unimed cujas
    // contas se faturam (ADR-126).
    await prisma.operadora.createMany({ data: OPERADORAS_COMUNS.map((nome, ordem) => ({ nome, ordem })) });
  }
}

/** A marcação que precisa estar ligada para a operadora aparecer naquele serviço. */
const CAMPO_DE_USO = {
  CREDENCIAMENTO: "usoCredenciamento",
  FATURAMENTO: "usoFaturamento",
} as const satisfies Record<UsoOperadora, string>;

/**
 * Catálogo de operadoras/convênios — **um só**, com marcação por serviço (ADR-126).
 *
 * Sem `uso`, devolve tudo (é o que a tela de gestão precisa mostrar). Com `uso`, devolve só as
 * marcadas para aquele serviço — é o que a proposta de credenciamento e a de faturamento pedem,
 * cada uma a sua.
 */
export async function listOperadoras(uso?: UsoOperadora) {
  await seedIfEmpty();
  return prisma.operadora.findMany({
    where: uso ? { [CAMPO_DE_USO[uso]]: true } : undefined,
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    select: { id: true, nome: true, usoCredenciamento: true, usoFaturamento: true },
  });
}

/** Operadora marcada para nada não aparece em lugar nenhum — some sem avisar, e parece perda de dado. */
function exigirAlgumUso(usos: { usoCredenciamento: boolean; usoFaturamento: boolean }) {
  if (!usos.usoCredenciamento && !usos.usoFaturamento) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Marque ao menos um serviço (Credenciamento ou Faturamento) — senão a operadora não aparece em nenhuma proposta.",
    });
  }
}

export async function criarOperadora(input: { nome: string; usoCredenciamento?: boolean; usoFaturamento?: boolean }) {
  const usos = {
    usoCredenciamento: input.usoCredenciamento ?? true,
    usoFaturamento: input.usoFaturamento ?? true,
  };
  exigirAlgumUso(usos);
  const max = await prisma.operadora.aggregate({ _max: { ordem: true } });
  return prisma.operadora.create({
    data: { nome: input.nome.trim(), ordem: (max._max.ordem ?? -1) + 1, ...usos },
  });
}

/**
 * Atualiza nome e/ou marcações. Substituiu o antigo `renomear`: com a marcação por serviço, a
 * tela grava as duas coisas no mesmo movimento, e duas chamadas separadas deixariam a operadora
 * marcada para nada por um instante — tempo suficiente para o erro acima disparar sem motivo.
 */
export async function atualizarOperadora(input: {
  id: string;
  nome?: string;
  usoCredenciamento?: boolean;
  usoFaturamento?: boolean;
}) {
  const atual = await prisma.operadora.findUnique({
    where: { id: input.id },
    select: { usoCredenciamento: true, usoFaturamento: true },
  });
  if (!atual) throw new TRPCError({ code: "NOT_FOUND", message: "Operadora não encontrada." });
  const usos = {
    usoCredenciamento: input.usoCredenciamento ?? atual.usoCredenciamento,
    usoFaturamento: input.usoFaturamento ?? atual.usoFaturamento,
  };
  exigirAlgumUso(usos);
  return prisma.operadora.update({
    where: { id: input.id },
    data: { ...(input.nome !== undefined ? { nome: input.nome.trim() } : {}), ...usos },
  });
}

/**
 * Exclusão PERMANENTE do catálogo. Desde a grade médico × operadora (ADR-104) há vínculo por
 * FK: operadora com credenciamento registrado não sai, senão o andamento (e a cobrança presa
 * a ele) desapareceria junto. O banco recusa com `Restrict`; aqui isso vira um recado que
 * explica o que está preso, em vez de um erro cru.
 *
 * Desde a ADR-126 o convênio também pode estar preso ao SERVIÇO CONTRATADO de um cliente. Ali
 * o banco apaga em cascata (é só um vínculo, não um processo com dinheiro), mas a lista do
 * cliente encolheria em silêncio — então também vira recado.
 */
export async function removerOperadora(id: string) {
  const [emUso, emClientes] = await Promise.all([
    prisma.credenciamento.count({ where: { operadoraId: id } }),
    prisma.clienteServico.count({ where: { operadoras: { some: { id } } } }),
  ]);
  const nome = async () =>
    (await prisma.operadora.findUnique({ where: { id }, select: { nome: true } }))?.nome ?? "Esta operadora";
  if (emUso > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${await nome()} não pode ser excluída: há ${emUso} credenciamento(s) registrado(s) nela. Renomeie-a, se for o caso — o histórico não se apaga.`,
    });
  }
  if (emClientes > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${await nome()} não pode ser excluída: ${emClientes} serviço(s) contratado(s) listam este convênio. Desmarque-o na ficha desses clientes primeiro.`,
    });
  }
  await prisma.operadora.deleteMany({ where: { id } });
  return { ok: true };
}
