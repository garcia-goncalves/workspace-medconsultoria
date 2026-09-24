import { prisma, type Prisma } from "@app/db";
import { MARCADOR_ANONIMIZADO } from "@app/shared";
import { removerArquivo } from "../../lib/storage.js";

/**
 * PRAZO DE GUARDA DO DADO DE PACIENTE DA CONCILIAÇÃO (LGPD — Onda 1, decisão do dono: 5 anos,
 * editável em Ajustes → Dados da empresa).
 *
 * Até aqui `ProducaoConsulta`, `ProducaoCirurgia` e o arquivo original importado ficavam PARA
 * SEMPRE — e o arquivo original é o pior dos três: a planilha do TASY traz prontuário, Cód. Pessoa
 * e leito, que o sistema deliberadamente não lê (ADR-141), mas que continuavam no disco.
 *
 * ⚠️ ANONIMIZAR, NÃO APAGAR, AS LINHAS. Apagar a cirurgia apagaria junto o cobrado, o recebido, a
 * glosa, o recurso (Cascade) e desmontaria o retrato de competência fechada — o histórico
 * FINANCEIRO da clínica, que ela pode precisar para uma auditoria da operadora ou para o fisco e
 * que, sem o nome, não é dado pessoal. Então sai o que identifica o paciente (nome, CPF, telefone,
 * e-mail, o apelido HMAC do CPF que casa o mesmo paciente entre linhas, e a observação livre, onde
 * a equipe pode ter escrito qualquer coisa) e FICAM data, convênio, profissional, procedimento e
 * dinheiro. As FKs não mudam uma linha: nada é removido, então competência fechada e recurso de
 * glosa continuam de pé.
 *
 * ⚠️ O QUE FICA DE PROPÓSITO:
 *   · `atendimento` e `numeroCirurgia` — são a chave que casa o repasse com a cirurgia (Fase 2b).
 *     Sem o arquivo original e sem o nome, são um número interno do hospital: reidentificar exige
 *     o próprio TASY, que é do hospital, não nosso.
 *   · `RepasseLinha` inteira — ela NUNCA gravou o nome do paciente (minimização desde a Fase 2b);
 *     o que tem é atendimento, executor (o médico) e valor.
 *   · `RecursoDeGlosa.motivoDaGlosa` — é o que a OPERADORA alegou ("procedimento não autorizado"),
 *     não dado do paciente. A `observacao` do recurso, texto livre da equipe, sai.
 *
 * ⚠️ O CORTE É A DATA DO ATENDIMENTO/CIRURGIA, NÃO A DA IMPORTAÇÃO. O prazo de guarda de dado de
 * saúde conta do fato (o atendimento), e importar em 2026 um mapa de 2021 não pode dar mais cinco
 * anos de vida ao dado de 2021. Para o ARQUIVO é diferente, ver `apagarArquivosOriginais`.
 */

/** O que fica no lugar do nome quando é o PRAZO que venceu. Vazio pareceria defeito. */
export const MARCADOR_PACIENTE_EXPURGADO = "[paciente removido pelo prazo de guarda]";

/** Os dois marcadores: nenhuma varredura reescreve, todo dia, linha que já foi limpa. */
const JA_LIMPO = [MARCADOR_PACIENTE_EXPURGADO, MARCADOR_ANONIMIZADO];

/** Padrão do dono. Mesmo valor do `@default` do schema, para banco sem a linha de identidade. */
export const RETENCAO_PACIENTE_ANOS_PADRAO = 5;

/**
 * A data antes da qual o dado de paciente passou do prazo. Em anos de calendário (não 365×N
 * dias), para "5 anos" querer dizer o que a Thaís entende: o mesmo dia, cinco anos atrás.
 * UTC porque as colunas comparadas são `@db.Date` (meia-noite UTC).
 */
export function limiteDoDadoDePaciente(anos: number, agora: Date): Date {
  const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
  d.setUTCFullYear(d.getUTCFullYear() - anos);
  return d;
}

type Alcance = {
  /** Só este cliente (anonimização a pedido). Ausente = todos (expurgo diário). */
  clienteId?: string;
  /** Só o que aconteceu ANTES desta data. Ausente = tudo daquele cliente. */
  antesDe?: Date;
  marcador: string;
};

/**
 * Tira a identidade do paciente das linhas da Conciliação no alcance pedido. Devolve SÓ contagens:
 * quem chama grava no `ActivityLog`, e nome de paciente não pode ir parar lá.
 */
