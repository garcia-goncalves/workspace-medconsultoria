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
import {
  atualizarContratacaoClienteSchema,
  createServicoSchema,
  ehServicoSomentePercentual,
  PRECO_VALOR_E_PERCENTUAL,
  temPercentual,
  temValorEPercentual,
  temValorFixo,
  updateServicoSchema,
} from "@app/shared";
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

describe("a decisão do SERVIDOR de documentos também não casa por nome de categoria", () => {
  // Quarta vez que esta comparação precisou sair daqui (ADR-125, 126 e 127). Em 26/08/2026 ela
  // estava de volta em QUATRO lugares do `documentos.service.ts`, montando o item da proposta a
  // partir do cliente e do lead: `categoria === "Faturamento" ? emReais(percentual) : null`
  // jogava fora o percentual de qualquer serviço de outra categoria. Ninguém tinha sido mordido
  // ainda; seria mordido no dia em que a Thaís pusesse % num serviço de Gestão, ou renomeasse a
  // categoria na tela — a proposta sairia sem o percentual, sem erro nenhum.
  const servidor = readFileSync(
    fileURLToPath(new URL("../modules/documentos/documentos.service.ts", import.meta.url)),
    "utf-8",
  );

  it('o servidor de documentos não compara com "Faturamento"', () => {
    const semComentarios = servidor
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(semComentarios).not.toMatch(/categoria\s*===\s*["']Faturamento["']/);
  });

  it("o servidor usa a regra de preço compartilhada para decidir a frase do repasse", () => {
    expect(servidor).toContain("ehServicoSomentePercentual");
  });
});

/**
 * AS DUAS TELAS QUE FICAVAM DE FORA (F4/F3 da descoberta de 28/08).
 *
 * O guarda acima cobria o seletor da proposta e o servidor de documentos — e deixava passar
 * justamente o lugar mais **a montante** de todos: a tela de Serviços, onde o campo de % só
 * existia se a categoria se chamasse "Faturamento". Era a QUINTA aparição da comparação. Ela
 * impedia um segundo serviço percentual de existir, sumia com o % no dia em que alguém
 * renomeasse a categoria, e deixava o campo Valor visível no serviço que não tem valor. A
 * quinta cópia sobrevivia também no editor de preço da ficha do cliente.
 */
describe("as TELAS de preço não casam por nome de categoria", () => {
  const semComentarios = (caminho: string) =>
    readFileSync(fileURLToPath(new URL(caminho, import.meta.url)), "utf-8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");

  const TELAS = [
    ["a tela de Serviços (catálogo)", "../../../web/src/features/crm/servicos/ServicosPage.tsx"],
    ["o editor de preço da ficha do cliente", "../../../web/src/features/crm/clientes/ServicosContratadosCard.tsx"],
  ] as const;

  for (const [nome, caminho] of TELAS) {
    it(`${nome} não compara com "Faturamento"`, () => {
      expect(semComentarios(caminho)).not.toMatch(/categoria\s*===\s*["']Faturamento["']/);
    });

    it(`${nome} usa a regra de preço compartilhada`, () => {
      expect(semComentarios(caminho)).toContain("ehServicoSomentePercentual");
    });
  }
});

/**
 * A TRAVA QUE NUNCA EXISTIU: valor fixo + percentual no mesmo serviço.
 *
 * Nada impedia esse estado — nem banco, nem Zod, nem servidor, nem tela. E ele quebra em
 * silêncio tudo o que lê `ehServicoSomentePercentual`: a linha da proposta volta a mostrar valor
 * e quantidade, a estimativa do funil troca de pergunta sozinha, a conversão passa a provisionar
 * dinheiro fixo. Nenhum desses caminhos avisa; eles só mudam de comportamento.
 */
describe("temValorEPercentual — a trava das duas cobranças juntas", () => {
  it("recusa os dois preenchidos", () => {
    expect(temValorEPercentual({ valor: 3500, percentual: 5 })).toBe(true);
  });

  it("aceita cada um sozinho, e o serviço sem preço nenhum", () => {
    expect(temValorEPercentual({ valor: 3500, percentual: null })).toBe(false);
    expect(temValorEPercentual({ valor: null, percentual: 5 })).toBe(false);
    expect(temValorEPercentual({ valor: null, percentual: null })).toBe(false);
  });

  it("zero não é cobrança — não trava serviço com valor 0 e percentual 5", () => {
    expect(temValorEPercentual({ valor: 0, percentual: 5 })).toBe(false);
    expect(temValorEPercentual({ valor: 3500, percentual: 0 })).toBe(false);
  });

  it("os três schemas recusam o envio com as duas cobranças, em português", () => {
    const base = { nome: "Faturamento", valor: 3500, percentual: 5 };
    const r1 = createServicoSchema.safeParse(base);
    const r2 = updateServicoSchema.safeParse({ id: "s1", ...base });
    const r3 = atualizarContratacaoClienteSchema.safeParse({ clienteId: "c1", servicoId: "s1", valor: 3500, percentual: 5 });
    for (const r of [r1, r2, r3]) {
      expect(r.success).toBe(false);
      expect(r.success === false && r.error.issues[0]?.message).toBe(PRECO_VALOR_E_PERCENTUAL);
    }
  });

  it("os três schemas aceitam cada cobrança sozinha", () => {
    expect(createServicoSchema.safeParse({ nome: "Faturamento", percentual: 5 }).success).toBe(true);
    expect(createServicoSchema.safeParse({ nome: "Gestão", valor: 3500 }).success).toBe(true);
    expect(updateServicoSchema.safeParse({ id: "s1", percentual: 5 }).success).toBe(true);
    expect(atualizarContratacaoClienteSchema.safeParse({ clienteId: "c1", servicoId: "s1", valor: 2500 }).success).toBe(true);
  });
});
