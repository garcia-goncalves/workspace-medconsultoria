import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { notificar } from "../notificacoes/notificacoes.service.js";
import { enviarEmailTemplate } from "../emails/enviados.service.js";
import { equipeDoCliente } from "../arquivos/arquivos.service.js";
import { seedRequisitosSeVazio } from "./servicos.service.js";
import { ehServicoDeCredenciamento, sincronizarRequisitosCredenciamento } from "./credenciamento.service.js";
import { garantirCardDoServicoContratado } from "../projetos/projetos.service.js";
import { garantirAcessoPortal } from "../usuarios/usuarios.service.js";
import { config } from "../../config.js";
import { emReais, emReaisOu } from "../../lib/dinheiro.js";
import { hojeBRT } from "../../lib/datas.js";
import { planejarEncerramentoDaCobranca, type PlanoDeEncerramento } from "./encerrar-cobranca.js";
import { temValorEPercentual, PRECO_VALOR_E_PERCENTUAL } from "@app/shared";

/**
 * Visão agregada dos serviços de um cliente (ficha): o catálogo ativo, com o status
 * contratado, as exigências (requisitos) de cada um e os arquivos que atendem cada
 * exigência (+ pendências dos obrigatórios). É a base do card "Serviços contratados".
 */
export async function servicosDoCliente(clienteId: string) {
  await seedRequisitosSeVazio();
  // Faz a lista real do credenciamento convergir sem passo manual (idempotente, uma vez
  // por processo). Best-effort: se falhar, a ficha continua abrindo.
  await sincronizarRequisitosCredenciamento().catch(() => {});
  const [servicos, contratacoes, arquivos, respostas] = await Promise.all([
    prisma.servico.findMany({
      where: { ativo: true },
      orderBy: { ordem: "asc" },
      include: { requisitos: { orderBy: { ordem: "asc" } } },
    }),
    prisma.clienteServico.findMany({
      where: { clienteId },
      // Os convênios que o cliente atende NAQUELE serviço (ADR-126). Vêm com a ficha porque é
      // ali que a Thaís os corrige — a lista muda com o tempo e é dado do cliente, não do
      // documento que a originou.
      include: { operadoras: { orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } } },
    }),
    prisma.arquivo.findMany({
      where: { clienteId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, nome: true, tamanho: true, mimetype: true, servicoId: true, requisitoId: true, enviadoPorTipo: true, createdAt: true },
    }),
    prisma.formularioResposta.findMany({ where: { clienteId }, select: { id: true, requisitoId: true, status: true } }),
  ]);

  return servicos.map((s) => {
    const c = contratacoes.find((x) => x.servicoId === s.id);
    const requisitos = s.requisitos.map((r) => {
      const arqs = arquivos.filter((a) => a.requisitoId === r.id);
      const resp = respostas.find((x) => x.requisitoId === r.id);
      // DOCUMENTO exige arquivo; INFORMACAO/BRIEFING exigem uma resposta enviada.
      const atendido = r.tipo === "DOCUMENTO" ? arqs.length > 0 : resp?.status === "ENVIADO";
      return {
        id: r.id,
        titulo: r.titulo,
        descricao: r.descricao,
        tipo: r.tipo,
        obrigatorio: r.obrigatorio,
        // Credenciamento (ADR-103): escopo preenchido = a exigência pertence à lista
        // agrupada por médico, que tem tela própria.
        escopo: r.escopo,
        frenteVerso: r.frenteVerso,
        atendido,
        arquivos: arqs,
        respostaId: resp?.id ?? null,
        respostaStatus: resp?.status ?? null,
      };
    });
    const arquivosAvulsos = arquivos.filter((a) => a.servicoId === s.id && !a.requisitoId);
    const obrigatorios = requisitos.filter((r) => r.obrigatorio);
    const pendentes = obrigatorios.filter((r) => !r.atendido).length;
    return {
      // `percentual` vai junto para a ficha saber que este serviço é cobrado por percentual
      // mesmo quando a contratação ainda não tem o número gravado (ADR-125). Decimal para
      // aqui, nunca atravessa o tRPC (ADR-118).
      servico: {
        id: s.id,
        nome: s.nome,
        descricao: s.descricao,
        categoria: s.categoria,
        percentual: emReais(s.percentual),
      },
      contratado: c?.status === "ATIVO",
      contratacao: c
        ? {
            status: c.status,
            origem: c.origem,
            valor: emReais(c.valor),
            valorRecorrencia: c.valorRecorrencia,
            percentual: emReais(c.percentual),
            percentualRecorrencia: c.percentualRecorrencia,
            contratadoEm: c.contratadoEm,
            canceladoEm: c.canceladoEm,
            canceladoPorTipo: c.canceladoPorTipo,
            convenios: c.operadoras,
          }
        : null,
      requisitos,
      arquivosAvulsos,
      totalObrigatorios: obrigatorios.length,
      pendentes,
    };
  });
}

