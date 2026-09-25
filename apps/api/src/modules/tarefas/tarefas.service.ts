import { TRPCError } from "@trpc/server";
import { Prisma, prisma } from "@app/db";
import {
  hasRoleLevel,
  type CreateTarefaInput,
  type UpdateTarefaInput,
  type ListTarefasInput,
  type TarefaStatus,
  type Recorrencia,
} from "@app/shared";
import { notificar } from "../notificacoes/notificacoes.service.js";
// A MESMA regra de "próxima data da série" do Financeiro (mensal no dia 31 → último dia do mês,
// com âncora para voltar ao 31 em março). Reusada, não copiada: duas cópias divergiriam.
import { proximo } from "../financeiro/contas.service.js";

/** Contexto do usuário logado. */
export type Ctx = { userId: string; role: string };

const clean = (v?: string | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

const include = {
  responsaveis: { include: { user: { select: { id: true, nome: true, avatarUrl: true } } } },
  criadoPor: { select: { id: true, nome: true, avatarUrl: true } },
  cliente: { select: { id: true, nome: true } },
  projeto: { select: { id: true, nome: true } },
} as const;

/** Filtro por situação (o "ABERTAS" some com as concluídas). */
function whereFiltro(filtro: ListTarefasInput["filtro"]) {
  if (filtro === "ABERTAS") return { status: { not: "CONCLUIDA" as TarefaStatus } };
  if (filtro === "CONCLUIDAS") return { status: "CONCLUIDA" as TarefaStatus };
  return {};
}

export async function listTarefas(input: ListTarefasInput, ctx: Ctx) {
  // "Comigo" = sou um dos responsáveis · "Deleguei" = eu pedi · "Equipe" = tudo (só gestão).
  let escopo: Record<string, unknown>;
  if (input.aba === "COMIGO") escopo = { responsaveis: { some: { userId: ctx.userId } } };
  else if (input.aba === "DELEGUEI") escopo = { criadoPorId: ctx.userId };
  else {
    if (!hasRoleLevel(ctx.role as never, "ADMIN"))
      throw new TRPCError({ code: "FORBIDDEN", message: "A visão da equipe é restrita a administradores." });
    escopo = {};
  }

  return prisma.tarefa.findMany({
    where: { deletedAt: null, ...escopo, ...whereFiltro(input.filtro) },
    include,
    // Abertas primeiro; entre elas, quem tem prazo mais próximo; depois as mais recentes.
    orderBy: [{ concluidaEm: "asc" }, { prazo: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

/**
 * Contadores para os selos das abas (o que está aberto em cada visão).
 *
 * ⚠️ "Da equipe" só é calculado para quem pode VER a aba (ADMIN+, mesma régua de
 * `listTarefas`) — sem isso o número apareceria para quem nunca abre essa visão, e um
 * funcionário veria uma contagem sobre tarefas que a própria lista recusa mostrar.
 */
export async function contarTarefas(ctx: Ctx) {
  const aberta = { deletedAt: null, status: { not: "CONCLUIDA" as TarefaStatus } };
  const [comigo, deleguei] = await Promise.all([
    prisma.tarefa.count({ where: { ...aberta, responsaveis: { some: { userId: ctx.userId } } } }),
    prisma.tarefa.count({ where: { ...aberta, criadoPorId: ctx.userId } }),
  ]);
  if (!hasRoleLevel(ctx.role as never, "ADMIN")) return { comigo, deleguei, equipe: 0, equipeAtrasadas: 0 };

  const [equipe, equipeAtrasadas] = await Promise.all([
    prisma.tarefa.count({ where: aberta }),
    prisma.tarefa.count({ where: { ...aberta, prazo: { lt: new Date() } } }),
  ]);
  return { comigo, deleguei, equipe, equipeAtrasadas };
}

/** Normaliza a lista de responsáveis: sem vazios/duplicados; vazio = só eu. */
export function normalizarResponsaveis(ids: string[] | undefined, ctx: Ctx): string[] {
  const limpos = [...new Set((ids ?? []).map((x) => x.trim()).filter(Boolean))];
  return limpos.length > 0 ? limpos : [ctx.userId];
}

async function tarefaComAcesso(id: string, ctx: Ctx, opts: { donoApenas?: boolean } = {}) {
  const tarefa = await prisma.tarefa.findFirst({
    where: { id, deletedAt: null },
    include: { responsaveis: { select: { userId: true } } },
  });
  if (!tarefa) throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada." });
  const admin = hasRoleLevel(ctx.role as never, "ADMIN");
  const ehDono = tarefa.criadoPorId === ctx.userId;
  const ehResponsavel = tarefa.responsaveis.some((r) => r.userId === ctx.userId);
  const permitido = opts.donoApenas ? ehDono || admin : ehDono || ehResponsavel || admin;
  if (!permitido) throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode alterar esta tarefa." });
  return tarefa;
}

/** Avisa cada responsável recém-atribuído (menos quem criou/você mesmo). */
export async function avisarDelegacao(tarefa: { id: string; titulo: string; criadoPorId: string }, paraIds: string[]) {
  const destinatarios = [...new Set(paraIds)].filter((uid) => uid !== tarefa.criadoPorId);
  if (destinatarios.length === 0) return;
  const dePor = await prisma.user.findUnique({ where: { id: tarefa.criadoPorId }, select: { nome: true } });
  await Promise.all(
    destinatarios.map((uid) =>
      notificar(
        uid,
        "tarefa_delegada",
        { tarefa: tarefa.titulo, dePor: dePor?.nome ?? "Alguém da equipe" },
        { entidadeTipo: "tarefa", entidadeId: tarefa.id },
      ),
    ),
  );
}

/** Avisa cada responsável de que o prazo da tarefa mudou (nunca avisa quem fez a própria mudança). */
async function avisarMudancaDePrazo(tarefa: { id: string; titulo: string; prazo: Date | null }, responsavelIds: string[], porUserId: string) {
  const destinatarios = [...new Set(responsavelIds)].filter((uid) => uid !== porUserId);
  if (destinatarios.length === 0) return;
  const prazo = tarefa.prazo ? tarefa.prazo.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "sem prazo";
  await Promise.all(
    destinatarios.map((uid) =>
      notificar(uid, "tarefa_prazo_alterado", { tarefa: tarefa.titulo, prazo }, { entidadeTipo: "tarefa", entidadeId: tarefa.id }),
    ),
  );
}

/** Avisa quem pediu de que a tarefa foi concluída (não avisa quando é você mesmo quem pediu). */
async function avisarConclusao(tarefa: { id: string; titulo: string; criadoPorId: string }, porUserId: string) {
  if (porUserId === tarefa.criadoPorId) return;
  const porQuem = await prisma.user.findUnique({ where: { id: porUserId }, select: { nome: true } });
  await notificar(
    tarefa.criadoPorId,
    "tarefa_concluida",
    { tarefa: tarefa.titulo, porQuem: porQuem?.nome ?? "O responsável" },
    { entidadeTipo: "tarefa", entidadeId: tarefa.id },
  );
}

/**
 * O `create` do Prisma, isolado — a ÚNICA montagem de uma tarefa nova nesta casa.
 *
 * ⚠️ **Existe porque há duas portas para criar tarefa, e a regra não pode morar nas duas.** A
 * humana é o `createTarefa` logo abaixo; a outra é a API do agente (CORA-003), que precisa
 * gravar **dentro da própria transação** para a reserva da chave de idempotência e a tarefa
 * entrarem ou não entrarem juntas. Duplicar a montagem seria o modo de falha da ADR-133: dois
 * lugares divergindo, e o segundo ficando para trás sem ninguém notar.
 *
 * Recebe o cliente do Prisma (`prisma` ou o cliente de uma transação) de propósito.
 */
export async function montarTarefa(
  db: Pick<typeof prisma, "tarefa">,
  dados: {
    titulo: string;
    descricao?: string | null;
    criadoPorId: string;
    prazo: Date | null;
    prioridade: CreateTarefaInput["prioridade"];
    clienteId?: string | null;
    projetoId?: string | null;
    responsavelIds: string[];
    /** Só a porta humana manda; a API do agente cria sempre tarefa avulsa. */
    recorrencia?: Recorrencia;
    recorrenciaAte?: Date | null;
  },
) {
  return db.tarefa.create({
    data: {
      titulo: dados.titulo.trim(),
      descricao: clean(dados.descricao),
      criadoPorId: dados.criadoPorId,
      prazo: dados.prazo,
      prioridade: dados.prioridade,
      clienteId: clean(dados.clienteId),
      projetoId: clean(dados.projetoId),
      responsaveis: { create: dados.responsavelIds.map((userId) => ({ userId })) },
      ...(dados.recorrencia && dados.recorrencia !== "NENHUMA"
        ? { recorrencia: dados.recorrencia, recorrenciaAte: dados.recorrenciaAte ?? null }
        : {}),
    },
    include,
  });
}

// ── Recorrência ───────────────────────────────────────────

/** Tarefa recorrente sem prazo não tem "próxima" — a série não teria de onde contar. */
function exigirPrazoSeRecorrente(recorrencia: Recorrencia, prazo: Date | null) {
  if (recorrencia !== "NENHUMA" && !prazo)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Para a tarefa se repetir, informe o prazo da primeira vez." });
}

/**
 * Prazo da próxima ocorrência. A data vem de `proximo` (Financeiro); a HORA do prazo original
 * é mantida — `proximo` devolve meia-noite UTC no mensal, e o prazo que chega pela API do agente
 * pode ter hora.
 */
export function proximoPrazoDaSerie(prazo: Date, recorrencia: Recorrencia, diaAncora: number): Date {
  const prox = proximo(prazo, recorrencia, diaAncora);
  prox.setUTCHours(prazo.getUTCHours(), prazo.getUTCMinutes(), prazo.getUTCSeconds(), prazo.getUTCMilliseconds());
  return prox;
}

type TarefaDaSerie = {
  id: string;
  titulo: string;
  descricao: string | null;
  criadoPorId: string;
  prazo: Date | null;
  prioridade: CreateTarefaInput["prioridade"];
  clienteId: string | null;
  projetoId: string | null;
  recorrencia: Recorrencia;
  recorrenciaAte: Date | null;
  recorrenteId: string | null;
  responsaveis: { userId: string }[];
};

/**
 * Ao CONCLUIR uma tarefa recorrente, cria a próxima ocorrência da série. Devolve o id da nova,
 * ou `null` quando não há o que criar.
 *
 * ⚠️ **IDEMPOTENTE, e quem garante é o índice único `(recorrenteId, prazo)`, não a leitura.**
 * Duas conclusões ao mesmo tempo passam as duas pela conferência abaixo; a segunda esbarra no
 * índice (`P2002`) e é lida como "alguém já criou" — o mesmo molde do Financeiro (ADR-92).
 *
 * ⚠️ **A série não empilha.** Se já existe ocorrência DEPOIS desta (viva ou excluída), não cria
 * nada: concluir, reabrir, mudar o prazo e concluir de novo não gera uma segunda "próxima"; e a
 * ocorrência que alguém excluiu de propósito não é recriada por outro caminho.
 */
export async function gerarProximaOcorrencia(tarefa: TarefaDaSerie): Promise<string | null> {
  if (tarefa.recorrencia === "NENHUMA" || !tarefa.prazo) return null;
  const serie = tarefa.recorrenteId ?? tarefa.id;

  // Âncora = dia do prazo da 1ª da série (se ela sumiu, o da própria tarefa).
  const origem = tarefa.recorrenteId
    ? await prisma.tarefa.findUnique({ where: { id: tarefa.recorrenteId }, select: { prazo: true } })
    : null;
  const diaAncora = (origem?.prazo ?? tarefa.prazo).getUTCDate();

  const prazo = proximoPrazoDaSerie(tarefa.prazo, tarefa.recorrencia, diaAncora);
  if (tarefa.recorrenciaAte && prazo > tarefa.recorrenciaAte) return null; // fim da série.

  const adiante = await prisma.tarefa.findFirst({
    where: { recorrenteId: serie, prazo: { gt: tarefa.prazo } },
    select: { id: true },
  });
  if (adiante) return null;

  try {
    const nova = await prisma.tarefa.create({
      data: {
        titulo: tarefa.titulo,
        descricao: tarefa.descricao,
        criadoPorId: tarefa.criadoPorId,
        prazo,
        prioridade: tarefa.prioridade,
        clienteId: tarefa.clienteId,
        projetoId: tarefa.projetoId,
        recorrencia: tarefa.recorrencia,
        recorrenciaAte: tarefa.recorrenciaAte,
        recorrenteId: serie,
        responsaveis: { create: [...new Set(tarefa.responsaveis.map((r) => r.userId))].map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    return nova.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null; // já existe.
    throw e;
  }
}

/** A tarefa da série trocou de prazo para um já ocupado por outra ocorrência da mesma série. */
function traduzirColisaoDePrazo(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    throw new TRPCError({ code: "CONFLICT", message: "Já existe outra ocorrência desta tarefa recorrente com esse prazo." });
  throw e;
}

/** O que a tela e o router mandam; os campos de recorrência podem faltar (ex.: testes antigos). */
type NovaTarefa = Omit<CreateTarefaInput, "recorrencia" | "recorrenciaAte"> &
  Partial<Pick<CreateTarefaInput, "recorrencia" | "recorrenciaAte">>;

export async function createTarefa(input: NovaTarefa, ctx: Ctx) {
  const responsaveis = normalizarResponsaveis(input.responsavelIds, ctx);
  const recorrencia = input.recorrencia ?? "NENHUMA";
  exigirPrazoSeRecorrente(recorrencia, input.prazo ?? null);
  const tarefa = await montarTarefa(prisma, {
    titulo: input.titulo,
    descricao: input.descricao,
    criadoPorId: ctx.userId,
    prazo: input.prazo ?? null,
    prioridade: input.prioridade,
    clienteId: input.clienteId,
    projetoId: input.projetoId,
    responsavelIds: responsaveis,
    recorrencia,
    recorrenciaAte: input.recorrenciaAte ?? null,
  });
  await avisarDelegacao(tarefa, responsaveis);
  return tarefa;
}

export async function updateTarefa(input: UpdateTarefaInput, ctx: Ctx) {
  const atual = await tarefaComAcesso(input.id, ctx);
  const idsAntes = atual.responsaveis.map((r) => r.userId);
  const trocaResponsaveis = input.responsavelIds !== undefined;
  const novosIds = trocaResponsaveis ? normalizarResponsaveis(input.responsavelIds, ctx) : idsAntes;

  // Prazo mudou? Compara ANTES × DEPOIS (null-safe) — só dispara aviso quando o valor de fato muda.
  const prazoAntes = atual.prazo ? atual.prazo.getTime() : null;
  const prazoDepois = input.prazo !== undefined ? (input.prazo ? input.prazo.getTime() : null) : prazoAntes;
  const prazoMudou = input.prazo !== undefined && prazoAntes !== prazoDepois;

  // Recorrência: a conferência olha o ANTES + o DEPOIS — a edição é parcial, e tirar só o prazo
  // de uma tarefa que já se repete também deixaria a série sem de onde contar.
  const recorrenciaDepois = input.recorrencia ?? atual.recorrencia;
  exigirPrazoSeRecorrente(recorrenciaDepois, prazoDepois === null ? null : new Date(prazoDepois));

  // Concluir grava a data; reabrir limpa.
  let concluidaEm = atual.concluidaEm;
  if (input.status && input.status !== atual.status) {
    concluidaEm = input.status === "CONCLUIDA" ? new Date() : null;
  }

  const tarefa = await prisma.tarefa
    .update({
      where: { id: input.id },
      data: {
        ...(input.titulo !== undefined ? { titulo: input.titulo.trim() } : {}),
        ...(input.descricao !== undefined ? { descricao: clean(input.descricao) } : {}),
        ...(input.prazo !== undefined ? { prazo: input.prazo ?? null } : {}),
        ...(input.prioridade !== undefined ? { prioridade: input.prioridade } : {}),
        ...(input.clienteId !== undefined ? { clienteId: clean(input.clienteId) } : {}),
        ...(input.projetoId !== undefined ? { projetoId: clean(input.projetoId) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.recorrencia !== undefined ? { recorrencia: input.recorrencia } : {}),
        // Sem repetição, a data de fim não significa nada: some junto.
        ...(recorrenciaDepois === "NENHUMA"
          ? { recorrenciaAte: null }
          : input.recorrenciaAte !== undefined
            ? { recorrenciaAte: input.recorrenciaAte ?? null }
            : {}),
        concluidaEm,
        ...(trocaResponsaveis ? { responsaveis: { deleteMany: {}, create: novosIds.map((userId) => ({ userId })) } } : {}),
      },
      include,
    })
    .catch(traduzirColisaoDePrazo);

  // Avisa só os responsáveis recém-adicionados; avisa quem pediu se acabou de concluir.
  if (trocaResponsaveis) {
    const adicionados = novosIds.filter((uid) => !idsAntes.includes(uid));
    await avisarDelegacao(tarefa, adicionados);
  }
  if (input.status === "CONCLUIDA" && atual.status !== "CONCLUIDA") {
    await avisarConclusao(tarefa, ctx.userId);
    await gerarProximaOcorrencia(tarefa);
  }
  if (prazoMudou) await avisarMudancaDePrazo(tarefa, novosIds, ctx.userId);
  return tarefa;
}

export async function setStatus(id: string, status: TarefaStatus, ctx: Ctx) {
  const atual = await tarefaComAcesso(id, ctx);
  const tarefa = await prisma.tarefa.update({
    where: { id },
    data: { status, concluidaEm: status === "CONCLUIDA" ? new Date() : null },
    include,
  });
  if (status === "CONCLUIDA" && atual.status !== "CONCLUIDA") {
    await avisarConclusao(tarefa, ctx.userId);
    await gerarProximaOcorrencia(tarefa);
  }
  return tarefa;
}

export async function removeTarefa(id: string, ctx: Ctx) {
  await tarefaComAcesso(id, ctx, { donoApenas: true });
  await prisma.tarefa.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
