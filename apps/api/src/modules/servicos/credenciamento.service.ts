import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import {
  ESCOPO_REQUISITO_LABEL,
  ESCOPOS_REQUISITO,
  motivosParaOCliente,
  progressoCredenciamento,
  triarCredenciamento,
  type CreateProfissionalInput,
  type EscopoRequisito,
  type LadoArquivo,
  type TravaElegibilidade,
  type UpdateProfissionalInput,
} from "@app/shared";

/**
 * CREDENCIAMENTO — a lista real de documentos e a reconciliação dela com o banco.
 *
 * Fonte única: `brand/identidade/Lista de documentos credenciamento médico.pdf`, o papel
 * que a Thaís manda hoje para o cliente. Nada aqui foi inventado; a única liberdade tomada
 * foi de agrupamento (as "duas fotos do consultório" estavam listadas em "documentos
 * pessoais" no PDF e são da clínica — é onde o médico vai procurar).
 *
 * **Uma lista só, igual para todas as operadoras** (spec §3.2, confirmado pelo dono).
 */

export const NOME_SERVICO_CREDENCIAMENTO = "Credenciamento médico e odontológico";

/**
 * O credenciamento **não se cobra como os outros serviços**: o honorário é no sucesso, e a
 * conta a receber nasce quando a operadora aprova (spec §3.3). Quem provisiona cobrança
 * automática — contratar na ficha, converter o lead — precisa saber disso e pular este
 * serviço, senão o cliente é cobrado antes de a operadora ter dito qualquer coisa.
 */
export function ehServicoDeCredenciamento(nome: string | null | undefined): boolean {
  return !!nome && nome.trim().toLowerCase() === NOME_SERVICO_CREDENCIAMENTO.toLowerCase();
}

/** Um serviço do lead, só com o que decide cobrança. */
export type ServicoParaProvisao = {
  nome: string | null;
  valor: number | null;
  valorRecorrencia: string | null;
  percentual: number | null;
};

export type ProvisaoDaConversao = {
  /** Soma dos serviços de cobrança única (credenciamento fora). */
  avulso: number;
  /** Soma dos serviços mensais (credenciamento fora). */
  mensal: number;
  /** Cobranças por % do faturamento: texto para as observações, nunca valor fixo. */
  percentuais: string[];
  /** O lead pediu credenciamento — quem escreve a observação precisa avisar a Thaís. */
  temCredenciamento: boolean;
  /** Provisionar uma conta única com a estimativa do funil. */
  usarEstimativa: boolean;
};

/**
 * O que a conversão do lead pode provisionar no Financeiro.
 *
 * A soma sempre pulou o credenciamento, mas o **fallback da estimativa do funil** não
 * sabia disso: lead cujo único serviço era credenciamento caía nele e virava uma conta a
 * receber no ato da conversão — exatamente o que a ADR-104 proíbe, e cobrado de novo
 * quando a operadora aprovasse. Por isso a estimativa também tem de olhar os serviços:
 * se TODOS são credenciamento, não há nada a provisionar hoje.
 */
export function planejarProvisaoDaConversao(
  servicos: ServicoParaProvisao[],
  valorEstimado: number | null | undefined,
): ProvisaoDaConversao {
  let avulso = 0;
  let mensal = 0;
  const percentuais: string[] = [];
  let temCredenciamento = false;
  let temOutroServico = false;

  for (const s of servicos) {
    if (ehServicoDeCredenciamento(s.nome)) {
      temCredenciamento = true;
      continue;
    }
    temOutroServico = true;
    if (s.valor && s.valor > 0) {
      if (s.valorRecorrencia === "MENSAL") mensal += s.valor;
      else avulso += s.valor;
    }
    if (s.percentual && s.percentual > 0) percentuais.push(`${s.percentual}% do faturamento (${s.nome})`);
  }

  // A estimativa é o último recurso: só quando não há preço de serviço nenhum E sobrou
  // algo além do credenciamento para cobrar (ou o lead nem escolheu serviço).
  const soCredenciamento = temCredenciamento && !temOutroServico;
  const usarEstimativa = avulso === 0 && mensal === 0 && !soCredenciamento && !!valorEstimado && valorEstimado > 0;

  return { avulso, mensal, percentuais, temCredenciamento, usarEstimativa };
}