/**
 * A CONVERSÃO DO LEAD AINDA VAI COBRAR POR ESTE CLIENTE?
 *
 * É a guarda contra cobrar duas vezes, e ela é **uma só** para todas as portas que provisionam
 * cobrança fora da conversão (contratar pela ficha, aceitar proposta de upsell). Havendo lead não
 * convertido e não perdido, quem cobra é a conversão, que soma os serviços contratados; sem lead
 * ativo, a porta que está sendo usada é a única que sobrou e precisa cobrar — senão ninguém cobra.
 *
 * Lead **convertido** e lead **perdido** não seguram nada: o primeiro já cobrou, o segundo nunca
 * vai converter.
 */
async function aConversaoAindaVaiCobrar(clienteId: string): Promise<boolean> {
  const leadAtivo = await prisma.lead.findFirst({
    where: { clienteId, deletedAt: null, convertidoEmClienteId: null, perdidoEm: null },
    select: { id: true },
  });
  return leadAtivo !== null;
}

/**
 * O SUFIXO DA DESCRIÇÃO DA COBRANÇA DAQUELE SERVIÇO — num lugar só.
 *
 * Há DUAS portas que criam a conta a receber de um serviço (contratar pela ficha e aceitar a
 * proposta) e agora uma TERCEIRA que precisa reencontrá-la para encerrá-la no cancelamento.
 * Cada uma montava a frase por conta própria; a que procura tem de casar exatamente com as
 * que escrevem, senão o cancelamento não acha nada e continua cobrando em silêncio.
 */
export function sufixoDaCobrancaDoServico(servicoNome: string, clienteNome: string): string {
  return `${servicoNome} — ${clienteNome}`;
}

/**
 * Levanta a cobrança recorrente daquele serviço e diz o que para e o que fica.
 *
 * Usada pela PRÉVIA (o texto da confirmação na tela) e pelo próprio cancelamento — a mesma
 * consulta e a mesma régua, para o número prometido ser o número executado.
 */
async function levantarCobrancaDoServico(clienteId: string, servicoId: string): Promise<PlanoDeEncerramento> {
  const [cliente, servico] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } }),
    prisma.servico.findUnique({ where: { id: servicoId }, select: { nome: true } }),
  ]);
  if (!cliente || !servico) return { series: [], encerrar: [], mantidas: [], valorEncerrado: 0 };

  const contas = await prisma.conta.findMany({
    where: {
      clienteId,
      tipo: "RECEBER",
      deletedAt: null,
      descricao: { endsWith: sufixoDaCobrancaDoServico(servico.nome, cliente.nome) },
    },
    select: { id: true, vencimento: true, pago: true, valor: true, recorrencia: true, recorrenteId: true },
  });

  return planejarEncerramentoDaCobranca(
    contas.map((c) => ({ ...c, valor: emReaisOu(c.valor) })),
    hojeBRT(),
  );
}

