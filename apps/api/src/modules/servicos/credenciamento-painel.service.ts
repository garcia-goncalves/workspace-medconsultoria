import { prisma } from "@app/db";
import {
  credenciamentoPrecisaDeAtencao,
  diasNaSituacaoAtual,
  ordenarPainelCredenciamentos,
  PRAZO_ACOMPANHAMENTO_PADRAO_DIAS,
  STATUS_CREDENCIAMENTO,
  type StatusCredenciamento,
} from "@app/shared";
import { getIdentidade } from "../identidade/identidade.service.js";

/**
 * O PAINEL de credenciamentos — a visão que faltava.
 *
 * Até aqui, o andamento só existia dentro da ficha de cada cliente: para saber o que estava
 * travado, a Thaís precisava abrir cliente por cliente e somar de cabeça. Enquanto for
 * assim, ela mantém a planilha paralela, e o sistema não substitui o caos — vira mais um
 * lugar para olhar.
 *
 * A tela responde UMA pergunta, a que ela faz de manhã: **o que travou e eu preciso cobrar
 * hoje?** Por isso abre ordenada pelo que está parado há mais tempo, e não pelo mais
 * recente, que é o padrão de quase toda listagem deste sistema.
 *
 * Complementa `credenciamento-grade.service.ts`, que responde outra pergunta — a grade de
 * UM cliente, usada no construtor da proposta e na ficha.
 */

export type FiltroPainel = {
  clienteId?: string | null;
  operadoraId?: string | null;
  status?: StatusCredenciamento[] | null;
  /** Só o que precisa de atenção — o atalho do "me mostra só o problema". */
  somenteAtencao?: boolean | null;
};

