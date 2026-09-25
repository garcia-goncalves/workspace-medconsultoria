import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

process.env.EMAIL_CRYPTO_KEY ??= randomBytes(32).toString("base64");
process.env.PACIENTE_CRYPTO_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@app/db");
const { appRouter } = await import("../trpc/router.js");
const { honorariosALembrar, mesesDoLembrete } = await import("../modules/conciliacao/honorario.service.js");

/**
 * O HONORÁRIO DO FATURAMENTO contra o MySQL de verdade, pelo ROUTER (Onda 2).
 *
 * Pelo `createCaller`, não pelo serviço: a trava de papel (só ADMIN lança) e a de cliente moram no
 * procedure, e chamar o serviço direto passaria verde com as duas abertas (a lição da ADR-137).
 *
 * ⚠️ ESTADO GLOBAL: a marca `ehFaturamento` é única por regra da aplicação e o serviço de
 * faturamento é achado por ela. Este arquivo desmarca os que encontrar, marca o SEU, e devolve
 * tudo como achou no `afterAll` — os testes rodam num fork só, um arquivo por vez.
 */

const SUFIXO = randomBytes(4).toString("hex");
let servicoId = "";
let marcadosAntes: string[] = [];
let clienteId = "";
let adminId = "";
let funcId = "";
let loteId = "";
let admin: ReturnType<typeof appRouter.createCaller>;
let func: ReturnType<typeof appRouter.createCaller>;

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function repasse(valor: number, dataPagamento: string | null, atendimento: string | null = "1234") {
  await prisma.repasseLinha.create({
    data: { loteId, clienteId, linha: 1, atendimento, valor, dataPagamento: dataPagamento ? d(dataPagamento) : null },
  });
}

const mesDe = async (mes: string) => (await admin.conciliacao.honorario({ clienteId })).meses.find((m) => m.mes === mes)!;

beforeAll(async () => {
  marcadosAntes = (await prisma.servico.findMany({ where: { ehFaturamento: true }, select: { id: true } })).map((s) => s.id);
  await prisma.servico.updateMany({ where: { id: { in: marcadosAntes } }, data: { ehFaturamento: false } });
  servicoId = (
    await prisma.servico.create({
      data: { nome: `Faturamento hon ${SUFIXO}`, valor: null, percentual: 9, percentualRecorrencia: "MENSAL", ehFaturamento: true },
    })
  ).id;

  const a = await prisma.user.create({ data: { nome: `Admin hon ${SUFIXO}`, email: `adm-hon-${SUFIXO}@teste.local`, role: "ADMIN", ativo: true } });
  const f = await prisma.user.create({ data: { nome: `Func hon ${SUFIXO}`, email: `func-hon-${SUFIXO}@teste.local`, role: "FUNCIONARIO" } });
  adminId = a.id;
  funcId = f.id;
  clienteId = (await prisma.cliente.create({ data: { nome: `Clínica hon ${SUFIXO}`, responsavelId: funcId, situacaoComercial: "ATIVO" } })).id;
  // ⚠️ O percentual é o da CONTRATAÇÃO (5%), não o do catálogo (9%) — o teste prova qual vale.
  await prisma.clienteServico.create({
    data: { clienteId, servicoId, percentual: 5, contratadoEm: new Date("2026-01-10T12:00:00Z") },
  });
  loteId = (
    await prisma.producaoLote.create({
      data: { clienteId, competencia: "2026-06", origem: "REPASSE_TASY", nomeArquivo: "r.csv", formato: "csv", hashArquivo: "0".repeat(64), status: "IMPORTADO" },
    })
  ).id;
  await repasse(1000, "2026-05-10");
  await repasse(250.5, "2026-05-28");
  await repasse(100, "2026-05-20", null); // incremento/acordo: sem produção, e entra do mesmo jeito
  await repasse(2000, "2026-06-15");
  await repasse(777, null); // sem data de pagamento: fica de fora, contado à parte

  const como = (id: string, nome: string, email: string, role: "ADMIN" | "FUNCIONARIO") =>
    appRouter.createCaller({ user: { id, role, nome, email }, req: {}, res: {} } as never);
  admin = como(adminId, a.nome, a.email, "ADMIN");
  func = como(funcId, f.nome, f.email, "FUNCIONARIO");
});

