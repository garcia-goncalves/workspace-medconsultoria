import { describe, it, expect } from "vitest";
import { sanitizarEmailHtml } from "./sanitizar-html.js";

describe("sanitizarEmailHtml", () => {
  it("remove script", () => {
    const { html } = sanitizarEmailHtml('<p>oi</p><script>fetch("/roubar")</script>');
    expect(html).toContain("oi");
    expect(html.toLowerCase()).not.toContain("script");
  });

  it("remove atributos de evento", () => {
    const { html } = sanitizarEmailHtml('<img src="https://x/y.png" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("remove link javascript:", () => {
    const { html } = sanitizarEmailHtml('<a href="javascript:alert(1)">clique</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("clique");
  });

  it("remove iframe e form (roubo de credencial dentro do e-mail)", () => {
    const { html } = sanitizarEmailHtml('<iframe src="https://x"></iframe><form action="https://x"><input name="senha"></form>');
    expect(html.toLowerCase()).not.toContain("<iframe");
    expect(html.toLowerCase()).not.toContain("<form");
  });

  it("bloqueia imagem remota e conta quantas", () => {
    const r = sanitizarEmailHtml('<img src="https://rastreio/pixel.gif"><img src="http://outro/a.png">');
    expect(r.imagensRemotasBloqueadas).toBe(2);
    // O que precisa ser verdade é que NENHUMA imagem tem `src` — o navegador não busca nada.
    // A URL continua no HTML, guardada em `data-src-bloqueada`: é dela que o botão
    // "Mostrar imagens" precisa. Afirmar que a URL sumiu quebraria esse botão.
    expect(r.html).not.toMatch(/<img[^>]*\ssrc=/);
    expect(r.html).toContain('data-src-bloqueada="https://rastreio/pixel.gif"');
    expect(r.html).toContain('data-src-bloqueada="http://outro/a.png"');
  });

  it("preserva formatação legítima de e-mail (tabela, negrito, link http)", () => {
    const { html } = sanitizarEmailHtml('<table><tr><td><b>Total</b> <a href="https://medconsultoria.com.br">site</a></td></tr></table>');
    expect(html).toContain("<table");
    expect(html).toContain("<b>Total</b>");
    expect(html).toContain('href="https://medconsultoria.com.br"');
  });

  it("aguenta entrada vazia sem explodir", () => {
    expect(sanitizarEmailHtml("").html).toBe("");
  });
});