export type DocumentoCredenciamento = {
  titulo: string;
  descricao: string | null;
  tipo: "DOCUMENTO";
  escopo: EscopoRequisito;
  obrigatorio: boolean;
  frenteVerso: boolean;
  travaElegibilidade: TravaElegibilidade | null;
};

const doc = (
  titulo: string,
  escopo: EscopoRequisito,
  extra: Partial<Omit<DocumentoCredenciamento, "titulo" | "escopo" | "tipo">> = {},
): DocumentoCredenciamento => ({
  titulo,
  escopo,
  tipo: "DOCUMENTO",
  descricao: extra.descricao ?? null,
  obrigatorio: extra.obrigatorio ?? true,
  frenteVerso: extra.frenteVerso ?? false,
  travaElegibilidade: extra.travaElegibilidade ?? null,
});

/** Os 14 documentos do PDF, na ordem em que ele os apresenta. */
export const DOCUMENTOS_CREDENCIAMENTO: DocumentoCredenciamento[] = [
  // ── Da PJ ──────────────────────────────────────────────────────────────────
  doc("Cópia do contrato/estatuto social e alterações (registrados)", "EMPRESA"),
  doc("Comprovante de inscrição no CNPJ", "EMPRESA"),
  doc("Comprovantes de isenções fiscais, tributárias e contribuições", "EMPRESA", {
    descricao: "Só se houver — não é exigido de todas as empresas.",
    obrigatorio: false,
  }),
  doc("Carta ou contrato de locação", "EMPRESA"),
  doc("Dados bancários", "EMPRESA", {
    descricao:
      "Documento emitido pelo banco em que apareçam o CNPJ e/ou a razão social da empresa e as informações de agência e conta — extrato, folha de cheque ou cartão. Não basta digitar o número.",
  }),

  // ── Da clínica ─────────────────────────────────────────────────────────────
  doc("Inscrição da entidade no Conselho", "CLINICA"),
  doc("Alvará de funcionamento", "CLINICA", { travaElegibilidade: "ALVARA_FUNCIONAMENTO" }),
  doc("Alvará da Vigilância Sanitária", "CLINICA", { travaElegibilidade: "ALVARA_VIGILANCIA" }),
  doc("Registro no CNES", "CLINICA", {
    descricao: "Cadastro Nacional dos Estabelecimentos de Saúde.",
    travaElegibilidade: "CNES",
  }),
  doc("Duas fotos do consultório (recepção e sala de atendimento)", "CLINICA", {
    descricao: "Vão para a divulgação no site.",
  }),

  // ── De cada profissional (repetem por médico) ──────────────────────────────
  doc("Registro no Conselho (CRM, CRO, CRP, CRN, Crefito ou CRFa)", "PROFISSIONAL", { frenteVerso: true }),
  doc("Diploma", "PROFISSIONAL", { frenteVerso: true }),
  doc("Especializações", "PROFISSIONAL", { frenteVerso: true, travaElegibilidade: "TITULO_ESPECIALISTA" }),

  // ── Do responsável técnico ─────────────────────────────────────────────────
  doc("Currículo resumido do responsável técnico", "RESPONSAVEL_TECNICO"),
];

// ── Reconciliação com o que já existe no banco ───────────────────────────────

export type RequisitoExistente = { id: string; titulo: string; tipo: string; obrigatorio: boolean };

export type PlanoSincronizacao = {
  criar: (DocumentoCredenciamento & { ordem: number })[];
  atualizar: {
    id: string;
    dados: {
      descricao: string | null;
      escopo: EscopoRequisito;
      obrigatorio: boolean;
      frenteVerso: boolean;
      travaElegibilidade: TravaElegibilidade | null;
      ordem: number;
    };
  }[];
  /** Exigência antiga que a Thaís não pede: deixa de ser obrigatória, mas CONTINUA existindo. */
  rebaixar: { id: string; titulo: string; ordem: number }[];
  /**
   * Linha repetida do MESMO documento da lista — lixo nosso, não escolha dela (duas
   * chamadas simultâneas da sincronização já leram o banco vazio e criaram as duas). Sai
   * da conta; quem apaga é o aplicador, e só quando não há arquivo preso nela.
   */
  duplicados: { id: string; titulo: string }[];
};

