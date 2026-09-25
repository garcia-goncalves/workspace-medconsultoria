import { prisma } from "@app/db";
import { hasRoleLevel } from "@app/shared";
import { dataBRT } from "../../lib/datas.js";

export type SearchTipo = "cliente" | "lead" | "projeto" | "documento" | "tarefa" | "evento" | "conversa";

export interface SearchHit {
  tipo: SearchTipo;
  id: string;
  titulo: string;
  subtitulo: string | null;
  /** Só `tarefa`: a aba de /tarefas onde ela aparece para QUEM buscou (Comigo/Deleguei/Da equipe). */
  aba?: "COMIGO" | "DELEGUEI" | "EQUIPE";
  /** Só `evento`: o dia (ISO) em que a agenda deve abrir para mostrá-lo. */
  data?: string;
}

/** Quem está buscando — a visibilidade de tarefa, agenda e conversa depende da pessoa. */
export type BuscaCtx = { userId: string; role: string };

/**
 * Busca global (interna) por nome/título nas entidades principais.
 * Cada tipo é limitado a 5 resultados; termos curtos (<2) não consultam o banco.
 *
 * ⚠️ **Tarefa, compromisso e conversa respeitam a MESMA régua da tela de cada um** — a busca
 * não pode virar uma segunda porta que mostra o que a própria página recusa:
 * - tarefa: ADMIN+ vê todas (aba "Da equipe"); os demais, só as que pediram ou que são deles
 *   (`tarefas.service.ts:listTarefas`);
 * - compromisso: os da EMPRESA + os de que a pessoa é dona ou participante
 *   (`agenda.service.ts:listEventos`);
 * - conversa: só as de que a pessoa participa e não apagou "só para mim"
 *   (`mensagens.service.ts:listConversas`). Procura pelo NOME da conversa — nunca pelo conteúdo
 *   das mensagens.
 */
export async function buscaGlobal(termo: string, ctx: BuscaCtx): Promise<SearchHit[]> {
  const s = termo.trim();
  if (s.length < 2) return [];
  const { userId } = ctx;
  const admin = hasRoleLevel(ctx.role as never, "ADMIN");

  const [clientes, leads, projetos, documentos, tarefas, eventos, conversas] = await Promise.all([
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
    prisma.tarefa.findMany({
      where: {
        deletedAt: null,
        titulo: { contains: s },
        ...(admin ? {} : { OR: [{ criadoPorId: userId }, { responsaveis: { some: { userId } } }] }),
      },
      take: 5,
      // Abertas primeiro, depois as mais recentes (mesma ideia da lista de Tarefas).
      orderBy: [{ concluidaEm: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        titulo: true,
        status: true,
        criadoPorId: true,
        responsaveis: { select: { userId: true } },
        cliente: { select: { nome: true } },
        projeto: { select: { nome: true } },
      },
    }),
    prisma.evento.findMany({
      where: {
        deletedAt: null,
        titulo: { contains: s },
        OR: [{ escopo: "EMPRESA" }, { donoId: userId }, { participantes: { some: { userId } } }],
      },
      take: 5,
      orderBy: { inicio: "desc" },
      select: { id: true, titulo: true, inicio: true, recorrencia: true, recorrenciaAte: true },
    }),
    prisma.conversaParticipante.findMany({
      where: {
        userId,
        ocultoEm: null,
        conversa: {
          deletedAt: null,
          OR: [
            { nome: { contains: s } },
            { assunto: { contains: s } },
            { cliente: { nome: { contains: s } } },
            // Conversa direta não tem nome: ela se chama pela OUTRA pessoa.
            { tipo: "INDIVIDUAL", participantes: { some: { userId: { not: userId }, user: { nome: { contains: s } } } } },
          ],
        },
      },
      take: 5,
      orderBy: { conversa: { updatedAt: "desc" } },
      select: {
        conversa: {
          select: {
            id: true,
            tipo: true,
            nome: true,
            numero: true,
            assunto: true,
            cliente: { select: { nome: true } },
            participantes: { where: { userId: { not: userId } }, take: 1, select: { user: { select: { nome: true } } } },
          },
        },
      },
    }),
  ]);

  const agora = new Date();
  return [
    ...clientes.map((c): SearchHit => ({ tipo: "cliente", id: c.id, titulo: c.nome, subtitulo: c.email })),
    ...leads.map((l): SearchHit => ({ tipo: "lead", id: l.id, titulo: l.nome, subtitulo: l.empresa })),
    ...projetos.map((p): SearchHit => ({ tipo: "projeto", id: p.id, titulo: p.nome, subtitulo: p.cliente?.nome ?? null })),
    ...documentos.map((d): SearchHit => ({ tipo: "documento", id: d.id, titulo: d.titulo, subtitulo: d.cliente?.nome ?? null })),
    ...tarefas.map((t): SearchHit => ({
      tipo: "tarefa",
      id: t.id,
      titulo: t.titulo,
      subtitulo: t.status === "CONCLUIDA" ? "Concluída" : (t.cliente?.nome ?? t.projeto?.nome ?? null),
      aba: abaDaTarefa(t, userId),
    })),
    ...eventos.map((e): SearchHit => ({
      tipo: "evento",
      id: e.id,
      titulo: e.titulo,
      subtitulo: e.recorrencia === "NENHUMA" ? dataBRT(e.inicio) : `Repete · desde ${dataBRT(e.inicio)}`,
      data: diaParaAbrirOEvento(e, agora).toISOString(),
    })),
    ...conversas.map(({ conversa: c }): SearchHit => {
      const outra = c.participantes[0]?.user.nome ?? null;
      const nome = c.tipo === "GRUPO" ? (c.nome ?? "Grupo") : c.tipo === "CLIENTE" ? (c.cliente?.nome ?? "Cliente") : (outra ?? "Conversa");
      const subtitulo = c.tipo === "CLIENTE" ? [c.numero ? `#${c.numero}` : null, c.assunto].filter(Boolean).join(" · ") || null : null;
      return { tipo: "conversa", id: c.id, titulo: nome, subtitulo };
    }),
  ];
}

/** Onde a tarefa aparece para quem buscou: "Comigo" se é dele, "Deleguei" se pediu, senão "Da equipe". */
export function abaDaTarefa(
  t: { criadoPorId: string; responsaveis: { userId: string }[] },
  userId: string,
): "COMIGO" | "DELEGUEI" | "EQUIPE" {
  if (t.responsaveis.some((r) => r.userId === userId)) return "COMIGO";
  if (t.criadoPorId === userId) return "DELEGUEI";
  return "EQUIPE";
}

/**
 * Dia em que a agenda abre para mostrar o compromisso. Avulso: o dia dele. Série que continua
 * valendo e já começou: hoje (a série segue viva na semana atual). Série encerrada: o início.
 */
export function diaParaAbrirOEvento(e: { inicio: Date; recorrencia: string; recorrenciaAte: Date | null }, agora: Date): Date {
  if (e.recorrencia === "NENHUMA" || e.inicio >= agora) return e.inicio;
  if (!e.recorrenciaAte || e.recorrenciaAte >= agora) return agora;
  return e.inicio;
}
