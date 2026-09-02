import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { criarServico, atualizarServico } from "../modules/servicos/servicos.service.js";

/**
 * O NOME DO SERVIÇO PRECISA SER ÚNICO — E O ERRO PRECISA DIZER A VERDADE.
 *
 * Dois serviços com o mesmo nome não produzem erro nenhum hoje, e o estrago é todo indireto: a
 * semeadura do catálogo casa por NOME (`semearCatalogoSeFaltar`), o construtor da proposta lista
 * os dois lado a lado sem distinguir, e a Thaís contrata "o" serviço sem saber qual dos dois
 * levou o preço, as exigências e o roteiro do projeto. É o mesmo modo de falha das ADR-144/145,
 * pelo outro lado: lá o perigo era casar por nome; aqui é o nome deixar de identificar.
 *
 * ⚠️ O ÍNDICE SOZINHO NÃO BASTA, e é isto que estes testes travam. Sem tratamento, o erro do
 * banco (P2002) sobe cru na criação; e na EDIÇÃO ele cai no `catch` que existia para "id não
 * existe", virando **"Serviço não encontrado."** — a mensagem mais confusa possível para quem
 * acabou de abrir o serviço na tela e só trocou o nome.
 */

const PFX = `unico-${randomBytes(4).toString("hex")}`;
let existente: string;

beforeAll(async () => {
  const s = await criarServico({ nome: `${PFX} Original` });
  existente = s.id;
});

afterAll(async () => {
  await prisma.servico.deleteMany({ where: { nome: { startsWith: PFX } } });
});

describe("nome de serviço é único", () => {
  it("CRIAR com nome já usado é recusado, dizendo o que houve", async () => {
    await expect(criarServico({ nome: `${PFX} Original` })).rejects.toThrow(/já existe um serviço/i);
  });

  it("⚠️ o nome repetido NÃO passa por espaço em volta", async () => {
    // O `trim()` acontece depois da conferência ingênua; sem normalizar, `"  X  "` viraria um
    // segundo `X` no banco e o índice reprovaria com erro cru em vez da frase em português.
    await expect(criarServico({ nome: `   ${PFX} Original   ` })).rejects.toThrow(/já existe um serviço/i);
  });

  it("⚠️ MAIÚSCULA não distingue — a coluna é `utf8mb4_unicode_ci`", async () => {
    // Comportamento que ninguém espera e que quase ninguém descobre a tempo: para o banco,
    // "FATURAMENTO" e "Faturamento" são a MESMA linha. A conferência da aplicação roda no banco
    // (`findFirst`), então ela herda a mesma régua — é o que faz as duas travas concordarem.
    await expect(criarServico({ nome: `${PFX} ORIGINAL` })).rejects.toThrow(/já existe um serviço/i);
  });

  it("⚠️ ACENTO também não distingue", async () => {
    await expect(criarServico({ nome: `${PFX} Origìnal` })).rejects.toThrow(/já existe um serviço/i);
  });

  it("RENOMEAR para um nome já usado NÃO diz 'Serviço não encontrado'", async () => {
    const outro = await criarServico({ nome: `${PFX} Outro` });
    const erro = await atualizarServico(outro.id, { nome: `${PFX} Original` }).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    // A regressão que este teste existe para impedir: o `catch` genérico do update dizia
    // "Serviço não encontrado." para um serviço que a pessoa acabou de abrir na tela.
    expect((erro as Error).message).not.toMatch(/não encontrado/i);
    expect((erro as Error).message).toMatch(/já existe um serviço/i);
  });

  it("id inexistente CONTINUA dizendo 'Serviço não encontrado'", async () => {
    await expect(atualizarServico("id-que-nao-existe", { nome: `${PFX} Qualquer` })).rejects.toThrow(
      /não encontrado/i,
    );
  });

  it("renomear para o PRÓPRIO nome continua permitido", async () => {
    // Salvar o formulário sem mexer no nome não pode ser lido como duplicata de si mesmo.
    const s = await atualizarServico(existente, { nome: `${PFX} Original` });
    expect(s.nome).toBe(`${PFX} Original`);
  });

  it("o banco RECUSA a duplicata mesmo por fora da aplicação", async () => {
    // A trava da aplicação é a mensagem; a trava do banco é a garantia. Sem o índice, um caminho
    // novo que esqueça a conferência volta a criar duplicata em silêncio.
    await expect(prisma.servico.create({ data: { nome: `${PFX} Original` } })).rejects.toThrow();
  });
});
