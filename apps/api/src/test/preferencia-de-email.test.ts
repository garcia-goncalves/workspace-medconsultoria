import { describe, it, expect } from "vitest";
import {
  EMAIL_CATEGORIAS,
  EMAIL_GRUPOS,
  decidirEmailOperacional,
  ehContaDeSistema,
  emailLigadoPorPadrao,
  type DecisaoDeEmail,
} from "@app/shared";

/**
 * A régua de "este aviso vira e-mail para esta pessoa?" — ADR-134.
 *
 * O que motivou: um lead novo disparava e-mail para CADA ADMIN/ROOT ativo (4 contas em
 * produção). O lead nasce sem responsável, então o sistema avisa todo mundo que poderia
 * atender. Com lead real chegando todo dia isso vira ruído — e equipe que para de ler o
 * ruído para de ler também o que importa.
 */

const SISTEMA = "root@medconsultoria.com.br";

function base(over: Partial<DecisaoDeEmail> = {}): DecisaoDeEmail {
  return {
    tipo: "lead_novo",
    role: "ADMIN",
    email: "thais.garcia@medconsultoria.com.br",
    ativo: true,
    excluido: false,
    preferencia: null,
    emailDoSistema: SISTEMA,
    ...over,
  };
}

describe("a conta de sistema nunca recebe e-mail operacional", () => {
  it("reconhece o endereço mesmo com maiúscula e espaço em volta", () => {
    expect(ehContaDeSistema("  ROOT@MedConsultoria.com.BR ", SISTEMA)).toBe(true);
    expect(ehContaDeSistema("thiago.garcia@medconsultoria.com.br", SISTEMA)).toBe(false);
    expect(ehContaDeSistema(null, SISTEMA)).toBe(false);
  });

  it("recusa mesmo quando a pessoa LIGOU a preferência à mão", () => {
    expect(decidirEmailOperacional(base({ email: SISTEMA, role: "ROOT", preferencia: true }))).toBe(false);
  });

  it("não confunde um endereço que apenas CONTÉM o do sistema", () => {
    expect(ehContaDeSistema("nao-root@medconsultoria.com.br", SISTEMA)).toBe(false);
    expect(ehContaDeSistema("root@medconsultoria.com.br.evil.com", SISTEMA)).toBe(false);
  });
});

describe("lead novo: nasce ligado para ADMIN, desligado para ROOT", () => {
  it("ADMIN recebe sem precisar configurar nada", () => {
    expect(decidirEmailOperacional(base({ role: "ADMIN" }))).toBe(true);
  });

  it("ROOT nominal NÃO recebe por padrão — vê pelo sininho", () => {
    expect(decidirEmailOperacional(base({ role: "ROOT", email: "thiago.garcia@medconsultoria.com.br" }))).toBe(false);
  });

  it("mas o ROOT pode LIGAR na tela, e aí recebe", () => {
    expect(
      decidirEmailOperacional(base({ role: "ROOT", email: "thiago.garcia@medconsultoria.com.br", preferencia: true })),
    ).toBe(true);
  });

  it("e o ADMIN pode DESLIGAR na tela, e aí não recebe", () => {
    expect(decidirEmailOperacional(base({ role: "ADMIN", preferencia: false }))).toBe(false);
  });

  it("o padrão de outros avisos não mudou — ligado para todo mundo", () => {
    expect(emailLigadoPorPadrao("proposta_aceita", "ROOT")).toBe(true);
    expect(emailLigadoPorPadrao("conta_vencida", "ROOT")).toBe(true);
    expect(emailLigadoPorPadrao("incidente", "ROOT")).toBe(true);
  });
});

describe("as travas que já existiam continuam valendo", () => {
  it("conta desativada, excluída, sem e-mail ou anonimizada não recebe", () => {
    expect(decidirEmailOperacional(base({ ativo: false }))).toBe(false);
    expect(decidirEmailOperacional(base({ excluido: true }))).toBe(false);
    expect(decidirEmailOperacional(base({ email: null }))).toBe(false);
    expect(decidirEmailOperacional(base({ email: "deleted+abc@medconsultoria.com.br" }))).toBe(false);
  });

  it("tipo que não é categoria de e-mail nunca vira e-mail", () => {
    expect(decidirEmailOperacional(base({ tipo: "senha_reset", preferencia: true }))).toBe(false);
  });
});

describe("o catálogo de categorias se mantém íntegro", () => {
  it("toda categoria declara um grupo conhecido", () => {
    for (const c of EMAIL_CATEGORIAS) {
      expect(EMAIL_GRUPOS, `categoria ${c.tipo}`).toContain(c.grupo);
    }
  });

  it("não há tipo repetido", () => {
    const tipos = EMAIL_CATEGORIAS.map((c) => c.tipo);
    expect(new Set(tipos).size).toBe(tipos.length);
  });
});
