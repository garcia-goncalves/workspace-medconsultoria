import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { PORTAL_PRECISA_DE_UM_RESPONSAVEL } from "@app/shared";
import { hashPassword } from "../lib/password.js";
import { createSession, getUserFromSession } from "../lib/session.js";
import { garantirAcessoPortal } from "../modules/usuarios/usuarios.service.js";
import {
  listarPessoasDoPortal,
  convidarPessoaDoPortal,
  alterarPapelDaPessoa,
  revogarAcessoDaPessoa,
  devolverAcessoDaPessoa,
  reenviarConviteDaPessoa,
} from "../modules/portal/pessoas.service.js";

/**
 * VÁRIAS PESSOAS POR CLÍNICA, no Portal do Cliente (ADR-131).
 *
 * Roda contra o MySQL de VERDADE porque o que se prova aqui é **isolamento entre clínicas** e
 * **estado de conta** — as duas coisas são linha em tabela, e tipo verde não diz nada sobre
 * nenhuma delas. O modo de falha aqui não é uma tela feia: é o dono da Clínica A revogando o
 * acesso de alguém da Clínica B.
 *
 * O que estes testes guardam, e não pode regredir:
 *  1. duas pessoas da MESMA clínica convivem, cada uma com o próprio acesso;
 *  2. quem é de outra clínica é INVISÍVEL e INTOCÁVEL — nem aparece na lista, nem aceita ordem;
 *  3. a clínica nunca fica sem um responsável ativo (nem por rebaixar, nem por revogar);
 *  4. revogar DESATIVA e derruba a sessão — nunca apaga a pessoa, senão o histórico perde o
 *     nome de quem agiu;
 *  5. o mesmo e-mail não vira duas contas;
 *  6. a primeira conta da clínica nasce RESPONSAVEL.
 */

const PFX = `pes-${randomBytes(4).toString("hex")}`;
let adminId: string;
let clinicaId: string;
let outraClinicaId: string;
let donoId: string;
let outroDonoId: string;
const criados: string[] = [];

beforeAll(async () => {
  expect(process.env["DATABASE_URL"]).toContain("_test");
  const senha = await hashPassword("x");

  const admin = await prisma.user.create({
    data: { nome: `${PFX}-admin`, email: `${PFX}-a@example.test`, passwordHash: senha, role: "ADMIN" },
  });
  adminId = admin.id;

  const [c1, c2] = await Promise.all([
    prisma.cliente.create({ data: { nome: `${PFX}-clinica`, email: `${PFX}-c1@example.test`, responsavelId: adminId } }),
    prisma.cliente.create({ data: { nome: `${PFX}-outra`, email: `${PFX}-c2@example.test`, responsavelId: adminId } }),
  ]);
  clinicaId = c1.id;
  outraClinicaId = c2.id;

  await garantirAcessoPortal(clinicaId, c1.nome, c1.email, "EQUIPE");
  await garantirAcessoPortal(outraClinicaId, c2.nome, c2.email, "EQUIPE");
  const dono = await prisma.user.findFirstOrThrow({ where: { clienteId: clinicaId, role: "CLIENTE" } });
  const outro = await prisma.user.findFirstOrThrow({ where: { clienteId: outraClinicaId, role: "CLIENTE" } });
  donoId = dono.id;
  outroDonoId = outro.id;

  // Os dois donos entram de verdade: sem senha, o teste de "revogar derruba a sessão" e o de
  // "não mexo em quem é de outra clínica" provariam menos do que parecem provar.
  await prisma.user.updateMany({
    where: { id: { in: [donoId, outroDonoId] } },
    data: { passwordHash: senha, ativo: true },
  });
});

afterAll(async () => {
  const todos = [...criados, donoId, outroDonoId];
  await prisma.session.deleteMany({ where: { userId: { in: todos } } });
  await prisma.token.deleteMany({ where: { userId: { in: todos } } });
  await prisma.emailEnviado.deleteMany({ where: { userId: { in: todos } } });
  await prisma.activityLog.deleteMany({ where: { userId: { in: [adminId, ...todos] } } });
  await prisma.user.deleteMany({ where: { id: { in: todos } } });
  await prisma.cliente.deleteMany({ where: { id: { in: [clinicaId, outraClinicaId] } } });
  await prisma.user.deleteMany({ where: { id: adminId } });
});

