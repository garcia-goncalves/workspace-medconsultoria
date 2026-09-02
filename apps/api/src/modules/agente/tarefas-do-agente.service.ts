import { prisma } from "@app/db";
import { codificarCursor, decodificarCursor, type PosicaoDoCursor } from "./cursor.js";

/**
 * `GET /api/agent/v1/tasks` — a consulta em si (ADR-149).
 *
 * ⚠️ **SÓ `Tarefa`.** Tarefa é pedido interno delegado; `Card` é etapa de projeto e `Evento` é
 * compromisso de agenda. O briefing da Cora proíbe fundir as três, e a proibição é de negócio,
 * não de estilo: um Card cobrado como tarefa faria a Thaís "concluir" uma entrega de cliente
 * respondendo a um lembrete.
 *
 * ⚠️ **O `userId` é sempre o do TOKEN.** Esta função nem sequer aceita "de quem" listar como
 * parâmetro separado do resultado da autenticação — quem a chama passa o que
 * `autenticarChamadaDeAgente` devolveu. Não há caminho para o pedido escolher a pessoa.
 *
 * ⚠️ **O escopo é o mesmo da aba "Comigo" do lado humano** (`listTarefas`, aba `COMIGO`):
 * responsável, não criador, não a equipe inteira. `scope=mine` não pode significar "tudo o que
 * eu posso ver", senão um ADMIN receberia a fila de toda a casa num assistente pessoal.
 */

/** "Aberta" = PENDENTE ou FAZENDO. Array mutável porque é o que o filtro do Prisma aceita. */
const ABERTAS: ("PENDENTE" | "FAZENDO")[] = ["PENDENTE", "FAZENDO"];

export const LIMITE_PADRAO = 20;
export const LIMITE_MAXIMO = 100;

export type ErroDeEntrada = "SCOPE" | "STATUS" | "LIMIT" | "CURSOR";

export interface EntradaCrua {
  scope?: string;
  status?: string;
  limit?: string;
  cursor?: string;
}

export interface EntradaValidada {
  limit: number;
  posicao: PosicaoDoCursor | null;
}

export type ValidacaoDaEntrada = { ok: true; valor: EntradaValidada } | { ok: false; campo: ErroDeEntrada };

/**
 * Valida os parâmetros da query.
 *
 * ⚠️ **`limit` fora da faixa é ERRO, não é aparado.** Pedido da CORA, e ela tem razão: aparar
 * em silêncio faz o cliente acreditar que recebeu 500 itens quando recebeu 100 — e a diferença
 * só aparece como "sumiu tarefa" muito depois, longe da causa.
 */
export function validarEntrada(cru: EntradaCrua, segredo: string): ValidacaoDaEntrada {
  if (cru.scope !== "mine") return { ok: false, campo: "SCOPE" };
  if (cru.status !== "open") return { ok: false, campo: "STATUS" };

  let limit = LIMITE_PADRAO;
  if (cru.limit !== undefined) {
    // `Number()` aceitaria "", " " e "1e2"; a régua é dígito puro, para "10abc" não virar 10.
    if (!/^\d+$/.test(cru.limit)) return { ok: false, campo: "LIMIT" };
    limit = Number(cru.limit);
    if (limit < 1 || limit > LIMITE_MAXIMO) return { ok: false, campo: "LIMIT" };
  }

  let posicao: PosicaoDoCursor | null = null;
  if (cru.cursor !== undefined && cru.cursor !== "") {
    posicao = decodificarCursor(cru.cursor, segredo);
    if (!posicao) return { ok: false, campo: "CURSOR" };
  }

  return { ok: true, valor: { limit, posicao } };
}

export interface TarefaDoAgente {
  id: string;
  title: string;
  status: "PENDENTE" | "FAZENDO";
  priority: "BAIXA" | "NORMAL" | "ALTA";
  /** ISO 8601 com offset, ou `null`. ⚠️ Ausência de prazo NUNCA vira prazo inventado. */
  dueAt: string | null;
  assigneeIds: string[];
  clientId: string | null;
  projectId: string | null;
}

export interface PaginaDeTarefas {
  items: TarefaDoAgente[];
  nextCursor: string | null;
}

/**
 * Lista as tarefas ABERTAS em que a pessoa delegada é responsável.
 *
 * Paginação por chave (keyset), não por `skip`: com `skip`, uma tarefa criada entre duas
 * páginas empurra a lista e faz a página seguinte PULAR uma linha — silenciosamente. O par
 * `(createdAt, id)` é total e imutável, então a paginação não depende de a lista ficar parada.
 */
export async function listarTarefasDoAgente(
  requesterUserId: string,
  entrada: EntradaValidada,
  segredo: string,
): Promise<PaginaDeTarefas> {
  const posicao = entrada.posicao;
  const where = {
    deletedAt: null,
    status: { in: ABERTAS },
    responsaveis: { some: { userId: requesterUserId } },
    ...(posicao
      ? {
          OR: [
            { createdAt: { lt: posicao.createdAt } },
            { createdAt: posicao.createdAt, id: { lt: posicao.id } },
          ],
        }
      : {}),
  };

  // Pede UM a mais do que o limite: é assim que se sabe que existe página seguinte sem contar a
  // tabela inteira — e sem devolver `nextCursor` numa última página cheia, que faria a Cora dar
  // uma volta a mais para receber lista vazia.
  const linhas = await prisma.tarefa.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: entrada.limit + 1,
    select: {
      id: true,
      titulo: true,
      status: true,
      prioridade: true,
      prazo: true,
      clienteId: true,
      projetoId: true,
      createdAt: true,
      responsaveis: { select: { userId: true } },
    },
  });

  const temMais = linhas.length > entrada.limit;
  const pagina = temMais ? linhas.slice(0, entrada.limit) : linhas;
  const ultima = pagina[pagina.length - 1];

  return {
    items: pagina.map((t) => ({
      id: t.id,
      title: t.titulo,
      status: t.status as "PENDENTE" | "FAZENDO",
      priority: t.prioridade,
      dueAt: t.prazo ? t.prazo.toISOString() : null,
      // Ordem estável por `userId`, como a CORA pediu: lista que muda de ordem entre duas
      // chamadas iguais faz qualquer comparação do lado dela acusar diferença que não existe.
      assigneeIds: t.responsaveis.map((r) => r.userId).sort(),
      clientId: t.clienteId,
      projectId: t.projetoId,
    })),
    nextCursor: temMais && ultima ? codificarCursor({ createdAt: ultima.createdAt, id: ultima.id }, segredo) : null,
  };
}
