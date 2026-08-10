import { prisma } from "@app/db";
import { OPERADORAS_COMUNS } from "@app/shared";
import { TRPCError } from "@trpc/server";

/** Semeia o catálogo com as operadoras comuns na primeira vez (depois é 100% editável). */
async function seedIfEmpty() {
  if ((await prisma.operadora.count()) === 0) {
    await prisma.operadora.createMany({ data: OPERADORAS_COMUNS.map((nome, ordem) => ({ nome, ordem })) });
  }
}

/** Catálogo de operadoras (para a Proposta de credenciamento). */
export async function listOperadoras() {
  await seedIfEmpty();
  return prisma.operadora.findMany({ orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } });
}

export async function criarOperadora(nome: string) {
  const max = await prisma.operadora.aggregate({ _max: { ordem: true } });
  return prisma.operadora.create({ data: { nome: nome.trim(), ordem: (max._max.ordem ?? -1) + 1 } });
}

export async function renomearOperadora(id: string, nome: string) {
  return prisma.operadora.update({ where: { id }, data: { nome: nome.trim() } }).catch(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Operadora não encontrada." });
  });
}

/**
 * Exclusão PERMANENTE do catálogo. Desde a grade médico × operadora (ADR-104) há vínculo por
 * FK: operadora com credenciamento registrado não sai, senão o andamento (e a cobrança presa
 * a ele) desapareceria junto. O banco recusa com `Restrict`; aqui isso vira um recado que
 * explica o que está preso, em vez de um erro cru.
 */
export async function removerOperadora(id: string) {
  const emUso = await prisma.credenciamento.count({ where: { operadoraId: id } });
  if (emUso > 0) {
    const nome = (await prisma.operadora.findUnique({ where: { id }, select: { nome: true } }))?.nome ?? "Esta operadora";
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${nome} não pode ser excluída: há ${emUso} credenciamento(s) registrado(s) nela. Renomeie-a, se for o caso — o histórico não se apaga.`,
    });
  }
  await prisma.operadora.deleteMany({ where: { id } });
  return { ok: true };
}
