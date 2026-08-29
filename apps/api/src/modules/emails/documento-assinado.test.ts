import { describe, it, expect } from "vitest";
import { EMAIL_TEMPLATES, templateDe } from "./emails.registry.js";

/**
 * M18 — o e-mail de "todos assinaram" reaproveitava `documento_revisao`, cujo corpo diz
 * "está aguardando sua revisão". Quem recebia lia que faltava revisar algo que já está
 * assinado por todos. `documento_assinado` é um template PRÓPRIO — não reaproveita o de
 * revisão — e a régua abaixo trava as duas pontas: o texto errado nunca mais aparece no
 * template certo, e o registry continua exigindo os três formatos (assunto/HTML/texto puro,
 * cobertos pelo `default` do `TemplateMeta`).
 */
describe("template documento_assinado", () => {
  it("existe no registry, com corpo e assunto PRÓPRIOS", () => {
    const meta = templateDe("documento_assinado");
    expect(meta).toBeDefined();
  });

  it("o corpo NÃO diz que o documento está aguardando revisão", () => {
    const meta = EMAIL_TEMPLATES.documento_assinado;
    expect(meta.default.corpo.toLowerCase()).not.toContain("aguardando");
    expect(meta.default.corpo.toLowerCase()).not.toContain("revisão");
    expect(meta.default.assunto.toLowerCase()).not.toContain("revisão");
  });

  it("o corpo diz que o documento foi assinado por todos", () => {
    const meta = EMAIL_TEMPLATES.documento_assinado;
    expect(meta.default.corpo.toLowerCase()).toContain("assinado");
    expect(meta.default.corpo).toContain("{{documento}}");
  });

  it("é marcado como notificação (aparece no sino) e é uma categoria de Notificações", () => {
    const meta = EMAIL_TEMPLATES.documento_assinado;
    expect(meta.notificacao).toBe(true);
    expect(meta.grupo).toBe("Notificações");
  });

  it("REGRESSÃO: documento_revisao continua dizendo 'aguardando sua revisão' (não foi apagado)", () => {
    const meta = EMAIL_TEMPLATES.documento_revisao;
    expect(meta.default.corpo.toLowerCase()).toContain("aguardando sua revisão");
  });
});
