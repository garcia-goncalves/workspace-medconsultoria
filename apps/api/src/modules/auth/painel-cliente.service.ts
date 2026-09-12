import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { SessionUser } from "@app/shared";
import { hasRoleLevel } from "@app/shared";
import { createSession, destroySession } from "../../lib/session.js";

/**
 * O PAINEL DO CLIENTE visto por dentro, pela equipe — a "sessão de suporte" (ADR-128).
 *
 * A ideia é a da revenda de hospedagem: quem revende entra no painel do cliente para conferir o
 * que ele está vendo, sem pedir a senha dele. Três coisas separam isto de "logar como o cliente",
 * e são elas que fazem a diferença entre suporte e problema:
 *
 * 1. **A sessão é identificada.** Ela pertence ao cliente (`userId`) mas guarda quem a abriu
 *    (`operadorId`). Sem isso, tudo o que a equipe fizer lá dentro fica registrado no nome do
 *    cliente — e ele reclamaria de algo que não fez, com o próprio sistema dando razão a ele.
 * 2. **Vê tudo, não assina nada.** Aceitar uma proposta no Portal cria contrato e conta a
 *    receber (ADR-104). Um clique errado da equipe viraria dívida no nome do cliente, sem prova
 *    de quem clicou. Quem barra é o próprio `portalProcedure`, que recusa toda MUTAÇÃO vinda de
 *    sessão de suporte — uma trava só, valendo inclusive para as ações que ainda não existem.
 * 3. **Dura 30 minutos e tem volta em um clique.** A sessão do operador continua viva; voltar é
 *    trocar o cookie, não fazer login de novo.
 *
 * ⚠️ **O isolamento do Portal não muda uma linha.** O `portalProcedure` continua filtrando tudo
 * pelo `clienteId` DA SESSÃO, então uma sessão de suporte enxerga exatamente o que aquele cliente
 * enxerga — nem um registro a mais.
 */

/**
 * O recado do modo só-leitura, num lugar só.
 *
 * ⚠️ **A trava em si NÃO mora aqui.** Ela está no `portalProcedure` (`trpc.ts`), barrando toda
 * MUTAÇÃO da sessão de suporte, e repetida no `/upload` (`http/uploads.ts`), que não passa por
 * lá. Marcar ação por ação foi descartado: exigiria acertar a lista hoje e lembrar dela em toda
 * ação nova, e a esquecida seria justamente a que morde — no Portal, escrever é sempre falar
 * pelo cliente.
 */
export const SUPORTE_SO_LEITURA =
  "Você está vendo o Portal como o cliente, em modo de suporte — só leitura. " +
  "Para agir, volte ao seu acesso e use as telas da equipe.";

/**
 * Quem pode abrir o painel de um cliente.
 *
 * ADMIN e acima, sempre. FUNCIONÁRIO só nos clientes sob a responsabilidade dele — negar por
 * padrão, porque isto dá acesso ao dado pessoal de terceiro e o mínimo necessário é a regra.
 */
export async function assertPodeVerOPainel(ator: SessionUser, clienteId: string) {
  if (!hasRoleLevel(ator.role, "FUNCIONARIO")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito à equipe." });
  }
  if (hasRoleLevel(ator.role, "ADMIN")) return;
  const meu = await prisma.cliente.findFirst({
    where: { id: clienteId, responsavelId: ator.id, deletedAt: null },
    select: { id: true },
  });
  if (!meu) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Você só pode abrir o painel dos clientes sob a sua responsabilidade.",
    });
  }
}

/**
 * Abre uma sessão de suporte no Portal deste cliente e devolve o id da nova sessão (o cookie).
 *
 * Só funciona com a conta do Portal **ativa** — ou seja, depois que o cliente definiu a própria
 * senha. Antes disso a conta existe mas está pendente, e uma sessão para conta inativa seria
 * recusada na primeira validação de qualquer jeito. É por isso que o card só mostra "Painel"
 * nesse estado; até lá ele mostra "Reenviar acesso".
 */
export async function abrirPainelDoCliente(
  clienteId: string,
  ator: SessionUser,
  sidDoOperador: string | undefined,
): Promise<{ sid: string; cliente: string }> {
  // Sem aninhamento: quem já está em modo de suporte volta ao próprio acesso antes de entrar em
  // outro painel. Aninhar faria a corrente de "voltar" mentir sobre onde a pessoa aterrissa.
  if (ator.operador) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Volte ao seu acesso antes de abrir o painel de outro cliente.",
    });
  }
  await assertPodeVerOPainel(ator, clienteId);

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, deletedAt: null },
    select: { id: true, nome: true },
  });
  if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });

  const doPortal = await prisma.user.findFirst({
    where: { clienteId, role: "CLIENTE", deletedAt: null },
    select: { id: true, ativo: true },
  });
  if (!doPortal) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Este cliente ainda não tem acesso ao Portal. Envie o acesso primeiro.",
    });
  }
  if (!doPortal.ativo) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "O cliente ainda não definiu a senha dele — não há painel para abrir. Reenvie o acesso.",
    });
  }

  const sid = await createSession(doPortal.id, {
    operadorId: ator.id,
    voltarParaSessionId: sidDoOperador,
  });
  // Acesso a dado pessoal de terceiro fica registrado. Não é capricho: é o que permite responder
  // "quem viu o quê, e quando" sem depender da memória de ninguém.
  await prisma.activityLog.create({
    data: { userId: ator.id, acao: "painel_cliente.entrou", entidadeTipo: "cliente", entidadeId: clienteId },
  });
  return { sid, cliente: cliente.nome };
}

/**
 * Encerra a sessão de suporte e devolve a sessão original do operador (ou `null` se ela já tiver
 * expirado, caso em que a tela manda para o login).
 */
export async function voltarDoPainel(
  atual: SessionUser,
  sidAtual: string | undefined,
): Promise<{ sid: string | null }> {
  if (!atual.operador) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Você não está em uma sessão de suporte." });
  }
  const voltarPara = atual.voltarParaSessionId ?? null;
  await prisma.activityLog.create({
    data: {
      userId: atual.operador.id,
      acao: "painel_cliente.saiu",
      entidadeTipo: "cliente",
      entidadeId: atual.clienteId,
    },
  });
  await destroySession(sidAtual);

  if (!voltarPara) return { sid: null };
  const original = await prisma.session.findUnique({
    where: { id: voltarPara },
    select: { id: true, expiresAt: true },
  });
  if (!original || original.expiresAt < new Date()) return { sid: null };
  return { sid: original.id };
}
