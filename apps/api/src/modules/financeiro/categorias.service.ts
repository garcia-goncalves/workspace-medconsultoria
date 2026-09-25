import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { CreateCategoriaInput, UpdateCategoriaInput, Escopo } from "@app/shared";
import type { Ctx } from "./contas.service.js";

type Semente = { nome: string; tipo: "RECEITA" | "DESPESA"; cor: string };

// Categorias-semente da EMPRESA (livros da Med).
const DEFAULTS_EMPRESA: Semente[] = [
  { nome: "Honorários", tipo: "RECEITA", cor: "#30AD73" },
  { nome: "Consultoria", tipo: "RECEITA", cor: "#2DA8E1" },
  { nome: "Outras receitas", tipo: "RECEITA", cor: "#003591" },
  { nome: "Aluguel", tipo: "DESPESA", cor: "#E5484D" },
  { nome: "Salários", tipo: "DESPESA", cor: "#F59E0B" },
  { nome: "Impostos", tipo: "DESPESA", cor: "#002463" },
  { nome: "Fornecedores", tipo: "DESPESA", cor: "#8b5cf6" },
  { nome: "Outras despesas", tipo: "DESPESA", cor: "#64748b" },
];

// Categorias-semente PESSOAIS (vida particular) — criadas por usuário no 1º acesso.
const DEFAULTS_PESSOAL: Semente[] = [
  { nome: "Salário / Renda", tipo: "RECEITA", cor: "#30AD73" },
  { nome: "Outras receitas", tipo: "RECEITA", cor: "#2DA8E1" },
  { nome: "Casa / Aluguel", tipo: "DESPESA", cor: "#E5484D" },
  { nome: "Mercado", tipo: "DESPESA", cor: "#F59E0B" },
  { nome: "Contas (água/luz/net)", tipo: "DESPESA", cor: "#0ea5e9" },
  { nome: "Cartão de crédito", tipo: "DESPESA", cor: "#8b5cf6" },
  { nome: "Transporte", tipo: "DESPESA", cor: "#002463" },
  { nome: "Saúde", tipo: "DESPESA", cor: "#ec4899" },
  { nome: "Educação", tipo: "DESPESA", cor: "#14b8a6" },
  { nome: "Lazer", tipo: "DESPESA", cor: "#f97316" },
  { nome: "Outras despesas", tipo: "DESPESA", cor: "#64748b" },
];

export async function listCategorias(escopo: Escopo, ctx: Ctx) {
  const filtro = escopo === "PESSOAL" ? { escopo, donoId: ctx.userId } : { escopo: "EMPRESA" as const };
  const count = await prisma.categoria.count({ where: filtro });
  if (count === 0) {
    const sementes = escopo === "PESSOAL" ? DEFAULTS_PESSOAL : DEFAULTS_EMPRESA;
    await prisma.categoria.createMany({
      data: sementes.map((s) => ({ ...s, escopo, donoId: escopo === "PESSOAL" ? ctx.userId : null })),
    });
  }
  const lista = await prisma.categoria.findMany({
    where: filtro,
    orderBy: [{ tipo: "asc" }, { nome: "asc" }],
    // Quantas contas VIVAS usam cada categoria — é o número que a confirmação de excluir precisa
    // dizer ("12 contas ficarão sem categoria"). Sem ele, excluir parecia não custar nada.
    include: { _count: { select: { contas: { where: { deletedAt: null } } } } },
  });
  return lista.map(({ _count, ...c }) => ({ ...c, contasVinculadas: _count.contas }));
}

async function categoriaComPosse(id: string, ctx: Ctx) {
  const cat = await prisma.categoria.findUnique({ where: { id } });
  if (!cat) throw new TRPCError({ code: "NOT_FOUND", message: "Categoria não encontrada" });
  if (cat.escopo === "PESSOAL" && cat.donoId !== ctx.userId)
    throw new TRPCError({ code: "FORBIDDEN", message: "Esta é uma categoria pessoal de outra pessoa." });
  return cat;
}

export function createCategoria(input: CreateCategoriaInput, ctx: Ctx) {
  const escopo = input.escopo ?? "EMPRESA";
  return prisma.categoria.create({
    data: {
      nome: input.nome.trim(),
      tipo: input.tipo,
      escopo,
      donoId: escopo === "PESSOAL" ? ctx.userId : null,
      cor: input.cor?.trim() || null,
    },
  });
}

export async function updateCategoria(input: UpdateCategoriaInput, ctx: Ctx) {
  await categoriaComPosse(input.id, ctx);
  return prisma.categoria.update({
    where: { id: input.id },
    data: {
      ...(input.nome !== undefined ? { nome: input.nome.trim() } : {}),
      ...(input.tipo !== undefined ? { tipo: input.tipo } : {}),
      ...(input.cor !== undefined ? { cor: input.cor?.trim() || null } : {}),
    },
  });
}

/**
 * Remove a categoria. As contas vinculadas ficam sem categoria (onDelete: SetNull) — a tela
 * mostra quantas ANTES de confirmar (`contasVinculadas`), e o filtro "Sem categoria" da lista
 * existe para achá-las depois e reclassificar.
 */
export async function removeCategoria(id: string, ctx: Ctx) {
  await categoriaComPosse(id, ctx);
  return prisma.categoria.delete({ where: { id } });
}
