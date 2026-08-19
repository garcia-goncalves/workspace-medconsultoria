import { prisma } from "@app/db";

export type SearchTipo = "cliente" | "lead" | "projeto" | "documento";

export interface SearchHit {
  tipo: SearchTipo;
  id: string;
  titulo: string;
  subtitulo: string | null;
}

/**
 * Busca global (interna) por nome/título nas entidades principais.
 * Cada tipo é limitado a 5 resultados; termos curtos (<2) não consultam o banco.
 */
export async function buscaGlobal(termo: string): Promise<SearchHit[]> {
  const s = termo.trim();
  if (s.length < 2) return [];

  const [clientes, leads, projetos, documentos] = await Promise.all([
    prisma.cliente.findMany({
      where: {
        deletedAt: null,
        OR: [{ nome: { contains: s } }, { email: { contains: s } }, { cnpj: { contains: s } }],
      },
      take: 5,
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, email: true },
    }),
    prisma.lead.findMany({
      where: {
        deletedAt: null,
        OR: [{ nome: { contains: s } }, { empresa: { contains: s } }, { email: { contains: s } }],
      },
      take: 5,
      orderBy: { updatedAt: "desc" },
      select: { id: true, nome: true, empresa: true },
    }),
    prisma.projeto.findMany({
      where: { deletedAt: null, nome: { contains: s } },
      take: 5,
      orderBy: { updatedAt: "desc" },
      select: { id: true, nome: true, cliente: { select: { nome: true } } },
    }),
    prisma.documento.findMany({
      where: { deletedAt: null, titulo: { contains: s } },
      take: 5,
      orderBy: { updatedAt: "desc" },
      select: { id: true, titulo: true, cliente: { select: { nome: true } } },
    }),
  ]);

  return [
    ...clientes.map((c): SearchHit => ({ tipo: "cliente", id: c.id, titulo: c.nome, subtitulo: c.email })),
    ...leads.map((l): SearchHit => ({ tipo: "lead", id: l.id, titulo: l.nome, subtitulo: l.empresa })),
    ...projetos.map((p): SearchHit => ({ tipo: "projeto", id: p.id, titulo: p.nome, subtitulo: p.cliente?.nome ?? null })),
    ...documentos.map((d): SearchHit => ({ tipo: "documento", id: d.id, titulo: d.titulo, subtitulo: d.cliente?.nome ?? null })),
  ];
}
