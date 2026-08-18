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

// O pnpm aceita uma sintaxe de chave que o npm NÃO entende: `pai>filho` (e `pai>filho>neto`),
// que a própria documentação do pnpm recomenda para escopar um override a um caminho. No npm
// essa chave não casa com pacote nenhum — vira **no-op silencioso**. O caminho de falha é o
// mesmo que a ADR-116 fechou, só que pela porta dos fundos: alguém escreve
// `"mailparser>html-to-text": "^9.0.6"` para fechar um CVE, o `pnpm audit --prod` da CI vai a
// zero, o artefato leva a chave inútil e o servidor instala a vulnerável.
// Por isso o módulo NÃO copia essa forma — ele **falha o build**. Barrar em cima da mesa é o
// único jeito de a pessoa descobrir; ignorar seria repetir o erro.
// Achado da revisão adversarial da própria ADR-116.
const SO_DO_PNPM = /[<>]/;

const conferirOverrides = (overrides) => {
  const incompativeis = Object.keys(overrides).filter((chave) => SO_DO_PNPM.test(chave));
  if (incompativeis.length) {
    throw new Error(
      "pnpm.overrides com sintaxe que o npm ignora em silêncio (`pai>filho`): " +
        incompativeis.join(", ") +
        ". No artefato de produção use a forma `nome` ou `nome@faixa`, que os dois entendem — " +
        "senão o override vale no monorepo e NÃO vale no servidor (ADR-116).",
    );
  }
  return { ...overrides };
};

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
    overrides: conferirOverrides(raiz.pnpm?.overrides ?? {}),
  };
}
