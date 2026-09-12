import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { resumoClientes } from "../modules/clientes/clientes.service.js";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";

/**
 * OS QUATRO INDICADORES DE CLIENTES PRECISAM CONTAR O MESMO UNIVERSO (28/08/2026).
 *
 * Em produção a página Clientes mostrava, lado a lado, **"Total de clientes 0"** e
 * **"Com Portal ativo 1"** — dois números que não podem ser verdade juntos, e que se leem
 * como defeito de sistema para quem bate o olho.
 *
 * A causa não é a contagem estar errada, é ela contar OUTRA COISA: `total`, `ativos` e
 * `inativos` respeitam a ADR-24 e excluem o PROSPECT (que vive no Funil, não aqui), mas
 * `portaisAtivos` contava TODA conta de Portal — inclusive a do prospect, criada pelo
 * acesso ao Portal do prospect (ADR-128). O próprio comentário da função já prometia
 * "só ativos/inativos"; era `portaisAtivos` que não obedecia.
 *
 * Contra o MySQL de verdade porque o que se prova é o `where` de uma contagem — typecheck
 * não diz nada sobre filtro.
 */

const PFX = `rc-${randomBytes(4).toString("hex")}`;
const clientesCriados: string[] = [];
const usuariosCriados: string[] = [];

async function criarCliente(situacao: "ATIVO" | "INATIVO" | "PROSPECT") {
  const c = await prisma.cliente.create({ data: { nome: `${PFX} ${situacao}`, situacaoComercial: situacao } });
  clientesCriados.push(c.id);
  return c;
}

async function criarPortalAtivo(clienteId: string) {
  const u = await prisma.user.create({
    data: {
      nome: `${PFX} portal`,
      email: `${PFX}-${randomBytes(3).toString("hex")}@example.test`,
      role: "CLIENTE",
      ativo: true,
      passwordHash: "hash-de-teste",
      clienteId,
    },
  });
  usuariosCriados.push(u.id);
  return u;
}

beforeAll(async () => {
  exigirBancoDeTeste();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } });
  await prisma.cliente.deleteMany({ where: { id: { in: clientesCriados } } });
});

describe("resumoClientes", () => {
  it("NÃO conta o Portal de um PROSPECT — ele não entra em 'Total de clientes'", async () => {
    const antes = await resumoClientes();

    const prospect = await criarCliente("PROSPECT");
    await criarPortalAtivo(prospect.id);

    const depois = await resumoClientes();

    // O prospect não entra no total (ADR-24) — então o Portal dele também não pode entrar,
    // senão a tela mostra "Total 0" ao lado de "Com Portal ativo 1".
    expect(depois.total).toBe(antes.total);
    expect(depois.portaisAtivos).toBe(antes.portaisAtivos);
  });

  it("conta o Portal de um cliente da base", async () => {
    const antes = await resumoClientes();

    const cliente = await criarCliente("ATIVO");
    await criarPortalAtivo(cliente.id);

    const depois = await resumoClientes();

    expect(depois.total).toBe(antes.total + 1);
    expect(depois.portaisAtivos).toBe(antes.portaisAtivos + 1);
  });

  it("nunca mostra mais Portais ativos do que clientes na base", async () => {
    const r = await resumoClientes();
    expect(r.portaisAtivos).toBeLessThanOrEqual(r.total);
  });
});
