/**
 * CONTAS DE TESTE DO AMBIENTE LOCAL — login fácil, público e igual em todos os projetos.
 *
 *   pnpm contas:teste
 *
 * Por que existe (CLAUDE.md global §0.8): no computador do dono o login é de MENTIRA e a senha
 * é DOCUMENTADA; no servidor o login é real e a senha é gerada lá dentro. Tratar a senha de
 * teste como segredo — a mesma valendo nos dois mundos — foi o que criou a dor de 05/08/2026.
 * Separados, o problema deixa de existir em vez de ser administrado para sempre.
 *
 * Por isso a senha abaixo é um literal no código, de propósito: ela NÃO é segredo, é dado de
 * teste. O que é segredo (`SEED_ROOT_PASSWORD`, chaves, senha de SMTP) continua só no `.env`.
 *
 * A trava é a MESMA do demo-seed (`podeRodarDemoSeed`, pura e testada): recusa quando
 * `NODE_ENV=production`. Não invente trava nova, e não confie no host — em produção o banco
 * TAMBÉM é `localhost` (MariaDB no próprio servidor, ver `docs/DEPLOY.md`).
 *
 * Diferente do `pnpm db:seed`, que preserva de propósito a senha de conta existente, este
 * script REESCREVE a senha das contas de teste toda vez: reconfigurar o ambiente de ensaio é
 * exatamente o que se espera dele.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { podeRodarDemoSeed } from "../packages/db/src/seed-guard";

config({ path: resolve(process.cwd(), ".env") });

/** Não é segredo: é dado de teste, e está documentado em `docs/LINKS.md` de propósito. */
const SENHA_TESTE = "teste1234";

const CONTAS = [
  { email: "root@teste.local", nome: "Root de Teste", role: "ROOT" as const },
  { email: "admin@teste.local", nome: "Admin de Teste", role: "ADMIN" as const },
  { email: "funcionario@teste.local", nome: "Funcionário de Teste", role: "FUNCIONARIO" as const },
  { email: "cliente@teste.local", nome: "Cliente de Teste", role: "CLIENTE" as const },
];

async function main() {
  const guard = podeRodarDemoSeed(process.env);
  if (!guard.permitido) {
    throw new Error(`CONTAS DE TESTE BLOQUEADAS: ${guard.motivo}`);
  }
  console.log(`▸ ${guard.motivo}\n`);

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hash(SENHA_TESTE);

    // O cliente do Portal precisa de um Cliente para enxergar algo. Reaproveita o que tiver
    // projetos (tela mais rica); se o banco estiver vazio, cria um cliente de ensaio.
    let clientePortal = await prisma.cliente.findFirst({
      where: { deletedAt: null, projetos: { some: { deletedAt: null } } },
      orderBy: { createdAt: "asc" },
    });
    clientePortal ??= await prisma.cliente.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
    clientePortal ??= await prisma.cliente.create({
      data: { nome: "Clínica de Teste", cnpj: "77.888.999/0001-81", email: "cliente@teste.local", telefone: "(11) 90000-0000" },
    });

    for (const c of CONTAS) {
      // `senhaTrocadaEm` preenchido de propósito: sem isso o ADR-91 manda a conta para a página
      // obrigatória de "defina sua senha" e o ambiente de ensaio não serve para ensaiar nada.
      const dados = {
        nome: c.nome,
        role: c.role,
        passwordHash,
        senhaTrocadaEm: new Date(),
        ativo: true,
        deletedAt: null,
        clienteId: c.role === "CLIENTE" ? clientePortal.id : null,
      };
      await prisma.user.upsert({
        where: { email: c.email },
        create: { email: c.email, ...dados },
        update: dados,
      });
      const onde = c.role === "CLIENTE" ? ` → Portal de "${clientePortal.nome}"` : "";
      console.log(`✔ ${c.email.padEnd(24)} ${c.role.padEnd(12)}${onde}`);
    }

    console.log(`\n✓ ${CONTAS.length} contas de teste prontas. Senha de todas: ${SENHA_TESTE}`);
    console.log("  Valem SÓ nesta máquina — em produção este script se recusa a rodar.\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}\n`);
  process.exit(1);
});
