import { describe, it, expect } from "vitest";
import { compararValores, ordenarPor, proximaOrdenacao } from "./data-table-ordenacao";

describe("compararValores", () => {
  it("números: ordem numérica", () => {
    expect(compararValores(1, 2)).toBeLessThan(0);
    expect(compararValores(2, 1)).toBeGreaterThan(0);
    expect(compararValores(5, 5)).toBe(0);
  });

  it("texto: ordem alfabética pt-BR, ignorando acento e maiúscula", () => {
    expect(compararValores("acento", "Ábaco")).toBeGreaterThan(0);
    expect(compararValores("abacate", "Abacate")).toBe(0);
  });

  it("texto: numérico — 'Item 2' vem antes de 'Item 10'", () => {
    expect(compararValores("Item 2", "Item 10")).toBeLessThan(0);
  });

  it("datas: ordem cronológica", () => {
    expect(compararValores(new Date("2026-01-01"), new Date("2026-06-01"))).toBeLessThan(0);
  });

  it("nulo é sempre tratado como 'depois' do valor real, dos dois lados", () => {
    expect(compararValores(null, 5)).toBeGreaterThan(0);
    expect(compararValores(5, null)).toBeLessThan(0);
    expect(compararValores(null, null)).toBe(0);
  });
});

describe("ordenarPor", () => {
  const itens = [{ v: 3 }, { v: 1 }, { v: 2 }];

  it("ordena crescente", () => {
    expect(ordenarPor(itens, (i) => i.v, "asc").map((i) => i.v)).toEqual([1, 2, 3]);
  });

  it("ordena decrescente", () => {
    expect(ordenarPor(itens, (i) => i.v, "desc").map((i) => i.v)).toEqual([3, 2, 1]);
  });

  it("não muta o array original", () => {
    const copia = [...itens];
    ordenarPor(itens, (i) => i.v, "asc");
    expect(itens).toEqual(copia);
  });

  it("nulo fica sempre por ÚLTIMO — inclusive na ordem decrescente", () => {
    const comNulo = [{ v: 2 }, { v: null as number | null }, { v: 1 }];
    expect(ordenarPor(comNulo, (i) => i.v, "asc").map((i) => i.v)).toEqual([1, 2, null]);
    expect(
      ordenarPor(comNulo, (i) => i.v, "desc").map((i) => i.v),
      "descrescente não pode trazer o nulo para o topo — ele não é 'o maior valor', é ausência de dado",
    ).toEqual([2, 1, null]);
  });
});

describe("proximaOrdenacao", () => {
  it("sem ordenação ativa: 1º clique começa em crescente", () => {
    expect(proximaOrdenacao(null, "nome")).toEqual({ chave: "nome", direcao: "asc" });
  });

  it("clicar de novo na MESMA coluna crescente vai para decrescente", () => {
    expect(proximaOrdenacao({ chave: "nome", direcao: "asc" }, "nome")).toEqual({ chave: "nome", direcao: "desc" });
  });

  it("clicar de novo na mesma coluna decrescente volta a 'sem ordenação'", () => {
    expect(proximaOrdenacao({ chave: "nome", direcao: "desc" }, "nome")).toBeNull();
  });

  it("clicar numa coluna DIFERENTE sempre recomeça em crescente — não herda a direção da anterior", () => {
    expect(proximaOrdenacao({ chave: "nome", direcao: "desc" }, "data")).toEqual({ chave: "data", direcao: "asc" });
  });
});
