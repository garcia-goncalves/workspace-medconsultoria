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

    // ── 1. Sem cliente escolhido, a tela mostra a VISÃO GERAL de todos (Fase 2b) — ou diz que
    //       ainda não há produção nenhuma, no banco novo da CI.
    await expect(page.getByText(/visão geral — todos os clientes|nenhum cliente com produção importada/i)).toBeVisible();

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

  test("Fase 2b: valor do procedimento, repasse, glosa e exportação — pela tela", async ({ page }) => {
    // Continua do teste anterior: 2 revascularizações executadas (uma com atendimento 19100001,
    // outra sem) e 1 reservada, todas SUS. Dados SINTÉTICOS.
    await page.goto("/conciliacao");
    await escolherNoCombo(page, /cliente/i, clienteNome);
    await page.getByRole("tab", { name: /cirurgias/i }).click();

    // ── 1. O valor do procedimento vira o COBRADO ────────────────────────────────────────────
    await page.getByRole("button", { name: /procedimentos e valores/i }).click();
    const proc = page.getByRole("dialog");
    await proc.getByLabel("Valor — Padrão").first().fill("1000000"); // centavos → R$ 10.000,00
    await proc
      .getByRole("button", { name: /^salvar$/i })
      .first()
      .click();
    await expect(page.getByText(/valor salvo/i)).toBeVisible({ timeout: 15_000 });
    await proc.getByRole("button", { name: /concluído/i }).click();
    // Duas executadas × 10.000; a reservada fica fora.
    await expect(page.getByText("R$ 20.000,00").first()).toBeVisible({ timeout: 15_000 });

    // ── 2. O repasse entra: casa pelo atendimento, e o incremento aparece à parte ────────────
    await page.getByRole("button", { name: /importar repasse/i }).click();
    const rep = page.getByRole("dialog");
    await rep.locator('input[type="file"]').setInputFiles({
      name: "repasse.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "Convênio;Atend;Medico Executor;Paciente;Dt Item;Código;Descrição;Data Pagamento;Vl Repasse",
          `SUS - BP Paulista;19100001;DR. ${MEDICO.toUpperCase()};PACIENTE CIR 1 ${RUN};04/05/2026;406010935;Revasc;31/08/2026;8.000,00`,
          ";0;;;;0;INCREMENTO JULHO;31/08/2026;500,00",
        ].join("\n"),
        "utf8",
      ),
    });
    await expect(rep.getByText(/casam com cirurgias/i)).toBeVisible({ timeout: 15_000 });
    await rep.getByRole("button", { name: /^importar$/i }).click();
    await expect(page.getByText(/linha\(s\) de repasse importada/i)).toBeVisible({ timeout: 20_000 });

    // Glosa de 2.000 na cirurgia 1 (cobrado 10.000, recebido 8.000), e o incremento não sumiu.
    await expect(page.getByText("R$ 2.000,00").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /glosa parcial/i }).first()).toBeVisible();
    // ⚠️ Sem "R$" no padrão: `formatBRL` usa ESPAÇO NÃO SEPARÁVEL depois do símbolo, e o
    // Playwright normaliza espaço no texto simples mas NÃO na expressão regular — foi o que
    // reprovou este teste na 1ª rodada da CI.
    const semCirurgia = page.getByText(/de repasse sem cirurgia correspondente/i);
    await expect(semCirurgia).toBeVisible();
    await expect(semCirurgia).toContainText("500,00");

    // ── 3. Exportar: o MODELO e os dois resumos ───────────────────────────────────────────────
    const downloads: string[] = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    await page.getByRole("button", { name: /exportar planilhas/i }).click();
    await expect(page.getByText(/exportada\(s\) em 3 planilhas/i)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => downloads.length, { timeout: 10_000 }).toBe(3);
    expect(downloads.some((n) => n.startsWith("conciliacao_"))).toBe(true);

    // E nada disso trouxe o prontuário para a tela.
    expect(await page.content(), "o prontuário vazou para a tela").not.toContain("PRONTUARIO-SINTETICO");

    // ── 4. A MESMA TELA, CHEIA DE DADO, NO CELULAR ────────────────────────────────────────────
    //
    // ⚠️ A varredura de responsividade (`responsividade-total.spec.ts`) percorre `/conciliacao`
    // com a tela VAZIA — nenhum cliente escolhido, nenhuma cirurgia, nenhum modal. E o defeito
    // de layout desta casa mora justamente no oposto: a lição de 02/09 é que a régua fica verde
    // porque a CI semeia banco novo e a tela nasce sem nada. Aqui a tela está carregada de
    // verdade, então mede-se aqui.
    //
    // A conferência é a do DOCUMENTO, de propósito: a varredura do outro arquivo é que faz a
    // medição elemento a elemento (com as isenções de rolagem por desenho e texto truncado).
    // Repetir aquele motor aqui seria a mesma régua em dois lugares.
    await page.setViewportSize({ width: 360, height: 800 });
    const sobra = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await sobra(), "a tela de conciliação cheia vaza para o lado a 360px").toBeLessThanOrEqual(2);

    // Os dois modais que só existem com dado na tela — o de Ajustes já mostrou, em 11/09, que
    // modal com contador de 2 dígitos estoura a 360px sem ninguém perceber.
    for (const botao of [/procedimentos e valores/i, /^conciliar a cirurgia/i]) {
      await page.getByRole("button", { name: botao }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
      expect(await sobra(), `o modal ${String(botao)} vaza para o lado a 360px`).toBeLessThanOrEqual(2);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });

  test("Fase 2c: recorrer da glosa, registrar a resposta e recorrer de novo — pela tela", async ({ page }) => {
    await page.goto("/conciliacao");
    await escolherNoCombo(page, /cliente/i, clienteNome);
    await page.getByRole("tab", { name: /cirurgias/i }).click();

    // ⚠️ A linha da glosa precisa OFERECER o recurso: glosa sem recurso é dinheiro perdido por
    // omissão, e o botão escondido num modal seria o mesmo que não existir.
    const recorrer = page.getByRole("button", { name: /abrir recurso da glosa/i }).first();
    await expect(recorrer).toBeVisible({ timeout: 15_000 });
    await recorrer.click();

    const modal = page.getByRole("dialog");
    await expect(modal.getByText(/recurso de glosa/i).first()).toBeVisible();
    await modal.getByLabel(/por onde/i).fill("Portal da operadora");
    // ⚠️ Exato: "Data do protocolo" também casa com /protocolo/i, e o Playwright recusa os dois.
    await modal.getByLabel("Protocolo", { exact: true }).fill("PROT-E2E");
    await modal.getByLabel(/o que a operadora alegou/i).fill("OPME não autorizado");
    await modal.getByRole("button", { name: /registrar recurso/i }).click();

    // O mesmo diálogo passa a pedir a RESPOSTA — não dá para abrir dois recursos ao mesmo tempo.
    await expect(modal.getByRole("button", { name: /registrar resposta/i })).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByText(/tentativa 1/i)).toBeVisible();

    // ⚠️ Acatar NÃO dá o dinheiro por recebido — a tela precisa dizer isso, senão a conta some.
    await expect(modal.getByText(/acatado não dá o dinheiro por recebido/i)).toBeVisible();

    await modal.getByLabel(/o que a operadora respondeu/i).selectOption("NEGADO");
    await modal.getByRole("button", { name: /registrar resposta/i }).click();
    await expect(modal.getByText(/tentativa 1/i)).toBeVisible({ timeout: 15_000 });

    // Recorrer de novo é LINHA NOVA: a tentativa 1 negada continua à vista.
    await modal.getByRole("button", { name: /registrar recurso/i }).click();
    await expect(modal.getByText(/tentativa 2/i)).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByText(/tentativa 1/i)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // E a linha da tabela passou a falar do estado de agora.
    await expect(page.getByRole("button", { name: /recurso da cirurgia .* em recurso/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("fechar a competência: o mês conferido trava a edição, e reabrir devolve", async ({ page }) => {
    await page.goto("/conciliacao");
    await escolherNoCombo(page, /cliente/i, clienteNome);
    await page.getByRole("tab", { name: /cirurgias/i }).click();

    // O selo só aparece com um MÊS escolhido — fechar "todos os meses" não quer dizer nada.
    await expect(page.getByRole("button", { name: /fechar o mês/i })).toHaveCount(0);
    await page.getByLabel(/^mês$/i).selectOption({ index: 1 });

    await page.getByRole("button", { name: /fechar o mês/i }).click();
    // ⚠️ Um trecho de UM elemento: o selo é "<mês> conferido em <data> por <quem>" num <span> e o
    // "— editar … está bloqueado" em outro, e `getByText` casa dentro de um elemento só.
    await expect(page.getByText(/editar cirurgia ou recurso deste mês está bloqueado/i)).toBeVisible({ timeout: 15_000 });

    // ⚠️ O botão de editar CONTINUA na tela: a recusa explica, e tela que esconde não ensina.
    await page
      .getByRole("button", { name: /conciliar a cirurgia/i })
      .first()
      .click();
    const modal = page.getByRole("dialog");
    await modal.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/conferida e fechada/i).first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: /reabrir/i }).click();
    await expect(page.getByRole("button", { name: /fechar o mês/i })).toBeVisible({ timeout: 15_000 });
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
