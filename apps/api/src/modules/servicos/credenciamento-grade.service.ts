import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import { notificar } from "../notificacoes/notificacoes.service.js";
import { equipeDoCliente } from "../arquivos/arquivos.service.js";
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
 *
 * E mostra também o médico DESATIVADO que ainda tem cruzamento registrado. `removerProfissional`
 * desativa em vez de apagar justamente para preservar o andamento e o elo com a cobrança —
 * mas, listando só os ativos, a grade fazia o contrário do pretendido: o médico saía da tela e
 * levava junto os processos dele, inclusive um APROVADO cuja conta a receber continuava no
 * Financeiro sem nada na ficha que a explicasse. Vem com `ativo: false` para quem desenha
 * saber a diferença: o card de andamento mostra (é trabalho em curso), o construtor da
 * proposta não oferece (não se vende credenciamento novo de quem saiu da lista).
 */
export async function gradeDoCliente(clienteId: string) {
  const [profissionais, operadoras, linhas] = await Promise.all([
    prisma.profissional.findMany({
      where: { clienteId, OR: [{ ativo: true }, { credenciamentos: { some: {} } }] },
      orderBy: [{ ativo: "desc" }, { nome: "asc" }],
      select: {
        id: true,
        nome: true,
        especialidade: true,
        conselho: true,
        conselhoNumero: true,
        conselhoUf: true,
        ativo: true,
      },
    }),
    // Só as operadoras marcadas para CREDENCIAMENTO (ADR-126) — mais as que já têm processo
    // deste cliente, mesmo desmarcadas depois. É a mesma lição da ADR-105: filtrar por uma
    // marcação atual apagaria da tela o que foi preservado de propósito.
    prisma.operadora.findMany({
      where: { OR: [{ usoCredenciamento: true }, { credenciamentos: { some: { clienteId } } }] },
      orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      select: { id: true, nome: true },
    }),
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
 *
 * ⚠️ `somenteOperadorasDaGrade` existe porque há DUAS portas para cá, com significados opostos:
 *
 * - A **grade da ficha** manda o cliente inteiro. Ali, par ausente = desmarcado de propósito,
 *   e apagar é o comportamento certo.
 * - O **construtor da proposta** manda uma operadora só (ADR-126: cada proposta de
 *   credenciamento é de UMA operadora). Ali, par ausente quase sempre quer dizer "é de outra
 *   proposta", não "foi desmarcado" — e apagar levava embora, em silêncio, todo cruzamento
 *   `A_PROTOCOLAR` das operadoras anteriores no dia em que a Thaís emitisse a 2ª proposta.
 *
 * Com a marca ligada, a remoção fica confinada às operadoras que vieram na carga.
 */
export async function salvarGrade(
  input: {
    clienteId: string;
    celulas: CelulaGrade[];
    documentoId?: string | null;
    somenteOperadorasDaGrade?: boolean;
  },
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

  // Fora do alcance desta carga: quando ela cobre uma operadora só, o que é de outra operadora
  // não foi "desmarcado" — nem estava em jogo.
  const operadorasEmJogo = new Set(input.celulas.map((c) => c.operadoraId));

  // Desmarcado na tela: só some quem nunca foi protocolado.
  for (const [par, vigente] of vigentePorPar) {
    if (marcados.has(par)) continue;
    if (input.somenteOperadorasDaGrade && !operadorasEmJogo.has(vigente.operadoraId)) {
      preservados++;
      continue;
    }
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

  // AQUI nasce a cobrança — e só aqui (§3.3, §6.3). O honorário do credenciamento é no
  // sucesso: nem o aceite da proposta, nem contratar o serviço na ficha, nem converter o lead
  // geram conta. A operadora aprovou; agora há o que cobrar.
  if (input.status === "APROVADO" && !atual.contaId) {
    await criarContaDoHonorario(atualizado.id, atual.clienteId, Number(atual.valor), ator);
  }

  await prisma.activityLog.create({
    data: {
      userId: ator.id,
      acao: "credenciamento.status",
      entidadeTipo: "cliente",
      entidadeId: atual.clienteId,
      dados: { credenciamentoId: input.id, de, para: input.status },
    },
  });

  // Aprovação e negativa são os dois desfechos que mudam dinheiro e conduta — e até aqui só
  // existiam no `activityLog` (que ninguém abre) e no toast de quem clicou. Quem cuida do
  // Financeiro, ou o responsável que não estava com a tela aberta, não ficava sabendo.
  // Best-effort: o aviso não pode derrubar a mudança de estado, que já está gravada.
  if (input.status === "APROVADO" || input.status === "NEGADO") {
    await avisarEquipeDoDesfecho(atual.clienteId, input.id, input.status, motivoNegativa).catch(() => {});
  }

  // Relê para devolver o `contaId` recém-gravado — a tela mostra "conta criada" a partir dele.
  return paraCelula((await prisma.credenciamento.findUnique({ where: { id: input.id } })) ?? atualizado);
}

/**
 * Avisa quem cuida do cliente que a operadora respondeu. Mesmos destinatários de qualquer
 * outro fato do cliente (responsável + gestão), pelo mesmo caminho — notificação interna e,
 * para quem deixou ligado, e-mail.
 */
async function avisarEquipeDoDesfecho(
  clienteId: string,
  credenciamentoId: string,
  status: "APROVADO" | "NEGADO",
  motivo: string,
) {
  const [cliente, celula] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } }),
    prisma.credenciamento.findUnique({
      where: { id: credenciamentoId },
      select: { valor: true, profissional: { select: { nome: true } }, operadora: { select: { nome: true } } },
    }),
  ]);

  const vars: Record<string, string> =
    status === "APROVADO"
      ? {
          cliente: cliente?.nome ?? "Cliente",
          profissional: celula?.profissional.nome ?? "o profissional",
          operadora: celula?.operadora.nome ?? "a operadora",
          valor: Number(celula?.valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
        }
      : {
          cliente: cliente?.nome ?? "Cliente",
          profissional: celula?.profissional.nome ?? "o profissional",
          operadora: celula?.operadora.nome ?? "a operadora",
          motivo: motivo || "não informado",
        };

  const destinos = await equipeDoCliente(clienteId);
  for (const uid of destinos) {
    await notificar(uid, status === "APROVADO" ? "credenciamento_aprovado" : "credenciamento_negado", vars, {
      entidadeTipo: "cliente",
      entidadeId: clienteId,
    }).catch(() => {});
  }
}

