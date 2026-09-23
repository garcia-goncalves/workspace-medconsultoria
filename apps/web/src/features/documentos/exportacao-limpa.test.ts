import { describe, it, expect, vi } from "vitest";
import { montarWordMhtml, confirmarExportacao, pendenciasDoDocumento, documentoBrandedHtml } from "./DocumentoBranded";

/**
 * O PDF e o Word vão ao cliente: não podem carregar rótulo de trabalho interno ("Rascunho",
 * "Em revisão") nem selo de tipo. A tela de edição continua mostrando os dois.
 */
const DOC = {
  titulo: "Proposta 0230",
  tipo: "Proposta",
  statusLabel: "RASCUNHO-INTERNO",
  numero: "0230",
  conteudoMarkdown: "# Olá\n\nTexto.",
  rodapeExtra: "Assinado digitalmente · integridade verificada.",
};

function htmlDeDentro(arquivo: string): string {
  const parte = arquivo.indexOf("documento.htm");
  const corpo = arquivo.slice(arquivo.indexOf("\r\n\r\n", parte) + 4).split("\r\n\r\n")[0] ?? "";
  return new TextDecoder().decode(Uint8Array.from(atob(corpo.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)));
}

describe("exportação sem selos internos", () => {
  it("a tela continua mostrando status e tipo", () => {
    const html = documentoBrandedHtml(DOC);
    expect(html).toContain("RASCUNHO-INTERNO");
    expect(html).toContain('class="tipo"');
  });

  it("o Word não traz selo de status nem de tipo, e traz o código de integridade uma vez", () => {
    const html = htmlDeDentro(montarWordMhtml(DOC, "AAAA"));
    expect(html).not.toContain("RASCUNHO-INTERNO");
    expect(html).not.toContain('<span class="status"');
    expect(html).not.toContain('<span class="tipo"');
    expect(html.match(/integridade verificada/g)).toHaveLength(1);
    expect(html.match(/class="doc-head"/g)).toHaveLength(1);
  });

  it("usa as mesmas margens do PDF (18mm × 16mm)", () => {
    expect(htmlDeDentro(montarWordMhtml(DOC, "AAAA"))).toContain("margin: 18mm 16mm");
  });
});

describe("aviso de pendências antes de exportar", () => {
  it("detecta marcador cru, (a preencher) e (a definir", () => {
    expect(pendenciasDoDocumento("ok")).toEqual([]);
    expect(pendenciasDoDocumento("valor {{valor}}")).toHaveLength(1);
    expect(pendenciasDoDocumento("prazo *(a preencher)*")).toHaveLength(1);
    expect(pendenciasDoDocumento("prazo (a definir com você)")).toHaveLength(1);
  });

  it("não pergunta quando está limpo e pergunta quando há pendência", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    expect(await confirmarExportacao(confirm, "tudo certo")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(await confirmarExportacao(confirm, "falta {{x}}")).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });
});
