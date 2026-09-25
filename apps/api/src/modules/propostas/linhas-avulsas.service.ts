import { z } from "zod";
import { prisma } from "@app/db";
import { garantirCategoriaHonorarios } from "../servicos/credenciamento.service.js";

/**
 * A LINHA AVULSA DA PROPOSTA PERSONALIZADA VIRA COBRANÇA NO ACEITE (Onda 4A).
 *
 * A linha avulsa ("Treinamento da recepção — 3 × R$ 400,00") é combinada naquele papel e não tem
 * serviço do catálogo por trás. Até aqui o aceite a ignorava: o cliente aceitava, a ficha ganhava
 * os serviços do catálogo e o dinheiro da linha avulsa ficava para alguém lembrar de lançar.
 *
 * ⚠️ O MODELO ESCOLHIDO: CONTA A RECEBER DIRETO, sem `ClienteServico`. A alternativa — criar um
 * `Servico` oculto por linha — poluiria o catálogo que alimenta a página pública, o Portal, a
 * semeadura por nome e o índice único de nome (ADR-147), tudo para guardar uma linha que existe
 * uma vez só. A linha avulsa não é serviço contratado; é um valor combinado. Ela aparece no
 * contrato automático como item do texto (`criarContrato`, parâmetro `linhasAvulsas`).
 *
 * ⚠️ NÃO PASSA PELA GUARDA DO LEAD ATIVO (`aConversaoAindaVaiCobrar`). Aquela guarda existe porque
 * a conversão do lead cobra o que está em `ClienteServico` — e a linha avulsa NÃO está lá, então a
 * conversão nunca a cobraria. Segurar aqui por causa do lead faria ninguém cobrar.
 *
 * ⚠️ IDEMPOTENTE PELO BANCO: reenviar a proposta para aceite reinicia a resposta, então a mesma
 * linha pode ser aceita de novo. A trava é o índice único `(origemDocumentoId, origemLinha)` —
 * `INSERT` primeiro, e a violação `P2002` é a resposta "já cobrada". Um "confere e grava" deixaria
 * duas respostas simultâneas passarem as duas (a lição da ADR-150). E uma conta APAGADA de
 * propósito no Financeiro continua segurando o índice: reaceitar não a ressuscita.
 */

/** O formato gravado em `Documento.linhasAvulsas` (ver `criarPropostaPersonalizada`). */
export const linhaAvulsaGravadaSchema = z.object({
  linha: z.number().int().min(0),
  descricao: z.string().min(1),
  valor: z.number().nonnegative(),
  quantidade: z.number().int().min(1),
  recorrencia: z.enum(["AVULSO", "MENSAL"]),
});
export type LinhaAvulsaGravada = z.infer<typeof linhaAvulsaGravadaSchema>;

/**
 * Lê a coluna JSON sem confiar nela: linha que não tem a forma esperada é descartada, não
 * derruba o aceite inteiro. (A coluna só é escrita por este código, mas é JSON solto no banco.)
 */
export function lerLinhasAvulsas(json: unknown): LinhaAvulsaGravada[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((l) => {
    const r = linhaAvulsaGravadaSchema.safeParse(l);
    return r.success ? [r.data] : [];
  });
}

const ehViolacaoDeUnico = (e: unknown) => (e as { code?: string })?.code === "P2002";

/**
 * Cria a conta a receber de cada linha avulsa com valor. Devolve quantas contas NASCERAM agora
 * (as já cobradas numa aceitação anterior não contam).
 */
export async function provisionarLinhasAvulsasAceitas(
  documentoId: string,
  clienteId: string,
  linhas: LinhaAvulsaGravada[],
  ator: { id: string },
): Promise<number> {
  const comValor = linhas.filter((l) => l.valor * l.quantidade > 0);
  if (!comValor.length) return 0;

  const [cliente, categoriaId] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } }),
    garantirCategoriaHonorarios(),
  ]);
  const vencimento = new Date();
  vencimento.setDate(vencimento.getDate() + 30);
  vencimento.setHours(12, 0, 0, 0);

  let criadas = 0;
  for (const l of comValor) {
    const mensal = l.recorrencia === "MENSAL";
    const valor = Math.round(l.valor * l.quantidade * 100) / 100;
    // Conferência prévia só para o caso comum (reaceite) não encher o log de erro do Prisma com
    // uma violação esperada. A GARANTIA continua sendo o índice, logo abaixo: duas respostas
    // simultâneas passam as duas por esta leitura.
    const jaCobrada = await prisma.conta.findFirst({
      where: { origemDocumentoId: documentoId, origemLinha: l.linha },
      select: { id: true },
    });
    if (jaCobrada) continue;
    try {
      await prisma.conta.create({
        data: {
          tipo: "RECEBER",
          descricao: `${mensal ? "Mensalidade" : "Serviço"}: ${l.descricao} — ${cliente?.nome ?? "cliente"}`,
          valor,
          vencimento,
          clienteId,
          categoriaId,
          recorrencia: mensal ? "MENSAL" : "NENHUMA",
          origemDocumentoId: documentoId,
          origemLinha: l.linha,
          observacoes:
            "Linha avulsa da proposta personalizada, provisionada quando o cliente aceitou. Revise o valor e o vencimento.",
        },
      });
    } catch (e) {
      if (ehViolacaoDeUnico(e)) continue; // já cobrada num aceite anterior desta mesma proposta.
      throw e;
    }
    criadas++;
    await prisma.activityLog.create({
      data: {
        userId: ator.id,
        acao: "conta.criada",
        entidadeTipo: "cliente",
        entidadeId: clienteId,
        dados: { origem: "proposta_aceita_linha_avulsa", documentoId, linha: l.linha },
      },
    });
  }
  return criadas;
}
