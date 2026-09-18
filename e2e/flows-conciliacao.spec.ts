import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * CONCILIAÇÃO — o fluxo inteiro pela INTERFACE (ADR-153).
 *
 * Percorre o que a Thaís vai fazer todo mês: escolher o cliente, enviar a planilha, **conferir
 * antes de gravar**, importar, ligar o convênio que chegou novo e ver o resumo se corrigir
 * sozinho. Nenhum teste de unidade prova isso — eles provam as peças; aqui se prova a costura.
 *
 * A asserção que mais importa é a §5: **o CPF, o telefone e o e-mail do paciente não podem
 * aparecer no HTML da página**. Eles vão para o banco cifrados e não voltam pelo tRPC; se um dia
 * voltarem, é vazamento de dado pessoal de terceiro — e este teste é a última rede.
 */

test.use({ storageState: "e2e/.auth/admin.json" });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4310";
const RUN = `CNC${Date.now().toString().slice(-6)}`;

/** Dado SINTÉTICO. Estes números são inventados — nunca use amostra real num teste. */
const CPF = "123.456.789-09";
const TELEFONE = "(11) 96067-6368";
const EMAIL_PACIENTE = "paciente.sintetico@exemplo.test";
const PACIENTE = `WILMA SAVINI ${RUN}`;
const MEDICO = `Leonardo Dragone ${RUN}`;
const OPERADORA = `Porto Seguro ${RUN}`;

const CABECALHO =
  "Data da agenda;Data do atendimento;Paciente;CPF do paciente;Telefone do Paciente;E-mail;Tipo de atendimento;Plano de convênio;Profissional";

/**
 * Duas linhas com o mesmo convênio escrito em CAIXAS DIFERENTES, como no arquivo real — é assim
 * que se prova que o de-para casa por texto normalizado e não cria duas operadoras.
 */
function planilha(): Buffer {
  return Buffer.from(
    [
      CABECALHO,
      `31/08/2026;31/08/2026;${PACIENTE};${CPF};${TELEFONE};${EMAIL_PACIENTE};Consulta;PORTO SEGURO - BÁSICO;DR. ${MEDICO.toUpperCase()}`,
      `;28/08/2026;CELIA OTA ${RUN};;;;Sem vínculo com a agenda;porto seguro - básico;DR. ${MEDICO.toUpperCase()}`,
      `25/08/2026;28/08/2026;LUCAS COSTA ${RUN};;;;Cortesia;PORTO SEGURO - BÁSICO;DR. ${MEDICO.toUpperCase()}`,
    ].join("\n"),
    "utf8",
  );
}

type PlaywrightFixture = { request: { newContext: (o: Record<string, unknown>) => Promise<APIRequestContext> } };

async function comoRoot(playwright: PlaywrightFixture) {
  return playwright.request.newContext({ baseURL: BASE, storageState: "e2e/.auth/root.json" });
}

async function chamar<T>(ctx: APIRequestContext, rota: string, json: unknown): Promise<T> {
  const r = await ctx.post(`/trpc/${rota}`, { data: { json } });
  expect(r.status(), `${rota} respondeu ${r.status()}`).toBe(200);
  const body = (await r.json()) as { result: { data: { json: T } } };
  return body.result.data.json;
}

/** Escolhe no Combobox: abre, digita e clica na opção. */
async function escolherNoCombo(page: Page, nomeDoCampo: RegExp, textoDaOpcao: string) {
  // O `id` e o `role="combobox"` ficam no MESMO input, então o campo se acha pelo rótulo e se
  // digita nele direto — não há um segundo campo de busca dentro do painel.
  const combo = page.getByRole("combobox", { name: nomeDoCampo }).first();
  await combo.click();
  await combo.fill(textoDaOpcao);
  await page.getByRole("option", { name: textoDaOpcao }).first().click();
}

