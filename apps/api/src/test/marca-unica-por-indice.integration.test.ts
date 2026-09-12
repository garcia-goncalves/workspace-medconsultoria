import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { criarServico, atualizarServico } from "../modules/servicos/servicos.service.js";

/**
 * A MARCA (ehCredenciamento / ehFaturamento) SÓ PODE HAVER UMA — E ISSO PRECISA VALER TAMBÉM
 * SOB CONCORRÊNCIA REAL, NÃO SÓ QUANDO AS DUAS REQUISIÇÕES CHEGAM EM ORDEM.
 *
 * ⚠️ ACHADO NA AUDITORIA DE 04/09/2026, FECHADO EM 10/09/2026: a conferência
 * (`recusarSegundaMarcaDeCredenciamento`/`recusarMarcaDeFaturamentoInvalida`) e a gravação eram
 * DUAS chamadas separadas ao banco. Dois admins EDITANDO serviços DIFERENTES ao mesmo tempo
 * passavam os dois pela conferência antes de qualquer um gravar — mesmo modo de falha que a
 * ADR-140 corrigiu para a conta do honorário. A cura é `tentarMarcarAtomicamente`
 * (`servicos.service.ts`): liga a marca num UPDATE só, com `NOT EXISTS` sobre as outras linhas —
 * sem migração, sem transação, sem índice novo no banco.
 *
 * A costura de injeção (como o W16 da ADR-150): forçamos a corrida de verdade com `Promise.all`
 * disparando as duas gravações ao mesmo tempo, contra o MySQL de teste real — não há outro jeito
 * de provar atomicidade além de tentar produzir a colisão. ⚠️ Como o catálogo semeado já traz um
 * "Faturamento"/"Credenciamento" marcado, cada teste desliga a marca ANTES da corrida (senão os
 * DOIS serviços novos perderiam para o canônico, não um contra o outro) e devolve como estava
 * depois — a mesma cautela que `marca-faturamento.integration.test.ts` já usa.
 */

const PFX = `marca-unica-${randomBytes(4).toString("hex")}`;

/** Desliga o que já estiver marcado com `campo`, roda `corrida`, e devolve como estava. */
async function comCampoDesligadoDurante(
  campo: "ehCredenciamento" | "ehFaturamento",
  corrida: () => Promise<void>,
): Promise<void> {
  const jaMarcado = await prisma.servico.findFirst({ where: { [campo]: true } });
  if (jaMarcado) await prisma.servico.update({ where: { id: jaMarcado.id }, data: { [campo]: false } });
  try {
    await corrida();
  } finally {
    await prisma.servico.updateMany({ where: { nome: { startsWith: PFX } }, data: { [campo]: false } });
    if (jaMarcado) await prisma.servico.update({ where: { id: jaMarcado.id }, data: { [campo]: true } });
  }
}

afterEach(async () => {
  // Rede de segurança: qualquer marca que uma corrida tenha deixado ligada nos serviços deste
  // arquivo, mesmo que `comCampoDesligadoDurante` já tenha desligado a sua.
  await prisma.servico.updateMany({
    where: { nome: { startsWith: PFX } },
    data: { ehCredenciamento: false, ehFaturamento: false },
  });
});

afterAll(async () => {
  await prisma.servico.deleteMany({ where: { nome: { startsWith: PFX } } });
});

describe("marca única (credenciamento/faturamento) sob concorrência real", () => {
  it("EDITAR dois serviços marcando credenciamento AO MESMO TEMPO: só um vence, o outro recebe a frase certa", async () => {
    await comCampoDesligadoDurante("ehCredenciamento", async () => {
      const [a, b] = await Promise.all([
        criarServico({ nome: `${PFX} A` }),
        criarServico({ nome: `${PFX} B` }),
      ]);

      const marcacoes = await Promise.allSettled([
        atualizarServico(a.id, { ehCredenciamento: true }),
        atualizarServico(b.id, { ehCredenciamento: true }),
      ]);

      const sucesso = marcacoes.filter((r) => r.status === "fulfilled");
      const falha = marcacoes.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(sucesso).toHaveLength(1);
      expect(falha).toHaveLength(1);
      // A régua é a MESMA frase da conferência normal, não um erro cru de banco.
      expect(String(falha[0]!.reason)).toMatch(/já está marcado como o credenciamento/i);

      const marcados = await prisma.servico.count({
        where: { nome: { startsWith: PFX }, ehCredenciamento: true },
      });
      expect(marcados).toBe(1);
    });
  });

  it("EDITAR dois serviços marcando faturamento AO MESMO TEMPO: só um vence, o outro recebe a frase certa", async () => {
    await comCampoDesligadoDurante("ehFaturamento", async () => {
      const [a, b] = await Promise.all([
        criarServico({ nome: `${PFX} Fat A` }),
        criarServico({ nome: `${PFX} Fat B` }),
      ]);

      const marcacoes = await Promise.allSettled([
        atualizarServico(a.id, { ehFaturamento: true, percentual: 5 }),
        atualizarServico(b.id, { ehFaturamento: true, percentual: 7 }),
      ]);

      const sucesso = marcacoes.filter((r) => r.status === "fulfilled");
      const falha = marcacoes.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(sucesso).toHaveLength(1);
      expect(falha).toHaveLength(1);
      expect(String(falha[0]!.reason)).toMatch(/já existe um serviço marcado como faturamento médico/i);

      const marcados = await prisma.servico.count({
        where: { nome: { startsWith: PFX }, ehFaturamento: true },
      });
      expect(marcados).toBe(1);
    });
  });

  it("dez edições concorrentes disputando a MESMA marca: exatamente uma vence", async () => {
    // Mais que duas, para afastar a hipótese de que só funciona no caso mais simples (2 vs 2).
    await comCampoDesligadoDurante("ehCredenciamento", async () => {
      const servicos = await Promise.all(
        Array.from({ length: 10 }, (_, i) => criarServico({ nome: `${PFX} C${i}` })),
      );
      const marcacoes = await Promise.allSettled(
        servicos.map((s) => atualizarServico(s.id, { ehCredenciamento: true })),
      );
      const sucesso = marcacoes.filter((r) => r.status === "fulfilled");
      expect(sucesso).toHaveLength(1);

      const marcados = await prisma.servico.count({
        where: { nome: { startsWith: PFX }, ehCredenciamento: true },
      });
      expect(marcados).toBe(1);
    });
  });

  it("⚠️ ACHADO DA REVISÃO: nome duplicado E marca no MESMO pedido não pode deixar a marca gravada sozinha", async () => {
    // A marca é aplicada num UPDATE atômico separado do resto — se ela fosse aplicada ANTES da
    // conferência de nome, um pedido que falha por nome duplicado deixaria a marca já gravada em
    // silêncio: a tela diz "nome já usado" e a Thaís conclui que nada foi salvo, mas a marca —
    // inclusive tendo roubado a marca única de outro serviço — ficou no banco.
    await comCampoDesligadoDurante("ehCredenciamento", async () => {
      const existente = await criarServico({ nome: `${PFX} Nome Existente` });
      const alvo = await criarServico({ nome: `${PFX} Alvo` });

      await expect(
        atualizarServico(alvo.id, { nome: `${PFX} Nome Existente`, ehCredenciamento: true }),
      ).rejects.toThrow(/já existe um serviço/i);

      const depois = await prisma.servico.findUniqueOrThrow({ where: { id: alvo.id } });
      expect(depois.ehCredenciamento).toBe(false);
      expect(depois.nome).toBe(`${PFX} Alvo`); // nem o nome mudou — o pedido inteiro foi recusado
      void existente;
    });
  });
});