/**
 * A conta a receber do honorário aprovado. Nasce PENDENTE, com 30 dias de vencimento e o
 * valor exato da célula — a Thaís revisa data e valor no Financeiro como em qualquer outra.
 *
 * Não é best-effort: se a cobrança falhar, a aprovação **também** falha. Um credenciamento
 * marcado como aprovado sem a conta correspondente é dinheiro que ninguém vai cobrar, e
 * ninguém descobre — o erro visível na hora custa muito menos que a receita perdida em
 * silêncio.
 */
async function criarContaDoHonorario(credenciamentoId: string, clienteId: string, valor: number, ator: { id: string }) {
  const [cliente, celula] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } }),
    prisma.credenciamento.findUnique({
      where: { id: credenciamentoId },
      select: { profissional: { select: { nome: true } }, operadora: { select: { nome: true } }, tentativa: true },
    }),
  ]);

  const vencimento = new Date();
  vencimento.setDate(vencimento.getDate() + 30);
  vencimento.setHours(12, 0, 0, 0);

  const quem = celula?.profissional.nome ?? "profissional";
  const onde = celula?.operadora.nome ?? "operadora";

  const conta = await prisma.conta.create({
    data: {
      tipo: "RECEBER",
      escopo: "EMPRESA",
      descricao: `Credenciamento aprovado: ${quem} — ${onde}`,
      valor,
      vencimento,
      clienteId,
      observacoes: `Honorário no sucesso: a operadora ${onde} aprovou o credenciamento de ${quem}${
        (celula?.tentativa ?? 1) > 1 ? ` (${celula!.tentativa}ª tentativa)` : ""
      }. Cliente: ${cliente?.nome ?? "—"}. Revise o vencimento.`,
    },
  });

  await prisma.credenciamento.update({ where: { id: credenciamentoId }, data: { contaId: conta.id } });
  await prisma.activityLog.create({
    data: {
      userId: ator.id,
      acao: "conta.criada",
      entidadeTipo: "cliente",
      entidadeId: clienteId,
      dados: { origem: "credenciamento_aprovado", credenciamentoId, contaId: conta.id },
    },
  });
  return conta;
}

/**
 * Abre a 2ª (ou 3ª…) tentativa daquele par — o "salvo acordo expresso" do §3.4. É ação
 * deliberada e exige o motivo do acordo: sem isso, uma negativa viraria retentativa
 * automática, e a operadora que já disse não receberia o mesmo processo de novo.
 *
 * A linha anterior fica intacta, com a negativa e a data. A nova nasce `A_PROTOCOLAR`, com o
 * valor da anterior como ponto de partida (editável na grade).
 *
 * ⚠️ A NOVA TENTATIVA NÃO HERDA `contaId`, E ISSO É DELIBERADO (ADR-141, decisão do dono).
 * O honorário nasce na APROVAÇÃO (ADR-104), então o ciclo aprovado → encerrado → reaberto →
 * aprovado gera uma SEGUNDA conta a receber pelo mesmo par médico × operadora. Está certo: a
 * proposta real da Thaís cobra "somente no sucesso" e "após 1 (uma) tentativa", e tentativa
 * nova é trabalho novo. O que faltava era AVISAR — a faixa âmbar de `CredenciamentoGradeCard`
 * aparece antes do clique quando a anterior já cobrou. Quem for "consertar" isto herdando a
 * conta estará dando de graça o segundo credenciamento.
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
