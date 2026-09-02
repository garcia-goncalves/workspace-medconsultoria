import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { notificar } from "../notificacoes/notificacoes.service.js";
import { removerArquivo as removerArquivoDisco } from "../../lib/storage.js";
import { reconciliarCardsDoServico } from "../projetos/projetos.service.js";

/** Destinatários internos de um aviso sobre um cliente: responsável + gestão (ADMIN/ROOT). */
export async function equipeDoCliente(clienteId: string, excluir?: string): Promise<string[]> {
  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { responsavelId: true } });
  const gestao = await prisma.user.findMany({
    where: { ativo: true, deletedAt: null, role: { in: ["ADMIN", "ROOT"] } },
    select: { id: true },
  });
  const ids = new Set<string>(gestao.map((g) => g.id));
  if (cliente?.responsavelId) ids.add(cliente.responsavelId);
  if (excluir) ids.delete(excluir);
  return [...ids];
}

interface RegistrarUploadInput {
  clienteId: string;
  servicoId?: string | null;
  requisitoId?: string | null;
  /** Credenciamento: de qual profissional é este documento, e qual lado (ADR-103). */
  profissionalId?: string | null;
  lado?: string | null;
  nome: string;
  mimetype: string;
  tamanho: number;
  caminho: string;
  enviadoPorTipo: "CLIENTE" | "EQUIPE";
  enviadoPorId: string;
}

/**
 * Registra os metadados de um arquivo já gravado no disco. Se veio do CLIENTE (Portal),
 * avisa a equipe (notificação + e-mail `documento_cliente_enviado`).
 */
export async function registrarUpload(input: RegistrarUploadInput) {
  // O id do profissional vem do formulário — inclusive do Portal, onde quem digita é o
  // cliente. Só vale se aquele profissional for DESTE cliente; qualquer outro id é
  // descartado, e não recusado, para não virar oráculo de "este id existe?".
  const profissionalId = input.profissionalId
    ? ((await prisma.profissional.findFirst({ where: { id: input.profissionalId, clienteId: input.clienteId }, select: { id: true } }))?.id ?? null)
    : null;
  // ⚠️ NÃO HÁ CONFERÊNCIA DE POSSE PARA `servicoId`/`requisitoId` AQUI, E ISSO É DELIBERADO.
  //
  // A revisão de segurança apontou a assimetria: o `profissionalId` acima é conferido e estes
  // dois não são. Tentei fechar exigindo que o cliente tivesse o serviço contratado — e a
  // suíte de ponta a ponta reprovou, mostrando que a premissa estava errada: a papelada do
  // credenciamento aparece legitimamente para quem tem **médico cadastrado**, ainda que a
  // contratação não esteja registrada (`credenciamentoDoCliente`: `emCurso = contratado ||
  // profissionais.length > 0`). Com a regra estrita, o cliente enviava o documento e a barra
  // de progresso não andava.
  //
  // Repetir aquela condição aqui seria escrever a MESMA regra em dois lugares, que é o modo de
  // falha da ADR-133: no dia em que a visibilidade mudar, o upload continua com a régua velha e
  // o cliente perde o documento em silêncio. E o que se ganharia é pouco — o estrago possível
  // fica todo dentro do próprio `clienteId` (arquivar um documento sob um serviço que ele não
  // contratou), sem atravessar a fronteira entre clínicas.
  //
  // Se um dia isto for fechado, a régua tem de ser UMA função exportada por
  // `credenciamento.service.ts`, chamada pelos dois lados — nunca uma cópia.

  const lado = input.lado === "FRENTE" || input.lado === "VERSO" ? input.lado : null;

  const arquivo = await prisma.arquivo.create({
    data: {
      clienteId: input.clienteId,
      servicoId: input.servicoId ?? null,
      requisitoId: input.requisitoId ?? null,
      profissionalId,
      lado,
      nome: input.nome,
      mimetype: input.mimetype,
      tamanho: input.tamanho,
      caminho: input.caminho,
      enviadoPorTipo: input.enviadoPorTipo,
      enviadoPorId: input.enviadoPorId,
    },
  });

  if (input.enviadoPorTipo === "CLIENTE") {
    const cliente = await prisma.cliente.findUnique({ where: { id: input.clienteId }, select: { nome: true } });
    const destinos = await equipeDoCliente(input.clienteId);
    for (const uid of destinos) {
      await notificar(
        uid,
        "documento_cliente_enviado",
        { cliente: cliente?.nome ?? "Cliente", documento: input.nome },
        { entidadeTipo: "cliente", entidadeId: input.clienteId },
      ).catch(() => {});
    }
  }

  // Automação: entregar um documento de uma exigência marca o item no card do serviço e move o card.
  if (input.requisitoId) {
    const servicoId = input.servicoId ?? (await prisma.servicoRequisito.findUnique({ where: { id: input.requisitoId }, select: { servicoId: true } }))?.servicoId ?? null;
    if (servicoId) await reconciliarCardsDoServico(input.clienteId, servicoId).catch(() => {});
  }
  return arquivo;
}

