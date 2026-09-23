import { describe, it, expect } from "vitest";
import { criarPropostaPersonalizadaSchema } from "@app/shared";
import {
  mover,
  novaLinha,
  novaPersonalizada,
  payloadDaPersonalizada,
  personalizadaTemConteudo,
  resolverParaPrevia,
  type PersonalizadaForm,
} from "./proposta-personalizada";

/** O editor da Proposta Personalizada (ADR-156): o que sai da tela tem de passar no schema. */

const catalogo = [{ id: "s1", nome: "Gestão Operacional", descricao: "Rotina", condicaoPagamento: null }];

function formCheio(): PersonalizadaForm {
  const f = novaPersonalizada();
  f.itens = [
    { ...novaLinha({ id: "s1", valor: 3500, valorRecorrencia: "MENSAL" }) },
    { ...novaLinha(), descricao: "  Treinamento  ", valor: 400, quantidade: 3 },
    { ...novaLinha(), descricao: "Repasse", cobranca: "PERCENTUAL", valor: 999, percentual: 5 },
    { ...novaLinha(), descricao: "   " }, // linha avulsa sem nome: não vai
  ];
  f.clausulas = [{ chave: "c1", texto: " Sigilo. " }, { chave: "c2", texto: "   " }];
  return f;
}

describe("reordenar", () => {
  it("move para cima e para baixo, e não sai da lista nas pontas", () => {
    expect(mover(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(mover(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(mover(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(mover(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("o que a tela manda ao servidor", () => {
  const p = payloadDaPersonalizada(formCheio());

  it("passa no schema do servidor (com o destino que o diálogo acrescenta)", () => {
    expect(criarPropostaPersonalizadaSchema.safeParse({ clienteId: "c1", ...p }).success).toBe(true);
  });

  it("percentual zera o valor fixo — nunca os dois juntos", () => {
    expect(p.itens[2]).toMatchObject({ valor: 0, percentual: 5, recorrencia: "MENSAL" });
  });

  it("descarta linha avulsa sem nome e cláusula vazia, e apara os textos", () => {
    expect(p.itens).toHaveLength(3);
    expect(p.itens[1]!.descricao).toBe("Treinamento");
    expect(p.clausulas).toEqual(["Sigilo."]);
    expect(p.formaPagamento).toBe("PIX");
  });

  it("a proposta nova já nasce com conteúdo (a apresentação padrão)", () => {
    expect(personalizadaTemConteudo(novaPersonalizada())).toBe(true);
    const vazia = novaPersonalizada();
    vazia.secoes = [];
    expect(personalizadaTemConteudo(vazia)).toBe(false);
  });
});

describe("a prévia usa a mesma regra de nome do servidor", () => {
  it("nome do catálogo, texto digitado por cima, e frase do repasse para o percentual", () => {
    const r = resolverParaPrevia(formCheio(), catalogo);
    expect(r.itens[0]).toMatchObject({ nome: "Gestão Operacional", detalhe: "Rotina", valor: 3500 });
    expect(r.itens[1]!.nome).toBe("Treinamento");
    expect(r.fraseRepasse).toBeTruthy();
  });
});
