import { prisma } from "@app/db";

/**
 * PARA QUEM VAI O LINK DE ACEITE / ASSINATURA (ADR-137).
 *
 * O link ia para `Cliente.email` — a caixa **cadastral da clínica**, que costuma ser a da
 * recepção. Isso derrotava sozinho a trava que acabou de ser posta nas rotas de token: a
 * secretária EQUIPE, proibida de assinar pela clínica, abria a caixa da recepção, clicava no
 * link **sem estar logada** e assinava o contrato — porque quem não está logado é tratado como
 * o signatário legítimo, que é o desenho correto do link público.
 *
 * Desde a ADR-131 cada pessoa da clínica tem conta própria e um papel. O endereço do link passa
 * a ser o de **quem fala pela clínica**, e a caixa da clínica fica como reserva para o cliente
 * que ainda não tem ninguém no Portal — que é o estado da maioria hoje, e onde nada muda.
 *
 * ⚠️ **Conta convidada e ainda sem senha VALE.** `ativo = false` é ambíguo (ADR-131): significa
 * tanto "convidado, ainda não entrou" quanto "acesso revogado". Quem manda é o
 * `acessoRevogadoEm`. E quem já entrou vem antes — se houver os dois, o link vai para quem
 * comprovadamente abre a caixa.
 *
 * ⚠️ **Papel nulo vale como RESPONSAVEL**, a MESMA leitura de `podeNoPortal` e de
 * `podeAssinarPelaClinica`. Três leituras divergentes do mesmo nulo é o modo de falha da
 * ADR-133; por isso a condição aqui é "não é EQUIPE", nunca "é RESPONSAVEL".
 */
export async function destinatarioDeAssinatura(
  clienteId: string,
  reserva: { nome: string; email: string },
): Promise<{ nome: string; email: string }> {
  const responsavel = await prisma.user.findFirst({
    where: {
      clienteId,
      role: "CLIENTE",
      deletedAt: null,
      acessoRevogadoEm: null,
      NOT: { papelPortal: "EQUIPE" },
      email: { not: "" },
    },
    orderBy: [{ ativo: "desc" }, { createdAt: "asc" }],
    select: { nome: true, email: true },
  });
  return responsavel ?? reserva;
}
