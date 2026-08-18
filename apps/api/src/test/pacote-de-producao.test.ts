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
  // em produção com a CI verde. A sintaxe `nome@faixa` do pnpm é entendida igual pelo npm.
  it("copia TODOS os overrides da raiz, sem perder nenhum", () => {
    const daRaiz = raiz.pnpm.overrides as Record<string, string>;
    expect(Object.keys(daRaiz).length).toBeGreaterThan(0);
    expect(pacote.overrides).toEqual(daRaiz);
  });

  it("mantém o override escopado por major (override sem escopo quebraria as outras majors)", () => {
    // `brace-expansion@5` e `deepmerge-ts@7` só valem para AQUELA major — ADR-107/112.
    for (const chave of Object.keys(pacote.overrides)) {
      if (chave.includes("@") && !chave.startsWith("@")) {
        expect(chave).toMatch(/@\d/);
      }
    }
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
