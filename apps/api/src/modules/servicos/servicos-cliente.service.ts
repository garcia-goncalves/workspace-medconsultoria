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
  const valorContratado = emReaisOu(cs.valor);
  if (
    !jaContratado &&
    (opts.origem ?? "MANUAL") === "MANUAL" &&
    !ehServicoDeCredenciamento(servico?.nome) &&
    valorContratado > 0
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
          descricao: `${mensal ? "Mensalidade" : "Serviço"}: ${servico?.nome ?? "Serviço"} — ${cliente?.nome ?? "cliente"}`,
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

  // GAP 2 — o trabalho para: pausa o projeto daquele serviço (reversível se retomar). A
  // cobrança NÃO é apagada automaticamente (a mensalidade agrega vários serviços) — a equipe
  // revisa. Best-effort.
  await prisma.projeto
    .updateMany({ where: { clienteId, servicoId, status: "ATIVO", deletedAt: null }, data: { status: "PAUSADO" } })
    .catch(() => {});

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
