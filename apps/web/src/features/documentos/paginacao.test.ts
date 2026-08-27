import { describe, it, expect } from "vitest";
import { empacotarBlocos, type BlocoMedido } from "./paginacao";

/**
 * COMO O DOCUMENTO SE PARTE EM FOLHAS.
 *
 * Esta é a regra que decide o que o cliente da Thaís vê impresso. As alturas aqui são
 * inventadas de propósito (a medição de verdade vive no navegador): o que se testa é a
 * DECISÃO — o que desce para a próxima folha e o que fica.
 */

const folha = { primeira: 100, demais: 120 };

const p = (html: string, h: number): BlocoMedido => ({ tipo: "atomo", html, h });
const titulo = (html: string, h: number): BlocoMedido => ({ tipo: "atomo", html, h, titulo: true });

describe("empacotar o documento em folhas A4", () => {
  it("enche a folha antes de abrir a próxima", () => {
    const paginas = empacotarBlocos([p("<p>a</p>", 40), p("<p>b</p>", 40)], folha);
    expect(paginas).toHaveLength(1);
    expect(paginas[0]).toBe("<p>a</p><p>b</p>");
  });

  it("bloco que não cabe desce INTEIRO para a próxima folha", () => {
    const paginas = empacotarBlocos([p("<p>a</p>", 80), p("<p>b</p>", 40)], folha);
    expect(paginas).toHaveLength(2);
    expect(paginas[1]).toBe("<p>b</p>");
  });

  it("A ASSINATURA NÃO SE PARTE: tabela que cabe numa folha inteira nunca é fatiada", () => {
    // Caso real: o par de assinaturas no pé da proposta (linha do traço, nome, papel).
    const assinatura: BlocoMedido = {
      tipo: "tabela",
      abre: "<table>",
      cabecalho: "",
      cabH: 0,
      linhas: [
        { html: "<tr><td>____</td></tr>", h: 20 },
        { html: "<tr><td>Thaís Garcia</td></tr>", h: 20 },
        { html: "<tr><td>MedConsultoria</td></tr>", h: 20 },
      ],
      h: 60,
    };
    const paginas = empacotarBlocos([p("<p>texto</p>", 70), assinatura], folha);
    expect(paginas).toHaveLength(2);
    expect(paginas[0], "nada da assinatura pode ficar na 1ª folha").not.toContain("<tr>");
    const inteira = paginas[1];
    expect(inteira).toContain("____");
    expect(inteira).toContain("Thaís Garcia");
    expect(inteira).toContain("MedConsultoria");
  });

  it("tabela MAIOR que a folha é fatiada por linhas, repetindo o cabeçalho", () => {
    const grande: BlocoMedido = {
      tipo: "tabela",
      abre: "<table>",
      cabecalho: "<thead><tr><th>Serviço</th></tr></thead>",
      cabH: 20,
      linhas: Array.from({ length: 12 }, (_, i) => ({ html: `<tr><td>s${i}</td></tr>`, h: 30 })),
      h: 380,
    };
    const paginas = empacotarBlocos([grande], folha);
    expect(paginas.length).toBeGreaterThan(1);
    for (const pg of paginas) {
      expect(pg, "toda fatia repete o cabeçalho da tabela").toContain("<thead>");
    }
    const tudo = paginas.join("");
    for (let i = 0; i < 12; i++) {
      const vezes = tudo.split(`<td>s${i}</td>`).length - 1;
      expect(vezes, `a linha s${i} aparece uma vez só, inteira`).toBe(1);
    }
  });

  it("TÍTULO NÃO FICA ÓRFÃO no pé da folha", () => {
    // Sobram 25px: o título (20px) caberia sozinho, mas nada do texto seguinte entraria.
    const paginas = empacotarBlocos([p("<p>a</p>", 75), titulo("<h2>Investimento</h2>", 20), p("<p>b</p>", 60)], folha);
    expect(paginas).toHaveLength(2);
    expect(paginas[0], "o título desceu junto com o texto dele").not.toContain("<h2>");
    expect(paginas[1]).toBe("<h2>Investimento</h2><p>b</p>");
  });

  it("título desce quando o PARÁGRAFO INTEIRO dele não cabe — parágrafo não se parte", () => {
    // Caso real: "Prazos e rotina de faturamento" ficou sozinho no pé da folha 2 da proposta
    // 0230 porque a régua pedia só "duas linhas" do texto seguinte, e sobrava espaço para elas.
    const paginas = empacotarBlocos([p("<p>a</p>", 20), titulo("<h2>Prazos</h2>", 20), p("<p>longo</p>", 100)], folha);
    expect(paginas).toHaveLength(2);
    expect(paginas[0]).toBe("<p>a</p>");
    expect(paginas[1]).toBe("<h2>Prazos</h2><p>longo</p>");
  });

  it("TÍTULO SEGUIDO DE TÍTULO desce junto — a fila inteira, não só o vizinho", () => {
    // Caso real: "Como funciona o nosso serviço" é seguido de "O que a Clínica nos encaminha".
    // Olhando só o vizinho, a conta dava "cabe" — e os DOIS ficavam sozinhos no pé da folha.
    const paginas = empacotarBlocos(
      [p("<p>a</p>", 20), titulo("<h2>Como funciona</h2>", 20), titulo("<h3>O que enviar</h3>", 20), p("<p>lista</p>", 80)],
      folha,
    );
    expect(paginas).toHaveLength(2);
    expect(paginas[0]).toBe("<p>a</p>");
    expect(paginas[1]).toBe("<h2>Como funciona</h2><h3>O que enviar</h3><p>lista</p>");
  });

  it("título com o texto dele cabendo junto NÃO desce à toa", () => {
    const paginas = empacotarBlocos([p("<p>a</p>", 20), titulo("<h2>T</h2>", 20), p("<p>b</p>", 40)], folha);
    expect(paginas).toHaveLength(1);
  });

  it("documento vazio ainda dá uma folha (nunca zero)", () => {
    expect(empacotarBlocos([], folha)).toEqual([""]);
  });
});
