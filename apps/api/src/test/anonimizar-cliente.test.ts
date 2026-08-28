import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MARCADOR_ANONIMIZADO, emailAnonimizado } from "@app/shared";

describe("anonimização do cliente (ADR-141)", () => {
  it("o marcador diz POR QUE o dado sumiu — 'null' pareceria defeito", () => {
    expect(MARCADOR_ANONIMIZADO).toMatch(/removido/i);
    expect(MARCADOR_ANONIMIZADO).toMatch(/titular/i);
  });

  it("o e-mail de quem saiu é único e INVÁLIDO — endereço plausível voltaria a receber e-mail", () => {
    expect(emailAnonimizado("abc")).not.toBe(emailAnonimizado("xyz"));
    expect(emailAnonimizado("abc")).toContain("@invalido.local");
  });
});

describe("as travas da anonimização", () => {
  const svc = readFileSync(resolve(__dirname, "../modules/clientes/anonimizar.service.ts"), "utf8");
  const router = readFileSync(resolve(__dirname, "../modules/clientes/clientes.router.ts"), "utf8");

  it("é ação de ROOT, como a exclusão definitiva", () => {
    expect(router).toMatch(/anonimizar:\s*rootProcedure/);
  });

  it("exige o cliente ARQUIVADO antes — anonimizar quem está em contrato quebraria a operação", () => {
    expect(svc).toContain("deletedAt");
    expect(svc).toMatch(/Arquive/);
  });

  it("recusa repetir — já anonimizado não tem o que remover", () => {
    expect(svc).toContain("anonimizadoEm");
  });

  it("alcança TODAS as tabelas com dado de pessoa, não só a ficha", () => {
    for (const tabela of ["contato", "user", "profissional", "cliente"]) {
      expect(svc, `faltou ${tabela}`).toContain(`prisma.${tabela}.`);
    }
  });

  it("derruba o acesso ao Portal junto — deixar a conta viva seria dado removido com porta aberta", () => {
    expect(svc).toContain("acessoRevogadoEm");
    expect(svc).toContain("prisma.session.deleteMany");
  });

  it("o acervo vencido é AVISADO, nunca apagado — apagar o diploma de um médico é irreversível", () => {
    expect(svc).toContain("acervoVencido");
    expect(svc).not.toMatch(/arquivo\.deleteMany/);
  });

  it("fica registrado quem fez e quando", () => {
    expect(svc).toContain("cliente.anonimizado");
    expect(svc).toContain("anonimizadoPorId");
  });
});

describe("credenciamento reaberto cobra de novo — e a tela avisa (ADR-141)", () => {
  const ler = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

  it("a decisão está escrita onde alguém iria 'consertar' — a tentativa nova NÃO herda a conta", () => {
    const svc = ler("../modules/servicos/credenciamento-grade.service.ts");
    expect(svc).toMatch(/NÃO HERDA `contaId`/);
    // a criação da tentativa nova não copia contaId da anterior
    expect(svc).not.toMatch(/contaId:\s*anterior\.contaId/);
  });

  it("o aviso só aparece quando a tentativa anterior REALMENTE cobrou", () => {
    const ui = ler("../../../web/src/features/crm/clientes/CredenciamentoGradeCard.tsx");
    expect(ui).toContain("{celula.contaId && (");
    expect(ui).toMatch(/Isto vai cobrar de novo/);
  });
});