/** Título comparável: sem espaço sobrando, sem caixa alta e sem acento. */
const normalizar = (t: string) =>
  t
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Decide o que fazer com as exigências que já existem — SEM APAGAR NENHUMA.
 *
 * `Arquivo.requisitoId` é `SetNull`: apagar a exigência solta o arquivo que o cliente já
 * enviou, e ele some da tela sem ninguém perceber. Por isso documento antigo que não está
 * na lista da Thaís só perde a obrigatoriedade — ela apaga pela tela quando quiser, vendo
 * o que está preso ali. Pergunta ao cliente (INFORMACAO/BRIEFING) não é documento e não é
 * tocada: a lista do PDF é de papel.
 */
export function planejarSincronizacaoDocumentos(existentes: RequisitoExistente[]): PlanoSincronizacao {
  const canonicos = new Set(DOCUMENTOS_CREDENCIAMENTO.map((d) => normalizar(d.titulo)));
  const plano: PlanoSincronizacao = { criar: [], atualizar: [], rebaixar: [], duplicados: [] };

  // A PRIMEIRA linha de cada título é a que vale; as demais são repetição. O aplicador
  // entrega a lista já com as que têm arquivo na frente, para o que vale ser a que guarda
  // o documento do cliente.
  const porTitulo = new Map<string, RequisitoExistente>();
  for (const e of existentes) {
    const chave = normalizar(e.titulo);
    if (!porTitulo.has(chave)) porTitulo.set(chave, e);
    else if (canonicos.has(chave)) plano.duplicados.push({ id: e.id, titulo: e.titulo });
  }

  DOCUMENTOS_CREDENCIAMENTO.forEach((d, ordem) => {
    const existente = porTitulo.get(normalizar(d.titulo));
    if (!existente) {
      plano.criar.push({ ...d, ordem });
      return;
    }
    plano.atualizar.push({
      id: existente.id,
      dados: {
        descricao: d.descricao,
        escopo: d.escopo,
        obrigatorio: d.obrigatorio,
        frenteVerso: d.frenteVerso,
        travaElegibilidade: d.travaElegibilidade,
        ordem,
      },
    });
  });

  let ordemExtra = DOCUMENTOS_CREDENCIAMENTO.length;
  for (const e of existentes) {
    if (e.tipo !== "DOCUMENTO") continue;
    if (canonicos.has(normalizar(e.titulo))) continue;
    if (!e.obrigatorio) continue;
    plano.rebaixar.push({ id: e.id, titulo: e.titulo, ordem: ordemExtra++ });
  }

  return plano;
}

/**
 * Aplica o plano no serviço de credenciamento. Idempotente — rodar de novo não duplica
 * nada. Executa uma vez por processo (a lista não muda em tempo de execução) e é chamada
 * de onde as exigências são lidas, para o banco de dev e o de produção convergirem sem
 * passo manual de ninguém.
 */
let execucao: Promise<SincronizacaoResultado> | null = null;

type SincronizacaoResultado =
  | { ok: false; motivo: "servico-inexistente" }
  | { ok: true; criados: number; atualizados: number; rebaixados: number; duplicadosApagados: number; duplicadosMantidos: number };

/**
 * Guarda a execução EM ANDAMENTO, não um booleano de "já rodou". Duas telas abrindo ao
 * mesmo tempo (a ficha e o card de credenciamento) chamavam isto em paralelo: as duas liam
 * o banco vazio antes de qualquer `create` e as duas criavam a lista inteira — 28 exigências
 * onde deviam existir 14. Compartilhando a promessa, a segunda espera a primeira.
 */
export function sincronizarRequisitosCredenciamento(forcar = false): Promise<SincronizacaoResultado> {
  if (execucao && !forcar) return execucao;
  execucao = executarSincronizacao().catch((e) => {
    execucao = null; // falhou: a próxima chamada tenta de novo
    throw e;
  });
  return execucao;
}