afterAll(async () => {
  const contas = await prisma.honorarioFaturamento.findMany({ where: { clienteId }, select: { contaId: true } });
  await prisma.honorarioFaturamento.deleteMany({ where: { clienteId } });
  await prisma.conta.deleteMany({ where: { OR: [{ clienteId }, { id: { in: contas.map((c) => c.contaId!).filter(Boolean) } }] } });
  await prisma.notificacao.deleteMany({ where: { tipo: "honorario_a_lancar", entidadeId: { startsWith: `${clienteId}:` } } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.servico.deleteMany({ where: { id: servicoId } });
  await prisma.servico.updateMany({ where: { id: { in: marcadosAntes } }, data: { ehFaturamento: true } });
  await prisma.activityLog.deleteMany({ where: { userId: { in: [adminId, funcId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, funcId] } } });
  await prisma.$disconnect();
});

describe("o cálculo, lido pelo router", () => {
  it("base = recebido no mês do crédito (inclui o sem produção); percentual = o da contratação", async () => {
    const r = await func.conciliacao.honorario({ clienteId });
    const mai = r.meses.find((m) => m.mes === "2026-05")!;
    expect(mai.baseRecebida).toBe(1350.5);
    expect(mai.percentual).toBe(5);
    expect(mai.honorario).toBe(67.53); // 5% de 1.350,50 = 67,525 → 67,53
    expect(mai.situacao).toBe("A_LANCAR");
    expect(mai.vencimentoSugerido).toBe("2026-06-10");
    expect(r.repasseSemData).toEqual({ linhas: 1, total: 777 });
    expect(r.aLancarTotal).toBe(167.53); // 67,53 + 100,00 (5% de 2.000)
    // Decimal nunca atravessa o tRPC.
    expect(typeof mai.baseRecebida).toBe("number");
  });
});

describe("lançar", () => {
  it("funcionário vê mas NÃO lança — FORBIDDEN", async () => {
    await expect(
      func.conciliacao.lancarHonorario({ clienteId, mes: "2026-05", vencimento: "2026-06-10", valorConferido: 67.53 }),
    ).rejects.toThrow(/ADMIN/);
    expect(await prisma.honorarioFaturamento.count({ where: { clienteId } })).toBe(0);
  });

  it("valor conferido diferente do de hoje é recusado", async () => {
    await expect(
      admin.conciliacao.lancarHonorario({ clienteId, mes: "2026-05", vencimento: "2026-06-10", valorConferido: 60 }),
    ).rejects.toThrow(/mudou/);
  });

  it("dois cliques ao mesmo tempo criam UMA conta só", async () => {
    const pedido = () => admin.conciliacao.lancarHonorario({ clienteId, mes: "2026-05", vencimento: "2026-06-12", valorConferido: 67.53 });
    const r = await Promise.allSettled([pedido(), pedido()]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const contas = await prisma.conta.findMany({ where: { clienteId, origemServicoId: servicoId, deletedAt: null } });
    expect(contas).toHaveLength(1);
    const c = contas[0]!;
    expect(c.tipo).toBe("RECEBER");
    expect(c.escopo).toBe("EMPRESA");
    expect(c.recorrencia).toBe("NENHUMA");
    expect(c.valor.toNumber()).toBe(67.53);
    expect(c.descricao).toBe("Faturamento — honorário de mai/2026");
    expect(c.vencimento.toISOString().slice(0, 10)).toBe("2026-06-12");
    const cat = await prisma.categoria.findUnique({ where: { id: c.categoriaId! } });
    expect(cat?.nome).toBe("Honorários");

    const retrato = await prisma.honorarioFaturamento.findUniqueOrThrow({ where: { clienteId_mes: { clienteId, mes: "2026-05" } } });
    expect(retrato.contaId).toBe(c.id);
    expect(retrato.base.toNumber()).toBe(1350.5);
    expect(retrato.percentual.toNumber()).toBe(5);
    expect(retrato.lancadoPorId).toBe(adminId);
    expect((await mesDe("2026-05")).situacao).toBe("LANCADO");
  });

  it("lançar de novo o mesmo mês é recusado, em português", async () => {
    await expect(
      admin.conciliacao.lancarHonorario({ clienteId, mes: "2026-05", vencimento: "2026-06-10", valorConferido: 67.53 }),
    ).rejects.toThrow(/já foi lançado/);
  });

  it("a mutação fica no rastro de atividade (a régua da Conciliação)", async () => {
    await expect
      .poll(() => prisma.activityLog.count({ where: { userId: adminId, acao: "conciliacao.lancarHonorario", entidadeId: clienteId } }), {
        timeout: 5_000,
      })
      .toBeGreaterThanOrEqual(1);
  });
});

describe("depois de lançar, o repasse muda", () => {
  it("conta em aberto: divergente, e 'Atualizar valor' corrige conta e retrato", async () => {
    await repasse(200, "2026-05-30");
    const mai = await mesDe("2026-05");
    expect(mai.situacao).toBe("DIVERGENTE");
    expect(mai.honorario).toBe(77.53); // 5% de 1.550,50
    expect(mai.lancamento?.valor).toBe(67.53);

    await admin.conciliacao.atualizarHonorario({ clienteId, mes: "2026-05", valorConferido: 77.53 });
    const retrato = await prisma.honorarioFaturamento.findUniqueOrThrow({ where: { clienteId_mes: { clienteId, mes: "2026-05" } } });
    expect(retrato.valor.toNumber()).toBe(77.53);
    expect(retrato.atualizadoEm).not.toBeNull();
    expect((await prisma.conta.findUniqueOrThrow({ where: { id: retrato.contaId! } })).valor.toNumber()).toBe(77.53);
    expect((await mesDe("2026-05")).situacao).toBe("LANCADO");
  });

  it("conta PAGA: só avisa, e a rota recusa mexer no valor", async () => {
    const retrato = await prisma.honorarioFaturamento.findUniqueOrThrow({ where: { clienteId_mes: { clienteId, mes: "2026-05" } } });
    await prisma.conta.update({ where: { id: retrato.contaId! }, data: { pago: true, pagoEm: new Date() } });
    await repasse(100, "2026-05-31");
    const mai = await mesDe("2026-05");
    expect(mai.situacao).toBe("PAGO");
    expect(mai.divergiu).toBe(true);
    await expect(admin.conciliacao.atualizarHonorario({ clienteId, mes: "2026-05", valorConferido: mai.honorario! })).rejects.toThrow(
      /já foi paga/,
    );
    expect((await prisma.conta.findUniqueOrThrow({ where: { id: retrato.contaId! } })).valor.toNumber()).toBe(77.53);
  });

  it("conta excluída no Financeiro: o mês volta a 'a lançar' e pode ser relançado", async () => {
    await admin.conciliacao.lancarHonorario({ clienteId, mes: "2026-06", vencimento: "2026-07-10", valorConferido: 100 });
    const antes = await prisma.honorarioFaturamento.findUniqueOrThrow({ where: { clienteId_mes: { clienteId, mes: "2026-06" } } });
    await prisma.conta.update({ where: { id: antes.contaId! }, data: { deletedAt: new Date() } });
    const jun = await mesDe("2026-06");
    expect(jun.situacao).toBe("A_LANCAR");
    expect(jun.lancamento?.contaExcluida).toBe(true);

    await admin.conciliacao.lancarHonorario({ clienteId, mes: "2026-06", vencimento: "2026-07-10", valorConferido: 100 });
    const depois = await prisma.honorarioFaturamento.findUniqueOrThrow({ where: { clienteId_mes: { clienteId, mes: "2026-06" } } });
    expect(depois.contaId).not.toBe(antes.contaId);
    expect((await mesDe("2026-06")).situacao).toBe("LANCADO");
  });
});

describe("visão geral e lembrete", () => {
  it("a visão geral soma o honorário a lançar do cliente", async () => {
    await repasse(1000, "2026-07-05"); // julho: 5% = 50,00, a lançar
    const v = await admin.conciliacao.visaoGeral();
    const linha = v.clientes.find((c) => c.clienteId === clienteId)!;
    expect(linha.honorarioALancar).toBe(50);
    expect(v.totais.honorarioALancar).toBeGreaterThanOrEqual(50);
  });

  it("o lembrete olha só os DOIS últimos meses encerrados", async () => {
    expect(mesesDoLembrete(d("2026-09-24"))).toEqual(["2026-08", "2026-07"]);
    // Em 24/09: julho está na janela e a lançar; maio e junho já foram lançados.
    const agora = (await honorariosALembrar(d("2026-09-24"))).filter((h) => h.clienteId === clienteId);
    expect(agora.map((h) => h.mes)).toEqual(["2026-07"]);
    // Em 15/07 julho ainda está em curso, e maio/junho já não são "a lançar" — nada a avisar.
    expect((await honorariosALembrar(d("2026-07-15"))).filter((h) => h.clienteId === clienteId)).toEqual([]);
    // Mês antigo a lançar FORA da janela não é avisado.
    await repasse(500, "2026-02-10");
    expect((await honorariosALembrar(d("2026-09-24"))).filter((h) => h.clienteId === clienteId).map((h) => h.mes)).toEqual(["2026-07"]);
  });
});