/**
 * O que a tela precisa dizer ANTES do clique. Confirmação que esconde consequência de
 * dinheiro é como se instala desconfiança no sistema — quem cancela tem de ver quantas
 * parcelas futuras vão parar e que as vencidas continuam.
 */
export async function previaDoCancelamento(clienteId: string, servicoId: string) {
  const plano = await levantarCobrancaDoServico(clienteId, servicoId);
  return {
    parcelasFuturas: plano.encerrar.length,
    valorFuturo: plano.valorEncerrado,
    parcelasVencidas: plano.mantidas.length,
  };
}

/** Liga (contrata) um serviço para o cliente — pela equipe (origem MANUAL). Idempotente. */
export async function ativarServicoCliente(
  clienteId: string,
  servicoId: string,
  opts: { valor?: number | null; observacao?: string | null; avisarCliente?: boolean; origem?: "MANUAL" | "FUNIL" },
  ator: { id: string },
) {
  // Ao contratar, herda a precificação de referência do serviço (editável depois na ficha).
  const servico = await prisma.servico.findUnique({
    where: { id: servicoId },
    select: { nome: true, valor: true, valorRecorrencia: true, percentual: true, percentualRecorrencia: true },
  });
  const jaContratado = await prisma.clienteServico.findUnique({
    where: { clienteId_servicoId: { clienteId, servicoId } },
    select: { id: true },
  });
  const cs = await prisma.clienteServico.upsert({
    where: { clienteId_servicoId: { clienteId, servicoId } },
    update: { status: "ATIVO", canceladoEm: null, canceladoPorTipo: null, valor: opts.valor ?? undefined, observacao: opts.observacao ?? undefined },
    create: {
      clienteId,
      servicoId,
      status: "ATIVO",
      origem: opts.origem ?? "MANUAL",
      valor: opts.valor ?? servico?.valor ?? null,
      valorRecorrencia: servico?.valorRecorrencia ?? "AVULSO",
      percentual: servico?.percentual ?? null,
      percentualRecorrencia: servico?.percentualRecorrencia ?? "MENSAL",
      observacao: opts.observacao ?? null,
    },
  });
  await prisma.activityLog.create({
    data: { userId: ator.id, acao: "servico.contratado", entidadeTipo: "cliente", entidadeId: clienteId, dados: { servicoId } },
  });

  // Automação: gera o cartão do serviço no projeto do cliente, com checklist (entregas do
  // cliente + passos do serviço). Best-effort — não bloqueia a contratação.
  const projetoId = await garantirCardDoServicoContratado(clienteId, servicoId, servico?.nome ?? "Serviço", ator.id).catch(() => null);
  // Reativar um serviço cancelado volta o projeto de PAUSADO para ATIVO (trabalho novo em andamento).
  if (projetoId) {
    await prisma.projeto
      .updateMany({ where: { id: projetoId, status: "PAUSADO", deletedAt: null }, data: { status: "ATIVO" } })
      .catch(() => {});
  }

  // GAP 3 — provisiona a COBRANÇA no Financeiro quando é uma contratação NOVA pela equipe
  // (a conversão do lead já cria a cobrança agregada; aqui é o upsell/serviço avulso da ficha).
  // Best-effort e só uma vez (contratação nova + origem MANUAL + valor de referência).
  //
  // O CREDENCIAMENTO fica de fora: nele o honorário é no sucesso, e a conta a receber nasce
  // quando a operadora aprova (ADR-104). Contratar é o começo do trabalho, não o fim dele —
  // cobrar aqui adiantaria dinheiro que a proposta promete não adiantar.
  //
  // ⚠️ **O VALOR É O DA LINHA CONTRATADA, NUNCA O DO CATÁLOGO (ADR-137).** Quem contrata pela
  // ficha pode combinar outro preço (`opts.valor`), e a conta saía pelo preço de tabela: a ficha
  // dizendo R$ 2.500 e o Financeiro cobrando R$ 3.500, sem nada explicando a diferença. Pior, a
  // guarda olhava o preço de catálogo — serviço sem preço de tabela, contratado por um valor
  // combinado, não gerava conta NENHUMA e o dinheiro simplesmente não era cobrado. Ler de `cs`,
  // que é a linha que a ficha mostra, faz os dois números baterem por construção.
  //
  // ⚠️ **E A CONVERSÃO DO LEAD NÃO PODE COBRAR O MESMO SERVIÇO DE NOVO (M1).** Todo lead tem um
  // `Cliente` PROSPECT por trás (ADR-132), e a ficha desse prospect já deixa contratar. Quem
  // contratava ali gerava a conta aqui, e a conversão — que provisiona a partir dos serviços
  // contratados — gerava a segunda. Eram DUAS PORTAS para o mesmo dinheiro, e só uma conhecia a
  // regra. A guarda é a MESMA de `provisionarUpsellAceito`, chamada de propósito: inventar uma
  // segunda régua para a mesma pergunta é como as duas respostas começam a divergir.
  const valorContratado = emReaisOu(cs.valor);
  if (
    !jaContratado &&
    (opts.origem ?? "MANUAL") === "MANUAL" &&
    !ehServicoDeCredenciamento(servico?.nome) &&
    valorContratado > 0 &&
    !(await aConversaoAindaVaiCobrar(clienteId))
  ) {
    try {
      const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } });
      const vencimento = new Date();
      vencimento.setDate(vencimento.getDate() + 30);
      vencimento.setHours(12, 0, 0, 0);
      const mensal = cs.valorRecorrencia === "MENSAL";
      await prisma.conta.create({
        data: {
          tipo: "RECEBER",
          descricao: `${mensal ? "Mensalidade" : "Serviço"}: ${sufixoDaCobrancaDoServico(servico?.nome ?? "Serviço", cliente?.nome ?? "cliente")}`,
          valor: valorContratado,
          vencimento,
          clienteId,
          recorrencia: mensal ? "MENSAL" : "NENHUMA",
          observacoes: "Provisionado ao contratar o serviço pela ficha do cliente. Revise o valor e o vencimento.",
        },
      });
      await prisma.activityLog.create({
        data: { userId: ator.id, acao: "conta.criada", entidadeTipo: "cliente", entidadeId: clienteId, dados: { origem: "contratou_servico", servicoId } },
      });
    } catch {
      /* provisão financeira é best-effort — não bloqueia a contratação */
    }
  }

  if (opts.avisarCliente) {
    const [cliente, servico] = await Promise.all([
      prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, email: true } }),
      prisma.servico.findUnique({ where: { id: servicoId }, select: { nome: true } }),
    ]);
    if (cliente?.email) {
      // Garante que o cliente TENHA acesso ao Portal antes de convidá-lo a acessá-lo (idempotente).
      // ⚠️ Origem EQUIPE (ADR-128): quem contratou o serviço foi alguém da casa, então a conta
      // nasce SEM e-mail de convite. O aviso que sai daqui é o "serviço ativado", que a pessoa
      // pediu explicitamente ao marcar `avisarCliente` — não o convite de acesso, que sairia
      // sozinho por um caminho que não tem caixa de confirmação nenhuma.
      await garantirAcessoPortal(clienteId, cliente.nome, cliente.email, "EQUIPE").catch(() => {});
      void enviarEmailTemplate("servico_ativado", cliente.email, {
        nome: cliente.nome,
        servico: servico?.nome ?? "serviço",
        link: config.WEB_ORIGIN,
      }).catch(() => {});
    }
  }
  // Dinheiro sai em número, nunca em Decimal (ADR-118) — a resposta desta mutation vai
  // direto para a tela (e, no cancelamento, também para o Portal do cliente).
  return { ...cs, valor: emReais(cs.valor), percentual: emReais(cs.percentual) };
}

