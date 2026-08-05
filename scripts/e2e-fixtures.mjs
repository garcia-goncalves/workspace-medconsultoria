/**
 * Fixtures DETERMINÍSTICAS para a suíte E2E (roda antes dos specs, com `node` — SEM tsx, para
 * funcionar na CI apenas com `pnpm install --frozen-lockfile`). Idempotente e portável
 * (lookup do cliente por e-mail, não por id fixo):
 *   1) Briefing (ServicoRequisito BRIEFING + Formulario com 1 campo por tipo) ligado ao cliente do Portal;
 *   2) Reset de senha (usuário descartável + tokens RESET válido/expirado), escrevendo os RAW em
 *      e2e/.auth/fixtures.json para o spec (o banco só guarda o hash sha256).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// Carrega DATABASE_URL do .env da raiz (o processo do Playwright/CI não a tem por padrão).
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const prisma = new PrismaClient();

const PORTAL_EMAIL = "cliente@medconsultoria.com.br";
const REQ_ID = "e2ereqbrief00000000000000";
const FORM_ID = "e2eformbrief0000000000000";
const SVC_ID = "e2esvcbrief00000000000000";
const CS_ID = "e2ecsbrief000000000000000";
const RESET_EMAIL = "e2e-reset-fixture@example.test";
const hashToken = (raw) => createHash("sha256").update(raw).digest("hex");

async function seedBriefing() {
  const portal = await prisma.user.findFirst({ where: { email: PORTAL_EMAIL }, select: { clienteId: true } });
  if (!portal?.clienteId) throw new Error(`Cliente do Portal (${PORTAL_EMAIL}) não encontrado — rode o seed base primeiro.`);
  const clienteId = portal.clienteId;

  // Idempotente: limpa o fixture anterior (inclusive respostas) e recria.
  await prisma.formularioResposta.deleteMany({ where: { requisitoId: REQ_ID } });
  await prisma.formularioCampo.deleteMany({ where: { formularioId: FORM_ID } });
  await prisma.servicoRequisito.deleteMany({ where: { id: REQ_ID } });
  await prisma.formulario.deleteMany({ where: { id: FORM_ID } });
  await prisma.clienteServico.deleteMany({ where: { id: CS_ID } });
  await prisma.servico.deleteMany({ where: { id: SVC_ID } });

  await prisma.servico.create({ data: { id: SVC_ID, nome: "Servico E2E Briefing" } });
  await prisma.clienteServico.create({ data: { id: CS_ID, clienteId, servicoId: SVC_ID } });
  await prisma.formulario.create({ data: { id: FORM_ID, titulo: "Briefing E2E" } });
  const campos = [
    { rotulo: "Curto", tipo: "TEXTO_CURTO", opcoes: null },
    { rotulo: "Longo", tipo: "TEXTO_LONGO", opcoes: null },
    { rotulo: "Escolha", tipo: "ESCOLHA", opcoes: JSON.stringify(["A", "B"]) },
    { rotulo: "Multipla", tipo: "MULTIPLA", opcoes: JSON.stringify(["X", "Y", "Z"]) },
    { rotulo: "Numero", tipo: "NUMERO", opcoes: null },
    { rotulo: "SimNao", tipo: "SIM_NAO", opcoes: null },
    { rotulo: "Data", tipo: "DATA", opcoes: null },
  ];
  await prisma.formularioCampo.createMany({
    data: campos.map((c, i) => ({ id: `e2ec${i}`, formularioId: FORM_ID, rotulo: c.rotulo, tipo: c.tipo, ordem: i, opcoes: c.opcoes })),
  });
  await prisma.servicoRequisito.create({
    data: { id: REQ_ID, servicoId: SVC_ID, titulo: "Briefing E2E", tipo: "BRIEFING", formularioId: FORM_ID },
  });
  return REQ_ID;
}

// Dados dinâmicos p/ os testes (ids/nomes variam a cada seed — NUNCA hardcodar).
async function seedIsolamento() {
  const portal = await prisma.user.findFirst({
    where: { email: PORTAL_EMAIL },
    select: { clienteId: true, cliente: { select: { nome: true } } },
  });
  if (!portal?.clienteId) throw new Error("Cliente do Portal não encontrado.");
  const portalClienteId = portal.clienteId;
  const portalClienteNome = portal.cliente?.nome ?? "";
  const outro = await prisma.cliente.findFirst({ where: { id: { not: portalClienteId }, deletedAt: null }, select: { id: true } });
  if (!outro) throw new Error("Nenhum OUTRO cliente para testes de isolamento.");
  const outroClienteId = outro.id;
  const ator = await prisma.user.findFirst({ where: { role: { in: ["ROOT", "ADMIN"] }, ativo: true }, select: { id: true } });

  // Documento e chamado do OUTRO cliente (isolamento) — idempotentes.
  const DOC_ID = "e2edocalheio000000000000";
  const CONV_ID = "e2econvalheio00000000000";
  await prisma.documento.deleteMany({ where: { id: DOC_ID } });
  await prisma.documento.create({ data: { id: DOC_ID, clienteId: outroClienteId, titulo: "Documento E2E (alheio)", conteudo: "conteudo", status: "ENVIADO", criadoPorId: ator?.id ?? null } });
  await prisma.conversa.deleteMany({ where: { id: CONV_ID } });
  await prisma.conversa.create({ data: { id: CONV_ID, tipo: "CLIENTE", clienteId: outroClienteId, assunto: "Chamado E2E (alheio)", status: "ABERTO" } });

  // Briefing ENVIADO no OUTRO cliente, p/ a visão da EQUIPE (Bloco 7 — "Ver respostas" na ficha).
  // Fica no outro cliente (não no do Portal) para o teste da equipe não colidir com o cancelamento
  // de serviços feito pelo teste do Portal. Reusa o serviço/briefing/campos semeados em seedBriefing.
  await prisma.formularioResposta.deleteMany({ where: { clienteId: outroClienteId, requisitoId: REQ_ID } });
  await prisma.clienteServico.upsert({
    where: { clienteId_servicoId: { clienteId: outroClienteId, servicoId: SVC_ID } },
    update: { status: "ATIVO" },
    create: { clienteId: outroClienteId, servicoId: SVC_ID, status: "ATIVO" },
  });
  await prisma.formularioResposta.create({
    data: {
      formularioId: FORM_ID,
      clienteId: outroClienteId,
      requisitoId: REQ_ID,
      servicoId: SVC_ID,
      status: "ENVIADO",
      enviadoEm: new Date(),
      respostas: JSON.stringify({ e2ec0: "Resposta curta FUNC", e2ec1: "Linha A\nLinha B", e2ec2: "A", e2ec3: ["X", "Z"], e2ec4: "42", e2ec5: "Sim", e2ec6: "2026-07-20" }),
    },
  });

  return { portalClienteId, portalClienteNome, outroClienteId, outroDocId: DOC_ID, outroConversaId: CONV_ID };
}

/**
 * Projeto determinístico.
 *
 * `flows-projetos` e `responsividade` abriam "o primeiro projeto do seed" — mas nem o `db:seed`
 * nem o `db:demo` criam projetos: eles apareciam por efeito colateral de `flows-comercial`, que
 * roda antes por ordem alfabética e converte um lead. Dependência de ordem disfarçada de seed:
 * num banco recém-criado a cadeia começa vazia e 5 testes quebravam. Aqui o projeto passa a
 * existir sempre, independente de quais specs rodem ou em que ordem.
 */
