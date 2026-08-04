import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAGINAS, MENU_GRUPOS, GRUPOS_MENU, paginaCasa, normalizar } from "./paginas";
import { trailFor } from "../components/layout/Breadcrumbs";

/**
 * Guarda do catálogo de busca. A dor que originou isto: Sistema e Modelos existiam no app mas
 * NÃO apareciam no Ctrl+K, porque a paleta tinha uma lista à mão que divergia das rotas reais.
 * Este teste cruza o catálogo com as rotas do router e falha se uma página navegável ficar de
 * fora — ou se o catálogo apontar para uma rota que não existe.
 */

// Rotas de PÁGINA declaradas no router (exclui login, rotas públicas e detalhes com `$`).
function rotasDoRouter(): Set<string> {
  const src = readFileSync(resolve(__dirname, "../app/router.tsx"), "utf8");
  const paths = [...src.matchAll(/path:\s*"(\/[a-z-]*)"/g)].map((m) => m[1]!);
  const fora = new Set(["/login"]); // pública, não entra na busca
  return new Set(paths.filter((p) => !fora.has(p) && !p.includes("$")));
}

describe("catálogo de páginas (busca do Ctrl+K)", () => {
  it("toda rota de página do router está no catálogo (nada fica de fora da busca)", () => {
    const noCatalogo = new Set(PAGINAS.map((p) => p.to));
    const faltando = [...rotasDoRouter()].filter((r) => !noCatalogo.has(r));
    expect(faltando, `rotas navegáveis ausentes da busca: ${faltando.join(", ")}`).toEqual([]);
  });

  it("nenhuma entrada do catálogo aponta para rota inexistente", () => {
    const doRouter = rotasDoRouter();
    const mortas = PAGINAS.map((p) => p.to).filter((to) => !doRouter.has(to));
    expect(mortas, `rotas no catálogo que não existem no router: ${mortas.join(", ")}`).toEqual([]);
  });

  it("Sistema e Modelos estão na busca (as duas que faltavam)", () => {
    expect(PAGINAS.some((p) => p.to === "/sistema")).toBe(true);
    expect(PAGINAS.some((p) => p.to === "/modelos")).toBe(true);
  });

  it("busca sem acento e por palavra-chave encontra a página certa", () => {
    const acha = (q: string) => PAGINAS.filter((p) => paginaCasa(p, q)).map((p) => p.to);
    expect(acha("saude")).toContain("/sistema"); // keyword, sem acento
    expect(acha("funil")).toContain("/leads"); // keyword
    expect(acha("Serviços")).toContain("/servicos"); // com acento na consulta
    expect(acha("usuarios")).toContain("/usuarios"); // keyword ≠ rótulo ("Equipe e acessos")
    expect(acha("kanban")).toContain("/projetos");
  });

  it("consulta vazia devolve todas; consulta sem match devolve nenhuma", () => {
    expect(PAGINAS.filter((p) => paginaCasa(p, "")).length).toBe(PAGINAS.length);
    expect(PAGINAS.filter((p) => paginaCasa(p, "xpto-nada-aqui"))).toEqual([]);
  });

  it("rótulos e rotas são únicos (sem duplicata)", () => {
    expect(new Set(PAGINAS.map((p) => p.to)).size).toBe(PAGINAS.length);
    expect(new Set(PAGINAS.map((p) => p.label)).size).toBe(PAGINAS.length);
  });

  it("normalizar remove acento e caixa", () => {
    expect(normalizar("Saúde Ações")).toBe("saude acoes");
  });
});

/**
 * Guarda do MENU LATERAL. A dor que originou isto: a página "E-mail" foi registrada no catálogo
 * (busca do Ctrl+K) mas o `AppLayout` tinha um `NAV_GROUPS` à mão, paralelo — e o item não
 * apareceu no menu para ninguém. Agora o menu é derivado daqui, e este teste obriga toda rota
 * nova a TOMAR UMA DECISÃO: ou entra num grupo do menu, ou entra na lista de exceções abaixo.
 */
// Páginas que existem de propósito FORA do menu — cada uma com o caminho por onde se chega.
const FORA_DO_MENU: Record<string, string> = {
  "/servicos": "abre por Ajustes",
  "/modelos": "abre por Ajustes",
  "/emails": "abre por Ajustes (mensagens automáticas)",
  "/emails-enviados": "abre por Ajustes (monitor de envios)",
  "/usuarios": "abre por Ajustes (equipe e acessos)",
  "/configuracoes": "abre pelo menu do usuário, no rodapé da barra",
};

describe("menu lateral (barra da esquerda)", () => {
  const noMenu = MENU_GRUPOS.flatMap((g) => g.itens);

  it("toda rota de página ou está no menu ou está declarada como exceção", () => {
    const cobertas = new Set([...noMenu.map((i) => i.to), ...Object.keys(FORA_DO_MENU)]);
    const orfas = [...rotasDoRouter()].filter((r) => !cobertas.has(r));
    expect(
      orfas,
      `rotas sem lugar no menu: ${orfas.join(", ")} — dê um \`grupo\` em paginas.ts ou declare em FORA_DO_MENU`,
    ).toEqual([]);
  });

  it("E-mail está no menu (o item que sumiu por causa da lista paralela)", () => {
    expect(noMenu.map((i) => i.to)).toContain("/email");
  });

  it("o menu não inventa rota: todo item veio do catálogo e existe no router", () => {
    const doRouter = rotasDoRouter();
    expect(noMenu.every((i) => PAGINAS.includes(i))).toBe(true);
    expect(noMenu.filter((i) => !doRouter.has(i.to)).map((i) => i.to)).toEqual([]);
  });

  it("todo grupo declarado tem item, e nenhum item fica num grupo inexistente", () => {
    expect(MENU_GRUPOS.filter((g) => g.itens.length === 0).map((g) => g.titulo)).toEqual([]);
    const grupos = new Set<string>(GRUPOS_MENU);
    expect(PAGINAS.filter((p) => p.grupo && !grupos.has(p.grupo)).map((p) => p.to)).toEqual([]);
  });

  it("a trilha do topo chama a página pelo mesmo nome do menu", () => {
    // O `SECTION_LABEL` do Breadcrumbs é outra lista à mão: sem entrada, ele capitaliza o
    // segmento da rota — foi assim que `/email` virou "Email" (sem hífen) no cabeçalho.
    const divergentes = noMenu
      .filter((i) => i.to !== "/")
      .map((i) => ({ to: i.to, menu: i.label, trilha: trailFor(i.to, null).at(-1)?.label }))
      .filter((x) => x.trilha !== x.menu);
    expect(divergentes).toEqual([]);
  });

  it("nenhuma exceção declarada está obsoleta (rota morta ou já no menu)", () => {
    const doRouter = rotasDoRouter();
    const noMenuTo = new Set(noMenu.map((i) => i.to));
    const obsoletas = Object.keys(FORA_DO_MENU).filter((r) => !doRouter.has(r) || noMenuTo.has(r));
    expect(obsoletas, `exceções obsoletas: ${obsoletas.join(", ")}`).toEqual([]);
  });
});
