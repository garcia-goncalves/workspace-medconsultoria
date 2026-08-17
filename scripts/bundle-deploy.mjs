// Monta o artefato de deploy AUTO-CONTIDO em apps/api/dist/, pronto para o rsync:
//   dist/server.js      → a API bundlada (serve tRPC + Socket.IO + o SPA)
//   dist/public/        → o SPA buildado (apps/web/dist) — o server serve daqui
//   dist/prisma/        → schema + migrations (para `prisma migrate deploy`/`generate`)
//   dist/package.json   → só as deps de RUNTIME (externas), sem workspace:*
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
import * as esbuild from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
// Só o que o servidor precisa. Os `.ts` NÃO servem lá: o bundle é instalado com
// `npm install --omit=dev`, então não existe tsx/typescript para executá-los.
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

// 3) package.json de produção — só deps externas de runtime (sem workspace:*)
const api = JSON.parse(readFileSync(resolve(root, "apps/api/package.json"), "utf8"));
const db = JSON.parse(readFileSync(resolve(root, "packages/db/package.json"), "utf8"));
const semWorkspace = (deps) =>
  Object.fromEntries(
    Object.entries(deps ?? {}).filter(([, v]) => !String(v).startsWith("workspace:")),
  );

const dependencies = { ...semWorkspace(api.dependencies), ...semWorkspace(db.dependencies) };
// A CLI do Prisma (para migrate deploy / generate no servidor) mora nas devDeps do db.
const prismaVer = db.devDependencies?.prisma ?? db.dependencies?.prisma;
if (prismaVer) dependencies.prisma = prismaVer;

const pkg = {
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
};
writeFileSync(resolve(apiDist, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

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

console.log("✓ Bundle pronto");
