import { describe, it, expect } from "vitest";
import { EMAIL_CATEGORIAS } from "@app/shared";
import { EMAIL_TEMPLATES, templateDe, type EmailTemplateChave } from "../modules/emails/emails.registry.js";

/**
 * Invariante entre camadas: todo tipo de aviso precisa ter template no `emails.registry`.
 * Sem template, o `renderTemplate` explode em RUNTIME — foi assim que o scan proativo já
 * caiu antes. `packages/shared` não pode importar de `apps/api`, então a checagem mora aqui.
 */
describe("tipos de notificação × templates de e-mail", () => {
  it("toda categoria de e-mail tem template correspondente", () => {
    const semTemplate = EMAIL_CATEGORIAS.map((c) => c.tipo).filter((tipo) => !templateDe(tipo));
    expect(semTemplate, `categorias sem template no registry: ${semTemplate.join(", ")}`).toEqual([]);
  });

  it("EmailTemplateChave é união literal — não `string`", () => {
    // Guarda do mecanismo: se alguém trocar o `satisfies` do registry por uma anotação
    // `: Record<string, TemplateMeta>`, a união vira `string`, a linha abaixo passa a
    // compilar e o @ts-expect-error é que vira erro. O teste quebra no BUILD, de propósito.
    // @ts-expect-error chave inexistente tem de ser barrada pelo compilador
    const invalida: EmailTemplateChave = "tipo_que_nao_existe";
    expect(templateDe(invalida)).toBeUndefined();
  });

  it("o registry não está vazio (pega import quebrado)", () => {
    expect(Object.keys(EMAIL_TEMPLATES).length).toBeGreaterThan(30);
  });
});
