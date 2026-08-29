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

/**
 * O CAMINHO DE VOLTA — e é ele que estava aberto (M6).
 *
 * O teste acima cobre "categoria sem template". O buraco era o contrário: template de
 * NOTIFICAÇÃO que ninguém pôs em `EMAIL_CATEGORIAS`. Como `decidirEmailOperacional` começa
 * por `if (!EMAIL_TIPOS.includes(p.tipo)) return false`, esse aviso nasce com assunto, corpo
 * e botão prontos — e o e-mail NUNCA SAI. Não há erro, não há log, não há nada na tela: o
 * aviso simplesmente não acontece, e quem depende dele nunca soube que existia.
 *
 * Eram SEIS: conflito de agenda, projeto parado, projeto sem responsável, upsell, documento
 * parado e lead parado — todos os alertas proativos da varredura, justamente os que ninguém
 * vai buscar sozinho.
 *
 * `default` fica de fora porque não é um tipo de aviso: é a moldura de fallback do render.
 */
describe("todo template de notificação é ENVIÁVEL", () => {
  const NAO_E_AVISO = new Set(["default"]);

  it("nenhum template de notificação ficou fora de EMAIL_CATEGORIAS", () => {
    const tipos = new Set(EMAIL_CATEGORIAS.map((c) => c.tipo));
    const mudos = Object.entries(EMAIL_TEMPLATES)
      .filter(([chave, meta]) => meta.notificacao && !NAO_E_AVISO.has(chave) && !tipos.has(chave))
      .map(([chave]) => chave);
    expect(
      mudos,
      `templates de notificação sem categoria (o e-mail nunca sai): ${mudos.join(", ")}`,
    ).toEqual([]);
  });
});
