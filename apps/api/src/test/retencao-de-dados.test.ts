import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataLimiteDeGuarda, CORPO_EXPURGADO } from "@app/shared";

describe("prazo de guarda (ADR-141)", () => {
  it("180 dias atrás é 180 dias atrás", () => {
    const agora = new Date("2026-08-28T12:00:00Z");
    const limite = dataLimiteDeGuarda(180, agora);
    expect(Math.round((agora.getTime() - limite.getTime()) / 86400000)).toBe(180);
  });

  it("o texto no lugar do corpo EXPLICA — vazio pareceria defeito", () => {
    expect(CORPO_EXPURGADO).toMatch(/removido/i);
    expect(CORPO_EXPURGADO).toMatch(/prazo/i);
  });
});

describe("o expurgo", () => {
  const svc = readFileSync(resolve(__dirname, "../modules/sistema/retencao.service.ts"), "utf8");
  const server = readFileSync(resolve(__dirname, "../server.ts"), "utf8");

  it("apaga o CORPO e guarda o metadado — o monitor de e-mails depende dele", () => {
    expect(svc).toContain("corpo: CORPO_EXPURGADO");
    expect(svc).not.toMatch(/emailEnviado\.deleteMany/);
  });

  it("lê o prazo do banco, não de uma constante — prazo é decisão de negócio", () => {
    expect(svc).toContain("retencaoCorpoEmailDias");
  });

  it("não expurga duas vezes a mesma linha — senão varre a tabela inteira todo dia", () => {
    expect(svc).toContain("not: CORPO_EXPURGADO");
  });

  it("roda sozinho no boot: a hospedagem não tem agendador (mesmo molde do email-anexo)", () => {
    expect(svc).toContain("setInterval");
    expect(svc).toContain("unref");
    expect(server).toContain("iniciarExpurgoDeRetencao");
  });
});
