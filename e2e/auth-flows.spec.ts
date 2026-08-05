import { test, expect } from "@playwright/test";

// Sem senha embutida: o valor vem do ambiente (ver e2e/auth.setup.ts e playwright.config.ts).
const PASS: string = process.env.E2E_PASSWORD ?? "";
if (!PASS) throw new Error("Sem senha para os testes: defina SEED_ROOT_PASSWORD no .env (ou E2E_PASSWORD no ambiente).");

test.describe("Auth — login inválido", () => {
  test("mostra erro e permanece no login", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("naoexiste@example.test");
    await page.locator('input[type="password"]').fill("senha-errada");
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  // O navegador autopreenche contas antigas. Sem ver QUAL e-mail foi enviado, a pessoa jura
  // que digitou o certo e fica presa em "senha incorreta" — foi exatamente o que aconteceu
  // depois da limpeza de dados, com o Chrome repondo uma conta que não existe mais.
  test("o erro mostra qual e-mail foi tentado (denuncia autofill de conta antiga)", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("conta-antiga@example.test");
    await page.locator('input[type="password"]').fill(PASS);
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page.getByRole("alert")).toContainText("conta-antiga@example.test");
    await expect(page.getByRole("alert")).toContainText(/navegador pode ter preenchido outro/i);
  });
});

// Trocar de conta: `/login` com sessão ativa REDIRECIONAVA em silêncio para o painel. Quem já
// estava logado nunca via o formulário — voltava ao painel ainda como o usuário anterior e
// concluía que a segunda conta não funcionava. Foi o que travou o dono em 20/07/2026.
// BUG-008: o autofill do Chrome escreve o valor direto no DOM SEM disparar o evento que o
// react-hook-form escuta. O formulário enviava o que o React lembrava — vazio ("E-mail
// inválido") ou uma conta antiga — enquanto a tela mostrava o e-mail certo. Deixou o dono
// sem conseguir entrar nem como ROOT nem como ADMIN.
test.describe("Auth — autofill do navegador", () => {
  for (const conta of ["root@medconsultoria.com.br", "thais.garcia@medconsultoria.com.br"]) {
    test(`entra quando o navegador autopreenche (sem evento de input) — ${conta}`, async ({ page }) => {
      await page.goto("/login");
      await expect(page.locator('input[type="password"]')).toBeVisible();

      // Reproduz o autofill: setter nativo, sem `dispatchEvent`. É o que o Chrome faz.
      await page.evaluate(
        ([email, senha]) => {
          const nativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
          nativo.call(document.querySelector("#email"), email);
          nativo.call(document.querySelector('input[type="password"]'), senha);
        },
        [conta, PASS],
      );

      await page.getByRole("button", { name: /entrar/i }).click();

      // Entrou de verdade: o formulário sumiu e não há alerta de erro.
      await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 15000 });
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  }
});

test.describe("Auth — trocar de conta", () => {
  // NÃO reutiliza `admin.json` (mesma razão do bloco de logout abaixo): estes testes DESLOGAM,
  // e derrubar a sessão compartilhada trava toda a suíte. Cada teste faz o próprio login.
  async function entrar(page: import("@playwright/test").Page, email: string) {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASS);
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 15000 });
  }

  test("/login com sessão ativa mostra quem está conectado, não redireciona calado", async ({ page }) => {
    await entrar(page, "thais.garcia@medconsultoria.com.br");

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /Você já está conectado/i })).toBeVisible();
    // Precisa dizer QUEM — é o que se confere ao trocar de conta.
    await expect(page.getByText("thais.garcia@medconsultoria.com.br")).toBeVisible();
    await expect(page.getByRole("button", { name: /Entrar com outra conta/i })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/); // não foi expulso para "/"
  });

  test("'Entrar com outra conta' devolve o formulário e o login leva ao painel", async ({ page }) => {
    await entrar(page, "thais.garcia@medconsultoria.com.br");

    await page.goto("/login");
    await page.getByRole("button", { name: /Entrar com outra conta/i }).click();

    // Voltou ao formulário de verdade.
    const senha = page.locator('input[type="password"]');
    await expect(senha).toBeVisible({ timeout: 15000 });

    await page.locator('input[type="email"]').fill("root@medconsultoria.com.br");
    await senha.fill(PASS);
    await page.getByRole("button", { name: /entrar/i }).click();

    // Cai no painel — e NÃO de volta em "Você já está conectado".
    await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: /Você já está conectado/i })).toHaveCount(0);
  });
});

test.describe("Auth — logout", () => {
  // NÃO reutiliza a sessão compartilhada (admin.json): faz login PRÓPRIO para não invalidar
  // a sessão usada pelos outros testes ao deslogar (isolamento).
  test("sai da conta e volta ao login", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("thais.garcia@medconsultoria.com.br");
    await page.locator('input[type="password"]').fill(PASS);
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 15000 });

    await page.locator("aside").getByRole("button").last().click();
    await page.getByRole("button", { name: /sair da conta/i }).click();
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 15000 });
  });
});
