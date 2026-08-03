/**
 * E2E LOCAL EM BANCO ISOLADO.
 *
 * Problema que resolve: a suíte E2E lê a `DATABASE_URL` do `.env` da raiz, que localmente
 * aponta para o MESMO banco de desenvolvimento que o dono usa no navegador. Cada rodada
 * deixava resíduo lá (serviços "E2E …", chamados, leads). Na CI isso nunca ocorreu — lá o
 * MySQL é um container efêmero.
 *
 * O que este script faz: sobe uma SEGUNDA instância do app (portas próprias) apontada para
 * o banco `medconsultoria_e2e`, roda o Playwright contra ela e derruba tudo no fim. O `pnpm dev`
 * de sempre continua no ar, intocado, no banco de desenvolvimento.
 *
 *   pnpm test:e2e:isolado
 *
 * NUNCA escreve no `.env` — passa tudo por variável de ambiente aos processos filhos
 * (o `dotenv` do app não sobrescreve o que já está em `process.env`).
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BANCO = "medconsultoria_e2e";
const WEB_PORT = 4410;
const API_PORT = 4419;
const BASE_URL = `http://localhost:${WEB_PORT}`;
const CONTAINER = "medconsultoria-mysql";

/** Lê o `.env` da raiz sem alterá-lo, só para derivar a URL do banco isolado. */
function urlDoBancoIsolado() {
  let devUrl = process.env.DATABASE_URL;
  if (!devUrl) {
    for (const linha of readFileSync(".env", "utf8").split("\n")) {
      const m = linha.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m) devUrl = m[1];
    }
  }
  if (!devUrl) throw new Error("DATABASE_URL não encontrada (.env da raiz).");
  const u = new URL(devUrl);
  if (u.pathname.replace("/", "") === BANCO) return devUrl; // já isolado
  u.pathname = `/${BANCO}`;
  return u.toString();
}

const DATABASE_URL = urlDoBancoIsolado();
const filhos = [];

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    // shell só para o `pnpm` (no Windows é um .cmd). Para `docker`/`node`, shell quebraria
    // o quoting dos argumentos (o SQL do CREATE DATABASE chega picotado).
    shell: process.platform === "win32" && cmd === "pnpm",
    env: { ...process.env, ...extraEnv },
  });
  if (r.status !== 0) throw new Error(`falhou: ${cmd} ${args.join(" ")}`);
}

function iniciar(nome, cmd, args, extraEnv) {
  const p = spawn(cmd, args, {
    stdio: "inherit",
    // shell só para o `pnpm` (no Windows é um .cmd). Para `docker`/`node`, shell quebraria
    // o quoting dos argumentos (o SQL do CREATE DATABASE chega picotado).
    shell: process.platform === "win32" && cmd === "pnpm",
    env: { ...process.env, ...extraEnv },
  });
  p.on("exit", (code) => code !== 0 && code !== null && console.error(`[${nome}] saiu com ${code}`));
  filhos.push(p);
  return p;
}

async function esperarSaudavel(timeoutMs = 180_000) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    try {
      const [web, api] = await Promise.all([
        fetch(BASE_URL).then((r) => r.ok),
        fetch(`http://localhost:${API_PORT}/health`).then((r) => r.ok),
      ]);
      if (web && api) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`app isolado não ficou saudável (web ${WEB_PORT} / api ${API_PORT})`);
}

/**
 * Mata quem já estiver ocupando as portas do runner.
 *
 * Sem isto, uma execução anterior interrompida (Ctrl+C, timeout do terminal) deixa a instância
 * viva; a nova sobe com EADDRINUSE, os testes batem no app VELHO — apontado para o banco velho —
 * e falham com 401 em specs que nada têm a ver com a mudança. Foi o que aconteceu: 13 falhas
 * fantasma que pareciam regressão da aplicação.
 */
