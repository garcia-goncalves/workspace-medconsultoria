import { prisma } from "@app/db";
import { CORPO_EXPURGADO, dataLimiteDeGuarda } from "@app/shared";
import { expurgarIdempotenciasVencidas } from "../agente/criar-tarefa-do-agente.service.js";

/**
 * PRAZO DE GUARDA — o expurgo automático (LGPD, ADR-141).
 *
 * O problema não era guardar: reter por obrigação contratual e fiscal é defensável.
 * O problema era guardar **sem prazo, sem base declarada e sem rotina** — `EmailEnviado`
 * mantinha o CORPO COMPLETO de todo e-mail para sempre, e `ErrorLog` a pilha de erro
 * inteira, que carrega o que o usuário digitou.
 *
 * ⚠️ O QUE FICA: o metadado do e-mail (para quem, assunto, quando, entregue ou não). É
 * disso que o monitor vive, e foi ele que provou, em 22/08, que o e-mail voltou a sair.
 * Apagar a linha inteira cegaria a única ferramenta de diagnóstico de entrega que existe.
 *
 * ⚠️ O PRAZO VEM DO BANCO, não de uma constante: prazo é decisão de negócio, e a Thaís
 * muda em Ajustes → Dados da empresa sem publicação nenhuma. Padrão 180 dias.
 *
 * ⚠️ NADA de credenciamento é apagado por aqui. O acervo do médico (diploma, CRM,
 * alvará) só ganha AVISO de prazo vencido — apagar sozinho o diploma de alguém é pior
 * que guardar demais, e quem decide é a Thaís.
 */
export async function expurgarDadosVencidos(agora = new Date()) {
  const identidade = await prisma.identidadeInstitucional.findUnique({
    where: { id: "default" },
    select: { retencaoCorpoEmailDias: true },
  });
  const dias = identidade?.retencaoCorpoEmailDias ?? 180;
  const limite = dataLimiteDeGuarda(dias, agora);

  // `not: CORPO_EXPURGADO` é o que impede a varredura de reescrever, todo dia, cada linha
  // que já foi expurgada — sem isso o trabalho cresceria com a idade do sistema.
  const emails = await prisma.emailEnviado.updateMany({
    where: { createdAt: { lt: limite }, corpo: { not: CORPO_EXPURGADO } },
    data: { corpo: CORPO_EXPURGADO, erro: null },
  });

  // A pilha do erro é onde entra o que a pessoa digitou. A mensagem fica: é ela que
  // identifica o defeito, e sem ela o painel do ROOT vira uma lista de linhas mudas.
  const erros = await prisma.errorLog.updateMany({
    where: { ultimaVez: { lt: limite }, stack: { not: null } },
    data: { stack: null },
  });

  // O RASTRO DE ATIVIDADE TAMBÉM PRECISA DE TETO — ele era a única tabela que crescia para
  // sempre, e boa parte do que entra ali nasce de caminho anônimo (o diagnóstico de login
  // barrado no navegador). Sem expurgo a tabela cresce sem limite num MySQL de revenda que já
  // cai por esgotamento de pool, e o painel do ROOT fica cada vez mais lento.
  //
  // ⚠️ **MAS NEM TUDO NO `ActivityLog` É RUÍDO DE OPERAÇÃO — e apagar o resto seria anti-forense
  // por rotina agendada.** Algumas ações são a ÚNICA prova de responsabilidade que existe:
  //
  //   · `painel_cliente.*` — quem da Med entrou no Portal de um cliente. É registro de acesso a
  //     dado pessoal de médico e clínica, e não existe em nenhum outro lugar.
  //   · `documento.link_de_assinatura_aberto` — quem tirou daqui o link que assina pelo cliente.
  //     ⚠️ Esta linha existe justamente para uma assinatura contestada; contrato se guarda por
  //     anos, então deixá-la evaporar em 180 dias apagaria a prova antes da pergunta.
  //   · `arquivo.removido`, `conta.criada`, `documento.assinatura_solicitada` — quem mexeu em
  //     documento do cliente e em dinheiro.
  //
  // E o prazo que sobrou para o resto é `retencaoCorpoEmailDias`, cujo rótulo na tela fala de
  // **e-mail**: quem apertar aquele campo para 30 dias não pode estar apagando trilha de
  // auditoria sem nunca ler a palavra "atividade". Por isso a lista abaixo, e não um prazo só.
  const ACOES_QUE_NAO_EXPIRAM = [
    "painel_cliente.entrou",
    "painel_cliente.saiu",
    "documento.link_de_assinatura_aberto",
    "documento.assinatura_solicitada",
    "documento.assinado",
    "arquivo.removido",
    "conta.criada",
    "cliente.anonimizado",
  ];
  const atividade = await prisma.activityLog.deleteMany({
    where: { createdAt: { lt: limite }, acao: { notIn: ACOES_QUE_NAO_EXPIRAM } },
  });

  // As reservas de idempotência da API do agente (CORA-003). O contrato declara 24 h; passado
  // o prazo a chave é esquecida e repetir cria tarefa nova. ⚠️ Sem isto a tabela cresceria para
  // sempre — uma linha por tarefa criada pelo agente. É a lição do `ActivityLog` na ADR-148.
  const idempotencias = await expurgarIdempotenciasVencidas();

  return {
    dias,
    limite,
    emails: emails.count,
    erros: erros.count,
    atividade: atividade.count,
    idempotencias,
  };
}

let intervalo: NodeJS.Timeout | null = null;

/**
 * Liga o expurgo periódico. A hospedagem não tem cron externo (mesmo motivo da varredura
 * de anexos temporários, em `http/email-anexo.ts`), então isto substitui um: roda ao subir
 * e depois uma vez por dia. `unref()` para o timer nunca segurar o processo.
 *
 * "Retenção sem rotina" é exatamente o que a lei não aceita — um botão que alguém pode
 * esquecer de apertar não é política de retenção.
 */
export function iniciarExpurgoDeRetencao(): void {
  if (intervalo) return;
  const rodar = () =>
    void expurgarDadosVencidos().catch((e) => console.error("[retencao] expurgo falhou.", e));
  rodar();
  intervalo = setInterval(rodar, 24 * 60 * 60 * 1000);
  intervalo.unref();
}
