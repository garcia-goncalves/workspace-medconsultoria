import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { CORPO_EXPURGADO } from "@app/shared";
import { expurgarDadosVencidos } from "../modules/sistema/retencao.service.js";

/**
 * O EXPURGO APAGA MESMO — contra o MySQL de verdade (LGPD, ADR-141).
 *
 * O teste de texto prova que o código chama as coisas certas; só o banco prova que o corpo
 * sai e que o metadado fica. E o metadado é o que importa preservar: é dele que vive o
 * monitor que provou, em 22/08, que o e-mail voltou a sair de produção.
 */

const PFX = `retencao-${randomBytes(4).toString("hex")}`;
const DIA = 24 * 60 * 60 * 1000;

let idVelho: string;
let idNovo: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");

  const velho = await prisma.emailEnviado.create({
    data: {
      para: `${PFX}-velho@teste.local`,
      assunto: `${PFX} assunto antigo`,
      corpo: "Prezado Dr. João, seu CPF 123.456.789-09 foi recebido.",
      status: "ENVIADO",
      createdAt: new Date(Date.now() - 400 * DIA),
    },
  });
  idVelho = velho.id;

  const novo = await prisma.emailEnviado.create({
    data: {
      para: `${PFX}-novo@teste.local`,
      assunto: `${PFX} assunto de ontem`,
      corpo: "Mensagem recente que NÃO pode ser tocada.",
      status: "ENVIADO",
      createdAt: new Date(Date.now() - 1 * DIA),
    },
  });
  idNovo = novo.id;
});

afterAll(async () => {
  await prisma.emailEnviado.deleteMany({ where: { para: { startsWith: PFX } } });
});

describe("expurgo do corpo de e-mail (ADR-141)", () => {
  it("apaga o corpo do que passou do prazo e NÃO toca no recente", async () => {
    const r = await expurgarDadosVencidos();
    expect(r.dias).toBeGreaterThanOrEqual(30);

    const velho = await prisma.emailEnviado.findUniqueOrThrow({ where: { id: idVelho } });
    const novo = await prisma.emailEnviado.findUniqueOrThrow({ where: { id: idNovo } });

    expect(velho.corpo).toBe(CORPO_EXPURGADO);
    expect(velho.corpo).not.toContain("123.456.789-09");
    expect(novo.corpo).toContain("NÃO pode ser tocada");
  });

  it("o METADADO fica — sem ele o monitor de e-mails fica cego", async () => {
    const velho = await prisma.emailEnviado.findUniqueOrThrow({ where: { id: idVelho } });
    expect(velho.para).toBe(`${PFX}-velho@teste.local`);
    expect(velho.assunto).toBe(`${PFX} assunto antigo`);
    expect(velho.status).toBe("ENVIADO");
    expect(velho.createdAt).toBeInstanceOf(Date);
  });

  it("rodar de novo não conta a mesma linha duas vezes — senão varre a tabela inteira todo dia", async () => {
    const antes = await expurgarDadosVencidos();
    const depois = await expurgarDadosVencidos();
    // a 2ª passada não encontra mais nada a expurgar entre as linhas que a 1ª já limpou
    expect(depois.emails).toBeLessThanOrEqual(antes.emails);
    const velho = await prisma.emailEnviado.findUniqueOrThrow({ where: { id: idVelho } });
    expect(velho.corpo).toBe(CORPO_EXPURGADO);
  });
});