/**
 * Sincroniza os serviços ACEITOS numa proposta com os serviços contratados do cliente
 * (ClienteServico), gravando os valores aceitos. Chamado no aceite da proposta — assim o
 * contrato, o recibo e a ficha refletem exatamente o que o cliente aceitou. Idempotente
 * (upsert por cliente+serviço). NÃO cria cobrança aqui (a conversão do lead cria a conta
 * agregada) para não duplicar faturamento. Ver ADR-81.
 */
export async function sincronizarServicosContratados(
  clienteId: string,
  itens: {
    servicoId: string;
    valor?: number | null;
    recorrencia?: "AVULSO" | "MENSAL";
    percentual?: number | null;
    /** Convênios que o cliente atende neste serviço (ADR-126) — vêm dentro do item aceito. */
    conveniosIds?: string[];
  }[],
  ator: { id: string },
) {
  for (const it of itens) {
    if (!it.servicoId) continue;
    // A lista de convênios aceita SUBSTITUI a anterior (`set`), não soma: o cliente que deixou
    // de atender um convênio precisa vê-lo sair da ficha. Item sem convênio nenhum não mexe no
    // que já está lá — proposta de outro serviço não pode zerar esta lista de passagem.
    const convenios = it.conveniosIds?.length ? { set: it.conveniosIds.map((id) => ({ id })) } : undefined;
    await prisma.clienteServico.upsert({
      where: { clienteId_servicoId: { clienteId, servicoId: it.servicoId } },
      update: {
        status: "ATIVO",
        canceladoEm: null,
        canceladoPorTipo: null,
        valor: it.valor ?? undefined,
        valorRecorrencia: it.recorrencia ?? undefined,
        percentual: it.percentual ?? undefined,
        ...(convenios ? { operadoras: convenios } : {}),
      },
      create: {
        clienteId,
        servicoId: it.servicoId,
        status: "ATIVO",
        origem: "FUNIL",
        valor: it.valor ?? null,
        valorRecorrencia: it.recorrencia ?? "AVULSO",
        percentual: it.percentual ?? null,
        ...(it.conveniosIds?.length ? { operadoras: { connect: it.conveniosIds.map((id) => ({ id })) } } : {}),
      },
    });
  }
  await prisma.activityLog
    .create({ data: { userId: ator.id, acao: "servico.sincronizado_aceite", entidadeTipo: "cliente", entidadeId: clienteId, dados: { qtd: itens.length } } })
    .catch(() => {});

  await provisionarUpsellAceito(clienteId, itens, ator);
}