export async function painelCredenciamentos(filtro: FiltroPainel = {}) {
  const identidade = await getIdentidade();
  const prazoDias = identidade.credenciamentoPrazoDias || PRAZO_ACOMPANHAMENTO_PADRAO_DIAS;

  const linhas = await prisma.credenciamento.findMany({
    where: {
      // Cliente excluído não aparece; o resto vem TODO, inclusive o de médico desativado.
      // Filtrar por `profissional.ativo` aqui repetiria o defeito 1 do ADR-105: quem foi
      // desativado para PRESERVAR o andamento sumiria justamente da tela que existe para
      // vigiar o andamento — junto com a conta a receber que ele sustenta.
      cliente: { deletedAt: null },
      ...(filtro.clienteId ? { clienteId: filtro.clienteId } : {}),
      ...(filtro.operadoraId ? { operadoraId: filtro.operadoraId } : {}),
      ...(filtro.status?.length ? { status: { in: filtro.status } } : {}),
    },
    select: {
      id: true,
      status: true,
      valor: true,
      tentativa: true,
      createdAt: true,
      protocoladoEm: true,
      emAnaliseEm: true,
      aprovadoEm: true,
      negadoEm: true,
      encerradoEm: true,
      motivoNegativa: true,
      observacoes: true,
      contaId: true,
      clienteId: true,
      cliente: { select: { id: true, nome: true } },
      profissional: { select: { id: true, nome: true, especialidade: true, ativo: true } },
      operadora: { select: { id: true, nome: true } },
    },
  });

  const agora = new Date();
  const comCalculo = linhas.map((l) => {
    const status = l.status as StatusCredenciamento;
    const paraCalculo = {
      id: l.id,
      status,
      createdAt: l.createdAt,
      protocoladoEm: l.protocoladoEm,
      emAnaliseEm: l.emAnaliseEm,
      aprovadoEm: l.aprovadoEm,
      negadoEm: l.negadoEm,
      encerradoEm: l.encerradoEm,
    };
    const diasParados = diasNaSituacaoAtual(paraCalculo, agora);
    return {
      // Desde quando está nesta situação. A tela mostra "há N dias" enquanto o processo
      // corre e a DATA quando ele terminou: um credenciamento aprovado não está "parado
      // há 3 dias", ele foi aprovado no dia 8 — e chamar isso de parado seria mentir com
      // uma palavra.
      desde:
        {
          A_PROTOCOLAR: l.createdAt,
          PROTOCOLADO: l.protocoladoEm,
          EM_ANALISE: l.emAnaliseEm,
          APROVADO: l.aprovadoEm,
          NEGADO: l.negadoEm,
          ENCERRADO: l.encerradoEm,
        }[status] ?? l.createdAt,
      id: l.id,
      status,
      valor: Number(l.valor),
      tentativa: l.tentativa,
      diasParados,
      precisaAtencao: credenciamentoPrecisaDeAtencao(status, diasParados, prazoDias),
      motivoNegativa: l.motivoNegativa,
      observacoes: l.observacoes,
      temConta: Boolean(l.contaId),
      clienteId: l.clienteId,
      clienteNome: l.cliente.nome,
      profissionalId: l.profissional.id,
      profissionalNome: l.profissional.nome,
      profissionalEspecialidade: l.profissional.especialidade,
      /** `false` = saiu da lista do cliente, mas o processo dele continua de pé. */
      profissionalAtivo: l.profissional.ativo,
      operadoraId: l.operadora.id,
      operadoraNome: l.operadora.nome,
    };
  });

  const visiveis = filtro.somenteAtencao ? comCalculo.filter((l) => l.precisaAtencao) : comCalculo;

  // Os totais descrevem o que está NA TELA, não o banco inteiro: um resumo que ignora o
  // filtro ativo faz a pessoa somar peras com maçãs sem perceber.
  const porStatus = Object.fromEntries(
    STATUS_CREDENCIAMENTO.map((s) => [s, visiveis.filter((l) => l.status === s).length]),
  ) as Record<StatusCredenciamento, number>;

  return {
    prazoDias,
    linhas: ordenarPainelCredenciamentos(visiveis),
    resumo: {
      total: visiveis.length,
      precisamAtencao: visiveis.filter((l) => l.precisaAtencao).length,
      porStatus,
      // ⚠️ "EM CURSO" E "APROVADO" SÃO CONJUNTOS SEPARADOS, e é assim que a tela os apresenta:
      // dois cartões lado a lado, o primeiro dizendo "honorário ainda não aprovado" e o
      // segundo "já virou conta a receber". Este filtro excluía só NEGADO e ENCERRADO, então
      // somava os aprovados dentro do "ainda não aprovado" — e quem lia os dois cartões
      // juntos contava o mesmo dinheiro duas vezes. Medido na tela: R$ 2.020 de fato em
      // andamento apareciam como R$ 2.770, que é 2.020 + os R$ 750 já aprovados ao lado.
      //
      // O total do processo (em curso + aprovado) continua existindo onde ele é a pergunta
      // certa: o cabeçalho da grade na ficha, que é o valor que vai para a proposta.
      valorEmCurso: visiveis
        .filter((l) => l.status !== "APROVADO" && l.status !== "NEGADO" && l.status !== "ENCERRADO")
        .reduce((s, l) => s + l.valor, 0),
      valorAprovado: visiveis.filter((l) => l.status === "APROVADO").reduce((s, l) => s + l.valor, 0),
    },
  };
}

/** Cliente e operadora que de fato têm credenciamento — só o que enche filtro que devolve algo. */
export async function opcoesDoPainel() {
  const linhas = await prisma.credenciamento.findMany({
    where: { cliente: { deletedAt: null } },
    select: { cliente: { select: { id: true, nome: true } }, operadora: { select: { id: true, nome: true } } },
  });

  const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, "pt-BR");
  const clientes = [...new Map(linhas.map((l) => [l.cliente.id, l.cliente])).values()].sort(porNome);
  const operadoras = [...new Map(linhas.map((l) => [l.operadora.id, l.operadora])).values()].sort(porNome);
  return { clientes, operadoras };
}
