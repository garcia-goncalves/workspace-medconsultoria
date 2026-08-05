import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { podeRodarDemoSeed } from "../src/seed-guard";
import { STAGE_DEFAULTS } from "../src/seed-config";

// Dados de EXEMPLO para acompanhar a aplicação ao vivo. Idempotente.
// Rodar: pnpm db:demo
config({ path: resolve(process.cwd(), "../../.env") });
const prisma = new PrismaClient();

/**
 * Senha das contas de exemplo = a MESMA senha de seed do `.env`, nunca um literal.
 *
 * Até 05/08/2026 estava escrita aqui no código: além de ser credencial versionada, ficava
 * imune a `pnpm senha:rotacionar` — quem tivesse lido o repositório continuava entrando como
 * FUNCIONARIO e como cliente do Portal depois da rotação (ADR-98).
 */
function senhaDeSeed(): string {
  const senha = process.env.SEED_ROOT_PASSWORD;
  if (!senha) throw new Error("Defina SEED_ROOT_PASSWORD no .env antes de rodar o demo-seed.");
  return senha;
}

async function main() {
  const guard = podeRodarDemoSeed(process.env);
  if (!guard.permitido) {
    throw new Error(`demo-seed BLOQUEADO: ${guard.motivo}`);
  }
  console.log(`• demo-seed liberado: ${guard.motivo}`);

  const senhaExemplo = await hash(senhaDeSeed());

  const root = await prisma.user.findFirst({ where: { role: "ROOT" } });

  // Usuários de exemplo (senha = a de seed, do `.env`) para testar mensagens/atribuições.
  const equipe: { nome: string; email: string; role: "ADMIN" | "FUNCIONARIO" }[] = [
    { nome: "Thaís", email: "thais.garcia@medconsultoria.com.br", role: "ADMIN" },
    { nome: "Funcionário Exemplo", email: "func@medconsultoria.com.br", role: "FUNCIONARIO" },
  ];
  for (const u of equipe) {
    const existe = await prisma.user.findUnique({ where: { email: u.email } });
    if (!existe) {
      await prisma.user.create({
        data: { nome: u.nome, email: u.email, role: u.role, passwordHash: senhaExemplo },
      });
    }
  }

  let stages = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
  if (stages.length === 0) {
    await prisma.pipelineStage.createMany({ data: STAGE_DEFAULTS });
    stages = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
  }

  const clientes = [
    { nome: "Clínica Bem Estar", tipo: "PJ" as const, email: "contato@bemestar.com.br", telefone: "(11) 3222-1000", documento: "11.222.333/0001-44" },
    { nome: "Consultório Dr. Almeida", tipo: "PF" as const, email: "almeida@consultorio.com.br", telefone: "(11) 98888-7777" },
    { nome: "Hospital Santa Luz", tipo: "PJ" as const, email: "administrativo@santaluz.com.br", telefone: "(11) 3555-2000", documento: "44.555.666/0001-77" },
  ];
  for (const c of clientes) {
    const existe = await prisma.cliente.findFirst({ where: { nome: c.nome } });
    if (!existe) await prisma.cliente.create({ data: { ...c, responsavelId: root?.id ?? null } });
  }

  const leads = [
    { nome: "Dra. Fernanda", empresa: "Clínica Sorriso", email: "fernanda@sorriso.com", origem: "Indicação", valorEstimado: 8000, stage: 0 },
    { nome: "Carlos Mendes", empresa: "MedLar Home Care", email: "carlos@medlar.com", origem: "Site", valorEstimado: 15000, stage: 0 },
    { nome: "Paula Ribeiro", empresa: "Instituto Vida", email: "paula@vida.org", origem: "Evento", valorEstimado: 22000, stage: 1 },
    { nome: "Dr. Nogueira", empresa: "Cardio Center", email: "nogueira@cardio.com", origem: "Indicação", valorEstimado: 40000, stage: 2 },
    { nome: "Amanda Costa", empresa: "Rede Saúde+", email: "amanda@saudemais.com", origem: "LinkedIn", valorEstimado: 60000, stage: 3 },
  ];
  for (const l of leads) {
    const existe = await prisma.lead.findFirst({ where: { nome: l.nome } });
    if (existe) continue;
    const stage = stages[l.stage] ?? stages[0];
    if (!stage) continue;
    const max = await prisma.lead.aggregate({
      where: { pipelineStageId: stage.id, deletedAt: null, convertidoEmClienteId: null },
      _max: { ordem: true },
    });
    await prisma.lead.create({
      data: {
        nome: l.nome,
        empresa: l.empresa,
        email: l.email,
        origem: l.origem,
        valorEstimado: l.valorEstimado,
        pipelineStageId: stage.id,
        ordem: (max._max.ordem ?? -1) + 1,
        responsavelId: root?.id ?? null,
      },
    });
  }

  // ── Agenda (eventos de exemplo desta semana) ──
  const primeiroCliente = await prisma.cliente.findFirst({ where: { deletedAt: null } });
  const hoje = new Date();
  const em = (dias: number, h: number, m: number) => {
    const d = new Date(hoje);
    d.setDate(d.getDate() + dias);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const segunda = (() => {
    const d = new Date(hoje);
    d.setHours(9, 0, 0, 0);
    const w = d.getDay();
    d.setDate(d.getDate() + (w === 0 ? -6 : 1 - w));
    return d;
  })();

  const eventos: Array<Record<string, unknown>> = [
    { titulo: "Reunião de alinhamento", tipo: "REUNIAO", escopo: "EMPRESA", inicio: em(0, 14, 0), fim: em(0, 15, 0), linkReuniao: "https://meet.google.com/abc-defg-hij", clienteId: primeiroCliente?.id ?? null },
    { titulo: "Retornar ligação do cliente", tipo: "RETORNO", escopo: "EMPRESA", inicio: em(0, 16, 30) },
    { titulo: "Visita técnica", tipo: "COMPROMISSO", escopo: "EMPRESA", inicio: em(1, 10, 0), fim: em(1, 11, 30), clienteId: primeiroCliente?.id ?? null },
    { titulo: "Consulta médica (pessoal)", tipo: "PESSOAL", escopo: "PESSOAL", inicio: em(2, 8, 0) },
    { titulo: "Reunião semanal de equipe", tipo: "REUNIAO", escopo: "EMPRESA", inicio: segunda, fim: new Date(segunda.getTime() + 60 * 60 * 1000), recorrencia: "SEMANAL" },
  ];
  for (const ev of eventos) {
    const existe = await prisma.evento.findFirst({ where: { titulo: ev.titulo as string } });
    if (!existe) await prisma.evento.create({ data: { ...ev, donoId: root?.id ?? "" } as never });
  }

  // ── Financeiro (categorias + contas de exemplo) ──
  const catDefaults: { nome: string; tipo: "RECEITA" | "DESPESA"; cor: string }[] = [
    { nome: "Honorários", tipo: "RECEITA", cor: "#30AD73" },
    { nome: "Consultoria", tipo: "RECEITA", cor: "#2DA8E1" },
    { nome: "Aluguel", tipo: "DESPESA", cor: "#E5484D" },
    { nome: "Salários", tipo: "DESPESA", cor: "#F59E0B" },
    { nome: "Impostos", tipo: "DESPESA", cor: "#002463" },
  ];
  if ((await prisma.categoria.count()) === 0) await prisma.categoria.createMany({ data: catDefaults });
  const catHon = await prisma.categoria.findFirst({ where: { nome: "Honorários" } });
  const catAlu = await prisma.categoria.findFirst({ where: { nome: "Aluguel" } });
  const catImp = await prisma.categoria.findFirst({ where: { nome: "Impostos" } });
  const catSal = await prisma.categoria.findFirst({ where: { nome: "Salários" } });

  const contas: Array<Record<string, unknown>> = [
    { tipo: "RECEBER", descricao: "Honorários mensais", valor: 5000, vencimento: em(10, 0, 0), categoriaId: catHon?.id ?? null, clienteId: primeiroCliente?.id ?? null },
    { tipo: "RECEBER", descricao: "Consultoria (atrasada)", valor: 3000, vencimento: em(-5, 0, 0) },
    { tipo: "PAGAR", descricao: "Aluguel do escritório", valor: 2500, vencimento: em(5, 0, 0), categoriaId: catAlu?.id ?? null },
    { tipo: "PAGAR", descricao: "Impostos (atrasado)", valor: 1800, vencimento: em(-2, 0, 0), categoriaId: catImp?.id ?? null },
    { tipo: "PAGAR", descricao: "Salários", valor: 12000, vencimento: em(-1, 0, 0), pago: true, pagoEm: new Date(), categoriaId: catSal?.id ?? null },
  ];
  for (const ct of contas) {
    const existe = await prisma.conta.findFirst({ where: { descricao: ct.descricao as string } });
    if (!existe) await prisma.conta.create({ data: ct as never });
  }

  // Usuário do Portal do Cliente — vinculado a um cliente que tenha projetos (dados ricos).
  const clientePortal =
    (await prisma.cliente.findFirst({
      where: { deletedAt: null, projetos: { some: { deletedAt: null } } },
      orderBy: { createdAt: "asc" },
    })) ?? primeiroCliente;
  if (clientePortal) {
    const emailPortal = "cliente@medconsultoria.com.br";
    if (!(await prisma.user.findUnique({ where: { email: emailPortal } }))) {
      await prisma.user.create({
        data: {
          nome: `Portal · ${clientePortal.nome}`,
          email: emailPortal,
          role: "CLIENTE",
          clienteId: clientePortal.id,
          passwordHash: senhaExemplo,
        },
      });
    }
    console.log(`  portal: cliente@medconsultoria.com.br → ${clientePortal.nome}`);
  }

  const nClientes = await prisma.cliente.count({ where: { deletedAt: null } });
  const nLeads = await prisma.lead.count({ where: { deletedAt: null, convertidoEmClienteId: null } });
  const nEventos = await prisma.evento.count({ where: { deletedAt: null } });
  const nContas = await prisma.conta.count({ where: { deletedAt: null } });
  console.log(`✔ Demo pronta: ${nClientes} clientes, ${nLeads} leads, ${nEventos} eventos, ${nContas} contas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
