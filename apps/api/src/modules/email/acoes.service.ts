import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { comCaixa } from "./imap.js";
import { normalizarEndereco } from "./enderecos.js";
import { carregarCasa, ehEnderecoDaCasa, type Casa } from "./casa.js";
import { MIMETYPES_ACEITOS, TAMANHO_MAX, salvarArquivo, removerArquivo } from "../../lib/storage.js";
import { registrarUpload } from "../arquivos/arquivos.service.js";
import { createLead } from "../leads/leads.service.js";

/**
 * O que a equipe faz A PARTIR de um e-mail (fases 2D-2 e 2D-3): guardar um anexo como documento
 * do cliente e transformar um remetente desconhecido em lead.
 *
 * As duas ações são de ESCRITA e nascem de um id que veio da tela, então valem aqui as mesmas
 * três regras do resto do módulo:
 *
 * 1. **Posse no `where`.** A mensagem tem de ser da caixa de quem clicou, e isso vai dentro da
 *    própria consulta — nunca numa comparação depois da leitura.
 * 2. **A trava da casa (ADR-97).** Endereço do nosso domínio não vira chave de nada: nem acha
 *    cliente, nem vira lead. Sem isso, a primeira conversa entre colegas encheria o funil.
 * 3. **Nada duplica.** Clicar duas vezes (ou dois colegas clicando ao mesmo tempo) devolve o que
 *    já existe em vez de criar um segundo documento/lead.
 */

/** Teto de endereços de uma mensagem que viram chave de busca — um e-mail com 200 cópias não vira um `IN (...)` gigante. */
const MAXIMO_ENDERECOS = 50;

/** Nome que aparece no funil quando o lead nasce de um e-mail sem `From` decente. */
const NOME_SEM_REMETENTE = "Contato por e-mail";

/**
 * O `Content-Type` do anexo vem do e-mail e costuma trazer parâmetros
 * (`application/pdf; name="contrato.pdf"`). Só a parte base interessa para comparar com a
 * allowlist — e em minúsculas, porque o cabeçalho não tem caixa canônica.
 */
