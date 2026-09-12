import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { createUsuario, updateUsuario } from "../modules/usuarios/usuarios.service.js";
import { criarChamado, sendMensagem } from "../modules/mensagens/mensagens.service.js";

/**
 * TRABALHO INVISÍVEL — o que acontece e ninguém fica sabendo.
 *
 * Aqui mora a metade que faltava do C8: desativar uma conta do Portal pela tela interna
 * (*Equipe e acessos*) marcava `ativo = false` e nada mais.
 */

const PFX = `invis-${randomBytes(4).toString("hex")}`;
let clienteId: string;
let rootId: string;
let donoId: string;
let secretariaId: string;
let operadorId: string;

beforeAll(async () => {
  exigirBancoDeTeste();
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } })).id;
  rootId = (
    await prisma.user.create({ data: { nome: `${PFX}-root`, email: `${PFX}-root@teste.local`, role: "ROOT" } })
  ).id;
  donoId = (
    await createUsuario("ADMIN", {
      nome: `${PFX}-dono`,
      email: `${PFX}-dono@teste.local`,
      senha: "SenhaBoa!2026",
      role: "CLIENTE",
      clienteId,
    })
  ).id;
  operadorId = (
    await prisma.user.create({
      data: { nome: `${PFX}-operador`, email: `${PFX}-operador@teste.local`, role: "ADMIN" },
    })
  ).id;
  secretariaId = (
    await createUsuario("ADMIN", {
      nome: `${PFX}-secretaria`,
      email: `${PFX}-secretaria@teste.local`,
      senha: "SenhaBoa!2026",
      role: "CLIENTE",
      clienteId,
    })
  ).id;
});

afterAll(async () => {
  await prisma.emailEnviado.deleteMany({ where: { para: { startsWith: PFX } } });
  await prisma.mensagem.deleteMany({ where: { conversa: { clienteId } } });
  await prisma.conversaParticipante.deleteMany({ where: { conversa: { clienteId } } });
  await prisma.conversa.deleteMany({ where: { clienteId } });
  await prisma.token.deleteMany({ where: { user: { email: { startsWith: PFX } } } });
  await prisma.session.deleteMany({ where: { user: { email: { startsWith: PFX } } } });
  await prisma.activityLog.deleteMany({ where: { user: { email: { startsWith: PFX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
});

describe("M8 — a equipe responde o chamado e o cliente fica sabendo", () => {
  it("a resposta da equipe sai por e-mail para quem tem acesso ao Portal da clínica", async () => {
    const chamado = await criarChamado(secretariaId, clienteId, `${PFX}-duvida`, "NORMAL");
    await sendMensagem(chamado.id, "Bom dia, preciso de ajuda com o envio.", secretariaId);

    const antes = await prisma.emailEnviado.count({
      where: { template: "suporte_resposta", para: { startsWith: PFX } },
    });
    expect(antes).toBe(0); // cliente escrevendo não gera aviso de resposta

    await sendMensagem(chamado.id, "Claro! Já separamos a lista para você.", operadorId);

    const avisos = await prisma.emailEnviado.findMany({
      where: { template: "suporte_resposta", para: { startsWith: PFX } },
      select: { para: true },
    });
    const destinos = avisos.map((a) => a.para).sort();
    // Vai para as contas do Portal daquela clínica — nunca de volta para a equipe.
    expect(destinos).toEqual([`${PFX}-dono@teste.local`, `${PFX}-secretaria@teste.local`]);
  });
});

describe("C8 — desativar pela tela interna marca o acesso como REVOGADO", () => {
  it("`ativo: false` sozinho é ambíguo: sem a marca, a pessoa vira 'convidado, ainda não entrou'", async () => {
    await updateUsuario(rootId, "ROOT", { id: secretariaId, ativo: false });
    const depois = await prisma.user.findUnique({
      where: { id: secretariaId },
      select: { ativo: true, acessoRevogadoEm: true },
    });
    expect(depois?.ativo).toBe(false);
    expect(depois?.acessoRevogadoEm).not.toBeNull();
  });

  it("reativar apaga a marca — senão a conta viva continuaria contada como revogada", async () => {
    await updateUsuario(rootId, "ROOT", { id: secretariaId, ativo: true });
    const depois = await prisma.user.findUnique({
      where: { id: secretariaId },
      select: { ativo: true, acessoRevogadoEm: true },
    });
    expect(depois?.ativo).toBe(true);
    expect(depois?.acessoRevogadoEm).toBeNull();
  });

  it("a trava do último responsável continua valendo (nada aqui a afrouxou)", async () => {
    await updateUsuario(rootId, "ROOT", { id: secretariaId, ativo: false });
    await expect(updateUsuario(rootId, "ROOT", { id: donoId, ativo: false })).rejects.toThrow(
      /pelo menos um responsável/i,
    );
  });
});