async function seedProjeto() {
  const PRJ_ID = "e2eprojetofixture0000000";
  const cliente = await prisma.cliente.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (!cliente) throw new Error("Nenhum cliente para ancorar o projeto de fixture.");
  const dono = await prisma.user.findFirst({ where: { role: { in: ["ROOT", "ADMIN"] }, ativo: true }, select: { id: true } });

  await prisma.card.deleteMany({ where: { projetoId: PRJ_ID } });
  await prisma.projeto.deleteMany({ where: { id: PRJ_ID } });
  await prisma.projeto.create({
    data: {
      id: PRJ_ID,
      nome: "Projeto E2E (fixture)",
      clienteId: cliente.id,
      status: "ATIVO",
      responsavelId: dono?.id ?? null,
    },
  });
  return PRJ_ID;
}

/**
 * A conversa da caixa na ficha do cliente (ADR-97). Só linhas de banco: a ficha resolve o vínculo
 * por JOIN no endereço e **nunca** abre o IMAP, então host inválido e `segredo` de mentira bastam
 * (nada aqui é decifrado — se um dia for, este fixture quebra alto, e é o que se quer).
 *
 * A caixa é da ADMIN, não do FUNCIONARIO: `email.spec.ts` afirma que a tela de e-mail do
 * funcionário ainda convida a "plugar a primeira caixa", e plugar uma aqui derrubaria aquele teste.
 */
