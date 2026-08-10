import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { gradeDoCliente } from "../modules/servicos/credenciamento-grade.service.js";
import { removerProfissional } from "../modules/servicos/credenciamento.service.js";

/**
 * O QUE ESTÁ EM CURSO NÃO PODE SUMIR DA TELA.
 *
 * `removerProfissional` desativa (em vez de apagar) um médico que tem credenciamento
 * justamente para **preservar** o andamento e o elo com a cobrança. Mas a grade só listava
 * profissionais ativos, então o efeito real era o oposto do pretendido: o médico saía da
 * lista e levava junto os cruzamentos dele — inclusive um APROVADO, cuja conta a receber
 * continuava viva no Financeiro sem nada na ficha que a explicasse.
 *
 * O cabeçalho do card ("1 de 5 aprovado(s) · em curso R$ 12.500,00") conta as células, não
 * as linhas desenhadas: o placar acusava um aprovado que não existia em lugar nenhum da tela.
 */

const PFX = `gradevis-${randomBytes(4).toString("hex")}`;
let clienteId: string;
let ativoId: string;
let desativadoId: string;
let operadoraId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const cliente = await prisma.cliente.create({ data: { nome: `${PFX}-clinica`, tipo: "PJ" } });
  clienteId = cliente.id;

  const [a, d] = await Promise.all([
    prisma.profissional.create({ data: { clienteId, nome: `${PFX}-ativo`, conselho: "CRM" } }),
    prisma.profissional.create({ data: { clienteId, nome: `${PFX}-saiu`, conselho: "CRM" } }),
  ]);
  ativoId = a.id;
  desativadoId = d.id;

  const op = await prisma.operadora.create({ data: { nome: `${PFX}-operadora`, ordem: 999 } });
  operadoraId = op.id;
});

afterAll(async () => {
  await prisma.credenciamento.deleteMany({ where: { clienteId } });
  await prisma.profissional.deleteMany({ where: { clienteId } });
  await prisma.operadora.deleteMany({ where: { id: operadoraId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("a grade não esconde credenciamento de médico desativado", () => {
  it("o médico desativado continua na grade, marcado como fora da lista", async () => {
    await prisma.credenciamento.create({
      data: { clienteId, profissionalId: desativadoId, operadoraId, valor: 2500, status: "APROVADO" },
    });

    // Desativa pelo caminho real da tela — que escolhe desativar por HAVER credenciamento.
    const r = await removerProfissional(desativadoId);
    expect(r.desativado, "quem tem credenciamento é desativado, não apagado").toBe(true);

    const grade = await gradeDoCliente(clienteId);
    const linha = grade.profissionais.find((p) => p.id === desativadoId);
    expect(linha, "o médico desativado com credenciamento continua na grade").toBeTruthy();
    expect(linha?.ativo, "e aparece marcado como desativado, para a Thaís entender por que ele está ali").toBe(false);
  });

  it("médico desativado SEM credenciamento nenhum não volta para a grade", async () => {
    const limpo = await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-limpo`, conselho: "CRM", ativo: false },
    });
    const grade = await gradeDoCliente(clienteId);
    expect(grade.profissionais.some((p) => p.id === limpo.id), "sem processo em curso, não há o que mostrar").toBe(false);
  });

  it("toda célula do cliente tem uma linha de médico para ser desenhada", async () => {
    const grade = await gradeDoCliente(clienteId);
    const comLinha = new Set(grade.profissionais.map((p) => p.id));
    const orfas = grade.celulas.filter((c) => !comLinha.has(c.profissionalId));
    expect(orfas, "célula sem médico na grade é credenciamento invisível na tela").toHaveLength(0);
  });

  it("o médico ativo continua vindo em primeiro, e a ordem é por nome", async () => {
    await prisma.credenciamento.create({
      data: { clienteId, profissionalId: ativoId, operadoraId, valor: 1000 },
    });
    const grade = await gradeDoCliente(clienteId);
    expect(grade.profissionais[0]?.id, "quem está na ativa aparece antes de quem saiu").toBe(ativoId);
  });
});