/**
 * O UPSELL ACEITO PRECISA VIRAR CONTA A RECEBER — E ATÉ AQUI NÃO VIRAVA.
 *
 * Há três portas para um serviço passar a valer, e duas delas já cobravam:
 *
 * 1. **Conversão do lead** — provisiona a cobrança agregada (`leads.service`).
 * 2. **Contratar pela ficha** — provisiona ali mesmo (`contratarServicoCliente`, acima).
 * 3. **Proposta aceita pelo cliente** — sincronizava o serviço, gerava o contrato… e parava.
 *
 * Para quem AINDA é lead, a porta 3 desemboca na 1: a conversão vem logo atrás e cobra. Mas o
 * cliente **já convertido** que aceita uma proposta nova (o upsell — que é justamente o que a
 * Med mais quer vender) não passa por conversão nenhuma. Resultado: serviço ativo na ficha,
 * contrato gerado, projeto aberto, trabalho começando — e **nada no Financeiro**. O buraco só
 * apareceria meses depois, se alguém cruzasse a ficha com as contas.
 *
 * ⚠️ **A guarda contra cobrar duas vezes é o LEAD ATIVO.** Havendo lead não convertido para este
 * cliente, quem cobra é a conversão, e aqui não se toca em dinheiro. Sem lead ativo, esta é a
 * única porta que sobrou.
 *
 * As demais regras são as MESMAS da contratação pela ficha, de propósito — credenciamento fora
 * (o honorário nasce na aprovação da operadora, ADR-104), serviço só-percentual fora (não há
 * valor a lançar antes de apurar o faturamento do mês), e o valor é o **aceito**, nunca o de
 * catálogo (ADR-137).
 */
