/**
 * LIMPEZA DE DADOS DE TESTE / DEMO — deixa a aplicação pronta para uso real.
 *
 *   pnpm db:limpar          → DRY-RUN: só lista o que seria apagado. Não toca em nada.
 *   pnpm db:limpar --apply  → faz o dump de segurança e AÍ apaga.
 *
 * O que SOBREVIVE (configuração e catálogo reais):
 *   - o usuário ROOT;
 *   - as etapas do funil (PipelineStage);
 *   - o catálogo real de serviços (e as exigências/passos deles);
 *   - modelos de documento, operadoras, origens, categorias de EMPRESA, templates de e-mail.
 *
 * O que É APAGADO (tudo transacional + o que é comprovadamente de teste):
 *   - clientes, leads, projetos, contas, documentos, conversas, eventos, arquivos;
 *   - logs, sessões, notificações, tokens, e-mails enviados, incidentes;
 *   - usuários que não são o ROOT (e o que é pessoal deles);
 *   - os serviços "E2E"/"Guard" criados pela suíte de testes.
 *
 * Segurança: nunca roda contra produção (mesma trava do demo-seed) e sempre faz `mysqldump`
 * antes de apagar — o arquivo em `backups/` permite reverter.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { podeRodarDemoSeed } from "../packages/db/src/seed-guard";
import { EQUIPE_REAL } from "../packages/db/src/seed-config";

const APLICAR = process.argv.includes("--apply");
const CONTAINER = "medconsultoria-mysql";

for (const linha of readFileSync(".env", "utf8").split("\n")) {
  const m = linha.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

// Mesma trava do demo-seed: nada disto roda contra banco de produção.
const guard = podeRodarDemoSeed(process.env);
if (!guard.permitido) {
  console.error(`✗ limpeza BLOQUEADA: ${guard.motivo}`);
  process.exit(1);
}

const BANCO = new URL(process.env.DATABASE_URL!).pathname.replace("/", "");

/**
 * As contas reais da equipe (ROOT e ADMIN) SOBREVIVEM à limpeza — sem elas ninguém entra na
 * aplicação depois de zerar. Respeita override por env, igual ao seed.
 */
const EMAILS_EQUIPE = EQUIPE_REAL.map((m) => `'${process.env[m.chaveEmail] ?? m.emailPadrao}'`).join(", ");

/** Tabelas esvaziadas por completo — tudo nelas é transacional ou de teste. */
const ESVAZIAR = [
  "ActivityLog", "Session", "Notificacao", "ChecklistItem", "EmailEnviado", "LeadPasso",
  "Card", "ConversaParticipante", "Conta", "Mensagem", "Lead", "Evento", "DocumentoVersao",
  "Documento", "Nota", "_LeadServicos", "Conversa", "TimeEntry", "Cliente", "Arquivo",
  "Token", "Incidente", "ErrorLog", "ClienteServico", "Projeto", "Contato", "SuporteMensagem",
  "ProjetoParticipante", "EventoParticipante", "Assinatura", "FormularioResposta",
  "PreferenciaEmail",
  // Acrescentados em 29/08/2026. Estes NOVE ficavam para trás, e o efeito só aparecia ao
  // repovoar: cada semeadura empilhava mais um lote de médicos e credenciamentos (26
  // profissionais e 59 credenciamentos onde o desenho pede 5 e 10), e o painel de
  // Credenciamentos mostrava gente que não existe mais em clínica nenhuma.
  //
  // ⚠️ `Credenciamento` e `Profissional` NÃO caíam em cascata: `Profissional` pende de
  // `Cliente`, mas com as chaves estrangeiras DESLIGADAS durante a limpeza (é o que este
  // script faz para não depender da ordem entre 40 tabelas) a cascata do banco não roda.
  // Tabela ausente desta lista é tabela que sobrevive.
  //
  // ⚠️ `CaixaEmail` guarda a senha IMAP cifrada de cada pessoa — é dado pessoal e não pode
  // sobreviver a uma limpeza. Deixá-la também era a origem do erro `412 Precondition
  // Failed` que a tela `/email` disparava em toda carga: a caixa semeada pedindo reconexão.
  "Credenciamento", "Profissional",
  "Tarefa", "TarefaResponsavel",
  "EmailAnexo", "EmailEndereco", "EmailMensagem", "CaixaPasta", "CaixaEmail",
];

