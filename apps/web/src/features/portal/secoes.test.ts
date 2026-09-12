import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SECOES_FIXAS, CANDIDATAS_DA_VAGA, POSICAO_DA_VAGA, montarSecoes } from "./secoes";

/**
 * Guarda da BARRA DO PORTAL — quatro coringas e uma vaga.
 *
 * Espelha o que `lib/paginas.test.ts` faz com o menu da equipe: cruza a lista de seções com as
 * rotas realmente declaradas no roteador, lendo o TEXTO do arquivo. É a única conferência
 * disponível, porque as rotas do Portal não existem para a tipagem do TanStack Router (o
 * `interface Register` aponta para o roteador interno — ver `features/portal/navegar.ts`).
 *
 * O que ele impede, em uma frase cada: a barra virar cinco itens com um buraco; a vaga sair da
 * 3ª posição; duas candidatas entrarem juntas; e um item de barra apontar para uma rota que
 * ninguém declarou.
 */
function rotasDoRoteadorDoPortal(): Set<string> {
  const src = readFileSync(resolve(__dirname, "../../app/portal-router.tsx"), "utf8");
  return new Set([...src.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]!));
}

describe("seções do Portal (a barra do cliente)", () => {
  it("sem candidata aplicável, a barra tem exatamente as 4 coringas", () => {
    const secoes = montarSecoes({ temCredenciamento: false });
    expect(secoes).toHaveLength(4);
    expect(secoes.map((s) => s.chave)).toEqual(["inicio", "documentos", "servicos", "suporte"]);
  });

  it("com credenciamento, a barra tem 5 itens e Convênios fica na 3ª posição", () => {
    const secoes = montarSecoes({ temCredenciamento: true });
    expect(secoes).toHaveLength(5);
    expect(secoes[POSICAO_DA_VAGA]!.rotulo).toBe("Convênios");
    expect(secoes[POSICAO_DA_VAGA]!.chave).toBe("credenciamento");
  });

  it("a vaga é UMA só: nunca entram duas candidatas, nunca a barra passa de 5", () => {
    // Vale mesmo que uma candidata nova seja acrescentada sem nenhuma condição em `aplica`.
    const secoes = montarSecoes({ temCredenciamento: true });
    expect(secoes.length).toBeLessThanOrEqual(SECOES_FIXAS.length + 1);
    const daVaga = secoes.filter((s) => CANDIDATAS_DA_VAGA.some((c) => c.chave === s.chave));
    expect(daVaga).toHaveLength(1);
  });

  it("as 4 coringas nunca somem, tenha o cliente o que tiver", () => {
    for (const temCredenciamento of [true, false]) {
      const chaves = montarSecoes({ temCredenciamento }).map((s) => s.chave);
      for (const fixa of SECOES_FIXAS) expect(chaves).toContain(fixa.chave);
    }
  });

  it("toda rota da barra existe de verdade no roteador do Portal", () => {
    const declaradas = rotasDoRoteadorDoPortal();
    const mortas = [...SECOES_FIXAS, ...CANDIDATAS_DA_VAGA].map((s) => s.rota).filter((r) => !declaradas.has(r));
    expect(mortas, `seções apontando para rota inexistente: ${mortas.join(", ")}`).toEqual([]);
  });

  it("o roteador guarda o curinga e a raiz — é o que faz qualquer caminho cair no Portal", () => {
    // Contrato testado em `e2e/flows-portal.spec.ts` (vai a /financeiro) e em `e2e/rbac.spec.ts`
    // (vai a /clientes): o cliente nunca vê "página não encontrada", cai no Portal.
    const declaradas = rotasDoRoteadorDoPortal();
    expect(declaradas.has("$"), "sumiu a rota curinga do Portal").toBe(true);
    expect(declaradas.has("/"), "sumiu o redirecionamento da raiz para /portal").toBe(true);
  });

  it("rótulos e rotas não se repetem, e cabem num item de barra a 360px", () => {
    const todas = [...SECOES_FIXAS, ...CANDIDATAS_DA_VAGA];
    expect(new Set(todas.map((s) => s.rota)).size).toBe(todas.length);
    expect(new Set(todas.map((s) => s.chave)).size).toBe(todas.length);
    // 11 caracteres é o limite prático: "Credenciamento" (14) quebra a linha do item.
    const compridos = todas.filter((s) => s.rotulo.length > 11).map((s) => s.rotulo);
    expect(compridos, `rótulos longos demais para a barra: ${compridos.join(", ")}`).toEqual([]);
  });

  it("só Serviços, Suporte e Convênios têm contador (Início e Documentos não, de propósito)", () => {
    const comContador = [...SECOES_FIXAS, ...CANDIDATAS_DA_VAGA].filter((s) => s.contador).map((s) => s.chave);
    expect(comContador.sort()).toEqual(["credenciamento", "servicos", "suporte"]);
  });
});
