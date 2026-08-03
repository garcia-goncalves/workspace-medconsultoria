import sanitizeHtml from "sanitize-html";

/**
 * Higieniza o HTML de um e-mail recebido. É a entrada mais hostil do sistema: qualquer pessoa do
 * mundo pode mandar HTML para cá. Camada 1 de 3 — as outras duas (iframe isolado e "Mostrar
 * imagens") são no front. Ver §7.2 do desenho.
 *
 * Imagem remota vira `data-src-bloqueada`: o front decide mostrar. O "pixel invisível" é como
 * quem manda spam confirma que o endereço existe e que foi lido.
 */
export function sanitizarEmailHtml(html: string): { html: string; imagensRemotasBloqueadas: number } {
  if (!html) return { html: "", imagensRemotasBloqueadas: 0 };

  let bloqueadas = 0;

  const limpo = sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr", "div", "span", "b", "strong", "i", "em", "u", "s", "sub", "sup",
      "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code",
      "ul", "ol", "li", "dl", "dt", "dd",
      "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
      "a", "img", "figure", "figcaption", "center", "font",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "data-src-bloqueada", "data-cid"],
      "*": ["style", "align", "valign", "colspan", "rowspan", "width", "height", "bgcolor", "color", "face", "size"],
    },
    // Só o que é seguro navegar. `data:` fica de fora de propósito (vetor de execução).
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "cid"] },
    // Toda âncora sai isolada da aba de origem.
    transformTags: {
      a: (_tag, atributos) => ({
        tagName: "a",
        attribs: { ...atributos, target: "_blank", rel: "noopener noreferrer nofollow" },
      }),
      img: (_tag, atributos) => {
        const src = atributos.src ?? "";
        if (/^https?:/i.test(src)) {
          bloqueadas += 1;
          const { src: _fora, ...resto } = atributos;
          return { tagName: "img", attribs: { ...resto, "data-src-bloqueada": src } };
        }
        return { tagName: "img", attribs: atributos };
      },
    },
    // `style` sobrevive, mas sem `position`/`url()` — que servem para sobrepor a interface.
    allowedStyles: {
      "*": {
        color: [/^.*$/],
        "background-color": [/^.*$/],
        "font-size": [/^.*$/],
        "font-family": [/^.*$/],
        "font-weight": [/^.*$/],
        "font-style": [/^.*$/],
        "text-align": [/^.*$/],
        "text-decoration": [/^.*$/],
        padding: [/^.*$/],
        margin: [/^.*$/],
        border: [/^.*$/],
        width: [/^.*$/],
        "max-width": [/^.*$/],
      },
    },
    disallowedTagsMode: "discard",
  });

  return { html: limpo, imagensRemotasBloqueadas: bloqueadas };
}