async function executarSincronizacao(): Promise<SincronizacaoResultado> {
  const servico = await prisma.servico.findFirst({
    where: { nome: NOME_SERVICO_CREDENCIAMENTO },
    select: { id: true },
  });
  if (!servico) return { ok: false, motivo: "servico-inexistente" };

  const existentesCru = await prisma.servicoRequisito.findMany({
    where: { servicoId: servico.id },
    select: { id: true, titulo: true, tipo: true, obrigatorio: true, _count: { select: { arquivos: true } } },
  });

  // Quem já guarda arquivo do cliente vai na frente: se houver linha repetida do mesmo
  // documento, a que vale é a que tem o documento dentro.
  const arquivosDe = new Map(existentesCru.map((e) => [e.id, e._count.arquivos]));
  const existentes = [...existentesCru]
    .sort((a, b) => (arquivosDe.get(b.id) ?? 0) - (arquivosDe.get(a.id) ?? 0))
    .map(({ id, titulo, tipo, obrigatorio }) => ({ id, titulo, tipo, obrigatorio }));

  const plano = planejarSincronizacaoDocumentos(existentes);

  for (const d of plano.criar) {
    await prisma.servicoRequisito.create({
      data: {
        servicoId: servico.id,
        titulo: d.titulo,
        descricao: d.descricao,
        tipo: d.tipo,
        obrigatorio: d.obrigatorio,
        escopo: d.escopo,
        frenteVerso: d.frenteVerso,
        travaElegibilidade: d.travaElegibilidade,
        ordem: d.ordem,
      },
    });
  }
  for (const a of plano.atualizar) {
    await prisma.servicoRequisito.update({ where: { id: a.id }, data: a.dados });
  }
  for (const r of plano.rebaixar) {
    await prisma.servicoRequisito.update({ where: { id: r.id }, data: { obrigatorio: false, ordem: r.ordem } });
  }

  // Linha repetida é lixo NOSSO, não escolha da Thaís: apaga de verdade quando não há
  // arquivo preso nela. Se tiver arquivo, só sai da conta — apagar soltaria o documento
  // do cliente (`Arquivo.requisitoId` é `SetNull`), e isso não se desfaz.
  let apagados = 0;
  let mantidos = 0;
  for (const d of plano.duplicados) {
    if ((arquivosDe.get(d.id) ?? 0) === 0) {
      await prisma.servicoRequisito.delete({ where: { id: d.id } }).catch(() => {});
      apagados++;
    } else {
      await prisma.servicoRequisito.update({ where: { id: d.id }, data: { obrigatorio: false } });
      mantidos++;
    }
  }

  return {
    ok: true,
    criados: plano.criar.length,
    atualizados: plano.atualizar.length,
    rebaixados: plano.rebaixar.length,
    duplicadosApagados: apagados,
    duplicadosMantidos: mantidos,
  };
}

// ── Profissionais do cliente ─────────────────────────────────────────────────

const limpar = (v: string | undefined | null) => (v?.trim() ? v.trim() : null);

export async function listProfissionais(clienteId: string) {
  return prisma.profissional.findMany({ where: { clienteId }, orderBy: [{ ativo: "desc" }, { nome: "asc" }] });
}

export async function criarProfissional(input: CreateProfissionalInput) {
  return prisma.profissional.create({
    data: {
      clienteId: input.clienteId,
      nome: input.nome.trim(),
      conselho: input.conselho,
      conselhoNumero: limpar(input.conselhoNumero),
      conselhoUf: limpar(input.conselhoUf),
      especialidade: limpar(input.especialidade),
      anoFormatura: input.anoFormatura ?? null,
      tituloEspecialista: input.tituloEspecialista ?? false,
      responsavelTecnico: input.responsavelTecnico ?? false,
    },
  });
}

export async function atualizarProfissional(input: UpdateProfissionalInput) {
  const { id, ...dados } = input;
  const data: Record<string, unknown> = {};
  if (dados.nome !== undefined) data.nome = dados.nome.trim();
  if (dados.conselho !== undefined) data.conselho = dados.conselho;
  if (dados.conselhoNumero !== undefined) data.conselhoNumero = limpar(dados.conselhoNumero);
  if (dados.conselhoUf !== undefined) data.conselhoUf = limpar(dados.conselhoUf);
  if (dados.especialidade !== undefined) data.especialidade = limpar(dados.especialidade);
  if (dados.anoFormatura !== undefined) data.anoFormatura = dados.anoFormatura ?? null;
  if (dados.tituloEspecialista !== undefined) data.tituloEspecialista = dados.tituloEspecialista;
  if (dados.responsavelTecnico !== undefined) data.responsavelTecnico = dados.responsavelTecnico;
  if (dados.ativo !== undefined) data.ativo = dados.ativo;
  return prisma.profissional.update({ where: { id }, data }).catch(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Profissional não encontrado." });
  });
}

