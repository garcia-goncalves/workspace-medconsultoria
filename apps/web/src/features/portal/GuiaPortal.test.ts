import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { guiaDoPortal, PREFIXOS_GUIA_PORTAL, GUIAS_DO_PORTAL } from "./GuiaPortal";

/**
 * Guarda dos guias "?" do PORTAL, seção por seção.
 *
 * Espelha `components/GuiaTour.test.ts`, mas lendo `app/portal-router.tsx` em vez de
 * `app/router.tsx` — são dois catálogos, para dois aplicativos. A dor que originou o guarda
 * original: páginas sem guia próprio abriam, caladas, o guia genérico do Início.
 */
function secoesDoRoteadorDoPortal(): string[] {
  const src = readFileSync(resolve(__dirname, "../../app/portal-router.tsx"), "utf8");
  const paths = [...src.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]!);
  // `/` e `$` não são seções: as duas redirecionam para `/portal` e nunca desenham tela.
  return [...new Set(paths)].filter((p) => p.startsWith("/portal"));
}

describe("guia do Portal (um por seção)", () => {
  it("toda seção do roteador tem guia PRÓPRIO — nenhuma cai no do Início por engano", () => {
    const doInicio = guiaDoPortal("/portal").titulo;
    const semGuiaProprio = secoesDoRoteadorDoPortal()
      .filter((rota) => rota !== "/portal")
      .filter((rota) => guiaDoPortal(rota).titulo === doInicio);
    expect(semGuiaProprio, `seções sem guia próprio: ${semGuiaProprio.join(", ")}`).toEqual([]);
  });

  it("cada seção abre o guia dela, e Convênios tem o seu (o único que não existia antes)", () => {
    expect(guiaDoPortal("/portal").titulo).toBe("Seu Portal");
    expect(guiaDoPortal("/portal/documentos").titulo).toBe("Documentos");
    expect(guiaDoPortal("/portal/credenciamento").titulo).toBe("Credenciamento nos convênios");
    expect(guiaDoPortal("/portal/servicos").titulo).toBe("Meus serviços");
    expect(guiaDoPortal("/portal/suporte").titulo).toBe("Suporte");
    expect(guiaDoPortal("/portal/equipe").titulo).toBe("Equipe da clínica");
  });

  it("prefixo curto nunca mascara um mais específico — `/portal` é o ÚLTIMO", () => {
    // A resolução usa `startsWith` e para no primeiro match. `/portal` é prefixo de TODOS os
    // outros: em primeiro lugar, as cinco seções abririam o guia do Início.
    for (let i = 0; i < PREFIXOS_GUIA_PORTAL.length; i++) {
      for (let j = i + 1; j < PREFIXOS_GUIA_PORTAL.length; j++) {
        const antes = PREFIXOS_GUIA_PORTAL[i]!;
        const depois = PREFIXOS_GUIA_PORTAL[j]!;
        expect(
          depois.startsWith(antes),
          `"${antes}" vem antes de "${depois}" e é prefixo dele — "${depois}" nunca seria alcançado`,
        ).toBe(false);
      }
    }
  });

  it("todo guia é COMPLETO: 2 passos no mínimo, cada um com título e descrição de verdade", () => {
    for (const guia of GUIAS_DO_PORTAL) {
      expect(guia.passos.length, `${guia.prefixo} tem menos de 2 passos — guia raso`).toBeGreaterThanOrEqual(2);
      for (const p of guia.passos) {
        expect(p.titulo.trim().length, `${guia.prefixo}: passo sem título`).toBeGreaterThan(2);
        const desc = typeof p.descricao === "string" ? p.descricao.trim().length : 40;
        expect(desc, `${guia.prefixo}: descrição curta demais`).toBeGreaterThan(30);
      }
    }
  });

  it("nenhum guia aponta para uma seção que não existe no roteador", () => {
    const secoes = new Set(secoesDoRoteadorDoPortal());
    const mortos = PREFIXOS_GUIA_PORTAL.filter((p) => !secoes.has(p));
    expect(mortos, `guias de seção inexistente: ${mortos.join(", ")}`).toEqual([]);
  });
});
