import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./DocumentoBranded";

/**
 * TABELA USADA COMO LAYOUT NÃO GANHA FAIXA AZUL.
 *
 * O Markdown exige cabeçalho em toda tabela — não existe tabela sem `| --- |`. Quando ela é
 * usada só para pôr duas coisas lado a lado (o par de assinaturas no fim da proposta de
 * credenciamento é o caso real), o cabeçalho vai vazio, e o estilo da folha pinta todo `th`
 * de azul escuro: no PDF que vai para o médico aparecia uma tarja azul sólida flutuando
 * acima das linhas de assinatura, sem nada escrito dentro.
 *
 * Cabeçalho com conteúdo continua azul — ele é o cabeçalho da tabela de investimento, e é
 * assim que a proposta sempre foi.
 */
describe("tabela de Markdown sem cabeçalho de verdade", () => {
  const assinaturas = [
    "| | |",
    "| --- | --- |",
    "| \\_\\_\\_\\_\\_\\_ | \\_\\_\\_\\_\\_\\_ |",
    "| **Thaís Garcia** | **Clínica Bem Estar** |",
    "| MedConsultoria | Cliente |",
  ].join("\n");

  it("cabeçalho inteiramente vazio não vira faixa no documento", () => {
    const html = renderMarkdown(assinaturas);
    expect(html, "thead sem nada escrito não deve sobrar no HTML").not.toContain("<thead>");
    expect(html, "as linhas da assinatura continuam lá").toContain("Thaís Garcia");
    expect(html).toContain("MedConsultoria");
  });

  it("cabeçalho com texto continua existindo (a tabela de investimento)", () => {
    const investimento = [
      "| Profissional | Operadora | Investimento |",
      "| --- | --- | --- |",
      "| Dra. Helena | Omint | R$ 2.500,00 |",
    ].join("\n");
    const html = renderMarkdown(investimento);
    expect(html).toContain("<thead>");
    expect(html).toContain("Profissional");
  });

  it("cabeçalho com uma só coluna preenchida continua sendo cabeçalho", () => {
    const misto = ["| Item | |", "| --- | --- |", "| Total | R$ 10,00 |"].join("\n");
    expect(renderMarkdown(misto)).toContain("<thead>");
  });
});