/**
 * Tira o profissional da lista. Se ele já tem documento enviado **ou credenciamento
 * registrado**, **desativa** em vez de apagar: `Arquivo.profissionalId` é `SetNull` (apagar
 * deixaria o arquivo do cliente solto e invisível) e `Credenciamento` é `Cascade` (apagar
 * levaria junto o andamento na operadora e o elo com a cobrança). Cadastro recém-criado por
 * engano, sem nada preso, é apagado de verdade — senão um erro de digitação ficaria para
 * sempre.
 */
export async function removerProfissional(id: string) {
  const [arquivos, credenciamentos] = await Promise.all([
    prisma.arquivo.count({ where: { profissionalId: id, deletedAt: null } }),
    prisma.credenciamento.count({ where: { profissionalId: id } }),
  ]);
  if (arquivos > 0 || credenciamentos > 0) {
    await prisma.profissional.update({ where: { id }, data: { ativo: false } });
    return { ok: true, desativado: true as const, arquivos, credenciamentos };
  }
  await prisma.profissional.delete({ where: { id } }).catch(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Profissional não encontrado." });
  });
  return { ok: true, desativado: false as const, arquivos: 0 };
}

// ── A visão de credenciamento de um cliente ──────────────────────────────────

/**
 * Junta num lugar só o que a ficha, o painel do lead e o Portal precisam saber: quem são
 * os profissionais, o que a triagem diz, quais documentos faltam e quanto da papelada já
 * veio. Uma consulta, uma verdade — as três telas não podem divergir.
 */
