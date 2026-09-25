import { prisma } from "@app/db";
import { ehContaDeSistema, type RelatorioEntregasInput } from "@app/shared";
import { hojeBRT, somarDiasUTC } from "../../lib/datas.js";
import { config } from "../../config.js";

/**
 * Relatório de entregas da equipe (ADMIN+): por pessoa e por período, quanto foi entregue e com
 * que pontualidade.
 *
 * ⚠️ **Tarefa é N-N com responsáveis**: uma tarefa da equipe com duas pessoas conta para AS DUAS.
 * Por isso não há linha de total — somar as linhas contaria a mesma tarefa duas vezes.
 *
 * ⚠️ **Cartão de projeto não guarda QUANDO foi concluído** (o `Card` não tem `concluidoEm`). O
 * número usado é "cartões CONCLUÍDOS cuja última alteração caiu no período" — aproximação honesta,
 * e a tela diz isso. Um cartão concluído e editado depois migra para o período da edição.
 */

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Dia de Brasília ("AAAA-MM-DD") de um INSTANTE (ex.: `concluidaEm`). */
function diaBRT(instante: Date): string {
  return new Date(instante.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Dia de um campo date-only (meia-noite UTC, como o `prazo`). */
function diaDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface LinhaEntrega {
  userId: string;
  nome: string;
  /** Tarefas concluídas no período (em que a pessoa é responsável). */
  concluidas: number;
  /** Concluídas até o dia do prazo. */
  noPrazo: number;
  /** Concluídas depois do dia do prazo. */
  atrasadas: number;
  /** Concluídas que não tinham prazo. */
  semPrazo: number;
  /** Abertas hoje com prazo já vencido (não depende do período). */
  abertasAtrasadasHoje: number;
  /** Cartões de projeto concluídos (última alteração no período). */
  cartoesConcluidos: number;
}

/**
 * A agregação, pura — quem MEDE é o banco, quem DECIDE é esta função (testada sem banco).
 * "No prazo" compara DIAS: concluir no próprio dia do prazo é no prazo, a qualquer hora.
 */
export function agregarEntregas(entrada: {
  pessoas: { id: string; nome: string }[];
  concluidas: { responsavelIds: string[]; prazo: Date | null; concluidaEm: Date }[];
  abertasAtrasadas: { responsavelIds: string[] }[];
  cartoes: { responsavelId: string | null }[];
}): LinhaEntrega[] {
  const linhas = new Map<string, LinhaEntrega>();
  for (const p of entrada.pessoas)
    linhas.set(p.id, {
      userId: p.id,
      nome: p.nome,
      concluidas: 0,
      noPrazo: 0,
      atrasadas: 0,
      semPrazo: 0,
      abertasAtrasadasHoje: 0,
      cartoesConcluidos: 0,
    });

  for (const t of entrada.concluidas) {
    for (const uid of new Set(t.responsavelIds)) {
      const l = linhas.get(uid);
      if (!l) continue;
      l.concluidas++;
      if (!t.prazo) l.semPrazo++;
      else if (diaBRT(t.concluidaEm) <= diaDateOnly(t.prazo)) l.noPrazo++;
      else l.atrasadas++;
    }
  }
  for (const t of entrada.abertasAtrasadas)
    for (const uid of new Set(t.responsavelIds)) {
      const l = linhas.get(uid);
      if (l) l.abertasAtrasadasHoje++;
    }
  for (const c of entrada.cartoes) {
    const l = c.responsavelId ? linhas.get(c.responsavelId) : undefined;
    if (l) l.cartoesConcluidos++;
  }
  return [...linhas.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * Limites do período em INSTANTES: `de`/`ate` chegam como meia-noite UTC do dia escolhido
 * (date-only); o dia de Brasília começa 3h depois. `fim` é exclusivo (o dia seguinte a `ate`).
 */
export function limitesDoPeriodo(input: RelatorioEntregasInput): { inicio: Date; fim: Date } {
  return {
    inicio: new Date(input.de.getTime() + BRT_OFFSET_MS),
    fim: new Date(somarDiasUTC(input.ate, 1).getTime() + BRT_OFFSET_MS),
  };
}

export async function relatorioEntregas(input: RelatorioEntregasInput) {
  const { inicio, fim } = limitesDoPeriodo(input);
  const [equipe, concluidas, abertasAtrasadas, cartoes] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null, role: { not: "CLIENTE" } },
      select: { id: true, nome: true, email: true, ativo: true },
    }),
    prisma.tarefa.findMany({
      where: { deletedAt: null, status: "CONCLUIDA", concluidaEm: { gte: inicio, lt: fim } },
      select: { prazo: true, concluidaEm: true, responsaveis: { select: { userId: true } } },
    }),
    prisma.tarefa.findMany({
      where: { deletedAt: null, status: { not: "CONCLUIDA" }, prazo: { lt: hojeBRT() } },
      select: { responsaveis: { select: { userId: true } } },
    }),
    prisma.card.findMany({
      where: { deletedAt: null, status: "CONCLUIDO", responsavelId: { not: null }, updatedAt: { gte: inicio, lt: fim } },
      select: { responsavelId: true },
    }),
  ]);

  const linhas = agregarEntregas({
    // A conta de sistema (ROOT primordial) nunca aparece; quem já saiu só aparece se tiver número.
    pessoas: equipe.filter((u) => !ehContaDeSistema(u.email, config.ROOT_PROTEGIDO_EMAIL)).map((u) => ({ id: u.id, nome: u.nome })),
    concluidas: concluidas.map((t) => ({
      responsavelIds: t.responsaveis.map((r) => r.userId),
      prazo: t.prazo,
      concluidaEm: t.concluidaEm!,
    })),
    abertasAtrasadas: abertasAtrasadas.map((t) => ({ responsavelIds: t.responsaveis.map((r) => r.userId) })),
    cartoes,
  });
  const ativos = new Set(equipe.filter((u) => u.ativo).map((u) => u.id));
  return linhas.filter((l) => ativos.has(l.userId) || l.concluidas + l.abertasAtrasadasHoje + l.cartoesConcluidos > 0);
}
