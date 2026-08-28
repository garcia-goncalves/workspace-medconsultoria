import { test, expect, type APIRequestContext } from "@playwright/test";
import { lerFixtures } from "./fixtures-helper";

/**
 * Credenciamento no Portal (spec §8): a papelada REPETE por médico.
 *
 * O que este teste protege: numa lista corrida, uma clínica com dois profissionais entrega
 * o diploma de um só e a tela diz "tudo enviado". Aqui cada médico tem o próprio bloco e a
 * barra conta PARES (documento × médico × lado) — entregar metade tem de mostrar metade.
 *
 * Os dois médicos são criados pela EQUIPE (contexto admin) e lidos pelo CLIENTE, que é
 * quem enxerga o Portal. Nada de id hardcodado: tudo vem da fixture.
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4310";

const NOMES = ["Dra. Carina Teste", "Dr. Marcos Teste"];

type PlaywrightFixture = { request: { newContext: (o: Record<string, unknown>) => Promise<APIRequestContext> } };

async function criarDoisMedicos(playwright: PlaywrightFixture, clienteId: string) {
  const admin = await playwright.request.newContext({
    baseURL: BASE,
    storageState: "e2e/.auth/root.json",
  });
  const criados: string[] = [];
  for (const [i, nome] of NOMES.entries()) {
    const r = await admin.post("/trpc/credenciamento.criarProfissional", {
      data: {
        json: {
          clienteId,
          nome,
          conselho: "CRM",
          especialidade: i === 0 ? "Cardiologista" : "Ortopedista",
          anoFormatura: 2010,
          tituloEspecialista: true,
          responsavelTecnico: i === 0,
        },
      },
    });
    expect(r.status(), "criar profissional pela equipe").toBe(200);
    const body = (await r.json()) as { result: { data: { json: { id: string } } } };
    criados.push(body.result.data.json.id);
  }
  return { admin, criados };
}

test.describe("credenciamento no Portal", () => {
  test("cada médico tem o próprio bloco e a barra conta pares", async ({ playwright, browser }) => {
    const { portalClienteId } = lerFixtures();
    const { admin, criados } = await criarDoisMedicos(playwright, portalClienteId);

    try {
      const ctx = await browser.newContext({ storageState: "e2e/.auth/cliente.json" });
      const page = await ctx.newPage();
      await page.goto("/portal/credenciamento"); // a papelada do credenciamento tem seção própria

      const secao = page.getByRole("heading", { name: /Documentos do credenciamento/i });
      await expect(secao).toBeVisible();

      // Dois blocos, um por médico — é o ponto do teste.
      for (const nome of NOMES) {
        await expect(page.getByText(nome, { exact: false })).toBeVisible();
      }

      // A conta é por par: 3 documentos do profissional × frente e verso × 2 médicos = 12
      // vagas só das pessoas, além das da empresa/clínica. Nada de "12 de 3".
      const contador = page.getByText(/Faltam \d+ de \d+/);
      await expect(contador).toBeVisible();
      const texto = (await contador.textContent()) ?? "";
      const total = Number(/de (\d+)/.exec(texto)?.[1] ?? "0");
      expect(total, "o total tem de incluir as vagas dos DOIS médicos").toBeGreaterThanOrEqual(12);

      await ctx.close();
    } finally {
      // Limpa o que este teste criou, para não sujar a próxima rodada.
      for (const id of criados) {
        await admin.post("/trpc/credenciamento.removerProfissional", { data: { json: { id } } });
      }
      await admin.dispose();
    }
  });

  test("enviar um documento move a barra", async ({ playwright, browser }) => {
    const { portalClienteId } = lerFixtures();
    const { admin, criados } = await criarDoisMedicos(playwright, portalClienteId);

    try {
      const ctx = await browser.newContext({ storageState: "e2e/.auth/cliente.json" });
      const page = await ctx.newPage();
      await page.goto("/portal/credenciamento"); // a papelada do credenciamento tem seção própria

      const contador = page.getByText(/Faltam \d+ de \d+/);
      await expect(contador).toBeVisible();
      const faltamAntes = Number(/Faltam (\d+)/.exec((await contador.textContent()) ?? "")?.[1] ?? "0");
      expect(faltamAntes).toBeGreaterThan(0);

      // "Enviar" seco só existe nas vagas do credenciamento (as outras seções do Portal
      // dizem "Enviar documento"/"Enviar um documento"), então não precisa escopo de seção
      // — que é justamente o que deixaria este teste frágil. O input é irmão do botão.
      const botao = page.getByRole("button", { name: /^Enviar$/ }).first();
      await botao.locator('xpath=preceding-sibling::input[@type="file"]').setInputFiles({
        name: "alvara.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 teste de credenciamento"),
      });

      await expect(page.getByText(new RegExp(`Faltam ${faltamAntes - 1} de`))).toBeVisible({ timeout: 15_000 });

      await ctx.close();
    } finally {
      for (const id of criados) {
        await admin.post("/trpc/credenciamento.removerProfissional", { data: { json: { id } } });
      }
      await admin.dispose();
    }
  });
});