describe("a primeira conta da clínica", () => {
  it("nasce RESPONSAVEL — senão a clínica não teria ninguém para assinar", async () => {
    const dono = await prisma.user.findFirstOrThrow({ where: { id: donoId }, select: { papelPortal: true } });
    expect(dono.papelPortal).toBe("RESPONSAVEL");
  });
});

describe("várias pessoas na mesma clínica", () => {
  it("convidar cria a conta pendente, ligada à clínica e com o papel pedido", async () => {
    const r = await convidarPessoaDoPortal({
      clienteId: clinicaId,
      nome: `${PFX} Secretária`,
      email: `${PFX}-sec@example.test`,
      papel: "EQUIPE",
      autorId: adminId,
    });
    criados.push(r.id);

    const criada = await prisma.user.findFirstOrThrow({
      where: { id: r.id },
      select: { clienteId: true, role: true, papelPortal: true, ativo: true, passwordHash: true, convidadoPorId: true },
    });
    expect(criada.clienteId).toBe(clinicaId);
    expect(criada.role).toBe("CLIENTE");
    expect(criada.papelPortal).toBe("EQUIPE");
    // Nasce pendente: conta ativa sem senha seria uma porta sem fechadura.
    expect(criada.ativo).toBe(false);
    expect(criada.passwordHash).toBeNull();
    expect(criada.convidadoPorId).toBe(adminId);
  });

  it("as duas pessoas convivem na MESMA clínica, cada uma com o seu estado", async () => {
    const lista = await listarPessoasDoPortal(clinicaId);
    expect(lista.length).toBe(2);
    const dono = lista.find((p) => p.id === donoId)!;
    const sec = lista.find((p) => p.papel === "EQUIPE")!;
    expect(dono.situacao).toBe("ATIVO");
    expect(dono.papel).toBe("RESPONSAVEL");
    expect(sec.situacao).toBe("CONVIDADO");
    expect(sec.convidadoPor).toContain("admin");
  });

  it("o mesmo e-mail não vira duas contas", async () => {
    await expect(
      convidarPessoaDoPortal({
        clienteId: clinicaId,
        nome: "Cópia",
        email: `${PFX}-sec@example.test`,
        papel: "EQUIPE",
        autorId: adminId,
      }),
    ).rejects.toThrow(/já tem acesso/i);
  });

  it("e-mail de OUTRA clínica também é recusado — o login é único no sistema todo", async () => {
    const outroEmail = (await prisma.user.findFirstOrThrow({ where: { id: outroDonoId } })).email;
    await expect(
      convidarPessoaDoPortal({ clienteId: clinicaId, nome: "X", email: outroEmail, papel: "EQUIPE", autorId: adminId }),
    ).rejects.toThrow(/outra conta/i);
  });
});

describe("isolamento entre clínicas — o que não pode acontecer nunca", () => {
  it("a lista de uma clínica NÃO traz gente da outra", async () => {
    const lista = await listarPessoasDoPortal(clinicaId);
    expect(lista.map((p) => p.id)).not.toContain(outroDonoId);
  });

  it("não dá para revogar alguém de outra clínica passando o id dele", async () => {
    await expect(
      revogarAcessoDaPessoa({ clienteId: clinicaId, pessoaId: outroDonoId, autorId: donoId }),
    ).rejects.toThrow(/não encontrada/i);
    const intacto = await prisma.user.findFirstOrThrow({
      where: { id: outroDonoId },
      select: { ativo: true, acessoRevogadoEm: true },
    });
    expect(intacto.ativo).toBe(true);
    expect(intacto.acessoRevogadoEm).toBeNull();
  });

  it("nem promover, nem reenviar convite para alguém de outra clínica", async () => {
    await expect(
      alterarPapelDaPessoa({ clienteId: clinicaId, pessoaId: outroDonoId, papel: "EQUIPE", autorId: donoId }),
    ).rejects.toThrow(/não encontrada/i);
    await expect(
      reenviarConviteDaPessoa({ clienteId: clinicaId, pessoaId: outroDonoId, autorId: donoId }),
    ).rejects.toThrow(/não encontrada/i);
  });
});