/** Limpezas seletivas: preservam o que é catálogo real. */
const SELETIVAS = [
  {
    rotulo: "usuários que não são da equipe real (docs/ACESSOS.md)",
    contar: `SELECT COUNT(*) FROM User WHERE email NOT IN (${EMAILS_EQUIPE})`,
    listar: `SELECT CONCAT(nome, ' <', email, '> ', role) FROM User WHERE email NOT IN (${EMAILS_EQUIPE})`,
    apagar: [`DELETE FROM User WHERE email NOT IN (${EMAILS_EQUIPE})`],
  },
  {
    rotulo: "categorias PESSOAIS (a carteira pessoal morre com o usuário)",
    contar: `SELECT COUNT(*) FROM Categoria WHERE escopo = 'PESSOAL'`,
    listar: `SELECT CONCAT(nome, ' (', tipo, ')') FROM Categoria WHERE escopo = 'PESSOAL'`,
    apagar: [`DELETE FROM Categoria WHERE escopo = 'PESSOAL'`],
  },
  {
    rotulo: "serviços criados pela suíte de testes (E2E/Guard)",
    contar: `SELECT COUNT(*) FROM Servico WHERE nome LIKE '%E2E%' OR nome LIKE '%Guard%'`,
    listar: `SELECT nome FROM Servico WHERE nome LIKE '%E2E%' OR nome LIKE '%Guard%'`,
    apagar: [
      `DELETE FROM ServicoRequisito WHERE servicoId IN (SELECT id FROM Servico WHERE nome LIKE '%E2E%' OR nome LIKE '%Guard%')`,
      `DELETE FROM ServicoPasso WHERE servicoId IN (SELECT id FROM Servico WHERE nome LIKE '%E2E%' OR nome LIKE '%Guard%')`,
      `DELETE FROM Servico WHERE nome LIKE '%E2E%' OR nome LIKE '%Guard%'`,
    ],
  },
  {
    // Roda DEPOIS da exclusão dos serviços de teste, então a contagem do dry-run (avaliada
    // antes) sai menor que a real — os briefings dos serviços E2E só ficam órfãos ali.
    rotulo: "formulários órfãos (contado só na aplicação, após remover os serviços de teste)",
    contar: `SELECT COUNT(*) FROM Formulario f WHERE NOT EXISTS (SELECT 1 FROM ServicoRequisito r WHERE r.formularioId = f.id)`,
    listar: `SELECT titulo FROM Formulario f WHERE NOT EXISTS (SELECT 1 FROM ServicoRequisito r WHERE r.formularioId = f.id)`,
    apagar: [
      `DELETE FROM FormularioCampo WHERE formularioId IN (SELECT id FROM (SELECT f.id FROM Formulario f WHERE NOT EXISTS (SELECT 1 FROM ServicoRequisito r WHERE r.formularioId = f.id)) x)`,
      `DELETE FROM Formulario f WHERE NOT EXISTS (SELECT 1 FROM ServicoRequisito r WHERE r.formularioId = f.id)`,
    ],
  },
];

function sql(query: string, { silencioso = false } = {}): string {
  const r = spawnSync(
    "docker",
    ["exec", CONTAINER, "mysql", "-uroot", "-proot", "--default-character-set=utf8mb4", "-N", "-e", `USE \`${BANCO}\`; ${query}`],
    { encoding: "utf8" },
  );
  if (r.status !== 0 && !silencioso) throw new Error(`SQL falhou: ${(r.stderr || "").trim()}`);
  return (r.stdout || "").trim();
}

function dump() {
  mkdirSync("backups", { recursive: true });
  const carimbo = sql("SELECT DATE_FORMAT(NOW(), '%Y%m%d-%H%i%s')");
  const destino = `backups/${BANCO}-antes-da-limpeza-${carimbo}.sql`;
  const r = spawnSync("docker", ["exec", CONTAINER, "mysqldump", "-uroot", "-proot", "--databases", BANCO], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`mysqldump falhou: ${(r.stderr || "").trim()}`);
  writeFileSync(destino, r.stdout);
  return { destino, kb: Math.round(r.stdout.length / 1024) };
}

