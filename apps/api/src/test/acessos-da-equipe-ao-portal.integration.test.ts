import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import type { SessionUser } from "@app/shared";
import { appRouter } from "../trpc/router";
import { emparelharAcessos } from "../modules/portal/acessos-da-equipe.service";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste";

/**
 * "Quem da MedConsultoria entrou no meu Portal?" (onda 4C) — a clínica vê as sessões de suporte
 * (ADR-128) que a equipe abriu no Portal DELA, e só dela.
 *
 * Pelo `createCaller`, não pelo serviço: o isolamento mora no `portalProcedure` (o `clienteId`
 * vem da sessão), e um teste do serviço passaria verde com o isolamento quebrado no router.
 */

const PFX = `itacesso-${randomBytes(4).toString("hex")}`;
const ids: { clientes: string[]; users: string[] } = { clientes: [], users: [] };

const caller = (u: SessionUser) =>
  appRouter.createCaller({ user: u, req: { ip: "1.2.3.4", headers: {} }, res: {} } as never);

async function clinica(nome: string) {
  const c = await prisma.cliente.create({ data: { nome: `${PFX} ${nome}` } });
  ids.clientes.push(c.id);
  return c;
}

async function pessoa(nome: string, role: "CLIENTE" | "ADMIN", clienteId?: string, papel?: "RESPONSAVEL" | "EQUIPE") {
  const u = await prisma.user.create({
    data: { nome, email: `${PFX}-${nome.toLowerCase().replace(/\s/g, "")}@example.test`, role, clienteId, papelPortal: papel },
  });
  ids.users.push(u.id);
  const s: SessionUser = {
    id: u.id,
    nome: u.nome,
    email: u.email,
    role: u.role,
    avatarUrl: null,
    clienteId: u.clienteId,
    papelPortal: u.papelPortal,
    senhaTrocadaEm: null,
  };
  return { u, s };
}

beforeAll(() => exigirBancoDeTeste());

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { entidadeId: { in: ids.clientes } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  await prisma.cliente.deleteMany({ where: { id: { in: ids.clientes } } });
  await prisma.$disconnect();
});

describe("Portal — acessos da equipe MedConsultoria", () => {
  it("a clínica A vê só os acessos à A, com nome e duração — nunca os da clínica B", async () => {
    const a = await clinica("A");
    const b = await clinica("B");
    const { u: thais } = await pessoa("Thais Suporte", "ADMIN");
    const { s: respA } = await pessoa("Resp A", "CLIENTE", a.id, "RESPONSAVEL");
    const { s: respB } = await pessoa("Resp B", "CLIENTE", b.id, "RESPONSAVEL");

    const t0 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.activityLog.createMany({
      data: [
        { userId: thais.id, acao: "painel_cliente.entrou", entidadeTipo: "cliente", entidadeId: a.id, createdAt: t0 },
        {
          userId: thais.id,
          acao: "painel_cliente.saiu",
          entidadeTipo: "cliente",
          entidadeId: a.id,
          createdAt: new Date(t0.getTime() + 12 * 60_000),
        },
        { userId: thais.id, acao: "painel_cliente.entrou", entidadeTipo: "cliente", entidadeId: b.id, createdAt: t0 },
        // Fora da janela de 90 dias: não aparece.
        {
          userId: thais.id,
          acao: "painel_cliente.entrou",
          entidadeTipo: "cliente",
          entidadeId: a.id,
          createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        },
      ],
    });

    const vistosPorA = await caller(respA).portal.acessosDaEquipe();
    expect(vistosPorA).toHaveLength(1);
    expect(vistosPorA[0]).toMatchObject({ quem: "Thais Suporte", duracaoMinutos: 12, emAndamento: false });
    // Só o que o cliente precisa: nada de e-mail ou id da pessoa da Med.
    const texto = JSON.stringify(vistosPorA);
    expect(texto).not.toContain(thais.email);
    expect(texto).not.toContain(thais.id);

    const vistosPorB = await caller(respB).portal.acessosDaEquipe();
    expect(vistosPorB).toHaveLength(1);
    expect(vistosPorB[0]!.saiuEm).toBeNull(); // entrou e a sessão expirou sozinha
  });

  it("quem é EQUIPE da clínica (secretária) não vê a lista", async () => {
    const c = await clinica("C");
    const { s: sec } = await pessoa("Secretaria C", "CLIENTE", c.id, "EQUIPE");
    await expect(caller(sec).portal.acessosDaEquipe()).rejects.toThrow(/responsável/);
  });

  it("equipe interna não usa esta rota (é do Portal)", async () => {
    const { s: adm } = await pessoa("Admin Interno", "ADMIN");
    await expect(caller(adm).portal.acessosDaEquipe()).rejects.toThrow(/Portal do Cliente/);
  });
});

describe("emparelharAcessos (pura)", () => {
  const agora = new Date("2026-09-25T12:00:00Z");
  const t = (min: number) => new Date(agora.getTime() - min * 60_000);

  it("casa entrada e saída da mesma pessoa, do mais recente para o mais antigo", () => {
    const r = emparelharAcessos(
      [
        { acao: "painel_cliente.entrou", createdAt: t(300), userId: "u1", nome: "Ana" },
        { acao: "painel_cliente.saiu", createdAt: t(290), userId: "u1", nome: "Ana" },
        { acao: "painel_cliente.entrou", createdAt: t(100), userId: "u2", nome: "Bia" },
      ],
      agora,
    );
    expect(r.map((x) => x.quem)).toEqual(["Bia", "Ana"]);
    expect(r[1]).toMatchObject({ duracaoMinutos: 10 });
    expect(r[0]).toMatchObject({ saiuEm: null, duracaoMinutos: null, emAndamento: false });
  });

  it("marca em andamento o que entrou há menos de 30 min e não saiu", () => {
    const r = emparelharAcessos([{ acao: "painel_cliente.entrou", createdAt: t(5), userId: "u1", nome: "Ana" }], agora);
    expect(r[0]!.emAndamento).toBe(true);
  });

  it("saída muito depois (ou órfã) não inventa duração; pessoa apagada vira texto neutro", () => {
    const r = emparelharAcessos(
      [
        { acao: "painel_cliente.saiu", createdAt: t(500), userId: "u9", nome: "X" },
        { acao: "painel_cliente.entrou", createdAt: t(200), userId: null, nome: null },
        { acao: "painel_cliente.saiu", createdAt: t(100), userId: null, nome: null },
      ],
      agora,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ quem: "Alguém da equipe MedConsultoria", saiuEm: null, duracaoMinutos: null });
  });
});
