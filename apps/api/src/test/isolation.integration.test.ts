import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { portalMeusDadosSchema } from "@app/shared";
import { getDocumento, atualizarMeusDados } from "../modules/portal/portal.service";
import { removerArquivo } from "../modules/arquivos/arquivos.service";
import { listPorCliente } from "../modules/emails/enviados.service";
import { hashPassword } from "../lib/password";

const PFX = `iso-${randomBytes(4).toString("hex")}`;

let clienteA: string;
let clienteB: string;
let docA: string;
let docB: string;
let arqA: string;
let arqB: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "os testes devem usar o banco _test").toContain("_test");
  const a = await prisma.cliente.create({ data: { nome: `${PFX}-A` } });
  const b = await prisma.cliente.create({ data: { nome: `${PFX}-B` } });
  clienteA = a.id;
  clienteB = b.id;

  const criador = await prisma.user.create({
    data: { nome: `${PFX}-criador`, email: `${PFX}-criador@example.test`, passwordHash: await hashPassword("x"), role: "FUNCIONARIO" },
  });

  const dA = await prisma.documento.create({
    data: { clienteId: clienteA, titulo: `${PFX}-docA`, conteudo: "conteudo A", status: "ENVIADO", criadoPorId: criador.id },
  });
  const dB = await prisma.documento.create({
    data: { clienteId: clienteB, titulo: `${PFX}-docB`, conteudo: "conteudo B", status: "ENVIADO", criadoPorId: criador.id },
  });
  docA = dA.id;
  docB = dB.id;

  const fA = await prisma.arquivo.create({
    data: { clienteId: clienteA, nome: `${PFX}-A.pdf`, mimetype: "application/pdf", tamanho: 10, caminho: `clientes/${clienteA}/x.pdf`, enviadoPorTipo: "CLIENTE" },
  });
  const fB = await prisma.arquivo.create({
    data: { clienteId: clienteB, nome: `${PFX}-B.pdf`, mimetype: "application/pdf", tamanho: 10, caminho: `clientes/${clienteB}/y.pdf`, enviadoPorTipo: "CLIENTE" },
  });
  arqA = fA.id;
  arqB = fB.id;
});

afterAll(async () => {
  await prisma.emailEnviado.deleteMany({ where: { assunto: { startsWith: PFX } } });
  await prisma.documento.deleteMany({ where: { titulo: { startsWith: PFX } } });
  await prisma.arquivo.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.cliente.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("Isolamento do Portal por clienteId", () => {
  it("o cliente vê o PRÓPRIO documento", async () => {
    const doc = await getDocumento(docA, clienteA);
    expect(doc.titulo).toContain("docA");
  });

  it("NÃO vê documento de OUTRO cliente (NOT_FOUND, sem revelar existência)", async () => {
    await expect(getDocumento(docB, clienteA)).rejects.toThrow();
  });

  it("o cliente remove o PRÓPRIO arquivo", async () => {
    await expect(removerArquivo(arqA, clienteA)).resolves.toBeTruthy();
  });

  it("NÃO remove arquivo de OUTRO cliente (FORBIDDEN)", async () => {
    await expect(removerArquivo(arqB, clienteA)).rejects.toThrow();
  });
});

/**
 * O endereço do cadastro é chave de consulta (`chaveDeEndereco`, ADR-97): quem escolhe o
 * endereço escolhe o que a consulta devolve. A trava existente barra só endereço DA CASA —
 * o endereço de OUTRO CLIENTE passava direto, e o Portal deixava o próprio cliente gravá-lo.
 */
describe("Portal não escolhe a chave da própria consulta", () => {
  it("cliente do Portal NÃO consegue gravar o e-mail de outro cliente no próprio cadastro", async () => {
    const vitima = `${PFX}-vitima@example.test`;
    await prisma.cliente.update({ where: { id: clienteB }, data: { email: vitima } });
    await prisma.emailEnviado.create({
      data: { para: vitima, assunto: `${PFX}-proposta sigilosa`, corpo: "x", clienteId: clienteB },
    });

    const userA = await prisma.user.create({
      data: {
        nome: `${PFX}-portalA`,
        email: `${PFX}-portalA@example.test`,
        passwordHash: await hashPassword("x"),
        role: "CLIENTE",
        clienteId: clienteA,
      },
    });

    // Como um cliente mal-intencionado chega ao servidor: o payload passa pelo schema do
    // Portal, e é ELE quem tem de derrubar o campo — não a boa vontade da tela.
    const payload = portalMeusDadosSchema.parse({ nome: `${PFX}-A`, tipo: "PJ", email: vitima });
    expect("email" in payload, "o schema do Portal não pode aceitar `email`").toBe(false);
    await atualizarMeusDados(clienteA, userA.id, payload);

    const depois = await prisma.cliente.findUnique({ where: { id: clienteA }, select: { email: true } });
    expect(depois?.email, "o Portal não pode gravar o e-mail do cadastro").not.toBe(vitima);

    const lista = await listPorCliente(clienteA);
    expect(
      lista.some((e) => e.assunto.includes("proposta sigilosa")),
      "o cliente A não pode enxergar e-mail endereçado ao cliente B",
    ).toBe(false);
  });
});

describe("Regra de integridade — Documento.criadoPorId SetNull (#1)", () => {
  it("excluir o usuário criador PRESERVA o documento (criadoPorId vira null)", async () => {
    const u = await prisma.user.create({
      data: { nome: `${PFX}-del`, email: `${PFX}-del@example.test`, passwordHash: await hashPassword("x"), role: "FUNCIONARIO" },
    });
    const d = await prisma.documento.create({
      data: { clienteId: clienteA, titulo: `${PFX}-docDel`, conteudo: "c", status: "RASCUNHO", criadoPorId: u.id },
    });
    await prisma.user.delete({ where: { id: u.id } }); // HARD delete → dispara ON DELETE SET NULL
    const depois = await prisma.documento.findUnique({ where: { id: d.id } });
    expect(depois, "o documento deve continuar existindo").not.toBeNull();
    expect(depois?.criadoPorId, "criadoPorId deve virar null").toBeNull();
  });
});
