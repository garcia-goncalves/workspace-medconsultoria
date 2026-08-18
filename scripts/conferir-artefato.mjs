// Asserção NEGATIVA sobre o artefato de deploy, antes de auditá-lo (ADR-116).
//
// POR QUE ISTO EXISTE: `npm audit` sai com código 0 em dois casos que parecem o mesmo — quando
// a árvore está limpa, e quando NÃO HÁ ÁRVORE PARA AUDITAR. A lição da ADR-114 foi exatamente
// essa: o verde só prova que nada deu erro. Um portão de segurança precisa provar que a
// verificação aconteceu, não só que não reclamou.
//
// Uso: node scripts/conferir-artefato.mjs   (depois de `pnpm build:deploy`)
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "apps/api/dist");
const falhas = [];
const ok = [];

const ler = (p) => JSON.parse(readFileSync(p, "utf8"));

// 1) O artefato existe e está inteiro.
for (const arquivo of ["server.js", "app.cjs", "package.json", "package-lock.json", "public/index.html", "prisma/schema.prisma"]) {
  if (existsSync(resolve(dist, arquivo))) ok.push(`${arquivo} presente`);
  else falhas.push(`FALTA ${arquivo} no artefato`);
}
if (falhas.length) {
  console.error("✗ artefato incompleto:\n  " + falhas.join("\n  "));
  process.exit(1);
}

const pkg = ler(resolve(dist, "package.json"));
const lock = ler(resolve(dist, "package-lock.json"));
const raiz = ler(resolve(root, "package.json"));

// 2) O lockfile tem árvore de verdade. Sem isto, o `npm audit` seguinte passaria sem auditar.
const travados = Object.keys(lock.packages ?? {}).length;
if (travados < 100) falhas.push(`lockfile raso demais: ${travados} pacotes (esperado mais de 100)`);
else ok.push(`${travados} pacotes com versão travada`);

// 3) O package.json e o lock falam do mesmo pacote — é o que o `npm ci` exige lá.
if (lock.name !== pkg.name) falhas.push(`lock e package.json discordam do nome (${lock.name} × ${pkg.name})`);
else ok.push("lock e package.json batem");

// 4) TODO override da raiz chegou ao artefato. É a proteção que o npm do servidor não herda
// sozinha, e a que faltava até 18/08/2026.
const daRaiz = raiz.pnpm?.overrides ?? {};
const noArtefato = pkg.overrides ?? {};
for (const [chave, valor] of Object.entries(daRaiz)) {
  if (noArtefato[chave] !== valor) falhas.push(`override "${chave}" da raiz não chegou ao artefato`);
}
if (Object.keys(daRaiz).length === 0) falhas.push("a raiz não tem pnpm.overrides — confira se o package.json foi lido certo");
else if (!falhas.length) ok.push(`${Object.keys(daRaiz).length} overrides copiados da raiz`);

// 5) Nenhuma dependência de workspace sobrou (o servidor não tem o monorepo).
const dosWorkspace = Object.entries(pkg.dependencies ?? {}).filter(([, v]) => String(v).startsWith("workspace:"));
if (dosWorkspace.length) falhas.push(`dependência de workspace no artefato: ${dosWorkspace.map(([k]) => k).join(", ")}`);
else ok.push("nenhuma dependência de workspace");

for (const linha of ok) console.log(`  ✓ ${linha}`);
if (falhas.length) {
  console.error("✗ o artefato NÃO está pronto para ser auditado nem publicado:\n  " + falhas.join("\n  "));
  process.exit(1);
}
console.log("✓ artefato conferido — pode auditar");
