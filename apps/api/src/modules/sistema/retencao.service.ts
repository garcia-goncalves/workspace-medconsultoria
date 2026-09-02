import { prisma } from "@app/db";
import { CORPO_EXPURGADO, dataLimiteDeGuarda } from "@app/shared";

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
  // sempre. `ActivityLog` guarda o histórico de quem fez o quê, e boa parte dele nasce de
  // caminho anônimo (o diagnóstico de login barrado no navegador). Sem expurgo, a tabela cresce
  // sem limite num MySQL de revenda que já cai por esgotamento de pool — e o painel do ROOT,
  // que mostra as 60 mais recentes, fica cada vez mais lento para responder a mesma pergunta.
  //
  // ⚠️ O prazo é o MESMO do corpo dos e-mails, e isso é deliberado: os dois são registro de
  // operação, não documento com dever de guarda. Contrato, nota e processo de credenciamento
  // continuam intocados aqui (ver o aviso no alto deste arquivo).
  const atividade = await prisma.activityLog.deleteMany({ where: { createdAt: { lt: limite } } });

  return { dias, limite, emails: emails.count, erros: erros.count, atividade: atividade.count };
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
