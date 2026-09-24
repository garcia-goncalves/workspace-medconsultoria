import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { sendMensagem, silenciar } from "../modules/mensagens/mensagens.service.js";

/**
 * MENSAGEM INTERNA NÃO AVISAVA NINGUÉM FORA DO SISTEMA (W5, Onda 1).
 *
 * `pushParaParticipantes` só emitia socket, e em produção o tempo real é polling (Socket.IO
 * desligado) — então conversa INDIVIDUAL/GRUPO/PROJETO nunca avisava ninguém que não estivesse
 * com a tela aberta naquele segundo. Agora toda mensagem interna gera notificação de sino para
 * os outros participantes (nunca para o autor) e e-mail conforme preferência, com anti-spam de
 * 1 e-mail por conversa/destinatário a cada 30 min.
 */

const PFX = `msginterna-${randomBytes(4).toString("hex")}`;
let autorId: string;
let colegaAId: string;
let colegaBId: string;
let conversaId: string;

beforeAll(async () => {
  exigirBancoDeTeste();
  autorId = (await prisma.user.create({ data: { nome: `${PFX}-autor`, email: `${PFX}-autor@teste.local`, role: "ADMIN" } })).id;
  colegaAId = (await prisma.user.create({ data: { nome: `${PFX}-colega-a`, email: `${PFX}-colega-a@teste.local`, role: "ADMIN" } })).id;
  colegaBId = (await prisma.user.create({ data: { nome: `${PFX}-colega-b`, email: `${PFX}-colega-b@teste.local`, role: "ADMIN" } })).id;

  const conversa = await prisma.conversa.create({ data: { tipo: "GRUPO", nome: `${PFX}-grupo`, criadoPorId: autorId } });
  conversaId = conversa.id;
  await prisma.conversaParticipante.createMany({
    data: [{ conversaId, userId: autorId }, { conversaId, userId: colegaAId }, { conversaId, userId: colegaBId }],
  });
});

afterAll(async () => {
  await prisma.emailEnviado.deleteMany({ where: { para: { startsWith: PFX } } });
  await prisma.notificacao.deleteMany({ where: { user: { email: { startsWith: PFX } } } });
  await prisma.mensagem.deleteMany({ where: { conversaId } });
  await prisma.conversaParticipante.deleteMany({ where: { conversaId } });
  await prisma.conversa.deleteMany({ where: { id: conversaId } });
  await prisma.preferenciaEmail.deleteMany({ where: { user: { email: { startsWith: PFX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
});

describe("mensagem em conversa interna notifica os outros, nunca o autor", () => {
  it("cria notificação de sino para os dois colegas e nenhuma para o autor", async () => {
    await sendMensagem(conversaId, "Bom dia! Vamos alinhar a proposta hoje?", autorId);

    const doAutor = await prisma.notificacao.count({ where: { userId: autorId, tipo: "mensagem_interna", entidadeId: conversaId } });
    expect(doAutor).toBe(0);

    const doColegaA = await prisma.notificacao.findFirst({ where: { userId: colegaAId, tipo: "mensagem_interna", entidadeId: conversaId } });
    const doColegaB = await prisma.notificacao.findFirst({ where: { userId: colegaBId, tipo: "mensagem_interna", entidadeId: conversaId } });
    expect(doColegaA).not.toBeNull();
    expect(doColegaB).not.toBeNull();
    expect(doColegaA?.lida).toBe(false);
    expect(doColegaA?.titulo).toContain(`${PFX}-grupo`);
  });

  it("também manda e-mail (categoria nasce ligada) para quem não está silenciando a conversa", async () => {
    const avisos = await prisma.emailEnviado.findMany({ where: { template: "mensagem_interna", para: { startsWith: PFX } } });
    const destinos = avisos.map((a) => a.para).sort();
    expect(destinos).toEqual([`${PFX}-colega-a@teste.local`, `${PFX}-colega-b@teste.local`]);
  });
});

describe("rajada de mensagens na mesma conversa", () => {
  it("agrega no sino (1 notificação não lida, não 1 por mensagem) e manda só 1 e-mail na janela de 30 min", async () => {
    // Zera o que o teste anterior deixou, para medir só esta rajada.
    await prisma.notificacao.deleteMany({ where: { userId: colegaAId, tipo: "mensagem_interna", entidadeId: conversaId } });
    await prisma.emailEnviado.deleteMany({ where: { template: "mensagem_interna", para: `${PFX}-colega-a@teste.local` } });

    for (let i = 0; i < 5; i++) {
      await sendMensagem(conversaId, `Mensagem ${i} da rajada`, autorId);
    }

    const notificacoes = await prisma.notificacao.findMany({ where: { userId: colegaAId, tipo: "mensagem_interna", entidadeId: conversaId } });
    expect(notificacoes).toHaveLength(1);
    expect(notificacoes[0]?.titulo).toBeTruthy();

    const emails = await prisma.emailEnviado.count({ where: { template: "mensagem_interna", para: `${PFX}-colega-a@teste.local` } });
    expect(emails).toBe(1);
  });
});

describe("quem silenciou a conversa não recebe nem sino nem e-mail", () => {
  it("silenciar antes de uma mensagem nova barra as duas coisas para essa pessoa", async () => {
    await silenciar(conversaId, colegaBId, true);
    await prisma.notificacao.deleteMany({ where: { userId: colegaBId, tipo: "mensagem_interna", entidadeId: conversaId } });
    await prisma.emailEnviado.deleteMany({ where: { template: "mensagem_interna", para: `${PFX}-colega-b@teste.local` } });

    await sendMensagem(conversaId, "Mensagem depois de silenciar", autorId);

    const notif = await prisma.notificacao.count({ where: { userId: colegaBId, tipo: "mensagem_interna", entidadeId: conversaId } });
    expect(notif).toBe(0);
    const email = await prisma.emailEnviado.count({ where: { template: "mensagem_interna", para: `${PFX}-colega-b@teste.local` } });
    expect(email).toBe(0);

    await silenciar(conversaId, colegaBId, false);
  });
});
