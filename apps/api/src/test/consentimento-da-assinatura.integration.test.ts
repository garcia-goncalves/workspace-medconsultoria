import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@app/db";
import {
  TEXTO_CONSENTIMENTO_ASSINATURA,
  VERSAO_CONSENTIMENTO_ASSINATURA,
} from "@app/shared";
import { assinar } from "../modules/assinaturas/assinaturas.service.js";

/**
 * O CONSENTIMENTO ERA EXIGIDO E NÃO ERA GUARDADO.
 *
 * A página de assinar sempre teve a caixa "li o documento e concordo", o Zod sempre recusou
 * `consentimento` diferente de `true` e o servidor sempre obedeceu. Mas nada disso ficava
 * gravado: passado o clique, não sobrava no sistema NENHUM registro de que a pessoa consentiu,
 * nem com que texto ela consentiu.
 *
 * ⚠️ A diferença aparece no dia em que uma assinatura for contestada. "A tela exigia a caixa" é
 * afirmação sobre o código de HOJE; não prova nada sobre o que estava na tela naquele dia — e o
 * texto muda. Por isso a prova é data **mais versão**: a versão aponta para um texto exato, que
 * o histórico do repositório preserva.
 */

const PFX = `consent-${randomBytes(4).toString("hex")}`;
let documentoId: string;
let assinaturaId: string;
const token = `${PFX}-token`;
const CONTEUDO = "# Contrato de teste\n\nCorpo do documento.";

beforeAll(async () => {
  const url = process.env["DATABASE_URL"] ?? "";
  expect(url).toContain("_test");

  const doc = await prisma.documento.create({
    data: { titulo: `${PFX}-contrato`, conteudo: CONTEUDO },
  });
  documentoId = doc.id;

  const a = await prisma.assinatura.create({
    data: {
      documentoId,
      papel: "CLIENTE",
      nome: `${PFX}-medico`,
      token,
      // O mesmo hash que `assinar` recalcula: sem ele a assinatura é recusada por divergência.
      hashDocumento: createHash("sha256").update(CONTEUDO).digest("hex"),
    },
  });
  assinaturaId = a.id;
});

afterAll(async () => {
  await prisma.assinatura.deleteMany({ where: { documentoId } });
  await prisma.documento.deleteMany({ where: { id: documentoId } });
  await prisma.$disconnect();
});

describe("a prova do consentimento da assinatura", () => {
  it("o texto e a versão andam juntos — mudar um sem o outro é a única forma de a prova mentir", () => {
    // Trava deliberada: se você editou o texto, suba a versão NO MESMO COMMIT. Sem isso, as
    // assinaturas já gravadas passam a apontar para um texto que ninguém leu.
    const impressao = createHash("sha256").update(TEXTO_CONSENTIMENTO_ASSINATURA).digest("hex").slice(0, 16);
    expect(
      { versao: VERSAO_CONSENTIMENTO_ASSINATURA, impressao },
      "editou o texto do consentimento? suba VERSAO_CONSENTIMENTO_ASSINATURA e ajuste esta trava",
    ).toEqual({ versao: "2026-09-02", impressao: "949d038a2080009f" });
  });

  it("assinar grava a data E a versão do texto consentido", async () => {
    await assinar({ token, metodo: "DIGITADO", nomeDigitado: "Dr. Teste", consentimento: true }, "203.0.113.7", "ua");

    const depois = await prisma.assinatura.findUnique({ where: { id: assinaturaId } });
    expect(depois?.status).toBe("ASSINADO");
    expect(depois?.consentimentoEm, "sem data, não há prova de quando a pessoa consentiu").toBeInstanceOf(Date);
    expect(depois?.consentimentoVersao, "sem versão, a data não diz COM QUE TEXTO").toBe(
      VERSAO_CONSENTIMENTO_ASSINATURA,
    );
  });
});
