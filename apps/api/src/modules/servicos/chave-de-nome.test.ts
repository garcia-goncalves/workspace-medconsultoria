import { describe, it, expect } from "vitest";
import { chaveDoNomeDeServico } from "./chave-de-nome.js";

/**
 * Estes casos são o contrato com a collation `utf8mb4_unicode_ci` da coluna `Servico.nome`.
 * Se algum dia a collation da coluna mudar, esta função tem de mudar junto — e este arquivo é o
 * lugar onde alguém descobre isso.
 */
describe("chave de comparação de nome de serviço", () => {
  it("ignora acento, como o banco ignora", () => {
    expect(chaveDoNomeDeServico("Conteúdo & SEO")).toBe(chaveDoNomeDeServico("Conteudo & SEO"));
    expect(chaveDoNomeDeServico("Gestão Operacional")).toBe(chaveDoNomeDeServico("Gestao Operacional"));
  });

  it("ignora maiúscula, como o banco ignora", () => {
    expect(chaveDoNomeDeServico("FATURAMENTO")).toBe(chaveDoNomeDeServico("Faturamento"));
  });

  it("ignora espaço em volta", () => {
    expect(chaveDoNomeDeServico("  Faturamento  ")).toBe(chaveDoNomeDeServico("Faturamento"));
  });

  it("NÃO junta nomes que são de fato diferentes", () => {
    expect(chaveDoNomeDeServico("Manual da marca")).not.toBe(chaveDoNomeDeServico("Manual de marca"));
    expect(chaveDoNomeDeServico("Tráfego pago")).not.toBe(chaveDoNomeDeServico("Tráfego"));
  });
});
