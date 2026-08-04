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
        // ALLOWLIST, não lista negra: só `cid:` (imagem embutida na própria mensagem) passa.
        // O teste anterior era `/^https?:/`, e DUAS coisas triviais escapavam dele — ambas
        // confirmadas rodando o sanitizador: `//rastreio.mau/pixel.gif` (protocolo-relativo,
        // que o navegador resolve normalmente) e `" HTTPS://…"` com espaço na frente. O pixel
        // carregava sem ninguém clicar em "Mostrar imagens" E o contador ficava em 0 — ou seja,
        // a faixa afirmava que nada tinha sido bloqueado. Era a promessa de privacidade da tela
        // sendo quebrada em silêncio, que é pior do que não ter a proteção.
        const src = (atributos.src ?? "").trim();
        if (!src || /^cid:/i.test(src)) return { tagName: "img", attribs: atributos };
        bloqueadas += 1;
        const { src: _fora, ...resto } = atributos;
        return { tagName: "img", attribs: { ...resto, "data-src-bloqueada": src } };
      },
    },
    // `style` sobrevive só nas propriedades desta lista — `position` fica de fora (serve para
    // sobrepor a interface). Atenção ao ler: os regex são `/^.*$/`, então `url(…)` PASSA dentro
    // das propriedades permitidas (ex.: `background-color:url(//x)`). Não é explorável — a
    // declaração é CSS inválido e o navegador a descarta, e o corpo roda em iframe sem rede
    // própria —, mas não confie neste bloco para barrar `url()`; quem barra imagem é o `img`.
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