console.log(`\n▸ banco: ${BANCO} (${guard.motivo})`);
console.log(APLICAR ? "▸ modo: APLICAR (vai apagar)\n" : "▸ modo: DRY-RUN — nada será apagado\n");

let total = 0;
console.log("Tabelas que serão ESVAZIADAS:");
for (const t of ESVAZIAR) {
  const n = Number(sql(`SELECT COUNT(*) FROM \`${t}\``, { silencioso: true }) || 0);
  total += n;
  if (n > 0) console.log(`  ${String(n).padStart(5)}  ${t}`);
}

console.log("\nLimpezas SELETIVAS (o catálogo real fica):");
for (const s of SELETIVAS) {
  const n = Number(sql(s.contar) || 0);
  total += n;
  console.log(`  ${String(n).padStart(5)}  ${s.rotulo}`);
  if (n > 0 && n <= 25) for (const linha of sql(s.listar).split("\n").filter(Boolean)) console.log(`         · ${linha}`);
}

/** `Lead` (e outros) são palavras reservadas no MySQL 8 — o nome da tabela vai sempre com crase. */
const contar = (tabela: string, onde = "") => `SELECT COUNT(*) FROM \`${tabela}\`${onde ? ` WHERE ${onde}` : ""}`;

console.log("\nO que SOBREVIVE:");
for (const [rotulo, q] of [
  ["contas da equipe real (ROOT + ADMIN)", contar("User", `email IN (${EMAILS_EQUIPE})`)],
  ["etapas do funil", contar("PipelineStage")],
  ["serviços reais", contar("Servico", "nome NOT LIKE '%E2E%' AND nome NOT LIKE '%Guard%'")],
  ["modelos de documento", contar("ModeloDocumento")],
  ["operadoras", contar("Operadora")],
  ["origens", contar("Origem")],
  ["categorias da EMPRESA", contar("Categoria", "escopo = 'EMPRESA'")],
  ["templates de e-mail", contar("EmailTemplate")],
]) {
  console.log(`  ${String(sql(q)).padStart(5)}  ${rotulo}`);
}

console.log(`\n= ${total} registro(s) seriam apagados.`);

if (!APLICAR) {
  console.log("\nDRY-RUN: nada foi apagado. Para aplicar:  pnpm db:limpar --apply\n");
  process.exit(0);
}

console.log("\n▸ dump de segurança antes de apagar…");
const bak = dump();
console.log(`  ✓ ${bak.destino} (${bak.kb} KB)`);

// FK desligadas só durante a limpeza: a ordem de exclusão entre 40 tabelas relacionadas não
// importa aqui — o alvo é "tudo transacional", não um recorte que precise respeitar cascatas.
const comandos = [
  "SET FOREIGN_KEY_CHECKS = 0",
  ...ESVAZIAR.map((t) => `DELETE FROM \`${t}\``),
  ...SELETIVAS.flatMap((s) => s.apagar),
  "SET FOREIGN_KEY_CHECKS = 1",
];
sql(comandos.join("; "));

console.log("\n▸ conferência depois da limpeza:");
for (const [rotulo, q] of [
  ["clientes", contar("Cliente")],
  ["leads", contar("Lead")],
  ["projetos", contar("Projeto")],
  ["contas", contar("Conta")],
  ["documentos", contar("Documento")],
  ["conversas", contar("Conversa")],
  ["eventos", contar("Evento")],
  ["usuários (só a equipe real)", contar("User")],
  ["serviços reais", contar("Servico")],
  ["etapas do funil", contar("PipelineStage")],
  ["modelos", contar("ModeloDocumento")],
]) {
  console.log(`  ${String(sql(q)).padStart(5)}  ${rotulo}`);
}

console.log(`\n✓ limpeza concluída. Reverter: docker exec -i ${CONTAINER} mysql -uroot -proot < ${bak.destino}\n`);