test.describe("Conciliação — a produção do mês entra pela tela", () => {
  let clienteId = "";
  const clienteNome = `Clinica Conciliacao ${RUN}`;

  test.beforeAll(async ({ playwright }) => {
    const root = await comoRoot(playwright as unknown as PlaywrightFixture);
    const cliente = await chamar<{ id: string }>(root, "clientes.create", { nome: clienteNome });
    clienteId = cliente.id;
    // O médico existe no cadastro com o nome SEM "DR." — é isso que o casamento automático
    // precisa reconhecer no "DR. LEONARDO..." que vem do relatório.
    await chamar(root, "credenciamento.criarProfissional", {
      clienteId,
      nome: MEDICO,
      conselho: "CRM",
    });
    await chamar(root, "documentos.operadoras.criar", { nome: OPERADORA });
    await root.dispose();
  });

  test("importar, conferir, ligar o convênio e ver o resumo fechar", async ({ page }) => {
    await page.goto("/conciliacao");
    await expect(page.getByRole("heading", { name: "Conciliação" })).toBeVisible();

    // ── 1. Sem cliente escolhido, a tela pede um em vez de mostrar tabela vazia ──────────────
    await expect(page.getByText(/escolha um cliente/i)).toBeVisible();

    await escolherNoCombo(page, /cliente/i, clienteNome);

    // ── 2. A prévia mostra o que ENTENDEU, antes de gravar ──────────────────────────────────
    await page.getByRole("button", { name: /importar produção/i }).click();
    const modal = page.getByRole("dialog");
    await expect(modal.getByText(/importar produção de consultas/i)).toBeVisible();

    await modal.locator('input[type="file"]').setInputFiles({
      name: "producao-08.csv",
      mimeType: "text/csv",
      buffer: planilha(),
    });

    // O resumo do que foi lido aparece na tela. `getByText` genérico não serve aqui: casaria o
    // <option> do <select>, que é invisível por natureza — foi o que reprovou na 1ª rodada.
    await expect(modal.getByText(/cabeçalho na linha/i)).toBeVisible({ timeout: 15_000 });
    // 3 atendimentos, formato csv detectado pelo CONTEÚDO (não pela extensão).
    await expect(modal.getByText(/formato\s+csv/i)).toBeVisible();
    // O convênio novo é anunciado ANTES de importar — e uma vez só, apesar das duas caixas.
    await expect(modal.getByText(/1 convênio/i)).toBeVisible();

    // A competência foi sugerida sozinha a partir das datas de atendimento, e o mês oferecido
    // conta os 3 (aqui é `toHaveCount`, não `toBeVisible`: <option> não é visível).
    await expect(modal.getByLabel(/competência/i)).toHaveValue("2026-08");
    await expect(modal.getByRole("option", { name: /2026-08 — 3 atendimento/ })).toHaveCount(1);

    // Nada foi gravado ainda: ATRÁS do modal, a tabela do cliente segue vazia. Este é o ponto
    // do fluxo em três passos — a prévia lê o arquivo inteiro e não toca no banco.
    await expect(page.getByText(/nenhum atendimento/i)).toHaveCount(1);

    // ── 3. Importar ─────────────────────────────────────────────────────────────────────────
    await modal.getByRole("button", { name: /^importar$/i }).click();
    await expect(page.getByText(/3 atendimento\(s\) de 2026-08 importado/i)).toBeVisible({ timeout: 20_000 });

    // ── 4. A produção aparece, e o médico foi ligado SOZINHO pelo nome ───────────────────────
    await expect(page.getByRole("cell", { name: PACIENTE })).toBeVisible();
    await expect(page.getByRole("cell", { name: MEDICO }).first()).toBeVisible();

    // ── 5. ⚠️ O DADO DO PACIENTE NÃO ESTÁ NA TELA ───────────────────────────────────────────
    // Esta é a razão de existir deste arquivo. O dado foi gravado (cifrado); o que não pode é
    // voltar. Olha o HTML inteiro, não só a tabela — um tooltip ou um atributo contariam igual.
    const html = await page.content();
    expect(html, "o CPF do paciente vazou para a tela").not.toContain(CPF);
    expect(html, "o CPF sem pontuação vazou para a tela").not.toContain("12345678909");
    expect(html, "o telefone do paciente vazou para a tela").not.toContain("96067-6368");
    expect(html, "o e-mail do paciente vazou para a tela").not.toContain(EMAIL_PACIENTE);
    expect(html, "texto cifrado vazou para a tela").not.toContain("v1:");

    // ── 6. A pendência de de-para aparece, e ligar RETROAGE ─────────────────────────────────
    await expect(page.getByText(/pendências de ligação/i)).toBeVisible();
    // As duas caixas ("PORTO SEGURO - BÁSICO" e "porto seguro - básico") são UMA pendência só.
    const pendentes = page.locator("select[aria-label^='Operadora de']");
    await expect(pendentes).toHaveCount(1);

    await pendentes.first().selectOption({ label: OPERADORA });
    await expect(page.getByText(/convênio ligado/i)).toBeVisible({ timeout: 15_000 });

    // Depois de ligar, some o aviso "(a ligar)" e a operadora aparece pelo nome do catálogo.
    await expect(page.getByText(/pendências de ligação/i)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("cell", { name: new RegExp(OPERADORA) }).first()).toBeVisible();

    // ── 7. O resumo separa o que NÃO gera recebimento ───────────────────────────────────────
    await page.getByLabel(/^competência$/i).selectOption("2026-08");
    // 3 atendimentos, sendo 1 cortesia → 2 de convênio.
    await expect(page.getByText("3", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/2 de convênio/i)).toBeVisible();

    // ── 8. O mesmo arquivo de novo é RECUSADO ───────────────────────────────────────────────
    await page.getByRole("button", { name: /importar produção/i }).click();
    const modal2 = page.getByRole("dialog");
    await modal2.locator('input[type="file"]').setInputFiles({
      name: "producao-08.csv",
      mimeType: "text/csv",
      buffer: planilha(),
    });
    await expect(modal2.getByText(/já foi importado/i)).toBeVisible({ timeout: 15_000 });
  });

  test("o card da ficha do cliente mostra o mês e leva para a tela cheia", async ({ page }) => {
    await page.goto(`/clientes/${clienteId}`);
    await expect(page.getByText(/produção de consultas/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("2026-08")).toBeVisible();

    // E aqui também não pode haver dado de paciente.
    const html = await page.content();
    expect(html, "o CPF vazou na ficha do cliente").not.toContain(CPF);
    expect(html, "o telefone vazou na ficha do cliente").not.toContain("96067-6368");
  });

  test("cirurgias do TASY: importar pela aba própria, conferir e ver o resumo", async ({ page }) => {
    // Cabeçalho idêntico ao do mapa cirúrgico real; dados SINTÉTICOS. O prontuário vai marcado
    // para provar que ele não chega à tela — ele nem é gravado (spec 2026-09-18 §2.3).
    const cab =
      '"Data";"Hora (UTC)";"Sala";"Duração prev (min)";"Paciente";"Prontuário";"Atendimento";"Nº Cirurgia";"Seq Cirurgia";"Convênio";"Tipo Conv";"Médico";"Anestesista";"Tipo Anestesia";"Procedimento";"Status";"Autorização";"Cód Aut";"Unid. Internação";"Setor";"Cód Pessoa";"OPME";"Tempo (min)";"Técnica"';
    const linha = (n: string, atend: string, status: string) =>
      [
        "2026-05-04",
        "2026-05-04T10:00:00Z",
        "Sala 08",
        "240",
        `PACIENTE CIR ${n} ${RUN}`,
        "PRONTUARIO-SINTETICO",
        atend,
        `${RUN.slice(-6)}${n}`,
        "7900000000",
        "SUS - BP Paulista",
        "3",
        `DR. ${MEDICO.toUpperCase()}`,
        "",
        "",
        "Revascularização Miocárdica",
        status,
        "Pendente de autorização",
        "PA",
        "LEITO-SINTETICO",
        "",
        "1",
        "Com OPME",
        "240",
        "Convencional",
      ]
        .map((x) => `"${x}"`)
        .join(";");
    const mapa = Buffer.from(
      [cab, linha("1", "19100001", "Executada"), linha("2", "", "Executada"), linha("3", "", "Reservada")].join("\n"),
      "utf8",
    );

    await page.goto("/conciliacao");
    await escolherNoCombo(page, /cliente/i, clienteNome);
    await page.getByRole("tab", { name: /cirurgias/i }).click();
    await expect(page.getByText(/nenhuma cirurgia importada/i)).toBeVisible();

    await page.getByRole("button", { name: /importar cirurgias/i }).click();
    const modal = page.getByRole("dialog");
    await modal.locator('input[type="file"]').setInputFiles({ name: "tasy.csv", mimeType: "text/csv", buffer: mapa });

    // A conferência diz o que vai acontecer ANTES de gravar.
    await expect(modal.getByText(/3 nova\(s\)/i)).toBeVisible({ timeout: 15_000 });
    // 2 linhas sem atendimento, mas uma é a reservada: só a executada conta (mesma régua do resumo).
    await expect(modal.getByText(/1 cirurgia\(s\) sem número de atendimento/i)).toBeVisible();
    await expect(modal.getByText(/1 cirurgia\(s\) não executada/i)).toBeVisible();

    await modal.getByRole("button", { name: /^importar$/i }).click();
    await expect(page.getByText(/3 cirurgia\(s\) nova\(s\) importada/i)).toBeVisible({ timeout: 20_000 });

    // Só as executadas contam; a reservada fica na lista, fora do total.
    // `listitem`: o toast da importação também diz "1 sem número de atendimento".
    await expect(page.getByRole("listitem").filter({ hasText: /^1 sem número de atendimento$/ })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: /^1 não executada/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: `PACIENTE CIR 1 ${RUN}` })).toBeVisible();
    // O médico foi ligado sozinho pelo nome, e o convênio novo apareceu nas pendências.
    await expect(page.getByRole("cell", { name: MEDICO }).first()).toBeVisible();
    await expect(page.locator("select[aria-label='Operadora de SUS - BP Paulista']")).toHaveCount(1);

    const html = await page.content();
    expect(html, "o prontuário vazou para a tela").not.toContain("PRONTUARIO-SINTETICO");
    expect(html, "o leito vazou para a tela").not.toContain("LEITO-SINTETICO");
  });

  test("arquivo que não é o relatório é recusado com recado em português", async ({ page }) => {
    await page.goto("/conciliacao");
    await escolherNoCombo(page, /cliente/i, clienteNome);
    await page.getByRole("button", { name: /importar produção/i }).click();

    const modal = page.getByRole("dialog");
    await modal.locator('input[type="file"]').setInputFiles({
      name: "outra-coisa.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Nome;Valor\nabc;123", "utf8"),
    });

    // Não é "erro inesperado": diz o que o arquivo precisa ter.
    await expect(page.getByText(/não reconheci este arquivo/i)).toBeVisible({ timeout: 15_000 });
  });
});
