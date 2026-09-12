import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { sobraResponsavel, PORTAL_PRECISA_DE_UM_RESPONSAVEL, type PortalPapel } from "@app/shared";

/**
 * AS DUAS PERGUNTAS SOBRE "QUEM FALA PELA CLÍNICA", NUM ARQUIVO SÓ.
 *
 * Elas nasceram dentro de `pessoas.service.ts`, servindo apenas às telas do Portal e da ficha.
 * Só que existe uma TERCEIRA porta que cria e desativa conta de Portal — a tela interna
 * *Equipe e acessos* (`usuarios.service.ts`) — e ela não passava por nenhuma das duas:
 *
 * - Criar/convidar por lá não gravava `papelPortal`. Nulo vale como RESPONSAVEL (contas
 *   anteriores à ADR-131), então **toda secretária cadastrada pela Med podia assinar contrato**,
 *   furando na origem a trava que as ADR-131 e 137 construíram.
 * - Desativar por lá não perguntava se sobrava responsável: dava para deixar a clínica sem
 *   ninguém que pudesse assinar, em silêncio.
 *
 * O arquivo é separado por causa de ciclo de módulos: `pessoas.service.ts` já importa
 * `gerarConvite` de `usuarios.service.ts`, então o caminho de volta não pode ser um import
 * estático. Aqui só entram Prisma e regra pura.
 */

/** As contas de Portal daquela clínica, no formato que a regra pura entende. */
async function contasDaClinica(clienteId: string) {
  const users = await prisma.user.findMany({
    where: { clienteId, role: "CLIENTE", deletedAt: null },
    select: { id: true, papelPortal: true, acessoRevogadoEm: true },
  });
  // ⚠️ `ativo` aqui é "não revogado", NUNCA a coluna `ativo`: quem foi convidado ontem e ainda
  // não criou a senha também é `ativo: false`, e essa pessoa pode ser a dona da clínica.
  return users.map((u) => ({ id: u.id, papel: u.papelPortal, ativo: !u.acessoRevogadoEm }));
}

/**
 * O papel com que uma pessoa NOVA daquela clínica nasce, quando ninguém escolheu.
 *
 * Sem ninguém falando pela clínica, a primeira é RESPONSAVEL — senão a clínica nasceria sem
 * quem assinasse. Havendo alguém, a seguinte entra como EQUIPE, e quem administra promove
 * depois: errar para este lado tira um poder que se devolve num clique; errar para o outro dá
 * poder de assinar contrato a quem só ia anexar documento.
 */
export async function papelPortalPadraoDaClinica(clienteId: string): Promise<PortalPapel> {
  const contas = await contasDaClinica(clienteId);
  return contas.some((c) => c.ativo && c.papel !== "EQUIPE") ? "EQUIPE" : "RESPONSAVEL";
}

/** Recusa a mudança que deixaria a clínica sem ninguém para assinar. */
export async function assertSobraResponsavel(
  clienteId: string,
  mudanca: { id: string; papel?: PortalPapel | null; ativo?: boolean },
) {
  if (!sobraResponsavel(await contasDaClinica(clienteId), mudanca)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: PORTAL_PRECISA_DE_UM_RESPONSAVEL });
  }
}