async function provisionarUpsellAceito(
  clienteId: string,
  itens: { servicoId: string; valor?: number | null; recorrencia?: "AVULSO" | "MENSAL" }[],
  ator: { id: string },
) {
  try {
    if (await aConversaoAindaVaiCobrar(clienteId)) return; // a conversão cobra; aqui seria a 2ª vez.

    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } });

    for (const it of itens) {
      if (!it.servicoId) continue;
      const valor = it.valor ?? 0;
      if (valor <= 0) continue; // só-percentual ou "a combinar": não há número a lançar hoje.

      const servico = await prisma.servico.findUnique({
        where: { id: it.servicoId },
        select: { nome: true },
      });
      if (ehServicoDeCredenciamento(servico?.nome)) continue;

      // Já existe conta deste serviço para este cliente? Reaceitar a mesma proposta (ou aceitar
      // duas que repetem um serviço) não pode lançar a cobrança de novo.
      const descricaoBase = sufixoDaCobrancaDoServico(servico?.nome ?? "Serviço", cliente?.nome ?? "cliente");
      const jaTem = await prisma.conta.count({
        where: { clienteId, tipo: "RECEBER", deletedAt: null, descricao: { endsWith: descricaoBase } },
      });
      if (jaTem > 0) continue;

      const vencimento = new Date();
      vencimento.setDate(vencimento.getDate() + 30);
      vencimento.setHours(12, 0, 0, 0);
      const mensal = it.recorrencia === "MENSAL";
      await prisma.conta.create({
        data: {
          tipo: "RECEBER",
          descricao: `${mensal ? "Mensalidade" : "Serviço"}: ${descricaoBase}`,
          valor,
          vencimento,
          clienteId,
          recorrencia: mensal ? "MENSAL" : "NENHUMA",
          observacoes: "Provisionado quando o cliente aceitou a proposta. Revise o valor e o vencimento.",
        },
      });
      await prisma.activityLog.create({
        data: {
          userId: ator.id,
          acao: "conta.criada",
          entidadeTipo: "cliente",
          entidadeId: clienteId,
          dados: { origem: "proposta_aceita_upsell", servicoId: it.servicoId },
        },
      });
    }
  } catch {
    /* Provisão é best-effort: o aceite do cliente não cai porque o Financeiro tropeçou. A falha
       chega ao painel de erros pelo `catch` de quem chamou (`propostas.service`). */
  }
}

/**
 * Cancela um serviço contratado. `porTipo` diz quem cancelou (EQUIPE ou CLIENTE, este
 * pelo Portal). Cancelamento pelo CLIENTE avisa a equipe (notificação + e-mail).
 */
