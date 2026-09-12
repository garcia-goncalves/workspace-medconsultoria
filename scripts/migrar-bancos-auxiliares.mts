/**
 * Aplica as migrações nos bancos AUXILIARES de desenvolvimento — o de integração
 * (`medconsultoria_test`, usado por `pnpm --filter @app/api test`) e o do e2e isolado
 * (`medconsultoria_e2e`).
 *
 * Existe porque migração nova só entra sozinha no banco de desenvolvimento: a suíte de
 * integração não migra nada antes de rodar, e a reprovação que ela dá quando o banco está
 * atrasado ("Unknown column ...") se lê como defeito de código, não como banco velho.
 * Já custou uma rodada inteira de investigação.
 *
 * Rodar da raiz:  pnpm exec tsx scripts/migrar-bancos-auxiliares.mts
 */
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

// O Prisma CLI carrega o arquivo de ambiente sozinho; um script solto, não.
dotenv.config();

const base = process.env.DATABASE_URL;
if (!base) {
  console.error("Sem conexão configurada no ambiente — rode a partir da raiz do repositório.");
  process.exit(1);
}

for (const sufixo of ["_test", "_e2e"]) {
  const u = new URL(base);
  const nome = u.pathname.replace(/^\//, "").replace(/(_test|_e2e)$/, "");
  u.pathname = `/${nome}${sufixo}`;
  console.log(`\n── migrando ${nome}${sufixo} ──`);
  const r = spawnSync("pnpm", ["--filter", "@app/db", "exec", "prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, DATABASE_URL: u.toString() },
  });
  if (r.status !== 0) {
    console.error(`FALHOU em ${nome}${sufixo} — o banco pode não existir ainda.`);
    process.exit(r.status ?? 1);
  }
}