/**
 * Lista os arquivos (não removidos) de um cliente, opcionalmente de um serviço.
 *
 * Traz o médico e o lado (ADR-103) porque a papelada do credenciamento REPETE por pessoa:
 * uma clínica com dois médicos tem seis linhas "Diploma", "Registro no Conselho" e
 * "Especializações" — frente e verso de cada um. Sem essas duas colunas, o acervo mostrava
 * seis itens de nome idêntico, e nem o cliente nem a equipe conseguiam dizer qual era qual
 * (nem qual apagar).
 */
export async function listarArquivos(clienteId: string, servicoId?: string) {
  const rows = await prisma.arquivo.findMany({
    where: { clienteId, deletedAt: null, ...(servicoId ? { servicoId } : {}) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      nome: true,
      mimetype: true,
      tamanho: true,
      servicoId: true,
      requisitoId: true,
      lado: true,
      enviadoPorTipo: true,
      createdAt: true,
      servico: { select: { nome: true } },
      requisito: { select: { titulo: true } },
      profissional: { select: { id: true, nome: true } },
    },
  });
  return rows;
}

/** Busca um arquivo para download (metadados + caminho). Lança se não existe/removido. */
export async function getArquivo(id: string) {
  const arquivo = await prisma.arquivo.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, nome: true, mimetype: true, caminho: true, clienteId: true },
  });
  if (!arquivo) throw new TRPCError({ code: "NOT_FOUND", message: "Arquivo não encontrado." });
  return arquivo;
}

/**
 * Remove um arquivo (soft-delete do registro + apaga do disco). Se `clienteScope` vier,
 * garante que o arquivo é daquele cliente (escopo do Portal).
 */
export async function removerArquivo(id: string, clienteScope?: string, removidoPorId?: string) {
  const arquivo = await prisma.arquivo.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, caminho: true, clienteId: true, servicoId: true, requisitoId: true },
  });
  if (!arquivo) throw new TRPCError({ code: "NOT_FOUND", message: "Arquivo não encontrado." });
  if (clienteScope && arquivo.clienteId !== clienteScope) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sem acesso a este arquivo." });
  }
  await prisma.arquivo.update({ where: { id }, data: { deletedAt: new Date() } });
  await removerArquivoDisco(arquivo.caminho);
  // Registro de auditoria: quem removeu e quando (a remoção da equipe informa o userId).
  if (removidoPorId) {
    await prisma.activityLog
      .create({ data: { userId: removidoPorId, acao: "arquivo.removido", entidadeTipo: "arquivo", entidadeId: id } })
      .catch(() => {});
  }

  // Remover a entrega pode desmarcar o item e voltar o card para "Aguardando cliente".
  if (arquivo.requisitoId) {
    const servicoId = arquivo.servicoId ?? (await prisma.servicoRequisito.findUnique({ where: { id: arquivo.requisitoId }, select: { servicoId: true } }))?.servicoId ?? null;
    if (servicoId) await reconciliarCardsDoServico(arquivo.clienteId, servicoId).catch(() => {});
  }
  return { ok: true };
}
