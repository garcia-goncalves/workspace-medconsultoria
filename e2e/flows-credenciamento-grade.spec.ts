import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * A GRADE médico × operadora pela INTERFACE (ADR-104, spec §5.4 e §6.4).
 *
 * Prova o caminho inteiro que a Thaís percorre: montar o preço por cruzamento no construtor
 * da proposta, ver a proposta sair fiel ao papel dela (numerada), acompanhar o andamento na
 * ficha do cliente e — só na aprovação da operadora — a cobrança aparecer no Financeiro.
 *
 * O que este teste protege, e nenhum teste de unidade protege: que a grade que a tela desenha
 * é a mesma que o servidor grava, e que aprovar cria a conta **uma vez**.
 */

test.use({ storageState: "e2e/.auth/admin.json" });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4310";
const RUN = `GRD${Date.now().toString().slice(-6)}`;

type PlaywrightFixture = { request: { newContext: (o: Record<string, unknown>) => Promise<APIRequestContext> } };

/** Chama um procedure tRPC autenticado como ROOT (montagem de cenário, não é o que se testa). */
async function comoRoot(playwright: PlaywrightFixture) {
  return playwright.request.newContext({ baseURL: BASE, storageState: "e2e/.auth/root.json" });
}

async function chamar<T>(ctx: APIRequestContext, rota: string, json: unknown): Promise<T> {
  const r = await ctx.post(`/trpc/${rota}`, { data: { json } });
  expect(r.status(), `${rota} respondeu ${r.status()}`).toBe(200);
  const body = (await r.json()) as { result: { data: { json: T } } };
  return body.result.data.json;
}

/** Query tRPC (GET) — usada só para conferir o efeito no Financeiro. */
async function consultar<T>(ctx: APIRequestContext, rota: string, json: unknown): Promise<T> {
  const r = await ctx.get(`/trpc/${rota}?input=${encodeURIComponent(JSON.stringify({ json }))}`);
  expect(r.status(), `${rota} respondeu ${r.status()}`).toBe(200);
  const body = (await r.json()) as { result: { data: { json: T } } };
  return body.result.data.json;
}