function liberarPortas() {
  for (const porta of [WEB_PORT, API_PORT]) {
    if (process.platform === "win32") {
      const r = spawnSync("powershell", [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -State Listen -LocalPort ${porta} -ErrorAction SilentlyContinue | ` +
          `ForEach-Object { taskkill /PID $_.OwningProcess /T /F 2>&1 | Out-Null }`,
      ]);
      if (r.status === 0) continue;
    } else {
      spawnSync("bash", ["-c", `lsof -ti tcp:${porta} | xargs -r kill -9`], { stdio: "ignore" });
    }
  }
}

/** Loga como ROOT e lista os serviços uma vez, disparando o lazy-seed do catálogo. */
async function aquecerCatalogo() {
  const senha = process.env.SEED_ROOT_PASSWORD;
  const email = process.env.SEED_ROOT_EMAIL ?? "root@medconsultoria.com.br";
  if (!senha) return; // sem senha no ambiente, deixa a suíte reportar o que faltar
  const login = await fetch(`${BASE_URL}/trpc/auth.login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify({ json: { email, password: senha } }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) return;
  const r = await fetch(`${BASE_URL}/trpc/servicos.list`, { headers: { cookie, origin: BASE_URL } });
  console.log(`  ${r.ok ? "✓" : "✗"} catálogo de serviços aquecido (HTTP ${r.status})`);
}

function derrubar() {
  for (const p of filhos) {
    if (!p.pid) continue;
    try {
      // No Windows o filho é um shell (pnpm.cmd); `kill` mataria só o wrapper e deixaria
      // vite/tsx segurando as portas. `/T` derruba a árvore inteira (mesma tática do keep-alive).
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        p.kill();
      }
    } catch {
      /* já morreu */
    }
  }
}

async function main() {
  console.log(`▸ banco isolado: ${BANCO} (o banco de desenvolvimento NÃO é tocado)`);
  liberarPortas();

  // 1) Banco DO ZERO a cada execução — reprodutibilidade igual à da CI, que sobe um container
  // novo por job. Reaproveitar o banco entre rodadas acumulava estado (leads/projetos/contas de
  // execuções anteriores) e fazia specs sem relação nenhuma falharem, escondendo o defeito real.
  // Só o banco de TESTE é recriado; o de desenvolvimento nunca é tocado.
  run("docker", [
    "exec",
    CONTAINER,
    "mysql",
    "-uroot",
    "-proot",
    "-e",
    `DROP DATABASE IF EXISTS \`${BANCO}\`; ` +
      `CREATE DATABASE \`${BANCO}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; ` +
      `GRANT ALL ON \`${BANCO}\`.* TO 'medconsultoria'@'%';`,
  ]);

  // 2) Estrutura + dados de teste, tudo dentro do banco isolado.
  const env = { DATABASE_URL };
  run("pnpm", ["--filter", "@app/db", "exec", "prisma", "migrate", "deploy"], env);
  run("pnpm", ["--filter", "@app/db", "seed"], env);
  run("pnpm", ["--filter", "@app/db", "demo"], env);
  // Contas de teste entram como "senha já definida" — senão todas caem na página de
  // primeiro acesso (ADR-91) e o auth.setup falha. O fluxo tem spec próprio.
  run("node", ["scripts/e2e-senha-ja-trocada.mjs"], env);

  // 3) Segunda instância do app, em portas próprias.
  const envApp = { ...env, API_PORT: String(API_PORT), WEB_PORT: String(WEB_PORT), WEB_ORIGIN: BASE_URL };
  iniciar("api", "pnpm", ["--filter", "@app/api", "dev"], envApp);
  iniciar("web", "pnpm", ["--filter", "@app/web", "dev"], envApp);
  await esperarSaudavel();
  console.log(`✓ app isolado no ar em ${BASE_URL}`);

  // 4) Aquece o catálogo de serviços. Ele nasce por LAZY-SEED na primeira listagem — num banco
  // recém-criado ainda não existe, e specs que escolhem um serviço no formulário (ex.: "Gestão
  // Operacional" no Novo lead) falhavam por dependerem de alguém ter aberto a página antes.
  // É o mesmo efeito de abrir "Serviços" no navegador.
  await aquecerCatalogo();

  // 5) Fixtures + suíte, contra a instância isolada.
  run("node", ["scripts/e2e-fixtures.mjs"], env);
  run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], { ...env, E2E_BASE_URL: BASE_URL });
}

main()
  .then(() => {
    derrubar();
    console.log("✓ E2E isolado concluído — banco de desenvolvimento intacto.");
    process.exit(0);
  })
  .catch((e) => {
    derrubar();
    console.error(`✗ ${e.message}`);
    process.exit(1);
  });
