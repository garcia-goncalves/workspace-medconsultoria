import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EQUIPE_REAL } from "@app/db";

const raiz = resolve(__dirname, "../../../..");

/**
 * Sem ROOT e ADMIN ninguém entra na aplicação depois de zerar o banco. A limpeza já apagou
 * essas contas uma vez — estes testes travam a regressão.
 */
describe("contas reais da equipe", () => {
  it("cobre ROOT e ADMIN", () => {
    // Cobertura (não contagem fixa): precisa haver ao menos um ROOT e um ADMIN na equipe real.
    const papeis = EQUIPE_REAL.map((m) => m.role);
    expect(papeis).toContain("ROOT");
    expect(papeis).toContain("ADMIN");
  });

  it("os e-mails batem com os documentados em docs/ACESSOS.md", () => {
    const doc = readFileSync(resolve(raiz, "docs/ACESSOS.md"), "utf8");
    for (const membro of EQUIPE_REAL) {
      expect(doc, `${membro.emailPadrao} não está documentado`).toContain(membro.emailPadrao);
    }
  });

  it("nenhuma senha fica no repositório — vêm todas do ambiente", () => {
    const seed = readFileSync(resolve(raiz, "packages/db/prisma/seed.ts"), "utf8");
    const config = readFileSync(resolve(raiz, "packages/db/src/seed-config.ts"), "utf8");
    expect(seed).toContain("SEED_ROOT_PASSWORD");
    // Comentário explicando de onde vem a senha é OK; senha ATRIBUÍDA como literal, não.
    for (const fonte of [seed, config]) {
      expect(fonte).not.toMatch(/(senha|password\w*)\s*[:=]\s*["'`][^"'`]+["'`]/i);
    }
  });

  it("a limpeza PRESERVA a equipe real (senão ninguém entra depois de zerar)", () => {
    const limpeza = readFileSync(resolve(raiz, "scripts/limpar-dados.ts"), "utf8");
    // O filtro tem de ser por e-mail da equipe, não por papel: apagar "role <> 'ROOT'"
    // levava o ADMIN junto — foi exatamente o que aconteceu em 20/07/2026.
    expect(limpeza).toContain("EMAILS_EQUIPE");
    expect(limpeza).not.toContain(`DELETE FROM User WHERE role <> 'ROOT'`);
  });
});
