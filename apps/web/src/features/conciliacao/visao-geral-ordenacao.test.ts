import { describe, it, expect } from "vitest";
import { proximaOrdenacaoVisaoGeral } from "./visao-geral-ordenacao";

describe("proximaOrdenacaoVisaoGeral", () => {
  it("sem ordenação ativa: 1º clique numa coluna de DINHEIRO começa DECRESCENTE — o maior problema primeiro", () => {
    expect(proximaOrdenacaoVisaoGeral(null, "glosa")).toEqual({ chave: "glosa", direcao: "desc" });
    expect(proximaOrdenacaoVisaoGeral(null, "cobrado")).toEqual({ chave: "cobrado", direcao: "desc" });
    expect(proximaOrdenacaoVisaoGeral(null, "aReceber")).toEqual({ chave: "aReceber", direcao: "desc" });
    expect(proximaOrdenacaoVisaoGeral(null, "aReceberAtrasado")).toEqual({ chave: "aReceberAtrasado", direcao: "desc" });
    expect(proximaOrdenacaoVisaoGeral(null, "glosaSemRecurso")).toEqual({ chave: "glosaSemRecurso", direcao: "desc" });
    expect(proximaOrdenacaoVisaoGeral(null, "recebido")).toEqual({ chave: "recebido", direcao: "desc" });
  });

  it("sem ordenação ativa: 1º clique em 'Cliente' começa CRESCENTE — é texto, A→Z como qualquer lista", () => {
    expect(proximaOrdenacaoVisaoGeral(null, "cliente")).toEqual({ chave: "cliente", direcao: "asc" });
  });

  it("clicar de novo na MESMA coluna de dinheiro (já decrescente) inverte para crescente", () => {
    expect(proximaOrdenacaoVisaoGeral({ chave: "glosa", direcao: "desc" }, "glosa")).toEqual({
      chave: "glosa",
      direcao: "asc",
    });
  });

  it("clicar pela 3ª vez na mesma coluna (já na direção oposta à inicial) volta à ordem do servidor (nulo)", () => {
    expect(proximaOrdenacaoVisaoGeral({ chave: "glosa", direcao: "asc" }, "glosa")).toBeNull();
  });

  it("clicar de novo em 'Cliente' (já crescente) inverte para decrescente (Z→A)", () => {
    expect(proximaOrdenacaoVisaoGeral({ chave: "cliente", direcao: "asc" }, "cliente")).toEqual({
      chave: "cliente",
      direcao: "desc",
    });
  });

  it("clicar numa coluna DIFERENTE sempre recomeça na direção INICIAL DELA, nunca herda a direção anterior", () => {
    // Estava em "cliente" crescente; clicar em "glosa" não deve vir crescente por herança.
    expect(proximaOrdenacaoVisaoGeral({ chave: "cliente", direcao: "asc" }, "glosa")).toEqual({
      chave: "glosa",
      direcao: "desc",
    });
    // E o caminho inverso: de "glosa" decrescente para "cliente" não vem decrescente.
    expect(proximaOrdenacaoVisaoGeral({ chave: "glosa", direcao: "desc" }, "cliente")).toEqual({
      chave: "cliente",
      direcao: "asc",
    });
  });
});
