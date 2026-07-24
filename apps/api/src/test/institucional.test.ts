import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INSTITUCIONAL, PENDENTE_THAIS, rodapeInstitucional, qualificacaoContratada } from "@app/shared";

const raiz = resolve(__dirname, "../../../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

describe("identidade institucional", () => {
  it("o rodapé cliente-facing usa o site PÚBLICO, nunca o workspace interno", () => {
    const rodape = rodapeInstitucional();
    expect(rodape).toContain(INSTITUCIONAL.site);
    expect(rodape).not.toContain("workspace.");
  });

  it("o rodapé traz os dados de contato reais do site", () => {
    const rodape = rodapeInstitucional();
    expect(rodape).toContain("comercial@medconsultoria.com.br");
    expect(rodape).toContain("(11) 94072-3055");
  });

  /**
   * Trava de integridade: um CNPJ/razão social inventado num contrato assinado é um problema
   * jurídico real. Enquanto a Thaís não fornecer, estes campos ficam `null` — quem consome
   * deve OMITIR, nunca preencher com exemplo. Este teste falha se alguém "resolver" o
   * pendente com um valor de mentira.
   */
  it("dados jurídicos não fornecidos continuam nulos (ninguém inventa CNPJ)", () => {
    expect(PENDENTE_THAIS.razaoSocial).toBeNull();
    expect(PENDENTE_THAIS.cnpj).toBeNull();
    expect(PENDENTE_THAIS.enderecoCompleto).toBeNull();
    expect(PENDENTE_THAIS.foro).toBeNull();
  });

  /**
   * Um contrato precisa qualificar as DUAS partes. Antes, só a CONTRATANTE era qualificada e a
   * CONTRATADA aparecia como um nome solto — falha que um advogado apontaria de imediato.
   */
  it("a qualificação da CONTRATADA traz o que já se sabe", () => {
    const q = qualificacaoContratada();
    expect(q).toContain(INSTITUCIONAL.nome);
    expect(q).toContain("CNPJ");
    expect(q).toContain(INSTITUCIONAL.email);
    expect(q).toContain(INSTITUCIONAL.telefone);
    expect(q).toContain(INSTITUCIONAL.cidade);
  });

  it("o que falta aparece como marcador VISÍVEL, nunca some calado", () => {
    const q = qualificacaoContratada();
    for (const campo of ["RAZÃO SOCIAL", "CNPJ", "ENDEREÇO COMPLETO"]) {
      expect(q, `${campo} sumiu do contrato em vez de virar marcador`).toContain(`**[A PREENCHER: ${campo}]**`);
    }
    // Nem "undefined"/"null" vazando para dentro do contrato.
    expect(q).not.toMatch(/undefined|null/);
  });

  /**
   * Agora a identidade é EDITÁVEL (Ajustes → Dados da empresa). Quando a Thaís preenche os dados
   * jurídicos, eles entram na qualificação da CONTRATADA e os marcadores "[A PREENCHER]" somem.
   */
  it("dados jurídicos preenchidos entram no contrato e derrubam os marcadores", () => {
    const q = qualificacaoContratada({
      razaoSocial: "Med Consultoria em Gestão LTDA",
      cnpj: "12.345.678/0001-90",
      enderecoCompleto: "Av. Paulista, 1000, São Paulo/SP",
    });
    expect(q).toContain("Med Consultoria em Gestão LTDA");
    expect(q).toContain("12.345.678/0001-90");
    expect(q).toContain("Av. Paulista, 1000, São Paulo/SP");
    expect(q).not.toContain("[A PREENCHER");
  });

  it("preenchimento parcial: o que veio entra, o que falta continua marcado", () => {
    const q = qualificacaoContratada({ razaoSocial: "Fulano ME" });
    expect(q).toContain("Fulano ME");
    expect(q).toContain("**[A PREENCHER: CNPJ]**"); // ainda sem CNPJ
  });

  it("o rodapé aceita dados do banco (editados pela Thaís)", () => {
    const r = rodapeInstitucional({ email: "novo@med.com.br", telefone: "(11) 0000-0000" });
    expect(r).toContain("novo@med.com.br");
    expect(r).toContain("(11) 0000-0000");
  });

  it("nenhum material cliente-facing tem contato solto no código", () => {
    const arquivos = [
      "apps/web/src/features/documentos/DocumentoBranded.tsx",
      "apps/api/src/lib/email-template.ts",
    ];
    for (const arq of arquivos) {
      const fonte = ler(arq);
      // O e-mail antigo (contato@) e a URL interna não podem voltar como texto literal.
      expect(fonte, `${arq} tem e-mail solto`).not.toContain("contato@medconsultoria.com.br");
      expect(fonte, `${arq} vaza a URL interna do workspace`).not.toContain("workspace.medconsultoria.com.br");
    }
  });
});
