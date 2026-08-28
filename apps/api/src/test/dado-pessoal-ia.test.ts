import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redigirDadoPessoal, restaurarDadoPessoal } from "@app/shared";

/**
 * A trava do item 1 da conformidade (LGPD): NENHUM dado pessoal identificável sai
 * daqui para a OpenAI. A lição da ADR-140 é que a segunda porta é a que fura a
 * regra — por isso a peneira mora na PORTA ÚNICA (`lib/ai.ts`), e não em cada
 * lugar que monta contexto.
 *
 * O par redigir/restaurar existe porque apagar o dado corromperia o resultado:
 * "melhorar com IA" devolve o corpo do documento, e um contrato voltando com
 * "[removido]" no lugar do CNPJ é perda de dado — troca de um problema por outro.
 */
describe("redigirDadoPessoal — o que sai daqui para a IA", () => {
  it("troca CPF, CNPJ, e-mail, telefone, CRM, RG e CEP por etiqueta", () => {
    const texto = [
      "Dr. João, CPF 123.456.789-09, CRM/SP 123456, RG 12.345.678-9",
      "Clínica Vida Plena, CNPJ 34.270.022/0001-93",
      "contato: joao.silva@clinica.com.br, (11) 98765-4321",
      "CEP 01310-100",
    ].join("\n");
    const { texto: saida } = redigirDadoPessoal(texto);

    for (const dado of [
      "123.456.789-09",
      "34.270.022/0001-93",
      "joao.silva@clinica.com.br",
      "98765-4321",
      "123456",
      "12.345.678-9",
      "01310-100",
    ]) {
      expect(saida, `vazou ${dado}`).not.toContain(dado);
    }
    expect(saida).toContain("Dr. João"); // o nome fica: sem ele o resumo não serve
  });

  it("pega CPF e CNPJ SEM máscara — o formulário público aceita os dois jeitos", () => {
    const { texto } = redigirDadoPessoal("cpf 12345678909 e cnpj 34270022000193");
    expect(texto).not.toContain("12345678909");
    expect(texto).not.toContain("34270022000193");
  });

  it("devolve o original no lugar certo — a ida esconde, a volta restaura", () => {
    const original = "Ligar para (11) 98765-4321 e confirmar o CNPJ 34.270.022/0001-93.";
    const { texto, achados } = redigirDadoPessoal(original);
    // o que a IA devolveria: mesmo texto, com os marcadores preservados
    expect(restaurarDadoPessoal(texto, achados)).toBe(original);
  });

  it("o MESMO dado repetido vira UMA etiqueta só", () => {
    const { texto, achados } = redigirDadoPessoal("a@b.com fala com a@b.com");
    expect(achados).toHaveLength(1);
    expect(texto.match(/\[\[EMAIL-1\]\]/g)).toHaveLength(2);
  });

  it("tolera o marcador voltando com espaço extra da IA", () => {
    const { achados } = redigirDadoPessoal("e-mail: a@b.com");
    expect(restaurarDadoPessoal("escreva para [[ EMAIL-1 ]] hoje", achados)).toBe(
      "escreva para a@b.com hoje",
    );
  });

  it("NÃO estraga data, dinheiro nem intervalo de anos", () => {
    const texto = "Reunião em 28/08/2026, contrato de 2024-2025, valor R$ 12.345,00 (12.345 reais).";
    expect(redigirDadoPessoal(texto).texto).toBe(texto);
  });

  it("texto vazio não quebra", () => {
    expect(redigirDadoPessoal("").achados).toEqual([]);
    expect(restaurarDadoPessoal("oi", [])).toBe("oi");
  });
});

describe("a porta única para a OpenAI", () => {
  const ai = readFileSync(resolve(__dirname, "../lib/ai.ts"), "utf8");

  it("gerarRascunho peneira a entrada e restaura a saída", () => {
    expect(ai).toContain("redigirDadoPessoal");
    expect(ai).toContain("restaurarDadoPessoal");
  });

  it("o campo `observacoes` não vai mais para a IA (é texto livre: guarda CPF antigo e o que o público digitou)", () => {
    const iaSvc = readFileSync(resolve(__dirname, "../modules/ia/ia.service.ts"), "utf8");
    expect(iaSvc).not.toMatch(/observacoes\s*\?\s*`Observações/);
  });
});
