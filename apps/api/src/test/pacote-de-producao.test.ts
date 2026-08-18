import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { montarPacoteDeProducao } from "../../../../scripts/lib/pacote-de-producao.mjs";

const raizDoRepo = resolve(__dirname, "../../../..");
const ler = (rel: string) => JSON.parse(readFileSync(resolve(raizDoRepo, rel), "utf8"));

describe("pacote de produção (o package.json que vai para o servidor)", () => {
  const raiz = ler("package.json");
  const api = ler("apps/api/package.json");
  const db = ler("packages/db/package.json");
  const pacote = montarPacoteDeProducao({ raiz, api, db });

  it("não leva dependência de workspace (o servidor não tem o monorepo)", () => {
    const valores = Object.values(pacote.dependencies) as string[];
    expect(valores.some((v) => v.startsWith("workspace:"))).toBe(false);
  });

  it("leva a CLI do Prisma, que mora nas devDeps do @app/db", () => {
    expect(pacote.dependencies.prisma).toBeTruthy();
  });

  // O CORAÇÃO DESTA ADR. Sem isto, o `npm` do servidor resolve a árvore do zero e IGNORA os
  // `pnpm.overrides` da raiz — foi assim que `deepmerge-ts` 7.x (falha ALTA, ADR-112) foi parar
  // em produção com a CI verde.
  it("leva TODO override da raiz, com o mesmo valor, sem perder nenhum", () => {
    const daRaiz = raiz.pnpm.overrides as Record<string, string>;
    expect(Object.keys(daRaiz).length).toBeGreaterThan(0);
    for (const [chave, valor] of Object.entries(daRaiz)) {
      const nome = chave.replace(/(?!^)@[^@/]+$/, "");
      expect(pacote.overrides[nome]).toBe(valor);
    }
  });

  // ⛔ O DEFEITO QUE DERRUBOU A PUBLICAÇÃO DAS 17:53 DE 18/08/2026. No npm, `nome@faixa` é
  // seletor de PAI, não escopo do próprio pacote: o `npm install` até hoista a versão certa,
  // mas as arestas do lock continuam pedindo a antiga e o `npm ci` — o comando que roda no
  // servidor — recusa com "Missing: deepmerge-ts@7.1.6 from lock file". A chave TEM de ser
  // traduzida para a forma `nome`.
  it("traduz `nome@faixa` para a forma que o npm entende — senão o `npm ci` recusa o lock", () => {
    for (const chave of Object.keys(pacote.overrides)) {
      const semEscopo = chave.startsWith("@") ? chave.slice(1) : chave;
      expect(semEscopo).not.toContain("@");
    }
    expect(pacote.overrides["deepmerge-ts"]).toBe("^8.0.0");
    expect(pacote.overrides["brace-expansion"]).toBe("^5.0.9");
  });

  it("preserva pacote com escopo (`@fastify/x`), que também tem arroba mas não é faixa", () => {
    const comEscopo = { raiz: { pnpm: { overrides: { "@fastify/static": "^10.1.2" } } }, api, db };
    expect(montarPacoteDeProducao(comEscopo).overrides["@fastify/static"]).toBe("^10.1.2");
  });

  // A tradução perde o escopo por major, então duas faixas do MESMO pacote viram uma chave só.
  // Silenciar isso seria escolher por conta própria qual vale — o build para e a pessoa decide.
  it("RECUSA montar se a raiz tiver duas faixas do mesmo pacote com valores diferentes", () => {
    const ambiguo = {
      raiz: { pnpm: { overrides: { "nanoid@3": "^3.3.17", "nanoid@5": "^5.1.0" } } },
      api,
      db,
    };
    expect(() => montarPacoteDeProducao(ambiguo)).toThrow(/ambígua|duas faixas/i);
  });

  // Achado da revisão adversarial da ADR-116: o pnpm aceita `pai>filho`, o npm ignora essa chave
  // em SILÊNCIO. Se alguém fechar um CVE assim, a CI vai a zero e o servidor instala a
  // vulnerável. O build tem de PARAR — e este teste é quem garante que ele para.
  it("RECUSA montar o pacote se um override usar sintaxe que só o pnpm entende", () => {
    const comSintaxeDoPnpm = {
      raiz: { pnpm: { overrides: { "mailparser>html-to-text": "^9.0.6" } } },
      api,
      db,
    };
    expect(() => montarPacoteDeProducao(comSintaxeDoPnpm)).toThrow(/pai>filho|silêncio/i);
  });

  it("a raiz de hoje passa nessa conferência (nenhum override usa `pai>filho`)", () => {
    expect(() => montarPacoteDeProducao({ raiz, api, db })).not.toThrow();
  });

  it("declara o start e os comandos de Prisma que o deploy executa", () => {
    expect(pacote.scripts.start).toBe("node server.js");
    expect(pacote.scripts["prisma:generate"]).toContain("prisma generate");
    expect(pacote.scripts["prisma:deploy"]).toContain("migrate deploy");
  });
});
