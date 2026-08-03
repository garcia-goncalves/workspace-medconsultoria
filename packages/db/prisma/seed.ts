import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { STAGE_DEFAULTS, EQUIPE_REAL } from "../src/seed-config";

// Carrega o .env dos dois lugares possíveis (o primeiro que existir vence; `dotenv` não
// sobrescreve o que já está em process.env):
//   - `./.env`      → NO SERVIDOR, o seed roda da raiz do app (`node prisma/seed.js`)
//   - `../../.env`  → em desenvolvimento, roda de `packages/db` (raiz do monorepo)
// Sem a primeira linha, o seed não achava o .env no servidor e falhava por falta de senha.
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../../.env") });

const prisma = new PrismaClient();

async function main() {
  const senha = process.env.SEED_ROOT_PASSWORD;
  if (!senha) {
    throw new Error("Defina SEED_ROOT_PASSWORD no .env antes de rodar o seed.");
  }

  // Contas reais da equipe (docs/ACESSOS.md). Só CRIA quem falta — nunca sobrescreve a senha
  // de uma conta já em uso, para o seed poder rodar quantas vezes for preciso sem estragar
  // um acesso que a pessoa já trocou.
  for (const membro of EQUIPE_REAL) {
    const email = process.env[membro.chaveEmail] ?? membro.emailPadrao;
    // Chave POR PESSOA (não por papel): um único SEED_ROOT_NOME chegou a batizar os três
    // roots de "Administrador" em produção (28/07/2026). Espelha o `chaveEmail`.
    const nome = process.env[membro.chaveNome] ?? membro.nome;
    const existente = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existente) {
      console.log(`• ${membro.role} já existe: ${email} — senha preservada.`);
      continue;
    }
    await prisma.user.create({ data: { nome, email, passwordHash: await hash(senha), role: membro.role } });
    console.log(`✔ ${membro.role} criado: ${email}`);
  }

  // Etapas do funil = CONFIG ESSENCIAL (sem elas a página Vendas nasce sem colunas).
  // Idempotente: só semeia se o pipeline estiver vazio; nunca mexe em etapas já criadas.
  const stages = await prisma.pipelineStage.count();
  if (stages === 0) {
    await prisma.pipelineStage.createMany({ data: STAGE_DEFAULTS });
    console.log(`✔ Etapas do funil criadas: ${STAGE_DEFAULTS.map((s) => s.nome).join(" → ")}`);
  } else {
    console.log(`• Etapas do funil já existem (${stages}) — mantidas.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
