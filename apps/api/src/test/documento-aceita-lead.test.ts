import { describe, it, expect } from "vitest";
import { MODELO_ACEITA_LEAD, modeloAceitaLead, tipoModeloEnum, TIPO_MODELO_LABEL } from "@app/shared";

/**
 * A regra de "que documento pode ser feito para um LEAD" (27/08/2026, ordem do dono).
 * É lista de LIBERAÇÕES com padrão fechado: tipo novo entra aqui e o teste cobra a decisão.
 */
describe("que documento aceita lead", () => {
  it("todo tipo de modelo tem uma decisão explícita — tipo novo nasce fechado", () => {
    for (const tipo of tipoModeloEnum.options) {
      expect(
        MODELO_ACEITA_LEAD[tipo],
        `Tipo "${TIPO_MODELO_LABEL[tipo]}" (${tipo}) entrou sem decidir se aceita lead. ` +
          `Acrescente em MODELO_ACEITA_LEAD: true só se o documento é feito ANTES do aceite.`,
      ).toBeTypeOf("boolean");
    }
  });

  it("os documentos de PRÉ-venda aceitam lead", () => {
    for (const t of ["PROPOSTA", "ESCOPO", "DIAGNOSTICO", "PLANO_ACAO", "ATA", "PAUTA_REUNIAO", "BRIEFING"] as const) {
      expect(modeloAceitaLead(t), `${t} deveria aceitar lead`).toBe(true);
    }
  });

  it("o que nasce DEPOIS do aceite continua exigindo cliente", () => {
    // Contrato é o caso que importa: quem aceita a proposta já virou cliente, então
    // um contrato apontando para lead significaria assinatura sem cliente por trás.
    for (const t of ["CONTRATO", "RECIBO", "ONBOARDING", "CHECKLIST", "RELATORIO", "PAUTA_POSTAGEM"] as const) {
      expect(modeloAceitaLead(t), `${t} NÃO deveria aceitar lead`).toBe(false);
    }
  });

  it("sem tipo escolhido, não oferece lead", () => {
    expect(modeloAceitaLead(null)).toBe(false);
    expect(modeloAceitaLead(undefined)).toBe(false);
  });
});
