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
// ⛔ CORREÇÃO DE 18/08/2026 (a publicação das 17:53 falhou por isto). A primeira versão desta
// ADR afirmava que `nome@faixa` era "entendida igual pelo npm", com base em duas medições que
// de fato passam: o `npm install` resolve `deepmerge-ts` 8.0.1 e o `npm audit --omit=dev` sai
// em 0. As duas são verdadeiras e as duas são insuficientes — nenhuma exercita o `npm ci`,
// que é o comando que roda no servidor.
//
// No npm, `nome@faixa` é SELETOR DE PAI ("dentro de deepmerge-ts@7, troque tal dependência"),
// não "substitua deepmerge-ts 7 por 8". A resolução do `npm install` hoistava a 8.0.1 assim
// mesmo, mas as arestas gravadas no lock continuavam pedindo 7.x — e o `npm ci`, que confere
// lock contra package.json antes de instalar, RECUSA:
//     npm error Missing: deepmerge-ts@7.1.6 from lock file
// Reproduzido no laptop com o mesmo npm 10.8.2 do servidor, e no servidor. Determinístico.
//
// Por isso a chave é TRADUZIDA para a forma que o npm entende (`nome`). Medido: com a chave
// traduzida o `npm ci` aceita (260 pacotes) e a árvore resolvida é **idêntica, 0 diferenças**
// em 260 pacotes — a tradução muda só o que o lock declara, não o que é instalado.
//
// E a revisão adversarial da ADR-116 estava CERTA ao apontar `html-to-text` pedindo 7.x; foi
// descartada como alarme falso porque a conferência olhou o lock (onde a 8.0.1 aparece sozinha)
// em vez de rodar `npm ci`. Lição registrada: só o comando que roda em produção prova produção.

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
  // pnpm: `nome@faixa` escopa por major do PRÓPRIO pacote. npm: a mesma chave escopa pelo PAI.
  // Traduzir é obrigatório; sem isso o `npm ci` do servidor recusa o lockfile.
  const traduzidos = {};
  for (const [chave, valor] of Object.entries(overrides)) {
    const nome = chave.replace(/(?!^)@[^@/]+$/, "");
    if (nome in traduzidos && traduzidos[nome] !== valor) {
      throw new Error(
        `pnpm.overrides tem duas faixas para "${nome}" (${chave} e outra) com valores diferentes. ` +
          "O npm não sabe escopar por major do próprio pacote, então a tradução seria ambígua — " +
          "resolva na raiz antes de publicar (ADR-116).",
      );
    }
    traduzidos[nome] = valor;
  }
  return traduzidos;
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
