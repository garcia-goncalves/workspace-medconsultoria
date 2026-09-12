import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { listarPreferenciasEmail } from "../modules/notificacoes/notificacoes.service.js";
import { config } from "../config.js";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";

/**
 * QUEM RECEBE O E-MAIL DE "LEAD NOVO" (ADR-134).
 *
 * O lead nasce SEM responsável, então o sistema avisa todo mundo que poderia atender: um
 * e-mail para cada ADMIN/ROOT ativo — quatro contas em produção. Com lead real chegando todo
 * dia isso vira ruído, e equipe que para de ler ruído para de ler também o que importa.
 *
 * Contra o MySQL de verdade porque o que se prova aqui é a LEITURA: que a listagem busca o
 * papel e o e-mail da pessoa no banco e aplica a mesma régua do envio. A régua em si é pura e
 * está coberta em `preferencia-de-email.test.ts`; o que typecheck não prova é o `select`.
 */

const PFX = `pref-${randomBytes(4).toString("hex")}`;
const criados: string[] = [];
let sistemaCriadoAqui = false;
let sistemaId = "";

async function criarUsuario(nome: string, email: string, role: "ADMIN" | "ROOT") {
  const u = await prisma.user.create({ data: { nome, email, role, ativo: true } });
  criados.push(u.id);
  return u;
}

let admin: { id: string };
let rootNominal: { id: string };

beforeAll(async () => {
  exigirBancoDeTeste();
  admin = await criarUsuario(`${PFX} admin`, `${PFX}-admin@example.test`, "ADMIN");
  rootNominal = await criarUsuario(`${PFX} root`, `${PFX}-root@example.test`, "ROOT");

  // A conta de sistema é identificada pelo ENDEREÇO, então o teste precisa dela de verdade.
  const existente = await prisma.user.findFirst({
    where: { email: config.ROOT_PROTEGIDO_EMAIL },
    select: { id: true },
  });
  if (existente) {
    sistemaId = existente.id;
  } else {
    const u = await prisma.user.create({
      data: { nome: "Root de sistema", email: config.ROOT_PROTEGIDO_EMAIL, role: "ROOT", ativo: true },
    });
    sistemaId = u.id;
    sistemaCriadoAqui = true;
  }
});

afterAll(async () => {
  const ids = [...criados, ...(sistemaCriadoAqui ? [sistemaId] : [])];
  await prisma.preferenciaEmail.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

function acharLeadNovo(lista: Array<{ tipo: string; ativo: boolean }>) {
  return lista.find((c) => c.tipo === "lead_novo");
}

describe("lead novo — quem nasce recebendo o e-mail", () => {
  it("o ADMIN nasce recebendo, sem configurar nada", async () => {
    const lista = await listarPreferenciasEmail(admin.id, "ADMIN");
    expect(acharLeadNovo(lista)?.ativo).toBe(true);
  });

  it("o ROOT nominal NÃO nasce recebendo — vê pelo sininho e liga se quiser", async () => {
    const lista = await listarPreferenciasEmail(rootNominal.id, "ROOT");
    expect(acharLeadNovo(lista)?.ativo).toBe(false);
  });

  it("mas o ROOT que LIGA na tela passa a receber", async () => {
    await prisma.preferenciaEmail.upsert({
      where: { userId_tipo: { userId: rootNominal.id, tipo: "lead_novo" } },
      create: { userId: rootNominal.id, tipo: "lead_novo", ativo: true },
      update: { ativo: true },
    });
    const lista = await listarPreferenciasEmail(rootNominal.id, "ROOT");
    expect(acharLeadNovo(lista)?.ativo).toBe(true);
  });

  it("a conta de sistema não recebe NADA, nem com a preferência ligada à mão", async () => {
    await prisma.preferenciaEmail.upsert({
      where: { userId_tipo: { userId: sistemaId, tipo: "lead_novo" } },
      create: { userId: sistemaId, tipo: "lead_novo", ativo: true },
      update: { ativo: true },
    });
    const lista = await listarPreferenciasEmail(sistemaId, "ROOT");
    expect(lista.every((c) => c.ativo === false)).toBe(true);
    await prisma.preferenciaEmail.deleteMany({ where: { userId: sistemaId } });
  });
});

describe("os outros avisos não mudaram", () => {
  it("o ROOT continua nascendo com os demais avisos ligados", async () => {
    const lista = await listarPreferenciasEmail(rootNominal.id, "ROOT");
    const outros = lista.filter((c) => c.tipo !== "lead_novo");
    expect(outros.length).toBeGreaterThan(10);
    expect(outros.every((c) => c.ativo)).toBe(true);
  });

  it("toda categoria devolvida traz o grupo, que a tela usa para as seções", async () => {
    const lista = await listarPreferenciasEmail(admin.id, "ADMIN");
    expect(lista.every((c) => typeof c.grupo === "string" && c.grupo.length > 0)).toBe(true);
  });
});
