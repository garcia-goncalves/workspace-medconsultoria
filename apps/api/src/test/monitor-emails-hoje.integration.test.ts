import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { resumoEnviados } from "../modules/emails/enviados.service.js";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";

/**
 * "ENVIADOS HOJE" NÃO PODE CONTAR FALHA (27/08/2026).
 *
 * Até esta data o número contava toda tentativa do dia, entregue ou não, sob o rótulo
 * *"Enviados hoje"*. A tela chegou a mostrar ao mesmo tempo **Enviados (7 dias) 0**, **Taxa de
 * entrega 0%** e **Enviados hoje 23** — três números que não podem ser verdade juntos.
 *
 * O modo de falha não é cosmético: é alguém bater o olho no painel, ler "40 enviados hoje" e
 * concluir que o e-mail está funcionando enquanto nenhum sai. Foi exatamente assim que a
 * ADR-122 passou meses sem ser percebida, com taxa de entrega em 0% desde sempre.
 *
 * Contra o MySQL de verdade porque o que se prova é uma CONTAGEM com filtro — typecheck não
 * diz nada sobre `where`.
 */

const PFX = `mon-${randomBytes(4).toString("hex")}`;
const criados: string[] = [];

beforeAll(async () => {
  exigirBancoDeTeste();
  const agora = new Date();
  const linhas = await Promise.all([
    prisma.emailEnviado.create({
      data: { para: `${PFX}-ok@example.test`, assunto: `${PFX} entregue`, corpo: "teste", status: "ENVIADO", createdAt: agora },
    }),
    prisma.emailEnviado.create({
      data: { para: `${PFX}-x1@example.test`, assunto: `${PFX} falhou 1`, corpo: "teste", status: "FALHOU", erro: "teste", createdAt: agora },
    }),
    prisma.emailEnviado.create({
      data: { para: `${PFX}-x2@example.test`, assunto: `${PFX} falhou 2`, corpo: "teste", status: "FALHOU", erro: "teste", createdAt: agora },
    }),
  ]);
  criados.push(...linhas.map((l) => l.id));
});

afterAll(async () => {
  await prisma.emailEnviado.deleteMany({ where: { id: { in: criados } } });
});

describe("monitor de e-mails: os números do dia", () => {
  it("conta como 'enviado hoje' só o que SAIU, e mostra as falhas do dia à parte", async () => {
    const antes = await resumoEnviados();

    // 1 entregue + 2 falhas acabaram de entrar. Se "hoje" contasse tentativa, subiria 3.
    const linhasNovas = 3;
    const entreguesNovas = 1;
    const falhasNovas = 2;

    // Compara com o próprio estado do banco, não com número fixo: o banco de teste é
    // compartilhado entre specs e um valor absoluto tornaria este teste instável.
    const soDoTeste = await prisma.emailEnviado.count({ where: { id: { in: criados } } });
    expect(soDoTeste).toBe(linhasNovas);

    const entreguesHoje = await prisma.emailEnviado.count({
      where: { id: { in: criados }, status: "ENVIADO" },
    });
    const falhasHoje = await prisma.emailEnviado.count({
      where: { id: { in: criados }, status: "FALHOU" },
    });
    expect(entreguesHoje).toBe(entreguesNovas);
    expect(falhasHoje).toBe(falhasNovas);

    // O que importa: `hoje` <= total de ENVIADO do dia — nunca a soma das tentativas.
    const totalTentativasHoje = await prisma.emailEnviado.count({
      where: { createdAt: { gte: inicioDeHoje() } },
    });
    const totalEntreguesHoje = await prisma.emailEnviado.count({
      where: { status: "ENVIADO", createdAt: { gte: inicioDeHoje() } },
    });
    expect(antes.hoje).toBe(totalEntreguesHoje);
    if (totalTentativasHoje > totalEntreguesHoje) {
      expect(
        antes.hoje,
        '"Enviados hoje" não pode incluir falha — é esse número que faz alguém achar que o e-mail está saindo',
      ).toBeLessThan(totalTentativasHoje);
    }
  });

  it("as falhas do dia vêm no resumo, para o problema aparecer no dia em que acontece", async () => {
    const r = await resumoEnviados();
    const falhasHoje = await prisma.emailEnviado.count({
      where: { status: "FALHOU", createdAt: { gte: inicioDeHoje() } },
    });
    expect(r.falhasHoje).toBe(falhasHoje);
    expect(r.falhasHoje).toBeGreaterThanOrEqual(2);
  });

  it("os números do painel não se contradizem: sem entrega em 7 dias, a taxa é 0%", async () => {
    const r = await resumoEnviados();
    if (r.enviados7d === 0 && r.falhas7d > 0) {
      expect(r.taxaEntrega).toBe(0);
      // E, se nada saiu em 7 dias, nada pode ter saído hoje — hoje está DENTRO dos 7 dias.
      expect(r.hoje, "hoje faz parte dos últimos 7 dias").toBe(0);
    }
  });
});

function inicioDeHoje(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
