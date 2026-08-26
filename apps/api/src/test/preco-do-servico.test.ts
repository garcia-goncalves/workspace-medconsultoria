/**
 * A regra que decide COMO um serviço é cobrado — e, por consequência, quais campos a proposta
 * mostra (ADR-126).
 *
 * O caso que originou: o `PropostaServicosPicker` ainda decidia por `categoria === "Faturamento"`
 * em dois lugares, depois de a ADR-125 já ter trocado a mesma checagem em outros três. Casar por
 * NOME quebra em dois dias previsíveis: quando a Thaís renomeia a categoria na tela de Serviços,
 * e quando ela cria um segundo serviço percentual. Nos dois, a tela volta a pedir valor e
 * quantidade para um serviço que não tem nem um nem outro — e ninguém lembraria desta linha.
 *
 * O que estes testes guardam, e não pode regredir:
 *  - a regra lê o PREÇO, não a categoria (nenhum "Faturamento" no código da regra);
 *  - serviço percentual PURO não tem valor fixo nem quantidade — é sempre mensal;
 *  - serviço MISTURADO (valor + %) continua com os dois campos: esconder o valor fixo sumiria
 *    com dinheiro real do documento.
 */
import { describe, it, expect } from "vitest";
import { ehServicoSomentePercentual, temPercentual, temValorFixo } from "@app/shared";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FATURAMENTO = { valor: null, percentual: 5 };
const GESTAO = { valor: 3500, percentual: null };
const MISTURADO = { valor: 1200, percentual: 3 };
const SEM_PRECO = { valor: null, percentual: null };

describe("ehServicoSomentePercentual", () => {
  it("serviço só com percentual → sem valor, sem quantidade, sempre mensal", () => {
    expect(ehServicoSomentePercentual(FATURAMENTO)).toBe(true);
  });

  it("serviço de preço fixo → segue com valor e quantidade", () => {
    expect(ehServicoSomentePercentual(GESTAO)).toBe(false);
  });

  it("serviço MISTURADO (valor + %) mantém os dois campos — o valor fixo não pode sumir", () => {
    expect(ehServicoSomentePercentual(MISTURADO)).toBe(false);
    expect(temValorFixo(MISTURADO)).toBe(true);
    expect(temPercentual(MISTURADO)).toBe(true);
  });

  it("serviço sem preço nenhum não vira percentual por omissão", () => {
    expect(ehServicoSomentePercentual(SEM_PRECO)).toBe(false);
  });

  it("zero e negativo não são preço — não ligam nem valor nem percentual", () => {
    expect(temValorFixo({ valor: 0, percentual: null })).toBe(false);
    expect(temPercentual({ valor: null, percentual: 0 })).toBe(false);
    expect(ehServicoSomentePercentual({ valor: 0, percentual: 5 })).toBe(true);
    expect(ehServicoSomentePercentual({ valor: null, percentual: -1 })).toBe(false);
  });

  it("undefined é tratado como ausente (o item da proposta pode não trazer o campo)", () => {
    expect(ehServicoSomentePercentual({ valor: undefined, percentual: 5 })).toBe(true);
    expect(temValorFixo({ valor: undefined, percentual: undefined })).toBe(false);
  });
});

describe("a decisão da TELA não casa por nome de categoria", () => {
  const picker = readFileSync(
    fileURLToPath(new URL("../../../web/src/features/documentos/PropostaServicosPicker.tsx", import.meta.url)),
    "utf-8",
  );

  it('o seletor de serviços da proposta não compara com "Faturamento"', () => {
    // O texto APARECE em comentário, contando a história — é o código que não pode voltar a
    // comparar. Por isso os comentários saem antes da conferência: guardar a regra e proibir a
    // explicação dela seria trocar uma armadilha por outra.
    const semComentarios = picker
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(semComentarios).not.toMatch(/categoria\s*===\s*["']Faturamento["']/);
  });

  it("o seletor usa a regra de preço compartilhada", () => {
    expect(picker).toContain("ehServicoSomentePercentual");
  });
});
