import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { criarServico } from "../modules/servicos/servicos.service.js";

/**
 * A MARCA DO CREDENCIAMENTO PRECISA PODER SER LIGADA JÁ NA CRIAÇÃO.
 *
 * Achado da auditoria de 04/09/2026: o formulário "Novo serviço" não expunha a caixa "Este é o
 * serviço de credenciamento" — só a edição tinha. Quem quisesse marcar um serviço recém-criado
 * tinha de salvar, reabrir e editar. `criarServico` (`servicos.service.ts`) sempre aceitou o
 * campo `ehCredenciamento` no `input` e sempre chamou `recusarSegundaMarcaDeCredenciamento` antes
 * de gravar — a trava de "só um marcado" nunca dependeu da tela; faltava só a tela expor o campo.
 *
 * ⚠️ Este teste cobre a CRIAÇÃO pela mesma trava SEQUENCIAL que a edição já tinha — não a trava
 * atômica (`tentarMarcarAtomicamente`) que fecha a corrida de concorrência na edição (ADR-152).
 * A corrida na CRIAÇÃO é risco residual conhecido e aceito (ver `servicos.service.ts`, comentário
 * acima de `criarServico`), fora de escopo deste teste.
 */

const PFX = `marca-criacao-${randomBytes(4).toString("hex")}`;

// ⚠️ A marca é ÚNICA no sistema inteiro, e este arquivo testa justamente "quando não há outro
// marcado". O banco de teste é compartilhado pela suíte em sequência, e outros arquivos marcam o
// serviço canônico de credenciamento como fixture — então o ponto de partida depende da ORDEM em
// que o Vitest roda os arquivos (que vem do histórico de duração, não do nome). O teste desliga as
// marcas que achar e devolve cada uma no fim: ele passa a controlar a própria premissa.
let marcadosAntes: string[] = [];

beforeAll(async () => {
  marcadosAntes = (await prisma.servico.findMany({ where: { ehCredenciamento: true }, select: { id: true } })).map((s) => s.id);
  if (marcadosAntes.length) await prisma.servico.updateMany({ where: { id: { in: marcadosAntes } }, data: { ehCredenciamento: false } });
});

afterAll(async () => {
  await prisma.servico.deleteMany({ where: { nome: { startsWith: PFX } } });
  if (marcadosAntes.length) await prisma.servico.updateMany({ where: { id: { in: marcadosAntes } }, data: { ehCredenciamento: true } });
});

describe("marca do credenciamento, exposta na criação", () => {
  it("cria um serviço já marcado como credenciamento quando não há outro marcado", async () => {
    const criado = await criarServico({ nome: `${PFX} A`, ehCredenciamento: true });
    expect(criado.ehCredenciamento).toBe(true);

    const doBanco = await prisma.servico.findUnique({ where: { id: criado.id }, select: { ehCredenciamento: true } });
    expect(doBanco?.ehCredenciamento).toBe(true);
  });

  it("recusa criar um SEGUNDO serviço já marcado, com mensagem clara — mesma trava da edição", async () => {
    await expect(criarServico({ nome: `${PFX} B`, ehCredenciamento: true })).rejects.toThrow(/já está marcado/i);

    // O segundo não deve ter sido criado marcado (nem criado, se a trava rodar antes do create).
    const marcados = await prisma.servico.findMany({
      where: { nome: { startsWith: PFX }, ehCredenciamento: true },
      select: { nome: true },
    });
    expect(marcados).toHaveLength(1);
    expect(marcados[0]?.nome).toBe(`${PFX} A`);
  });

  it("cria normalmente um serviço SEM marcar nada, mesmo já havendo um marcado", async () => {
    const criado = await criarServico({ nome: `${PFX} C` });
    expect(criado.ehCredenciamento).toBe(false);
  });
});
