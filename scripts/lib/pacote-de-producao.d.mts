// Tipos do módulo irmão `.mjs`. Existe porque o teste em `apps/api/src/test/` é TypeScript e o
// `tsc --noEmit` da API reprova import de `.mjs` sem declaração (TS7016).
export interface PacoteDeProducao {
  name: string;
  version: string;
  private: boolean;
  type: string;
  main: string;
  engines: Record<string, string>;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  /** Cópia verbatim de `pnpm.overrides` da raiz — ADR-116. */
  overrides: Record<string, string>;
}

export function montarPacoteDeProducao(pkgs: {
  raiz: { pnpm?: { overrides?: Record<string, string> } };
  api: { dependencies?: Record<string, string> };
  db: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
}): PacoteDeProducao;