export async function credenciamentoDoCliente(clienteId: string) {
  await sincronizarRequisitosCredenciamento().catch(() => {});

  const [cliente, profissionais, servico] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true, nome: true } }),
    prisma.profissional.findMany({ where: { clienteId, ativo: true }, orderBy: { nome: "asc" } }),
    prisma.servico.findFirst({ where: { nome: NOME_SERVICO_CREDENCIAMENTO }, select: { id: true } }),
  ]);
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });

  // O credenciamento só existe para quem contratou o serviço — senão a papelada dele
  // apareceria na ficha (e no Portal) de todo cliente da casa, pedindo alvará a quem só
  // faz marketing. Profissional já cadastrado também conta: se alguém está ali, o assunto
  // está em curso, mesmo que a contratação ainda não tenha sido registrada.
  const contratado = servico
    ? (await prisma.clienteServico.findUnique({
        where: { clienteId_servicoId: { clienteId, servicoId: servico.id } },
        select: { status: true },
      }))?.status === "ATIVO"
    : false;
  const emCurso = contratado || profissionais.length > 0;

  const requisitos = servico
    ? await prisma.servicoRequisito.findMany({
        where: { servicoId: servico.id, tipo: "DOCUMENTO" },
        orderBy: { ordem: "asc" },
        select: {
          id: true,
          titulo: true,
          descricao: true,
          obrigatorio: true,
          escopo: true,
          frenteVerso: true,
          travaElegibilidade: true,
        },
      })
    : [];

  const arquivos = requisitos.length
    ? await prisma.arquivo.findMany({
        where: { clienteId, deletedAt: null, requisitoId: { in: requisitos.map((r) => r.id) } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          nome: true,
          tamanho: true,
          mimetype: true,
          requisitoId: true,
          profissionalId: true,
          lado: true,
          createdAt: true,
        },
      })
    : [];

  // Uma trava está satisfeita quando QUALQUER exigência marcada com ela já tem arquivo.
  const entregue = new Set(arquivos.map((a) => a.requisitoId));
  const travaAtendida = (trava: TravaElegibilidade) =>
    requisitos.some((r) => r.travaElegibilidade === trava && entregue.has(r.id));

  const triagem = triarCredenciamento({
    clinica: {
      alvaraFuncionamento: travaAtendida("ALVARA_FUNCIONAMENTO"),
      alvaraVigilancia: travaAtendida("ALVARA_VIGILANCIA"),
      cnes: travaAtendida("CNES"),
    },
    profissionais: profissionais.map((p) => ({
      id: p.id,
      nome: p.nome,
      anoFormatura: p.anoFormatura,
      tituloEspecialista: p.tituloEspecialista,
    })),
  });

  const progresso = progressoCredenciamento({
    requisitos: requisitos.map((r) => ({
      id: r.id,
      escopo: (r.escopo as EscopoRequisito | null) ?? null,
      frenteVerso: r.frenteVerso,
      obrigatorio: r.obrigatorio,
    })),
    profissionais: profissionais.map((p) => ({ id: p.id })),
    enviados: arquivos
      .filter((a): a is typeof a & { requisitoId: string } => !!a.requisitoId)
      .map((a) => ({
        requisitoId: a.requisitoId,
        profissionalId: a.profissionalId,
        lado: (a.lado as LadoArquivo | null) ?? null,
      })),
  });

  /** As vagas de uma exigência, já com o arquivo que preenche cada uma (ou null). */
  const vagasDo = (requisitoId: string, frenteVerso: boolean, profissionalId: string | null) => {
    const lados: (LadoArquivo | null)[] = frenteVerso ? ["FRENTE", "VERSO"] : [null];
    return lados.map((lado) => ({
      lado,
      profissionalId,
      arquivo:
        arquivos.find(
          (a) => a.requisitoId === requisitoId && (a.profissionalId ?? null) === profissionalId && (a.lado ?? null) === lado,
        ) ?? null,
    }));
  };

  const montar = (r: (typeof requisitos)[number], profissionalId: string | null) => ({
    id: r.id,
    titulo: r.titulo,
    descricao: r.descricao,
    obrigatorio: r.obrigatorio,
    frenteVerso: r.frenteVerso,
    travaElegibilidade: r.travaElegibilidade as TravaElegibilidade | null,
    vagas: vagasDo(r.id, r.frenteVerso, profissionalId),
  });

  // Todo cliente é pessoa jurídica (ADR-119), então os documentos de EMPRESA valem sempre —
  // antes daqui este filtro escondia o grupo inteiro quando a conta era pessoa física.
  const grupos = ESCOPOS_REQUISITO.filter((e) => e !== "PROFISSIONAL")
    .map((escopo) => ({
      escopo,
      titulo: ESCOPO_REQUISITO_LABEL[escopo],
      requisitos: requisitos.filter((r) => r.escopo === escopo).map((r) => montar(r, null)),
    }))
    .filter((g) => g.requisitos.length > 0);

  const requisitosDoProfissional = requisitos.filter((r) => r.escopo === "PROFISSIONAL");
  const porProfissional = profissionais.map((p) => ({
    profissional: {
      id: p.id,
      nome: p.nome,
      conselho: p.conselho,
      conselhoNumero: p.conselhoNumero,
      conselhoUf: p.conselhoUf,
      especialidade: p.especialidade,
      anoFormatura: p.anoFormatura,
      tituloEspecialista: p.tituloEspecialista,
      responsavelTecnico: p.responsavelTecnico,
    },
    requisitos: requisitosDoProfissional.map((r) => montar(r, p.id)),
  }));

  // Exigências sem escopo (as antigas, que a Thaís não pede) ficam à parte, para não se
  // misturarem com a lista real e para ela ver o que ainda está preso ali.
  const semEscopo = requisitos.filter((r) => !r.escopo).map((r) => montar(r, null));

  return {
    cliente,
    contratado,
    emCurso,
    profissionais,
    triagem,
    progresso: {
      total: progresso.total,
      atendidas: progresso.atendidas,
      faltam: progresso.faltam,
      percentual: progresso.percentual,
    },
    grupos,
    porProfissional,
    semEscopo,
    servicoId: servico?.id ?? null,
  };
}

/**
 * O mesmo, recortado para o CLIENTE ler no Portal: some o veredito comercial e sobra o que
 * ele resolve entregando alguma coisa. Ele nunca lê "inapto" nem o motivo de uma recusa —
 * a triagem é ferramenta da Thaís, não julgamento entregue ao cliente.
 */
export async function credenciamentoParaOPortal(clienteId: string) {
  const v = await credenciamentoDoCliente(clienteId);
  // Quem não contratou credenciamento não vê papelada de credenciamento.
  if (!v.emCurso) return null;
  return {
    profissionais: v.profissionais.map((p) => ({ id: p.id, nome: p.nome, especialidade: p.especialidade })),
    pendencias: motivosParaOCliente(v.triagem),
    progresso: v.progresso,
    grupos: v.grupos,
    porProfissional: v.porProfissional,
  };
}