describe("a clínica nunca fica sem quem assine", () => {
  it("rebaixar o único responsável é recusado", async () => {
    await expect(
      alterarPapelDaPessoa({ clienteId: clinicaId, pessoaId: donoId, papel: "EQUIPE", autorId: adminId }),
    ).rejects.toThrow(PORTAL_PRECISA_DE_UM_RESPONSAVEL);
    const dono = await prisma.user.findFirstOrThrow({ where: { id: donoId }, select: { papelPortal: true } });
    expect(dono.papelPortal).toBe("RESPONSAVEL");
  });

  it("revogar o único responsável é recusado", async () => {
    await expect(
      revogarAcessoDaPessoa({ clienteId: clinicaId, pessoaId: donoId, autorId: adminId }),
    ).rejects.toThrow(PORTAL_PRECISA_DE_UM_RESPONSAVEL);
  });

  it("com um segundo responsável, o primeiro pode sair", async () => {
    const sec = (await listarPessoasDoPortal(clinicaId)).find((p) => p.papel === "EQUIPE")!;
    await alterarPapelDaPessoa({ clienteId: clinicaId, pessoaId: sec.id, papel: "RESPONSAVEL", autorId: adminId });
    await alterarPapelDaPessoa({ clienteId: clinicaId, pessoaId: donoId, papel: "EQUIPE", autorId: adminId });

    const depois = await listarPessoasDoPortal(clinicaId);
    expect(depois.find((p) => p.id === donoId)!.papel).toBe("EQUIPE");
    expect(depois.find((p) => p.id === sec.id)!.papel).toBe("RESPONSAVEL");

    // Devolve o mundo ao estado anterior para os testes seguintes não dependerem da ordem.
    await alterarPapelDaPessoa({ clienteId: clinicaId, pessoaId: donoId, papel: "RESPONSAVEL", autorId: adminId });
    await alterarPapelDaPessoa({ clienteId: clinicaId, pessoaId: sec.id, papel: "EQUIPE", autorId: adminId });
  });

  it("ninguém revoga o próprio acesso", async () => {
    await expect(
      revogarAcessoDaPessoa({ clienteId: clinicaId, pessoaId: donoId, autorId: donoId }),
    ).rejects.toThrow(/próprio acesso/i);
  });
});

describe("revogar tira o acesso sem apagar a pessoa", () => {
  it("desativa, derruba a sessão aberta e mantém a linha no banco", async () => {
    // Uma segunda pessoa com senha, para revogar de verdade sem esbarrar na trava do responsável.
    const medico = await convidarPessoaDoPortal({
      clienteId: clinicaId,
      nome: `${PFX} Médico`,
      email: `${PFX}-med@example.test`,
      papel: "EQUIPE",
      autorId: adminId,
    });
    criados.push(medico.id);
    await prisma.user.update({
      where: { id: medico.id },
      data: { passwordHash: await hashPassword("x"), ativo: true },
    });

    const sid = await createSession(medico.id);
    expect(await getUserFromSession(sid)).not.toBeNull();

    await revogarAcessoDaPessoa({ clienteId: clinicaId, pessoaId: medico.id, autorId: adminId });

    // A pessoa continua existindo — é ela que o histórico cita.
    const linha = await prisma.user.findFirstOrThrow({
      where: { id: medico.id },
      select: { ativo: true, deletedAt: true, acessoRevogadoEm: true },
    });
    expect(linha.ativo).toBe(false);
    expect(linha.acessoRevogadoEm).not.toBeNull();
    expect(linha.deletedAt).toBeNull();
    // E a sessão que estava aberta morreu.
    expect(await getUserFromSession(sid)).toBeNull();
    expect(await prisma.session.count({ where: { userId: medico.id } })).toBe(0);

    const lista = await listarPessoasDoPortal(clinicaId);
    expect(lista.find((p) => p.id === medico.id)!.situacao).toBe("REVOGADO");
  });

  it("devolver o acesso a quem já tinha senha reativa sem novo convite", async () => {
    const medico = (await listarPessoasDoPortal(clinicaId)).find((p) => p.situacao === "REVOGADO")!;
    const r = await devolverAcessoDaPessoa({ clienteId: clinicaId, pessoaId: medico.id, autorId: adminId });
    expect(r.emailEnviado).toBe(false);
    const lista = await listarPessoasDoPortal(clinicaId);
    expect(lista.find((p) => p.id === medico.id)!.situacao).toBe("ATIVO");
  });

  it("reenviar convite para quem já criou a senha é recusado", async () => {
    await expect(
      reenviarConviteDaPessoa({ clienteId: clinicaId, pessoaId: donoId, autorId: adminId }),
    ).rejects.toThrow(/já criou a senha/i);
  });
});
