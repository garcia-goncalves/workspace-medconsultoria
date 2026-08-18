// Monta o `package.json` que vai DENTRO do artefato de deploy — o único que o servidor lê.
//
// POR QUE ISTO É UM MÓDULO SEPARADO, E TESTADO (ADR-116, 18/08/2026): até aqui o bundle levava
// só a lista de dependências, e o servidor rodava `npm install --omit=dev` sem lockfile. O npm
// resolvia a árvore do zero e IGNORAVA os `pnpm.overrides` da raiz — que é onde moram as
// correções de vulnerabilidade em dependência transitiva (ADR-107/112). Resultado medido em
// 18/08/2026: a CI dizia `pnpm audit --prod` = 0 e o servidor instalava `deepmerge-ts` 7.1.x,
// com a falha ALTA de exaustão de pilha que a ADR-112 havia fechado em desenvolvimento.
// A CI verde estava certa sobre o monorepo e errada sobre produção.
//
// A boa notícia é que a sintaxe de chave do pnpm (`nome@faixa`, escopo por major) é entendida
// igual pelo npm — conferido empiricamente: com `"deepmerge-ts@7": "^8.0.0"` o npm resolve
// 8.0.1 e o `npm audit --omit=dev` sai em 0. Por isso os overrides são copiados VERBATIM: nada
// de traduzir, nada de escolher quais valem. Override que existe na raiz existe no servidor.

const semWorkspace = (deps) => Object.fromEntries(Object.entries(deps ?? {}).filter(([, v]) => !String(v).startsWith("workspace:")));

/**
 * @param {{ raiz: object, api: object, db: object }} pkgs os package.json lidos do repositório
 * @returns {object} o package.json de produção, pronto para ser escrito no artefato
 */
export function montarPacoteDeProducao({ raiz, api, db }) {
  const dependencies = { ...semWorkspace(api.dependencies), ...semWorkspace(db.dependencies) };

  // A CLI do Prisma (para `migrate deploy` / `generate` no servidor) mora nas devDeps do db.
  const prismaVer = db.devDependencies?.prisma ?? db.dependencies?.prisma;
  if (prismaVer) dependencies.prisma = prismaVer;

  return {
    name: "workspace-medconsultoria-server",
    version: "0.0.0",
    private: true,
    type: "module",
    main: "server.js",
    engines: { node: ">=20" },
    scripts: {
      start: "node server.js",
      "prisma:generate": "prisma generate --schema=prisma/schema.prisma",
      "prisma:deploy": "prisma migrate deploy --schema=prisma/schema.prisma",
    },
    dependencies,
    overrides: { ...(raiz.pnpm?.overrides ?? {}) },
  };
}