export function tipoBase(tipo: string | null | undefined): string {
  return (tipo ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * `Lead.nome` é obrigatório no banco e é o que a equipe lê no card do funil. O nome do `From` é
 * o melhor palpite; sem ele, a parte local do endereço já diz mais do que um card em branco.
 */
export function nomeDoRemetente(deNome: string | null | undefined, deEmail: string): string {
  const nome = (deNome ?? "").trim();
  if (nome) return nome;
  const local = (deEmail ?? "").split("@")[0]!.trim();
  return local || NOME_SEM_REMETENTE;
}

/**
 * Quais clientes casam com estes endereços — a mesma pergunta que a ficha faz, na direção
 * inversa (da mensagem para o cliente). Passa pelo mesmo filtro da casa: endereço nosso nunca
 * é chave, senão bastaria pôr `contato@medconsultoria.com.br` num cadastro para que todo e-mail
 * interno "pertencesse" àquele cliente.
 */
async function clientesPorEnderecos(brutos: Array<string | null | undefined>, casa: Casa) {
  const vistos = new Set<string>();
  for (const bruto of brutos) {
    const e = bruto ? normalizarEndereco(bruto) : "";
    if (e && !ehEnderecoDaCasa(e, casa)) vistos.add(e);
  }
  const enderecos = [...vistos].slice(0, MAXIMO_ENDERECOS);
  if (enderecos.length === 0) return [];
  return prisma.cliente.findMany({
    where: {
      deletedAt: null,
      OR: [{ email: { in: enderecos } }, { contatos: { some: { email: { in: enderecos } } } }],
    },
    select: { id: true, nome: true },
    // Mais de um já é ambiguidade, e a tela resolve perguntando: não precisa listar o cadastro inteiro.
    take: 5,
  });
}

export interface ContextoDaMensagem {
  /** Clientes que casam com os endereços da mensagem (vazio = ninguém conhecido). */
  clientes: Array<{ id: string; nome: string }>;
  /** Lead ativo do remetente, se houver. */
  lead: { id: string; nome: string } | null;
  /** Remetente do nosso próprio domínio: a tela não oferece "virar lead" para colega. */
  remetenteDaCasa: boolean;
}

/**
 * O que a tela precisa saber para decidir quais ações oferecer nesta mensagem — quem é o cliente
 * (para guardar anexo sem perguntar) e se o remetente é desconhecido (para oferecer virar lead).
 *
 * Vive fora do `abrirMensagem` de propósito: aquilo já é a operação cara (baixa e higieniza o
 * corpo), e este contexto é barato, cacheável à parte e não pode atrasar a leitura.
 */
export async function contextoDaMensagem(userId: string, mensagemId: string): Promise<ContextoDaMensagem> {
  const msg = await prisma.emailMensagem.findFirst({
    where: { id: mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    select: { deEmail: true, enderecos: { select: { endereco: true } } },
  });
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });

  const casa = await carregarCasa();
  const remetente = normalizarEndereco(msg.deEmail);
  const remetenteDaCasa = !!remetente && ehEnderecoDaCasa(remetente, casa);

  const clientes = await clientesPorEnderecos(
    [msg.deEmail, ...msg.enderecos.map((e) => e.endereco)],
    casa,
  );

  // Lead só interessa pelo REMETENTE: quem está em cópia não é dono da conversa.
  const lead =
    remetente && !remetenteDaCasa
      ? await prisma.lead.findFirst({
          where: { email: remetente, deletedAt: null, convertidoEmClienteId: null },
          select: { id: true, nome: true },
        })
      : null;

  return { clientes, lead, remetenteDaCasa };
}

export interface ArquivarAnexoInput {
  mensagemId: string;
  anexoId: string;
  /** Quando a tela pergunta a quem pertence (sem vínculo, ou com mais de um candidato). */
  clienteId?: string;
}

export interface AnexoArquivado {
  arquivoId: string;
  nome: string;
  clienteId: string;
  /** `true` quando o anexo já estava guardado: o clique foi repetido, e nada novo foi criado. */
  jaExistia: boolean;
}

/**
 * Fase 2D-2: o anexo que chegou por e-mail vira documento do cliente, com um clique.
 *
 * O conteúdo NÃO está no nosso banco (o índice só guarda metadado, ADR-95), então ele é baixado
 * do IMAP na hora. Dois cuidados que não são negociáveis:
 *
 *  - **Gravar DENTRO do `comCaixa`.** A conexão IMAP fecha assim que o callback retorna, e
 *    `download()` resolve depois do primeiro pedaço — o resto ainda está vindo pelo socket.
 *    Devolver o stream para fora e gravar depois entregaria arquivo cortado (mesma lição da
 *    rota de download, `http/email-anexo.ts`).
 *  - **Allowlist de tipo.** Aqui ela vale, ao contrário do anexo de SAÍDA: o arquivo entra no
 *    acervo de documentos do cliente, que o Portal serve com o `Content-Type` do banco. O que
 *    o acervo aceita é o que `/upload` aceita — PDF, imagem, Word e Excel.
 */
export async function arquivarAnexoComoDocumento(
  userId: string,
  input: ArquivarAnexoInput,
): Promise<AnexoArquivado> {
  const anexo = await prisma.emailAnexo.findFirst({
    where: {
      id: input.anexoId,
      mensagemId: input.mensagemId,
      mensagem: { pasta: { caixa: { userId, deletedAt: null } } },
    },
    select: {
      id: true,
      nome: true,
      tipo: true,
      parte: true,
      arquivoId: true,
      mensagem: {
        select: {
          id: true,
          uid: true,
          deEmail: true,
          pasta: { select: { caminho: true, caixaId: true } },
          enderecos: { select: { endereco: true } },
        },
      },
    },
  });
  if (!anexo) throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado." });

  // Já guardado? Devolve o mesmo documento. O elo só vale se o documento ainda existe: quem
  // apagou o arquivo da ficha e clicou de novo está pedindo para guardar outra vez, não para
  // receber o id de um registro que sumiu.
  if (anexo.arquivoId) {
    const existente = await prisma.arquivo.findFirst({
      where: { id: anexo.arquivoId, deletedAt: null },
      select: { id: true, nome: true, clienteId: true },
    });
    if (existente) {
      return { arquivoId: existente.id, nome: existente.nome, clienteId: existente.clienteId, jaExistia: true };
    }
  }

  const mimetype = tipoBase(anexo.tipo);
  if (!MIMETYPES_ACEITOS.has(mimetype)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `Documentos do cliente aceitam PDF, imagem, Word e Excel — este anexo é "${mimetype || "de tipo desconhecido"}". ` +
        `Baixe o anexo e guarde manualmente se precisar dele na ficha.`,
    });
  }

  const casa = await carregarCasa();
  let clienteId: string;
  if (input.clienteId) {
    const escolhido = await prisma.cliente.findFirst({
      where: { id: input.clienteId, deletedAt: null },
      select: { id: true },
    });
    if (!escolhido) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
    clienteId = escolhido.id;
  } else {
    const candidatos = await clientesPorEnderecos(
      [anexo.mensagem.deEmail, ...anexo.mensagem.enderecos.map((e) => e.endereco)],
      casa,
    );
    if (candidatos.length === 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Este e-mail não está ligado a nenhum cliente. Escolha de quem é o documento.",
      });
    }
    if (candidatos.length > 1) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          `Este e-mail toca mais de um cliente (${candidatos.map((c) => c.nome).join(", ")}). ` +
          `Escolha de quem é o documento.`,
      });
    }
    clienteId = candidatos[0]!.id;
  }

  // `marcarErro: false`: guardar um anexo é acessório e falhar aqui (tipicamente o limite de
  // conexões IMAP simultâneas) não é prova de que a CAIXA está quebrada — mesmo critério do
  // download e do descarte de rascunho. Quem clicou continua vendo o erro.
  const salvo = await comCaixa(
    anexo.mensagem.pasta.caixaId,
    async (c) => {
      const lock = await c.getMailboxLock(anexo.mensagem.pasta.caminho);
      try {
        const r = await c.download(String(anexo.mensagem.uid), anexo.parte, { uid: true });
        if (!r?.content) return null;
        // Gravação AQUI DENTRO, com a conexão viva — ver o cabeçalho desta função.
        return await salvarArquivo(clienteId, anexo.nome, r.content);
      } finally {
        lock.release();
      }
    },
    { marcarErro: false },
  );
  if (!salvo) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "O servidor de e-mail não devolveu este anexo. Tente de novo em instantes.",
    });
  }

  // O tamanho do índice é metadado do servidor de e-mail e pode mentir; quem decide é o disco.
  // Acima do teto do acervo, desfaz a gravação em vez de deixar um arquivo órfão lá dentro.
  if (salvo.tamanho > TAMANHO_MAX) {
    await removerArquivo(salvo.caminho);
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: `Anexo acima do limite de ${TAMANHO_MAX / 1024 / 1024} MB para documentos do cliente.`,
    });
  }

  const arquivo = await registrarUpload({
    clienteId,
    nome: anexo.nome,
    mimetype,
    tamanho: salvo.tamanho,
    caminho: salvo.caminho,
    // Quem guardou foi a equipe, ainda que o arquivo tenha vindo do cliente: `enviadoPorTipo`
    // responde "por qual porta entrou", e a porta aqui é a caixa de alguém da casa. Marcar
    // CLIENTE dispararia o aviso de "cliente enviou documento" para a equipe inteira.
    enviadoPorTipo: "EQUIPE",
    enviadoPorId: userId,
  });

  await prisma.emailAnexo.update({ where: { id: anexo.id }, data: { arquivoId: arquivo.id } });

  // Auditoria com ids, nunca com assunto ou conteúdo — o log do painel ROOT não pode virar
  // outra porta para a correspondência (mesmo critério do `marcarParticular`).
  await prisma.activityLog
    .create({
      data: {
        userId,
        acao: "email_anexo_arquivado",
        entidadeTipo: "arquivo",
        entidadeId: arquivo.id,
      },
    })
    .catch(() => {});

  return { arquivoId: arquivo.id, nome: arquivo.nome, clienteId, jaExistia: false };
}

