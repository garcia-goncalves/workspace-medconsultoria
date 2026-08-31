import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { hashPassword } from "../lib/password.js";
import { credenciamentoDoCliente, NOME_SERVICO_CREDENCIAMENTO, sincronizarRequisitosCredenciamento } from "../modules/servicos/credenciamento.service.js";

/**
 * M17 — A TRAVA DO TÍTULO DE ESPECIALISTA EXISTE E A TRIAGEM NUNCA A LÊ.
 *
 * `triarCredenciamento` (R6) usava só `Profissional.tituloEspecialista` — o booleano
 * "declarado" no cadastro. Existe também a exigência documental "Especializações"
 * (`travaElegibilidade: TITULO_ESPECIALISTA`), e ninguém a consultava: um médico com o
 * comprovante já entregue continuava PENDENTE na triagem enquanto ninguém voltasse à ficha
 * para marcar a caixinha.
 *
 * A escolha: R6 passa a ser satisfeita pelo DECLARADO **ou** pelo COMPROVANTE (o mesmo médico
 * não fica pendente com o documento já na papelada) — nunca o contrário (declarar não some).
 */

const PFX = `titulo-${randomBytes(4).toString("hex")}`;
let ator: { id: string };
let clienteId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  ator = { id: u.id };
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } })).id;

  // O catálogo nasce sob demanda (`seedIfEmpty`) e só semeia com a TABELA vazia — noutro
  // arquivo de teste desta suíte já pode ter criado serviço, e aí ele nunca semeia o
  // credenciamento sozinho. Garante a marca explicitamente, como o resto da suíte já faz.
  const existente = await prisma.servico.findFirst({ where: { nome: NOME_SERVICO_CREDENCIAMENTO }, select: { id: true } });
  if (!existente) {
    await prisma.servico.create({
      data: { nome: NOME_SERVICO_CREDENCIAMENTO, valor: 2000, valorRecorrencia: "AVULSO", ehCredenciamento: true },
    });
  } else {
    await prisma.servico.update({ where: { id: existente.id }, data: { ehCredenciamento: true } });
  }
  await sincronizarRequisitosCredenciamento(true);
});

afterAll(async () => {
  await prisma.arquivo.deleteMany({ where: { clienteId } });
  await prisma.profissional.deleteMany({ where: { clienteId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  void ator;
  await prisma.$disconnect();
});

async function requisitoTituloEspecialista(): Promise<string> {
  const v = await credenciamentoDoCliente(clienteId);
  const requisito = v.grupos
    .flatMap((g) => g.requisitos)
    .concat(v.porProfissional.flatMap((p) => p.requisitos))
    .find((r) => r.travaElegibilidade === "TITULO_ESPECIALISTA");
  if (!requisito) throw new Error("Exigência 'Especializações' não encontrada — sincronização não rodou.");
  return requisito.id;
}

describe("M17 — R6 lê o declarado OU o comprovante", () => {
  it("médico sem título declarado e sem documento fica PENDENTE (R6)", async () => {
    const p = await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-sem-nada`, conselho: "CRM", anoFormatura: 2010, tituloEspecialista: false },
    });
    const v = await credenciamentoDoCliente(clienteId);
    const motivo = v.triagem.motivos.find((m) => m.regra === "R6" && m.profissionalId === p.id);
    expect(motivo, "sem declaração e sem documento, R6 tem de acender").toBeTruthy();
  });

  it("comprovante ENTREGUE satisfaz R6 mesmo com o booleano do cadastro em false", async () => {
    const p = await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-com-doc`, conselho: "CRM", anoFormatura: 2010, tituloEspecialista: false },
    });
    const requisitoId = await requisitoTituloEspecialista();
    await prisma.arquivo.create({
      data: {
        nome: "especializacao.pdf",
        mimetype: "application/pdf",
        tamanho: 100,
        caminho: `${PFX}/especializacao.pdf`,
        clienteId,
        requisitoId,
        profissionalId: p.id,
        lado: "FRENTE",
        enviadoPorTipo: "CLIENTE",
      },
    });

    const v = await credenciamentoDoCliente(clienteId);
    const motivo = v.triagem.motivos.find((m) => m.regra === "R6" && m.profissionalId === p.id);
    expect(motivo, "o comprovante já entregue não pode deixar o médico pendente por R6").toBeUndefined();
  });

  it("o documento de UM médico não satisfaz a R6 de OUTRO (a trava é por profissional)", async () => {
    const comDoc = await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-A`, conselho: "CRM", anoFormatura: 2010, tituloEspecialista: false },
    });
    const semDoc = await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-B`, conselho: "CRM", anoFormatura: 2010, tituloEspecialista: false },
    });
    const requisitoId = await requisitoTituloEspecialista();
    await prisma.arquivo.create({
      data: {
        nome: "especializacao-A.pdf",
        mimetype: "application/pdf",
        tamanho: 100,
        caminho: `${PFX}/especializacao-A.pdf`,
        clienteId,
        requisitoId,
        profissionalId: comDoc.id,
        lado: "FRENTE",
        enviadoPorTipo: "CLIENTE",
      },
    });

    const v = await credenciamentoDoCliente(clienteId);
    expect(v.triagem.motivos.find((m) => m.regra === "R6" && m.profissionalId === comDoc.id)).toBeUndefined();
    expect(v.triagem.motivos.find((m) => m.regra === "R6" && m.profissionalId === semDoc.id)).toBeTruthy();
  });

  it("o booleano do cadastro sozinho, sem documento, continua satisfazendo R6 (declarar não some)", async () => {
    const p = await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-declarado`, conselho: "CRM", anoFormatura: 2010, tituloEspecialista: true },
    });
    const v = await credenciamentoDoCliente(clienteId);
    expect(v.triagem.motivos.find((m) => m.regra === "R6" && m.profissionalId === p.id)).toBeUndefined();
  });
});