export async function cancelarServicoCliente(
  clienteId: string,
  servicoId: string,
  porTipo: "EQUIPE" | "CLIENTE",
  motivo?: string,
  atorId?: string,
) {
  const existente = await prisma.clienteServico.findUnique({ where: { clienteId_servicoId: { clienteId, servicoId } } });
  if (!existente || existente.status !== "ATIVO") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Este serviço não está ativo para o cliente." });
  }
  const cs = await prisma.clienteServico.update({
    where: { clienteId_servicoId: { clienteId, servicoId } },
    data: {
      status: "CANCELADO",
      canceladoEm: new Date(),
      canceladoPorTipo: porTipo,
      observacao: motivo?.trim() ? motivo.trim() : existente.observacao,
    },
  });
  await prisma.activityLog.create({
    data: { userId: atorId ?? null, acao: "servico.cancelado", entidadeTipo: "cliente", entidadeId: clienteId, dados: { servicoId, porTipo } },
  });

  // GAP 2 — o trabalho para: pausa o projeto daquele serviço (reversível se retomar). Best-effort.
  await prisma.projeto
    .updateMany({ where: { clienteId, servicoId, status: "ATIVO", deletedAt: null }, data: { status: "PAUSADO" } })
    .catch(() => {});

  // ⚠️ E O DINHEIRO PARA JUNTO — decisão do dono (28/08/2026).
  //
  // Antes: "a cobrança NÃO é apagada automaticamente — a equipe revisa". Na prática ninguém
  // revisava, e a série recorrente seguia materializando parcela todo mês: a Med emitindo
  // cobrança de um serviço que já não presta, até alguém notar e apagar à mão.
  //
  // ⚠️ **ENCERRAR NÃO É APAGAR A SÉRIE.** São dois movimentos, e cada um resolve metade:
  //
  //  1. `recorrenciaAte = hoje` em TODAS as linhas da série — é o que faz
  //     `gerarProximaOcorrencia` parar de criar o mês seguinte. Sem isto, apagar a parcela
  //     aberta só adiantaria o problema: a varredura da madrugada criaria a próxima.
  //  2. as parcelas FUTURAS ainda em aberto saem (soft-delete). As vencidas e as pagas ficam:
  //     o serviço foi prestado naquele mês e o dinheiro é devido.
  //
  // ⚠️ **O soft-delete aqui não briga com o significado que `deletedAt` ganhou na série** (C10:
  // "alguém excluiu esta ocorrência de propósito"). É exatamente isso: uma pessoa cancelou o
  // serviço. E a linha ficando onde está é o que segura a data no índice único
  // `(recorrenteId, vencimento)`, impedindo que a parcela volte por outro caminho.
  //
  // Best-effort: o cancelamento do cliente não cai porque o Financeiro tropeçou.
  try {
    const plano = await levantarCobrancaDoServico(clienteId, servicoId);
    if (plano.series.length) {
      await prisma.conta.updateMany({
        where: { OR: [{ id: { in: plano.series } }, { recorrenteId: { in: plano.series } }] },
        data: { recorrenciaAte: hojeBRT() },
      });
    }
    if (plano.encerrar.length) {
      await prisma.conta.updateMany({
        where: { id: { in: plano.encerrar } },
        data: { deletedAt: new Date() },
      });
      await prisma.activityLog.create({
        data: {
          userId: atorId ?? null,
          acao: "conta.encerrada",
          entidadeTipo: "cliente",
          entidadeId: clienteId,
          dados: { origem: "servico_cancelado", servicoId, parcelas: plano.encerrar.length, valor: plano.valorEncerrado },
        },
      });
    }
  } catch {
    /* encerrar a cobrança é best-effort — o serviço já consta como cancelado. */
  }

  if (porTipo === "CLIENTE") {
    const [cliente, servico] = await Promise.all([
      prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } }),
      prisma.servico.findUnique({ where: { id: servicoId }, select: { nome: true } }),
    ]);
    const destinos = await equipeDoCliente(clienteId);
    for (const uid of destinos) {
      await notificar(
        uid,
        "servico_cancelado",
        { cliente: cliente?.nome ?? "Cliente", servico: servico?.nome ?? "um serviço" },
        { entidadeTipo: "cliente", entidadeId: clienteId },
      ).catch(() => {});
    }
  }
  // Dinheiro sai em número, nunca em Decimal (ADR-118) — a resposta desta mutation vai
  // direto para a tela (e, no cancelamento, também para o Portal do cliente).
  return { ...cs, valor: emReais(cs.valor), percentual: emReais(cs.percentual) };
}

