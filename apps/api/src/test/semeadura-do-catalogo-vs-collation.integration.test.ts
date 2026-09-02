import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@app/db";
import { listServicos } from "../modules/servicos/servicos.service.js";

/**
 * A SEMEADURA DO CATÁLOGO NÃO PODE DISCORDAR DO BANCO SOBRE O QUE É "O MESMO NOME".
 *
 * `semearCatalogoSeFaltar` decide o que criar comparando os nomes canônicos com os que já existem.
 * Enquanto a comparação era a igualdade do JavaScript e a coluna é `utf8mb4_unicode_ci`, havia um
 * estado em que os dois discordavam: para o JS, "manual da marca" ≠ "Manual da marca"; para o
 * banco, é a MESMA linha.
 *
 * ⚠️ SEM ÍNDICE ÚNICO isso produzia só um clone silencioso. COM o índice, vira INDISPONIBILIDADE:
 * a semeadura roda em TODA leitura de catálogo — inclusive na página pública `/comecar` e no
 * "Solicitar" do Portal —, tentaria recriar o canônico, levaria `P2002` do banco, e a rota
 * pública passaria a responder erro em vez de lista. Achado pelo `database-reviewer`.
 */

const CANONICO = "Manual da marca";
let varianteId: string | null = null;

afterAll(async () => {
  if (varianteId) await prisma.servico.delete({ where: { id: varianteId } }).catch(() => {});
  // Devolve o canônico ao catálogo para as outras suítes não herdarem o buraco.
  await listServicos();
});

describe("semeadura do catálogo × collation da coluna", () => {
  it("não tenta recriar um canônico que o banco já considera existente", async () => {
    await prisma.servico.deleteMany({ where: { nome: CANONICO } });
    const variante = await prisma.servico.create({
      data: { nome: CANONICO.toLowerCase() },
      select: { id: true },
    });
    varianteId = variante.id;

    // Esta é a chamada que derrubava: `listServicos` passa por `seedIfEmpty`.
    await expect(listServicos()).resolves.toBeInstanceOf(Array);

    // E não nasceu um segundo: para o banco, a variante em minúsculas JÁ É esse nome.
    expect(await prisma.servico.count({ where: { nome: CANONICO } })).toBe(1);
  });
});
