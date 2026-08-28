import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { createUsuario, convidarUsuario, updateUsuario } from "../modules/usuarios/usuarios.service.js";
import { revogarAcessoDaPessoa } from "../modules/portal/pessoas.service.js";
import { aceitarConvite } from "../modules/auth/auth.service.js";
import { excluirDefinitivoCliente } from "../modules/clientes/clientes.service.js";
import { criarToken } from "../lib/tokens.js";

/**
 * AS TRAVAS QUE A AUDITORIA DE 28/08/2026 ENCONTROU ABERTAS.
 *
 * Todas nasceram do mesmo padrão: uma regra construída com cuidado numa tela, e uma SEGUNDA
 * porta para o mesmo dado que não passava por ela. Este arquivo é a prova de que as portas
 * agora dão no mesmo lugar.
 */

const PFX = `audit-${randomBytes(4).toString("hex")}`;
let clienteId: string;
let rootId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const cliente = await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } });
  clienteId = cliente.id;
  const root = await prisma.user.create({
    data: { nome: `${PFX}-root`, email: `${PFX}-root@teste.local`, role: "ROOT" },
  });
  rootId = root.id;
});

afterAll(async () => {
  await prisma.token.deleteMany({ where: { user: { email: { startsWith: PFX } } } });
  await prisma.session.deleteMany({ where: { user: { email: { startsWith: PFX } } } });
  await prisma.activityLog.deleteMany({ where: { user: { email: { startsWith: PFX } } } });
  await prisma.suporteMensagem.deleteMany({ where: { clienteId } });
  await prisma.credenciamento.deleteMany({ where: { clienteId } });
  await prisma.profissional.deleteMany({ where: { clienteId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
});

describe("papel no Portal — a tela interna da Med não cria mais assinante por descuido", () => {
  it("a PRIMEIRA pessoa da clínica nasce RESPONSAVEL; a segunda nasce EQUIPE", async () => {
    const primeira = await createUsuario("ADMIN", {
      nome: `${PFX}-dono`,
      email: `${PFX}-dono@teste.local`,
      senha: "SenhaBoa!2026",
      role: "CLIENTE",
      clienteId,
    });
    const p1 = await prisma.user.findUnique({ where: { id: primeira.id }, select: { papelPortal: true } });
    expect(p1?.papelPortal).toBe("RESPONSAVEL");

    const segunda = await convidarUsuario("ADMIN", {
      nome: `${PFX}-secretaria`,
      email: `${PFX}-secretaria@teste.local`,
      role: "CLIENTE",
      clienteId,
    });
    const p2 = await prisma.user.findUnique({
      where: { id: segunda.usuario.id },
      select: { papelPortal: true },
    });
    // ANTES: nulo — e nulo vale como RESPONSAVEL, ou seja, a secretária assinava contrato.
    expect(p2?.papelPortal).toBe("EQUIPE");
  });

  it("desativar o ÚNICO responsável pela tela interna é recusado", async () => {
    const dono = await prisma.user.findFirstOrThrow({ where: { email: `${PFX}-dono@teste.local` } });
    await expect(
      updateUsuario(rootId, "ROOT", { id: dono.id, ativo: false }),
    ).rejects.toThrow(/pelo menos um responsável/i);
  });
});

describe("acesso revogado não volta por um link antigo", () => {
  it("revogar apaga o convite em voo, e aceitá-lo é recusado", async () => {
    const dono = await prisma.user.findFirstOrThrow({ where: { email: `${PFX}-dono@teste.local` } });
    const secretaria = await prisma.user.findFirstOrThrow({
      where: { email: `${PFX}-secretaria@teste.local` },
    });

    // Um convite legítimo, ainda válido, na caixa da pessoa.
    const token = await criarToken(secretaria.id, "CONVITE", 72 * 60 * 60 * 1000);

    await revogarAcessoDaPessoa({ clienteId, pessoaId: secretaria.id, autorId: dono.id });

    expect(await prisma.token.count({ where: { userId: secretaria.id, usedAt: null } })).toBe(0);
    // Segunda tranca: mesmo que um token escapasse, aceitar não reabre a conta.
    await expect(aceitarConvite(token, "OutraSenha!2026")).rejects.toThrow();
    const depois = await prisma.user.findUnique({
      where: { id: secretaria.id },
      select: { ativo: true, acessoRevogadoEm: true },
    });
    expect(depois?.ativo).toBe(false);
    expect(depois?.acessoRevogadoEm).not.toBeNull();
  });
});

describe("exclusão definitiva de cliente — a lista de vínculos cobre o que o banco apaga em cascata", () => {
  it("bloqueia quando há médico cadastrado, credenciamento ou histórico de suporte", async () => {
    // Um cliente "limpo" pelos 10 vínculos antigos, mas com os três que faltavam.
    const outro = await prisma.cliente.create({ data: { nome: `${PFX}-so-cascata` } });
    const medico = await prisma.profissional.create({
      data: { clienteId: outro.id, nome: `${PFX}-medico`, conselho: "CRM" },
    });
    const op = await prisma.operadora.create({ data: { nome: `${PFX}-op`, ordem: 998 } });
    await prisma.credenciamento.create({
      data: { clienteId: outro.id, profissionalId: medico.id, operadoraId: op.id, tentativa: 1 },
    });

    await expect(excluirDefinitivoCliente(outro.id, rootId)).rejects.toThrow(
      /médicos cadastrados|credenciamentos/i,
    );

    // Ainda está lá — nada foi apagado em cascata pelas costas.
    expect(await prisma.profissional.count({ where: { clienteId: outro.id } })).toBe(1);
    expect(await prisma.credenciamento.count({ where: { clienteId: outro.id } })).toBe(1);

    await prisma.credenciamento.deleteMany({ where: { clienteId: outro.id } });
    await prisma.profissional.deleteMany({ where: { clienteId: outro.id } });
    await prisma.operadora.delete({ where: { id: op.id } });
    await prisma.cliente.delete({ where: { id: outro.id } });
  });
});
