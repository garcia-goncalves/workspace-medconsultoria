import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { montarWordMhtml } from "./DocumentoBranded";

/**
 * O WORD SAÍA SEM O LOGOTIPO DA MED — e a proposta 0226 (Dr. Rinaldi, 22/09/2026) foi ao
 * cliente assim: no lugar da marca, o quadradinho de imagem quebrada de 14×16 px que o Word
 * desenha quando não acha a figura.
 *
 * A causa era o `.doc` carregar `<img src="/logo.png">`. Na tela e na janela de impressão isso
 * resolve contra a origem da aplicação e funciona; no `.doc`, que é aberto FORA do navegador —
 * muitas vezes na máquina do cliente —, não resolve para nada.
 *
 * ⚠️ O conserto que parece óbvio NÃO funciona, e é por isso que isto virou teste: com
 * `data:image/png;base64,…` o Word 16 desenha o MESMO quadradinho. Medido, não suposto. Quem
 * "simplificar" este arquivo de volta para um HTML solto devolve o defeito — e ele é invisível
 * daqui: só aparece no papel que já chegou ao cliente.
 */

const DOC = { titulo: "Proposta de faturamento médico 0226", conteudoMarkdown: "Prezado(a)," };
const LOGO = "iVBORw0KGgoAAAANSUhEUg";

/** Devolve o HTML do documento, que viaja em base64 dentro da parte `documento.htm`. */
function htmlDeDentro(arquivo: string): string {
  const parte = arquivo.indexOf("documento.htm");
  const corpo = arquivo.slice(arquivo.indexOf("\r\n\r\n", parte) + 4).split("\r\n\r\n")[0] ?? "";
  return new TextDecoder().decode(
    Uint8Array.from(atob(corpo.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)),
  );
}

describe("o .doc leva o logotipo dentro", () => {
  it("é um arquivo MHTML de várias partes, não um HTML solto", () => {
    const a = montarWordMhtml(DOC, LOGO);
    expect(a.startsWith("MIME-Version: 1.0")).toBe(true);
    expect(a).toContain('Content-Type: multipart/related; boundary="----=_NextPart_MedConsultoria"');
  });

  it("traz o logotipo como uma parte de imagem do próprio arquivo", () => {
    const a = montarWordMhtml(DOC, LOGO);
    expect(a).toContain("Content-Type: image/png");
    expect(a).toContain(LOGO);
  });

  it("o src do logotipo casa com o Content-Location da parte que o carrega", () => {
    const a = montarWordMhtml(DOC, LOGO);
    const html = htmlDeDentro(a);
    // Relativo, e não `/logo.png`: o Word resolve o src contra o Content-Location da parte
    // HTML, então o caminho absoluto apontaria para fora do arquivo.
    expect(html).toContain('<img src="logo.png"');
    expect(html).not.toContain('src="/logo.png"');
    expect(a).toContain("Content-Location: file:///C:/medconsultoria/logo.png");
  });

  it("não tenta embutir a marca por data: URI — o Word não desenha", () => {
    expect(htmlDeDentro(montarWordMhtml(DOC, LOGO))).not.toContain("data:image");
  });

  it("preserva o acento do título no corpo do documento", () => {
    expect(htmlDeDentro(montarWordMhtml(DOC, LOGO))).toContain("faturamento médico");
  });
});

/**
 * O WORD NÃO DIMENSIONA A MARCA PELO CSS — e sem os atributos ele desenha o logotipo em tamanho
 * natural (481×328 pt), mais largo que a folha inteira, jogando o documento para a página
 * seguinte. Os atributos são a ÚNICA régua que ele respeita, e precisam ser os dois: medido no
 * Word 16, `height` sozinho mantém a largura natural e estica a marca.
 *
 * Este teste existe para o dia em que alguém trocar `public/logo.png` por um arquivo de outra
 * proporção: na tela nada muda (o CSS usa `width:auto`), e só o papel do cliente sai espremido.
 */
describe("o tamanho do logotipo no Word", () => {
  /** Largura e altura do PNG, lidas do cabeçalho IHDR. */
  function dimensoesDoPng(caminho: string) {
    const b = readFileSync(caminho);
    return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
  }

  it("os atributos width/height guardam a proporção do logotipo de verdade", () => {
    const html = htmlDeDentro(montarWordMhtml(DOC, LOGO));
    const attrs = /<img[^>]*width="(\d+)"[^>]*height="(\d+)"/.exec(html);
    expect(attrs).not.toBeNull();
    const [largura, altura] = [Number(attrs![1]), Number(attrs![2])];

    const png = dimensoesDoPng("public/logo.png");
    // 1px de folga: a largura é arredondada para inteiro.
    expect(Math.abs(largura - (altura * png.largura) / png.altura)).toBeLessThanOrEqual(1);
  });
});
