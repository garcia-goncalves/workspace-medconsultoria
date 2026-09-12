/**
 * ROTACIONAR A SENHA DE SEED (desenvolvimento) — troca o valor E o que está no banco.
 *
 *   pnpm senha:rotacionar              → sorteia uma senha nova (não é impressa)
 *   pnpm senha:rotacionar <senha>      → usa a senha que você escolheu
 *
 * A forma com senha escolhida existe porque a sorteada é ótima para higiene e péssima para
 * ENTRAR: o dono é leigo em terminal e precisa de uma senha que ele saiba de cor no ambiente
 * de mentira. Isso não afrouxa nada — a senha local não é segredo (CLAUDE.md global §0.8), o
 * que é segredo mora só no `.env` do servidor, e a trava de produção abaixo vale nas duas
 * formas. A senha escolhida é validada antes (`validarSenhaEscolhida`): aspas duplas, barra
 * invertida ou quebra de linha corromperiam o `.env` em silêncio e trancariam TUDO fora.
 *
 * Existe porque "trocar o `.env` e reexecutar o seed" NÃO troca nada: o seed só CRIA quem
 * falta e preserva de propósito a senha de conta já existente (`packages/db/prisma/seed.ts`).
 * Sem reescrever o hash das contas que já estão no banco, a senha antiga continua entrando.
 *
 * O que faz, nesta ordem:
 *   1. exige ambiente de DESENVOLVIMENTO (mesma trava do demo-seed) e mostra o banco alvo;
 *   2. descobre quem ainda usa a senha ATUAL — é este o critério, não uma lista de e-mails:
 *      pega toda conta cujo hash confere com ela, incluindo as de exemplo do `demo-seed`, e
 *      **não toca em quem já definiu senha própria** (ADR-91 segue valendo, sem mexer em
 *      `senhaTrocadaEm`: quem escolheu a sua não é afetado, quem não escolheu continua sendo
 *      cobrado no 1º acesso);
 *   3. sorteia (ou usa a que você passou) a senha nova e grava a linha `SEED_ROOT_PASSWORD` do
 *      `.env` — fonte única: o `playwright.config.ts` deriva a senha dos e2e dela;
 *   4. reescreve o `passwordHash` dessas contas, num único UPDATE (atômico: não existe desfecho
 *      com metade das contas numa senha e metade em outra).
 *
 * A senha SORTEADA nunca é impressa, nem em log, nem em mensagem de erro: quem quiser ver abre
 * a linha `SEED_ROOT_PASSWORD` do `.env`. A ESCOLHIDA também não é impressa — quem a passou já
 * a conhece, e repetir na tela só a espalha pelo histórico do terminal. Se qualquer passo
 * falhar, o `.env` volta ao que era — o estado intermediário (arquivo novo × banco antigo) é o
 * único em que NADA autentica.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { hash, verify } from "@node-rs/argon2";
import { podeRodarDemoSeed } from "../packages/db/src/seed-guard";
import { validarSenhaEscolhida } from "../packages/db/src/senha-escolhida";

const ENV = ".env";
const CHAVE = "SEED_ROOT_PASSWORD";

async function main() {
  // Senha escolhida (opcional). Validada ANTES de tocar em arquivo ou banco: um erro de
  // digitação aqui deve custar uma mensagem, não um `.env` corrompido.
  const escolhida = process.argv[2];
  if (escolhida !== undefined) {
    const v = validarSenhaEscolhida(escolhida);
    if (!v.valida) throw new Error(`Senha recusada: ${v.motivo} Nada foi alterado.`);
  }

  const original = readFileSync(ENV, "utf8");
  const env = parse(original); // o mesmo parser que a aplicação usa (CRLF, aspas, comentários)

  const senhaAtual = env[CHAVE];
  if (!senhaAtual) throw new Error(`Não achei a linha ${CHAVE} no ${ENV} (ou está vazia). Nada foi alterado.`);

  // Chave repetida: o `dotenv` usa a ÚLTIMA e o replace abaixo trocaria a PRIMEIRA — a app
  // leria uma senha e o banco teria outra. Melhor recusar do que deixar a máquina sem acesso.
  const ocorrencias = original.split(/\r?\n/).filter((l) => new RegExp(`^\\s*${CHAVE}\\s*=`).test(l)).length;
  if (ocorrencias > 1) {
    throw new Error(`${CHAVE} aparece ${ocorrencias} vezes no ${ENV}. Deixe só uma linha e rode de novo.`);
  }

  // Trava de ambiente: a MESMA do demo-seed (pura e testada), alimentada com o `NODE_ENV` do
  // ARQUIVO — em produção o banco também é `localhost` (DEPLOY.md), então checar só o host não
  // separa desenvolvimento de produção; o que separa é o `NODE_ENV=production` do `.env` de lá.
  const guard = podeRodarDemoSeed({ NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV, DATABASE_URL: env.DATABASE_URL });
  if (!guard.permitido) throw new Error(`ROTAÇÃO BLOQUEADA: ${guard.motivo}`);

  const url = env.DATABASE_URL!;
  const alvo = new URL(url);
  console.log(`▸ banco alvo: ${alvo.hostname}:${alvo.port || "3306"}${alvo.pathname} (${guard.motivo})\n`);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  let restaurar = false;

  try {
    // Quem ainda usa a senha de seed? Este é o critério certo: pega as contas semeadas E as de
    // exemplo do demo-seed, e deixa em paz quem já tem senha própria.
    const contas = await prisma.user.findMany({ select: { id: true, email: true, passwordHash: true } });
    const usamASenha: { id: string; email: string }[] = [];
    for (const c of contas) {
      if (c.passwordHash && (await verify(c.passwordHash, senhaAtual).catch(() => false))) {
        usamASenha.push({ id: c.id, email: c.email });
      }
    }

    if (!usamASenha.length) {
      throw new Error("Nenhuma conta deste banco usa a senha atual — nada a rotacionar. Rode `pnpm db:seed` se o banco estiver vazio.");
    }

    const nova = escolhida ?? randomBytes(18).toString("base64url"); // 24 caracteres, sem "=" nem "/"
    const passwordHash = await hash(nova);

    const atualizado = original.replace(
      new RegExp(`^(\\s*${CHAVE}\\s*=).*$`, "m"),
      (_todo, prefixo: string) => `${prefixo}"${nova}"`,
    );
    writeFileSync(ENV, atualizado);
    restaurar = true;
    if (parse(readFileSync(ENV, "utf8"))[CHAVE] !== nova) {
      throw new Error(`a gravação do ${ENV} não conferiu`);
    }

    const r = await prisma.user.updateMany({ where: { id: { in: usamASenha.map((c) => c.id) } }, data: { passwordHash } });
    restaurar = false;

    for (const c of usamASenha) console.log(`✔ senha reescrita: ${c.email}`);
    console.log(`\n✓ Senha de seed rotacionada em ${r.count} conta(s).`);
    console.log(
      escolhida
        ? `  Vale a senha que você passou no comando — ela não é repetida aqui de propósito.`
        : `  O valor novo está SÓ na linha ${CHAVE} do ${ENV} — não é impresso aqui de propósito.`,
    );
    console.log(`  Confira com: pnpm acessos\n`);
  } catch (e) {
    if (restaurar) writeFileSync(ENV, original); // volta pelo conteúdo em memória: sem cópia do segredo em disco
    throw new Error(
      `${(e as Error).message}\n  O ${ENV} está como estava — nada mudou. O banco está no ar? (pnpm db:up)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}\n`);
  process.exit(1);
});