/** Edita o preço/cobrança de um serviço CONTRATADO (o que o cliente realmente paga). */
export async function atualizarContratacaoCliente(
  clienteId: string,
  servicoId: string,
  dados: {
    valor?: number | null;
    valorRecorrencia?: "AVULSO" | "MENSAL";
    percentual?: number | null;
    percentualRecorrencia?: "AVULSO" | "MENSAL";
    observacao?: string | null;
    /** Convênios atendidos neste serviço (ADR-126). Lista completa — substitui a anterior. */
    conveniosIds?: string[];
  },
) {
  const existente = await prisma.clienteServico.findUnique({ where: { clienteId_servicoId: { clienteId, servicoId } } });
  if (!existente) throw new TRPCError({ code: "NOT_FOUND", message: "Este serviço não está contratado para o cliente." });
  // A mesma trava do catálogo, aplicada ao preço DESTE cliente (ADR-137): sobre o antes + o
  // depois, porque a edição é parcial e o `refine` do schema só vê o que veio no pedido.
  const depois = {
    valor: dados.valor !== undefined ? dados.valor : emReais(existente.valor),
    percentual: dados.percentual !== undefined ? dados.percentual : emReais(existente.percentual),
  };
  if (temValorEPercentual(depois)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: PRECO_VALOR_E_PERCENTUAL });
  }
  const data: Record<string, unknown> = {};
  if (dados.valor !== undefined) data.valor = dados.valor ?? null;
  if (dados.valorRecorrencia !== undefined) data.valorRecorrencia = dados.valorRecorrencia;
  if (dados.percentual !== undefined) data.percentual = dados.percentual ?? null;
  if (dados.percentualRecorrencia !== undefined) data.percentualRecorrencia = dados.percentualRecorrencia;
  if (dados.observacao !== undefined) data.observacao = dados.observacao?.trim() || null;
  // `set` e não `connect`: a tela manda a lista INTEIRA, e desmarcar um convênio precisa
  // realmente tirá-lo. Lista vazia é um estado legítimo (o cliente parou de atender convênio),
  // então o que separa "não mexeu" de "esvaziou" é `undefined`, não o tamanho do array.
  if (dados.conveniosIds !== undefined) data.operadoras = { set: dados.conveniosIds.map((id) => ({ id })) };
  const atualizado = await prisma.clienteServico.update({
    where: { clienteId_servicoId: { clienteId, servicoId } },
    data,
    include: { operadoras: { orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } } },
  });
  return {
    ...atualizado,
    valor: emReais(atualizado.valor),
    percentual: emReais(atualizado.percentual),
    convenios: atualizado.operadoras,
  };
}

/**
 * Reflexo dos serviços contratados no Portal (só os ATIVOS do próprio cliente), com as
 * exigências de DOCUMENTO e o que já foi enviado — o cliente vê o que falta mandar.
 */
export async function servicosDoClientePortal(clienteId: string) {
  const todos = await servicosDoCliente(clienteId);
  return todos
    .filter((s) => s.contratado)
    .map((s) => {
      // Exigência COM escopo é do credenciamento e tem tela própria no Portal
      // (`PortalCredenciamento`), agrupada por médico. Fica de fora daqui para o cliente
      // não ver a mesma papelada em dois lugares — e a contagem acompanha o recorte,
      // senão a lista some e o "faltam 14" fica boiando sozinho.
      const requisitos = s.requisitos.filter((r) => !r.escopo);
      const obrigatorios = requisitos.filter((r) => r.obrigatorio);
      return {
        servico: s.servico,
        requisitos, // documentos (upload) + briefings (preencher online)
        pendentes: obrigatorios.filter((r) => !r.atendido).length,
        totalObrigatorios: obrigatorios.length,
        // Os convênios atendidos neste serviço (ADR-126). O cliente precisa poder conferir a
        // lista que combinamos — é a lista sobre a qual o faturamento é apurado.
        convenios: s.contratacao?.convenios ?? [],
      };
    });
}
