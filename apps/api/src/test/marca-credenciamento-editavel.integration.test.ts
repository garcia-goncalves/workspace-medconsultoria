import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { atualizarServico } from "../modules/servicos/servicos.service.js";

/**
 * A MARCA DO CREDENCIAMENTO PRECISA TER UM ESCRITOR NA APLICAÇÃO.
 *
 * `Servico.ehCredenciamento` decide três regras de dinheiro (ADR-104/108). Ela nasce na
 * semeadura do catálogo e no backfill da migração `20260829203721` — e, enquanto não havia
 * caminho de escrita, um estado errado (serviço recriado depois de apagado, backfill que não
 * casou nome nenhum) só teria conserto por `UPDATE` manual no banco de PRODUÇÃO. Foi o achado
 * da revisão deste lote.
 *
 * A trava que acompanha a escrita é a que importa: **não pode haver dois serviços marcados**.
 * Com dois, `findFirst({ where: { ehCredenciamento: true } })` escolhe um deles, os 14
 * requisitos passam a ser sincronizados no serviço errado e o Portal do cliente mostra a
 * papelada do outro. Marcar o segundo é recusado dizendo QUAL já está marcado — em vez de
 * desmarcar o primeiro em silêncio, que trocaria a regra de cobrança sem ninguém pedir.
 */

const PFX = `marca-${randomBytes(4).toString("hex")}`;
let servicoA: string;
let servicoB: string;

beforeAll(async () => {
  const a = await prisma.servico.create({ data: { nome: `${PFX} A`, ehCredenciamento: false }, select: { id: true } });
  const b = await prisma.servico.create({ data: { nome: `${PFX} B`, ehCredenciamento: false }, select: { id: true } });
  servicoA = a.id;
  servicoB = b.id;
  // O catálogo real pode ter o credenciamento marcado; este teste precisa do campo limpo para
  // valer sozinho, então guarda e restaura no fim.
  await prisma.servico.updateMany({ where: { ehCredenciamento: true }, data: { ehCredenciamento: false } });
});

afterAll(async () => {
  await prisma.servico.deleteMany({ where: { nome: { startsWith: PFX } } });
});

describe("marca do credenciamento, editável e única", () => {
  it("dá para marcar um serviço pela aplicação", async () => {
    await atualizarServico(servicoA, { ehCredenciamento: true });
    const a = await prisma.servico.findUnique({ where: { id: servicoA }, select: { ehCredenciamento: true } });
    expect(a?.ehCredenciamento).toBe(true);
  });

  it("recusa marcar um SEGUNDO, dizendo qual já está marcado", async () => {
    await expect(atualizarServico(servicoB, { ehCredenciamento: true })).rejects.toThrow(/já está marcado/i);
    const b = await prisma.servico.findUnique({ where: { id: servicoB }, select: { ehCredenciamento: true } });
    expect(b?.ehCredenciamento).toBe(false);
  });

  it("remarcar o MESMO serviço continua valendo (não é um segundo)", async () => {
    await expect(atualizarServico(servicoA, { ehCredenciamento: true })).resolves.toBeTruthy();
  });

  it("desmarcar é permitido — é como se corrige uma marca errada", async () => {
    await atualizarServico(servicoA, { ehCredenciamento: false });
    const a = await prisma.servico.findUnique({ where: { id: servicoA }, select: { ehCredenciamento: true } });
    expect(a?.ehCredenciamento).toBe(false);
  });
});