export async function anonimizarPacientesDaConciliacao({ clienteId, antesDe, marcador }: Alcance) {
  const doCliente = clienteId ? { clienteId } : {};

  const consultas = await prisma.producaoConsulta.updateMany({
    where: {
      ...doCliente,
      ...(antesDe ? { dataAtendimento: { lt: antesDe } } : {}),
      pacienteNome: { notIn: JA_LIMPO },
    },
    data: {
      pacienteNome: marcador,
      pacienteCpfCifrado: null,
      pacienteCpfApelido: null,
      pacienteTelefoneCifrado: null,
      pacienteEmailCifrado: null,
    },
  });

  const filtroCirurgia: Prisma.ProducaoCirurgiaWhereInput = {
    ...doCliente,
    ...(antesDe ? { dataCirurgia: { lt: antesDe } } : {}),
  };

  // O recurso segue a CIRURGIA (a data dela), não a própria data de abertura: é a cirurgia que
  // identifica o paciente, e um recurso aberto anos depois fala do mesmo atendimento antigo.
  const recursos = await prisma.recursoDeGlosa.updateMany({
    where: { cirurgia: filtroCirurgia, observacao: { not: null } },
    data: { observacao: null },
  });

  const cirurgias = await prisma.producaoCirurgia.updateMany({
    where: { ...filtroCirurgia, pacienteNome: { notIn: JA_LIMPO } },
    data: { pacienteNome: marcador, observacao: null },
  });
  // Texto livre escrito DEPOIS da anonimização (a cirurgia antiga continua editável) também sai —
  // mesma regra do recurso acima. Não conta como linha nova: o paciente já estava anonimizado.
  await prisma.producaoCirurgia.updateMany({
    where: { ...filtroCirurgia, pacienteNome: { in: JA_LIMPO }, observacao: { not: null } },
    data: { observacao: null },
  });

  return { consultas: consultas.count, cirurgias: cirurgias.count, recursos: recursos.count };
}

/**
 * Apaga do DISCO (e do banco) o arquivo original importado na Conciliação — a planilha com tudo
 * em claro, inclusive o que o sistema se recusa a ler.
 *
 * ⚠️ PARA O ARQUIVO O CORTE É A DATA DO ENVIO (`Arquivo.createdAt`), e não é contradição com o
 * das linhas: o arquivo pode trazer atendimentos que NÃO foram importados (outras competências
 * do mesmo relatório, linhas ignoradas), e esses o banco não conhece. O que se sabe com certeza é
 * que nenhum atendimento dentro dele é posterior ao dia em que ele foi enviado — então, passado o
 * prazo desde o envio, TODO o conteúdo passou do prazo. Custa guardar o arquivo alguns meses a
 * mais que as linhas (a defasagem da importação), e é o lado seguro de errar: apagar pelo mês da
 * competência poderia jogar fora um arquivo com atendimentos ainda dentro do prazo.
 *
 * ⚠️ SÓ arquivo que é de fato da Conciliação: ligado a algum `ProducaoLote` e a NENHUMA exigência,
 * serviço ou médico. O acervo de credenciamento (diploma, CRM) segue a regra da ADR-141 — é
 * AVISADO, nunca apagado sozinho —, e esta trava impede que um documento de médico importado por
 * engano como planilha caia aqui.
 *
 * A linha do `Arquivo` sai junto (o lote fica, com `arquivoId` nulo pelo SetNull, e continua
 * dizendo `nomeArquivo` e o hash): linha apontando para arquivo que não existe mais faria a tela
 * oferecer um download que responde erro.
 */
export async function apagarArquivosOriginais({ clienteId, antesDe }: { clienteId?: string; antesDe?: Date }) {
  const arquivos = await prisma.arquivo.findMany({
    where: {
      ...(clienteId ? { clienteId } : {}),
      ...(antesDe ? { createdAt: { lt: antesDe } } : {}),
      producaoLotes: { some: {} },
      servicoId: null,
      requisitoId: null,
      profissionalId: null,
    },
    select: { id: true, caminho: true },
  });

  let apagados = 0;
  for (const a of arquivos) {
    // Disco primeiro: se o banco falhar depois, a próxima varredura acha a linha de novo e
    // `removerArquivo` não reclama do arquivo que já não está lá. Na ordem inversa, uma falha
    // no disco deixaria o arquivo em claro sem nenhuma linha que leve a ele.
    await removerArquivo(a.caminho);
    await prisma.arquivo.delete({ where: { id: a.id } });
    apagados++;
  }
  return apagados;
}

/**
 * A varredura diária — chamada por `expurgarDadosVencidos` (retencao.service.ts), que já roda
 * no boot e a cada 24 h. Lê o prazo do banco a cada execução: mudar em Ajustes vale na próxima.
 */
export async function expurgarDadoDePacienteVencido(agora = new Date()) {
  const identidade = await prisma.identidadeInstitucional.findUnique({
    where: { id: "default" },
    select: { retencaoPacienteAnos: true },
  });
  const anos = identidade?.retencaoPacienteAnos ?? RETENCAO_PACIENTE_ANOS_PADRAO;
  const limite = limiteDoDadoDePaciente(anos, agora);

  const linhas = await anonimizarPacientesDaConciliacao({ antesDe: limite, marcador: MARCADOR_PACIENTE_EXPURGADO });
  const arquivos = await apagarArquivosOriginais({ antesDe: limite });

  const total = linhas.consultas + linhas.cirurgias + linhas.recursos + arquivos;
  // Registra SÓ quando fez alguma coisa — um registro por dia dizendo "zero" enterraria os que
  // importam. Contagem, nunca nome. ⚠️ O prefixo `conciliacao.` é o que PRESERVA esta linha do
  // expurgo do próprio `ActivityLog` (ver `atividadeDeConciliacao` em retencao.service.ts): a
  // prova de que o dado foi eliminado no prazo não pode evaporar em 180 dias.
  if (total > 0) {
    await prisma.activityLog.create({
      data: {
        acao: "conciliacao.paciente_expurgado",
        entidadeTipo: "conciliacao",
        dados: { anos, limite: limite.toISOString().slice(0, 10), ...linhas, arquivos },
      },
    });
  }

  return { anos, limite, ...linhas, arquivos };
}