test("grade médico × operadora: monta o preço, gera a proposta numerada e cobra só na aprovação", async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  const root = await comoRoot(playwright);

  const cliente = await chamar<{ id: string }>(root, "clientes.create", {
    nome: `Clínica ${RUN}`,
    status: "ATIVO",
  });
  const medico = await chamar<{ id: string }>(root, "credenciamento.criarProfissional", {
    clienteId: cliente.id,
    nome: `Dr. Teste ${RUN}`,
    conselho: "CRM",
    especialidade: "cardiologista",
    anoFormatura: 2010,
    tituloEspecialista: true,
    responsavelTecnico: true,
  });
  const operadora = await chamar<{ id: string; nome: string }>(root, "documentos.operadoras.criar", {
    nome: `Operadora ${RUN}`,
  });

  try {
    // ── 1. O construtor da proposta mostra a GRADE, não "valor por operadora" ───────────
    await page.goto("/documentos");
    await page.getByRole("button", { name: "Novo documento" }).click();
    const d = page.getByRole("dialog");
    await d.getByPlaceholder("Escolha o tipo de documento…").fill("credenciamento");
    await page.getByRole("option", { name: /Proposta de credenciamento/ }).click();
    // O campo aceita cliente E lead desde a ADR-132, então o texto de dentro dele mudou:
    // "Buscar cliente ou lead…" na proposta, "Buscar cliente…" nos documentos de pós-venda.
    await d.getByPlaceholder(/Buscar cliente/).fill(`Clínica ${RUN}`);
    await page.getByRole("option", { name: `Clínica ${RUN}` }).click();

    // UMA operadora por proposta (ADR-126): escolhe-se a operadora e, só então, os médicos
    // que entram NESTA proposta. A grade médico × operadora do cliente não mudou — o que se
    // recorta aqui é o documento.
    await expect(d.getByText("Operadora desta proposta", { exact: false })).toBeVisible({ timeout: 15_000 });
    await d.locator("#cred-operadora").selectOption({ label: operadora.nome });
    await expect(d.getByText(`Dr. Teste ${RUN}`)).toBeVisible();

    // Valor padrão preenche o médico que for marcado — é o atalho do dia a dia.
    await d.getByLabel("Valor padrão por credenciamento").fill("2.000,00");
    await d.getByRole("checkbox").first().check();
    await d.getByRole("checkbox", { checked: true }).first().waitFor();

    // O total ao vivo confirma que o médico entrou com o valor padrão, naquela operadora.
    await expect(d.getByText(/1 médico\(s\) em /)).toBeVisible();

    await d.getByRole("button", { name: /Gerar (documento|proposta)/i }).click();

    // ── 2. A proposta sai numerada e fiel ao papel ─────────────────────────────────────
    await expect(page).toHaveURL(/\/documentos\/[a-z0-9]+/i, { timeout: 20_000 });
    const corpo = page.locator("body");
    await expect(corpo).toContainText("DESCRIÇÃO DA PROPOSTA", { timeout: 15_000 });
    await expect(corpo).toContainText("Plano de Trabalho");
    await expect(corpo).toContainText("somente no sucesso");
    await expect(corpo).toContainText("Confidencialidade");
    // Numeração: quatro dígitos, continuando a contagem da Thaís (0225 em diante).
    await expect(corpo).toContainText(/\b0[2-9]\d{2}\b|\b[1-9]\d{3}\b/);

    // ── 3. A ficha do cliente acompanha o andamento ────────────────────────────────────
    await page.goto(`/clientes/${cliente.id}`);
    await expect(page.getByRole("heading", { name: /Credenciamentos em andamento/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("A protocolar", { exact: true })).toBeVisible();

    // ── 4. Só a APROVAÇÃO cria a cobrança ─────────────────────────────────────────────
    const contasDesteCliente = async () => {
      const r = await consultar<{ id: string; descricao: string }[] | { itens: { id: string; descricao: string }[] }>(
        root,
        "financeiro.contas.list",
        {},
      );
      const lista = Array.isArray(r) ? r : (r.itens ?? []);
      return lista.filter((c) => c.descricao.includes(RUN));
    };
    expect(await contasDesteCliente(), "nada cobrado antes de a operadora aprovar").toHaveLength(0);

    await page.getByRole("button", { name: "Atualizar" }).first().click();
    const dialogo = page.getByRole("dialog");
    await dialogo.getByLabel("Como está agora? *").selectOption("PROTOCOLADO");
    await dialogo.getByRole("button", { name: "Salvar" }).click();
    // `exact` porque a linha também escreve "protocolado em 10/08/2026" logo acima do selo.
    await expect(page.getByText("Protocolado", { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Atualizar" }).first().click();
    await page.getByRole("dialog").getByLabel("Como está agora? *").selectOption("APROVADO");
    // O aviso tem de dizer, antes de clicar, que aquilo vira dinheiro.
    await expect(page.getByRole("dialog").getByText(/entra no Financeiro como conta a receber/)).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Aprovado", { exact: true })).toBeVisible({ timeout: 15_000 });

    const cobradas = await contasDesteCliente();
    expect(cobradas, "a aprovação da operadora cria exatamente uma conta a receber").toHaveLength(1);
    expect(cobradas[0]!.descricao).toContain("Credenciamento aprovado");
  } finally {
    // Limpa o cenário. A operadora NÃO sai: há credenciamento registrado nela e a FK é
    // `Restrict` — de propósito (ADR-104). A recusa aqui é o comportamento correto aparecendo;
    // o banco isolado deste teste é descartado no fim da rodada.
    await chamar(root, "clientes.remove", { id: cliente.id }).catch(() => {});
    await root.post("/trpc/credenciamento.removerProfissional", { data: { json: { id: medico.id } } });
    await root.post("/trpc/documentos.operadoras.remover", { data: { json: { id: operadora.id } } });
    await root.dispose();
  }
});