async function seedEmailDaCaixaNaFicha() {
  const CAIXA_ID = "e2ecaixaficha000000000000";
  const PASTA_ID = "e2epastafichainbox0000000";
  const CLIENTE_ID = "e2eclienteemail000000000";
  // Cliente PRÓPRIO, com e-mail de DOMÍNIO EXTERNO: o do seed é `@medconsultoria.com.br`, e desde
  // a trava do ADR-97 endereço do nosso domínio nunca vira chave do JOIN (era por ele que se lia a
  // caixa de um colega). Cliente de verdade tem e-mail de fora — a fixture reflete isso.
  const enderecoDoCliente = "contato@cliente-e2e.test";

  const dona = await prisma.user.findFirst({
    where: { email: "thais.garcia@medconsultoria.com.br" },
    select: { id: true, nome: true, email: true },
  });
  if (!dona) throw new Error("ADMIN thais.garcia não encontrada — rode o seed base primeiro.");

  await prisma.cliente.upsert({
    where: { id: CLIENTE_ID },
    update: { email: enderecoDoCliente, deletedAt: null },
    create: { id: CLIENTE_ID, nome: "Cliente E2E (e-mail na ficha)", email: enderecoDoCliente },
  });

  // Idempotente: apagar a caixa leva pastas, mensagens e endereços em cascata.
  await prisma.caixaEmail.deleteMany({ where: { id: CAIXA_ID } });
  await prisma.caixaEmail.create({
    data: {
      id: CAIXA_ID,
      userId: dona.id,
      email: dona.email,
      nomeExibicao: dona.nome,
      imapHost: "imap.invalido.test",
      smtpHost: "smtp.invalido.test",
      usuario: dona.email,
      segredo: "e2e-nunca-decifrado",
      pastas: { create: { id: PASTA_ID, caminho: "INBOX", nome: "Caixa de entrada", papel: "INBOX" } },
    },
  });

  const mensagem = (id, uid, assunto, trecho, particular) => ({
    id,
    caixaId: CAIXA_ID,
    pastaId: PASTA_ID,
    uid,
    messageId: `<${id}@e2e.test>`,
    deNome: "Cliente E2E",
    deEmail: enderecoDoCliente,
    assunto,
    trecho,
    dataEm: new Date(),
    particular,
    // Corpo já em cache e mensagem lida: com `corpoEm` preenchido, abrir a mensagem em `/email`
    // é consulta de banco pura — sem isso o e2e precisaria de um servidor IMAP de verdade.
    lido: true,
    corpoTexto: trecho,
    corpoEm: new Date(),
    enderecos: {
      create: [
        { papel: "DE", endereco: enderecoDoCliente, nome: "Cliente E2E" },
        { papel: "PARA", endereco: dona.email },
      ],
    },
  });

  await prisma.emailMensagem.create({
    data: mensagem("e2emsgficha00000000000000", 9001n, "Contrato para revisar (E2E)", "segue o contrato para a sua revisão", false),
  });
  // Nasce fora da ficha: é a prova de que a válvula filtra na consulta, e não só na tela.
  await prisma.emailMensagem.create({
    data: mensagem("e2emsgparticular000000000", 9002n, "Conversa particular (E2E)", "assunto pessoal", true),
  });
  return CLIENTE_ID;
}

async function seedReset() {
  const user = await prisma.user.upsert({
    where: { email: RESET_EMAIL },
    update: { ativo: true, deletedAt: null },
    create: { email: RESET_EMAIL, nome: "Reset E2E", passwordHash: "dummy", role: "FUNCIONARIO", ativo: true },
  });
  await prisma.token.deleteMany({ where: { userId: user.id } });
  const rawValid = randomBytes(24).toString("hex");
  const rawExpired = randomBytes(24).toString("hex");
  await prisma.token.create({ data: { tokenHash: hashToken(rawValid), tipo: "RESET", userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
  await prisma.token.create({ data: { tokenHash: hashToken(rawExpired), tipo: "RESET", userId: user.id, expiresAt: new Date(Date.now() - 3600_000) } });
  return { rawValid, rawExpired };
}

async function main() {
  const briefingReqId = await seedBriefing();
  const iso = await seedIsolamento();
  const projetoId = await seedProjeto();
  const emailClienteId = await seedEmailDaCaixaNaFicha();
  const reset = await seedReset();
  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync(
    "e2e/.auth/fixtures.json",
    JSON.stringify(
      { briefingReqId, ...iso, projetoId, emailClienteId, resetRawValid: reset.rawValid, resetRawExpired: reset.rawExpired },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
  console.log("✓ fixtures E2E semeadas (briefing + isolamento + projeto + e-mail na ficha + reset) → e2e/.auth/fixtures.json");
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
