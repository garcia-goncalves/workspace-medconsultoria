// Monta o artefato de deploy AUTO-CONTIDO em apps/api/dist/, pronto para o rsync:
//   dist/server.js           → a API bundlada (serve tRPC + Socket.IO + o SPA)
//   dist/public/             → o SPA buildado (apps/web/dist) — o server serve daqui
//   dist/prisma/             → schema + migrations (para `prisma migrate deploy`/`generate`)
//   dist/package.json        → só as deps de RUNTIME (externas), sem workspace:*, COM overrides
//   dist/package-lock.json   → a lista TRAVADA de versões que o servidor instala (ADR-116)
//
// Rode DEPOIS de `pnpm build`. Uso: node scripts/bundle-deploy.mjs
//
// O `esbuild` abaixo é dependência DECLARADA na raiz (devDependencies), e precisa continuar
// sendo. Até 17/08/2026 não era: o script só achava o pacote porque alguma dependência do
// Vite deixava uma cópia solta na raiz do `node_modules` deste computador. Num ambiente
// limpo — o runner do GitHub — o pacote não existe e o deploy morre no passo 1 com
// ERR_MODULE_NOT_FOUND. Quatro versões de esbuild convivem na árvore; sem declarar, qual
// delas monta o artefato que vai para produção era sorte.
import { readFileSync, writeFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as esbuild from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { montarPacoteDeProducao } from "./lib/pacote-de-producao.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDist = resolve(root, "apps/api/dist");

if (!existsSync(resolve(apiDist, "server.js"))) {
  console.error("✗ apps/api/dist/server.js não existe. Rode `pnpm build` primeiro.");
  process.exit(1);
}
if (!existsSync(resolve(root, "apps/web/dist/index.html"))) {
  console.error("✗ apps/web/dist não existe. Rode `pnpm build` primeiro.");
  process.exit(1);
}

// 1) SPA → dist/public
const pub = resolve(apiDist, "public");
rmSync(pub, { recursive: true, force: true });
cpSync(resolve(root, "apps/web/dist"), pub, { recursive: true });

// 2) Prisma (schema + migrations) → dist/prisma
// Só o que o servidor precisa. Os `.ts` NÃO servem lá: o bundle é instalado sem devDependencies,
// então não existe tsx/typescript para executá-los.
const prismaDst = resolve(apiDist, "prisma");
rmSync(prismaDst, { recursive: true, force: true });
cpSync(resolve(root, "packages/db/prisma"), prismaDst, {
  recursive: true,
  // `demo-seed.ts` semeia dados FICTÍCIOS — não tem o que fazer num servidor. `seed.ts` é
  // compilado logo abaixo para `seed.js`.
  filter: (src) => !/(demo-)?seed\.ts$/.test(src),
});

// 2a) Seed → dist/prisma/seed.js (ESM, executável com `node`)
// Sem isto o bundle levava apenas `seed.ts` e o passo `node prisma/seed.js` do checklist de
// deploy era IMPOSSÍVEL no servidor — o primeiro usuário ROOT nunca seria criado.
await esbuild.build({
  entryPoints: [resolve(root, "packages/db/prisma/seed.ts")],
  outfile: resolve(prismaDst, "seed.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  // Mesmas externas do server: Prisma Client e argon2 são nativos/CJS e são instalados no
  // servidor. `dotenv` idem (está nas dependencies do bundle).
  external: ["@prisma/client", ".prisma/client", "@node-rs/argon2", "dotenv"],
  logLevel: "warning",
});

// 2b) Preflight → dist/preflight.mjs
// Vai JUNTO do bundle de propósito: o checklist de deploy manda rodá-lo NO SERVIDOR, antes de
// publicar (checa Node, Argon2, UPLOADS_DIR gravável, MySQL, migrations, DNS, rede). Se ele
// ficasse só no repositório, o passo seria impossível de executar lá — a TineHost não tem Git.
cpSync(resolve(root, "scripts/preflight.mjs"), resolve(apiDist, "preflight.mjs"));

// 3) package.json de produção — só deps externas de runtime (sem workspace:*), MAIS os
// `pnpm.overrides` da raiz. A montagem virou módulo testado (`scripts/lib/pacote-de-producao.mjs`,
// ADR-116): sem os overrides, o npm do servidor resolvia a árvore do zero e reintroduzia
// vulnerabilidade que a CI já tinha fechado.
const raizPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const apiPkg = JSON.parse(readFileSync(resolve(root, "apps/api/package.json"), "utf8"));
const dbPkg = JSON.parse(readFileSync(resolve(root, "packages/db/package.json"), "utf8"));

const pkg = montarPacoteDeProducao({ raiz: raizPkg, api: apiPkg, db: dbPkg });
writeFileSync(resolve(apiDist, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

// 3a) package-lock.json — a lista TRAVADA de versões, resolvida AQUI e obedecida LÁ.
// O servidor instala com `npm ci --omit=dev`: ele não re-resolve nada, instala exatamente o que
// está neste arquivo, e RECUSA rodar se o lock discordar do package.json. É o que faz do que a
// CI auditou exatamente o que a produção instala.
// Precisa de rede (fala com o registro do npm). Se a rede cair aqui o bundle FALHA — e falhar é
// o certo: artefato sem lockfile é artefato cujo conteúdo ninguém conferiu.
rmSync(resolve(apiDist, "package-lock.json"), { force: true });
rmSync(resolve(apiDist, "node_modules"), { recursive: true, force: true });
execFileSync("npm", ["install", "--package-lock-only", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: apiDist,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (!existsSync(resolve(apiDist, "package-lock.json"))) {
  console.error("✗ package-lock.json não foi gerado — o servidor instalaria versão não auditada.");
  process.exit(1);
}

// 4) Startup file para o CloudLinux Passenger. O painel roda o startup via require() (CommonJS);
// como o server.js é ESM (type: module), fazemos um shim .cjs que o carrega por import() dinâmico
// (funciona em CJS) — evita ERR_REQUIRE_ESM. Aponte a "Application startup file" para `app.cjs`.
// O Passenger intercepta o `.listen()` do Fastify e gerencia a porta/socket (API_PORT é ignorado
// sob Passenger). Ver docs/DEPLOY.md §12.
const startup = `// Gerado por bundle-deploy.mjs — startup file do CloudLinux Passenger (NÃO editar à mão).
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
import("./server.js").catch((e) => { console.error("Falha ao iniciar server.js:", e); process.exit(1); });
`;
writeFileSync(resolve(apiDist, "app.cjs"), startup);

console.log("✓ Bundle pronto (package-lock.json incluído)");
