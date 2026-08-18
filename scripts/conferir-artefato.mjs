// Asserção NEGATIVA sobre o artefato de deploy, antes de auditá-lo (ADR-116).
//
// POR QUE ISTO EXISTE: `npm audit` sai com código 0 em dois casos que parecem o mesmo — quando
// a árvore está limpa, e quando NÃO HÁ ÁRVORE PARA AUDITAR. A lição da ADR-114 foi exatamente
// essa: o verde só prova que nada deu erro. Um portão de segurança precisa provar que a
// verificação aconteceu, não só que não reclamou.
//
// Uso: node scripts/conferir-artefato.mjs   (depois de `pnpm build:deploy`)
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "apps/api/dist");
const NO_WINDOWS = process.platform === "win32";
const NPM = NO_WINDOWS ? "npm.cmd" : "npm";
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
// A chave é traduzida de `nome@faixa` (pnpm) para `nome` (npm) — ver o comentário longo em
// scripts/lib/pacote-de-producao.mjs. Aqui conferimos pelo nome traduzido e pelo VALOR.
const daRaiz = raiz.pnpm?.overrides ?? {};
const noArtefato = pkg.overrides ?? {};
for (const [chave, valor] of Object.entries(daRaiz)) {
  const nome = chave.replace(/(?!^)@[^@/]+$/, "");
  if (noArtefato[nome] !== valor) falhas.push(`override "${chave}" da raiz não chegou ao artefato`);
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
// 5.5) ⛔ A CHECAGEM QUE FALTAVA, E QUE CUSTOU UMA PUBLICAÇÃO QUEBRADA (18/08/2026, 17:53).
// O conferidor provava que o lock tinha árvore, que os overrides chegaram e que o audit saía
// em 0 — três coisas verdadeiras — e nenhuma delas exercitava o `npm ci`, que é o ÚNICO
// comando que roda no servidor. O lock estava internamente inconsistente com o package.json
// (arestas pedindo `deepmerge-ts` 7.x, árvore com a 8.0.1) e só o `npm ci` percebe isso.
// Ele parou o deploy no passo 5/7, depois do artefato já enviado. `--dry-run` não escreve nada
// e roda em ~1s: é a asserção que faltava, na lição da ADR-114 (verde tem de PROVAR algo).
try {
  execFileSync(NPM, ["ci", "--omit=dev", "--dry-run", "--no-audit", "--no-fund"], {
    cwd: dist,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: NO_WINDOWS,
  });
  console.log("  ✓ o `npm ci` do servidor aceita este lockfile (ensaiado a seco)");
} catch (e) {
  const saida = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  const linhas = saida.split(/\r?\n/).filter((l) => /npm error/.test(l) && !/EBADENGINE/.test(l));
  const motivo = linhas.slice(0, 6).join("\n  ");
  console.error(
    "✗ o `npm ci` RECUSARIA este artefato no servidor — o deploy morreria no passo 5/7:\n  " +
      (motivo || e.message),
  );
  process.exit(1);
}

// 6) O AUDIT, aqui dentro e não num passo separado — para que a prova de que ele auditou
// alguma coisa fique colada nele. `npm audit` responde "found 0 vulnerabilities" e sai 0
// também com uma árvore VAZIA; o número que desmente isso vem da própria saída dele
// (`metadata.dependencies.prod`). Achado da revisão adversarial da ADR-116.
let auditoria;
try {
  auditoria = execFileSync(NPM, ["audit", "--omit=dev", "--json"], {
    cwd: dist,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
  });
} catch (e) {
  // `npm audit` sai diferente de 0 quando ENCONTRA falha — a saída JSON vem no stdout do erro.
  auditoria = e.stdout ?? "";
  if (!auditoria) {
    console.error("✗ o `npm audit` não rodou (nem JSON devolveu):", e.message);
    process.exit(1);
  }
}

const relatorio = JSON.parse(auditoria);
const auditadas = relatorio.metadata?.dependencies?.prod ?? 0;
if (auditadas < 150) {
  console.error(`✗ o audit olhou apenas ${auditadas} dependências de produção — árvore vazia ou curta.`);
  console.error("  Um `found 0 vulnerabilities` sobre nada não prova nada (lição da ADR-114).");
  process.exit(1);
}
console.log(`  ✓ ${auditadas} dependências de produção realmente auditadas`);

const graves = Object.entries(relatorio.metadata?.vulnerabilities ?? {}).filter(
  ([nivel, n]) => (nivel === "high" || nivel === "critical") && n > 0,
);
if (graves.length) {
  console.error("✗ falha ALTA ou CRÍTICA no que o SERVIDOR vai instalar: " + graves.map(([n, q]) => `${q} ${n}`).join(", "));
  console.error("  Rode `npm audit --omit=dev` em apps/api/dist para ver os caminhos.");
  process.exit(1);
}

console.log("✓ artefato conferido e auditado — pode publicar");
