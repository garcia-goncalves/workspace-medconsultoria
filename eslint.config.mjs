// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

/**
 * ESLint 9 (flat config) para o monorepo. Foco em BUGS REAIS (não formatação — isso é do
 * Prettier). Régua pragmática por instrução explícita do dono ("configure ESLint/Prettier" +
 * "evite reformas cosméticas desnecessárias"): pega erro, não reforma estilo.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/*.d.ts",
      "packages/db/prisma/migrations/**",
      ".playwright-mcp/**",
      "apps/api/dist/**",
      "apps/web/dist/**",
      "**/coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/ban-ts-comment": ["warn", { "ts-expect-error": "allow-with-description", "ts-ignore": "allow-with-description" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // DESLIGADA de propósito, RATIFICADO PELO DONO em 19/08/2026. Ela acusava 46 avisos em
      // 13 arquivos e nenhum era erro: são o idioma que esta base escolheu — `useAuth` ao lado
      // do `AuthProvider`, `useConfirm` ao lado do diálogo, `toast` ao lado do componente,
      // `buttonVariants` ao lado do `Button` (padrão shadcn). Separar isso em 13 arquivos novos
      // seria mexer na arquitetura para agradar a uma regra que só afeta o Fast Refresh em
      // desenvolvimento — não a correção, não o build, não a produção.
      //
      // O que se ganhou desligando: com 46 avisos permanentes na saída, o aviso 47 — que pode
      // ser real — passava despercebido. Zerada a saída, o `lint` roda com `--max-warnings 0`
      // e qualquer aviso NOVO reprova. Se um dia a base deixar de co-locar hook com
      // componente, religue esta regra.
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["apps/api/**/*.ts", "packages/**/*.ts", "scripts/**/*.{js,mjs}", "*.{js,mjs,ts}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/e2e/**"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  prettier,
);
