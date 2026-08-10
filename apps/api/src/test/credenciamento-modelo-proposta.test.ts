import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../modules/documentos/modelos.service.js";

/**
 * O MODELO da Proposta de credenciamento tem de continuar fiel ao papel que a Thaís manda
 * hoje (`brand/identidade/Proposta Credenciamento…pdf`, spec §6.4).
 *
 * O teste existe porque o risco aqui não é o código quebrar — é alguém "melhorar" a redação
 * de uma cláusula que tem efeito comercial. "Somente no sucesso", "não haverá adiantamento" e
 * "após 1 (uma) tentativa e negativa" definem quando a MedConsultoria recebe e até onde vai o
 * trabalho. Reescrever isso sem querer muda o contrato com o cliente, calado.
 */

const modelo = DEFAULTS.find((d) => d.nome === "Proposta de credenciamento");

describe("modelo da Proposta de credenciamento", () => {
  it("existe e é do tipo PROPOSTA", () => {
    expect(modelo).toBeDefined();
    expect(modelo!.tipo).toBe("PROPOSTA");
  });

  it("tem as cinco seções do papel, na ordem", () => {
    const corpo = modelo!.corpo;
    const secoes = [
      "1. Dados, Serviços e instalações a serem fornecidos para o Cliente",
      "2. Plano de Trabalho Relativo à Execução do Serviço",
      "3. Honorários",
      "4. Observações Importantes",
      "5. Confidencialidade e não divulgação",
    ];
    let anterior = -1;
    for (const s of secoes) {
      const pos = corpo.indexOf(s);
      expect(pos, `seção ausente: ${s}`).toBeGreaterThan(-1);
      expect(pos, `seção fora de ordem: ${s}`).toBeGreaterThan(anterior);
      anterior = pos;
    }
  });

  it("mantém os seis passos do plano de trabalho", () => {
    const corpo = modelo!.corpo;
    for (const passo of [
      "Primeiro contato com a operadora",
      "Elaboração da carta de apresentação",
      "Follow-up da documentação solicitada",
      "Elaboração e negociação da tabela de valores",
      "Acompanhamento até pronunciamento do plano de saúde e assinatura do contrato",
      "Networking com a equipe de relacionamento médico",
    ]) {
      expect(corpo, `passo ausente: ${passo}`).toContain(passo);
    }
  });

  it("mantém as cláusulas que definem quando a MedConsultoria recebe", () => {
    const corpo = modelo!.corpo;
    expect(corpo).toContain("somente no sucesso");
    expect(corpo).toContain("após assinatura do contrato de prestação de serviço formalizado com a operadora");
    expect(corpo).toContain("Não haverá adiantamento nem despesas adicionais");
  });

  it("mantém a regra de uma tentativa e a responsabilidade documental do cliente", () => {
    const corpo = modelo!.corpo;
    expect(corpo).toContain("É de responsabilidade do doutor fornecer a documentação exigida pelo plano de saúde");
    expect(corpo).toContain("Após 1 (uma) tentativa e negativa do plano de saúde");
    expect(corpo).toContain("salvo em comum acordo para uma nova tentativa");
  });

  it("mantém a confidencialidade e o aviso de escopo", () => {
    const corpo = modelo!.corpo;
    expect(corpo).toContain("se compromete a não divulgar, sem autorização formal");
    expect(corpo).toContain("Todas as informações fornecidas decorrentes da execução do trabalho são confidenciais");
    expect(corpo).toContain("fora do escopo proposto será necessária elaboração de nova proposta");
  });

  it("declara os marcadores que o sistema preenche", () => {
    const corpo = modelo!.corpo;
    // {{operadoras}} é o que faz o diálogo usar o formulário de credenciamento (ADR-56);
    // {{numero}} é o que põe a proposta na sequência da Thaís (§5.5).
    for (const marcador of [
      "{{numero}}",
      "{{data}}",
      "{{cliente.nome}}",
      "{{profissionais}}",
      "{{profissionais_nomes}}",
      "{{operadoras}}",
      "{{servicos}}",
      "{{consultora}}",
    ]) {
      expect(corpo, `marcador ausente: ${marcador}`).toContain(marcador);
    }
  });

  it("NÃO traz nome de médico nem valor do papel original", () => {
    // O PDF de referência é de um cliente real. O modelo é a moldura — os dados entram pelos
    // marcadores. Nome de paciente/médico real versionado no repositório não tem volta.
    const corpo = modelo!.corpo;
    for (const vazado of ["Lottenberg", "Simão", "Marcos", "Carina", "Omint", "Care Plus", "Amil"]) {
      expect(corpo, `dado real vazado no modelo: ${vazado}`).not.toContain(vazado);
    }
  });
});