export interface LeadDoRemetente {
  leadId: string;
  nome: string;
  /** `true` quando o remetente já tinha lead ativo: devolvemos o dele em vez de criar outro. */
  jaExistia: boolean;
}

/**
 * Fase 2D-3: o e-mail de quem ainda não está no sistema vira lead, com um clique.
 *
 * A ordem das recusas é a ordem do risco: colega da casa nunca vira lead (ADR-97); quem já é
 * cliente não volta para o funil; e quem já é lead ativo devolve o lead que existe.
 */
export async function criarLeadDoRemetente(
  userId: string,
  input: { mensagemId: string },
): Promise<LeadDoRemetente> {
  const msg = await prisma.emailMensagem.findFirst({
    where: { id: input.mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    select: {
      id: true,
      deNome: true,
      deEmail: true,
      assunto: true,
      dataEm: true,
      pasta: { select: { caixa: { select: { id: true, email: true } } } },
    },
  });
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });

  const remetente = normalizarEndereco(msg.deEmail);
  if (!remetente || !remetente.includes("@")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Esta mensagem não tem um remetente válido." });
  }

  const casa = await carregarCasa();
  if (ehEnderecoDaCasa(remetente, casa)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Este e-mail é de alguém da própria equipe — colega não vira lead.",
    });
  }

  const clientes = await clientesPorEnderecos([remetente], casa);
  if (clientes.length > 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Este remetente já é cliente (${clientes[0]!.nome}).`,
    });
  }

  // Mesmo critério de deduplicação da captação pelo site (`capturarLead`): só lead ATIVO
  // bloqueia. Lead apagado ou já convertido em cliente não impede um negócio novo.
  const jaLead = await prisma.lead.findFirst({
    where: { email: remetente, deletedAt: null, convertidoEmClienteId: null },
    select: { id: true, nome: true },
  });
  if (jaLead) return { leadId: jaLead.id, nome: jaLead.nome, jaExistia: true };

  const quando = msg.dataEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const rastreio = [
    `Criado a partir de um e-mail recebido na caixa ${msg.pasta.caixa.email} em ${quando}.`,
    msg.assunto ? `Assunto: ${msg.assunto}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const lead = await createLead(
    { nome: nomeDoRemetente(msg.deNome, remetente), email: remetente, origem: "E-mail" },
    userId,
    rastreio,
  );
  return { leadId: lead.id, nome: lead.nome, jaExistia: false };
}
