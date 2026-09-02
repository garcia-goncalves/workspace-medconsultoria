/**
 * Comandos de credencial da API do agente (ADR-149).
 *
 *   pnpm agente cliente  --nome cora-dev
 *   pnpm agente delegar  --cliente <clientId> --email pessoa@exemplo --minutos 60 [--escopos "tasks:read"]
 *   pnpm agente revogar  --delegacao <delegationId>
 *   pnpm agente listar
 *
 * ⚠️ **O segredo e o token aparecem UMA vez, aqui na tela.** O banco guarda só o hash; se o
 * valor se perder, emite-se outro. É de propósito: credencial recuperável é credencial que
 * alguém acaba guardando em arquivo.
 *
 * ⚠️ **Nada disto roda em produção.** A trava é a mesma do `contas-de-teste`/`demo-seed`: em
 * `NODE_ENV=production` o comando recusa. Credencial de produção se emite pelo caminho de
 * produção, com registro de quem emitiu — não por script de linha de comando de quem tem
 * acesso ao shell.
 */
import "../env.js";
import { prisma } from "@app/db";
import {
  criarClienteDeAgente,
  emitirDelegacao,
  revogarDelegacao,
  ESCOPOS_CONHECIDOS,
  normalizarEscopos,
} from "../modules/agente/agente.service.js";

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fim(mensagem: string): never {
  console.error(`\n❌ ${mensagem}\n`);
  process.exit(1);
}

async function principal() {
  if (process.env["NODE_ENV"] === "production") {
    fim("Este comando não roda em produção. Ver o cabeçalho do arquivo.");
  }

  const acao = process.argv[2];

  if (acao === "cliente") {
    const nome = arg("nome") ?? fim("Informe --nome (ex.: --nome cora-dev).");
    const { id, segredo } = await criarClienteDeAgente(nome);
    console.log("\n✅ Cliente de agente criado.\n");
    console.log(`  x-agent-client: ${id}`);
    console.log(`  x-agent-secret: ${segredo}`);
    console.log("\n⚠️  O segredo NÃO será mostrado de novo.\n");
    return;
  }

  if (acao === "delegar") {
    const clientId = arg("cliente") ?? fim("Informe --cliente <clientId>.");
    const email = arg("email") ?? fim("Informe --email <e-mail da pessoa>.");
    const minutos = Number(arg("minutos") ?? "60");
    if (!Number.isFinite(minutos)) fim("--minutos precisa ser um número (negativo = já expirada).");
    const escopos = normalizarEscopos((arg("escopos") ?? "tasks:read").split(/[\s,]+/));
    const desconhecidos = escopos.filter((e) => !ESCOPOS_CONHECIDOS.includes(e as never));
    if (desconhecidos.length) fim(`Escopo desconhecido: ${desconhecidos.join(", ")}.`);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, nome: true, role: true, ativo: true },
    });
    if (!user) fim(`Não existe usuário com o e-mail ${email}.`);
    if (user.role === "CLIENTE") fim("Conta de Portal não pode delegar leitura de tarefa interna.");
    if (!user.ativo) console.warn("⚠️  Atenção: este usuário está DESATIVADO — a API vai recusar (403).");

    const { id, token, expiraEm } = await emitirDelegacao({ clientId, userId: user.id, escopos, minutos });
    console.log("\n✅ Delegação emitida.\n");
    console.log(`  delegationId : ${id}`);
    console.log(`  usuário      : ${user.nome} (${user.id})`);
    console.log(`  escopos      : ${escopos.join(" ")}`);
    console.log(`  expira em    : ${expiraEm.toISOString()}`);
    console.log(`  Authorization: Bearer ${token}`);
    console.log("\n⚠️  O token NÃO será mostrado de novo.\n");
    return;
  }

  if (acao === "revogar") {
    const id = arg("delegacao") ?? fim("Informe --delegacao <delegationId>.");
    const ok = await revogarDelegacao(id);
    console.log(
      ok
        ? "\n✅ Delegação revogada — vale já na próxima chamada.\n"
        : "\n⚠️  Nada a revogar (id inexistente ou já revogada).\n",
    );
    return;
  }

  if (acao === "listar") {
    const linhas = await prisma.agentDelegation.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        escopos: true,
        expiraEm: true,
        revogadaEm: true,
        ultimoUsoEm: true,
        client: { select: { nome: true } },
        user: { select: { nome: true, email: true, ativo: true } },
      },
    });
    if (!linhas.length) console.log("\nNenhuma delegação emitida.\n");
    for (const l of linhas) {
      const estado = l.revogadaEm ? "REVOGADA" : l.expiraEm <= new Date() ? "EXPIRADA" : "ativa";
      console.log(
        `${l.id}  ${estado.padEnd(9)} ${l.client.nome} → ${l.user.nome} <${l.user.email}>` +
          `  escopos=[${l.escopos}]  expira=${l.expiraEm.toISOString()}` +
          `  ultimoUso=${l.ultimoUsoEm ? l.ultimoUsoEm.toISOString() : "nunca"}`,
      );
    }
    return;
  }

  fim("Ação desconhecida. Use: cliente | delegar | revogar | listar. Ver o cabeçalho do arquivo.");
}

principal()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
