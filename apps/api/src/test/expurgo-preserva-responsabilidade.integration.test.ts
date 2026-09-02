import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { expurgarDadosVencidos } from "../modules/sistema/retencao.service.js";

/**
 * O EXPURGO NÃO PODE APAGAR A PROVA DE QUEM FEZ O QUÊ.
 *
 * O `ActivityLog` era a única tabela sem teto, e pôr um teto nele estava certo. Apagar tudo, não:
 * algumas ações são a **única** prova de responsabilidade que o sistema guarda.
 *
 * ⚠️ O caso que fecha o argumento apareceu na mesma rodada que criou o problema (ADR-148): a
 * correção do link de assinatura passou a registrar `documento.link_de_assinatura_aberto`
 * **justamente** para o dia em que uma assinatura for contestada — e o expurgo novo apagaria
 * essa linha em 180 dias. Contrato se guarda por anos: a prova evaporaria antes da pergunta.
 *
 * ⚠️ E o prazo herdado é `retencaoCorpoEmailDias`, cujo rótulo na tela fala de **e-mail**. Quem
 * apertasse aquele campo para 30 dias destruiria cinco meses de trilha de auditoria sem nunca
 * ler a palavra "atividade". Por isso a régua é uma LISTA de ações preservadas, não um prazo.
 */

const PFX = `expurgo-${randomBytes(4).toString("hex")}`;
const ANTIGO = new Date("2020-01-01T12:00:00Z");

/** Uma ação que é prova de responsabilidade e uma que é ruído de operação — as duas velhas. */
const PRESERVAR = ["painel_cliente.entrou", "documento.link_de_assinatura_aberto", "arquivo.removido", "conta.criada"];
const APAGAR = ["login.bloqueado_no_navegador", "login.falhou"];

beforeAll(async () => {
  const url = process.env["DATABASE_URL"] ?? "";
  expect(url).toContain("_test");

  for (const acao of [...PRESERVAR, ...APAGAR]) {
    await prisma.activityLog.create({
      data: { acao, entidadeTipo: "teste", entidadeId: PFX, createdAt: ANTIGO, dados: { pfx: PFX } },
    });
  }
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { entidadeId: PFX } });
  await prisma.$disconnect();
});

const acoesRestantes = async () =>
  (await prisma.activityLog.findMany({ where: { entidadeId: PFX }, select: { acao: true } })).map((l) => l.acao);

describe("expurgo de retenção", () => {
  it("apaga o ruído de operação vencido", async () => {
    await expurgarDadosVencidos();
    const restam = await acoesRestantes();
    for (const acao of APAGAR) {
      expect(restam, `${acao} é ruído de operação e devia ter saído`).not.toContain(acao);
    }
  });

  it("PRESERVA quem entrou no Portal do cliente, quem abriu link de assinatura, quem removeu documento e quem criou cobrança", async () => {
    await expurgarDadosVencidos();
    const restam = await acoesRestantes();
    for (const acao of PRESERVAR) {
      expect(
        restam,
        `${acao} é a única prova de responsabilidade que existe para esse ato — apagá-la é anti-forense por rotina agendada`,
      ).toContain(acao);
    }
  });
});
