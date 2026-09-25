import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { SEM_CATEGORIA } from "@app/shared";

// Import dinâmico (depois do `env` do vitest) — mesmo molde de `conciliacao-acesso.integration`.
const { prisma } = await import("@app/db");
const { appRouter } = await import("../trpc/router.js");
const { financeiroRouter } = await import("../modules/financeiro/financeiro.router.js");
const { hojeBRT, somarDiasUTC } = await import("../lib/datas.js");

/**
 * ONDA 3A — O FINANCEIRO QUE RESPONDE PERGUNTAS, contra o MySQL de verdade e pelo `createCaller`
 * (chamar o serviço direto pularia o procedure, que é onde mora a trava de papel).
 *
 * ⚠️ Quase tudo aqui roda na carteira PESSOAL de usuários criados pelo próprio teste: ela é
 * privada por dono, então nada que outro arquivo de teste deixou no banco entra nas somas — e
 * a própria privacidade fica provada de brinde. As datas são RELATIVAS a hoje (Brasília), porque
 * relatório e projeção são sobre "este mês" e "os próximos".
 */

const PFX = `fin3a-${randomBytes(4).toString("hex")}`;
type Caller = ReturnType<typeof appRouter.createCaller>;
const ids: Record<string, string> = {};
const callers: Record<string, Caller> = {};

const como = (id: string, role: "FUNCIONARIO" | "ADMIN") =>
  appRouter.createCaller({ user: { id, role, nome: id, email: `${id}@teste.local` }, req: {}, res: {} } as never);

/** "AAAA-MM-DD" do dia deslocado `n` dias de hoje (Brasília). */
const dia = (n: number) => somarDiasUTC(hojeBRT(), n).toISOString().slice(0, 10);
/** Meia-noite UTC do dia `d` do mês deslocado `delta` meses do corrente. */
const noMes = (delta: number, d: number) => {
  const h = hojeBRT();
  return new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() + delta, d));
};
const mesStr = (delta: number) => noMes(delta, 1).toISOString().slice(0, 7);

async function conta(dono: string | null, dados: {
  tipo: "PAGAR" | "RECEBER";
  valor: number;
  vencimento: Date;
  descricao?: string;
  pago?: boolean;
  pagoEm?: Date | null;
  categoriaId?: string | null;
  clienteId?: string | null;
}) {
  return prisma.conta.create({
    data: {
      tipo: dados.tipo,
      escopo: dono ? "PESSOAL" : "EMPRESA",
      donoId: dono,
      descricao: `${PFX} ${dados.descricao ?? "conta"}`,
      valor: dados.valor as never,
      vencimento: dados.vencimento,
      pago: dados.pago ?? false,
      pagoEm: dados.pagoEm ?? (dados.pago ? new Date() : null),
      categoriaId: dados.categoriaId ?? null,
      clienteId: dados.clienteId ?? null,
    },
  });
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  for (const nome of ["filtro", "outro", "relatorio", "projecao", "func"]) {
    const u = await prisma.user.create({
      data: { nome: `${PFX}-${nome}`, email: `${PFX}-${nome}@teste.local`, role: nome === "func" ? "FUNCIONARIO" : "ADMIN" },
    });
    ids[nome] = u.id;
    callers[nome] = como(u.id, nome === "func" ? "FUNCIONARIO" : "ADMIN");
  }
});

afterAll(async () => {
  await prisma.conta.deleteMany({ where: { descricao: { startsWith: PFX } } });
  await prisma.categoria.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.cliente.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

describe("lista: filtros e paginação no servidor", () => {
  let catId: string;

  beforeAll(async () => {
    const u = ids.filtro!;
    catId = (await prisma.categoria.create({ data: { nome: `${PFX}-aluguel`, tipo: "DESPESA", escopo: "PESSOAL", donoId: u } })).id;
    await conta(u, { tipo: "PAGAR", valor: 100, vencimento: noMes(0, 1), descricao: "desconto 10% luz", categoriaId: catId });
    await conta(u, { tipo: "PAGAR", valor: 200, vencimento: noMes(0, 2), descricao: "10 parcelas geladeira", categoriaId: catId });
    await conta(u, { tipo: "PAGAR", valor: 300, vencimento: noMes(0, 3), descricao: "mercado" });
    await conta(u, { tipo: "PAGAR", valor: 400, vencimento: noMes(1, 4), descricao: "escola" });
    await conta(u, { tipo: "PAGAR", valor: 500.55, vencimento: noMes(2, 5), descricao: "viagem" });
  });

  it("pagina e devolve total e soma do recorte INTEIRO, não só da página", async () => {
    const p1 = await callers.filtro!.financeiro.contas.list({ carteira: "PESSOAL", tipo: "PAGAR", porPagina: 2 });
    expect(p1.total).toBe(5);
    expect(p1.somaValor).toBeCloseTo(1500.55, 2);
    expect(p1.itens.map((c) => c.valor)).toEqual([100, 200]);
    const p3 = await callers.filtro!.financeiro.contas.list({ carteira: "PESSOAL", tipo: "PAGAR", porPagina: 2, pagina: 3 });
    expect(p3.itens.map((c) => c.valor)).toEqual([500.55]);
    // ⚠️ `Decimal` nunca atravessa o tRPC (ADR-118).
    expect(typeof p3.itens[0]!.valor).toBe("number");
  });

  it("filtra por categoria, por 'sem categoria' e por período (até é inclusive)", async () => {
    const porCat = await callers.filtro!.financeiro.contas.list({ carteira: "PESSOAL", categoriaId: catId });
    expect(porCat.itens.map((c) => c.valor)).toEqual([100, 200]);
    const semCat = await callers.filtro!.financeiro.contas.list({ carteira: "PESSOAL", categoriaId: SEM_CATEGORIA });
    expect(semCat.itens.map((c) => c.valor)).toEqual([300, 400, 500.55]);
    const periodo = await callers.filtro!.financeiro.contas.list({
      carteira: "PESSOAL",
      vencimentoDe: noMes(0, 2).toISOString().slice(0, 10),
      vencimentoAte: noMes(1, 4).toISOString().slice(0, 10),
    });
    expect(periodo.itens.map((c) => c.valor)).toEqual([200, 300, 400]);
  });

  it("⚠️ a busca trata % e _ como texto, não como coringa do LIKE", async () => {
    const r = await callers.filtro!.financeiro.contas.list({ carteira: "PESSOAL", busca: "10%" });
    expect(r.itens.map((c) => c.descricao)).toEqual([`${PFX} desconto 10% luz`]);
    const todos = await callers.filtro!.financeiro.contas.list({ carteira: "PESSOAL", busca: "%%" });
    expect(todos.total).toBe(0);
  });

  it("filtra por cliente na carteira da empresa", async () => {
    const cli = await prisma.cliente.create({ data: { nome: `${PFX}-clinica-filtro` } });
    await conta(null, { tipo: "RECEBER", valor: 777, vencimento: noMes(0, 5), clienteId: cli.id });
    await conta(null, { tipo: "RECEBER", valor: 888, vencimento: noMes(0, 5) });
    const r = await callers.filtro!.financeiro.contas.list({ carteira: "EMPRESA", clienteId: cli.id });
    expect(r.itens.map((c) => [c.valor, c.cliente?.nome])).toEqual([[777, `${PFX}-clinica-filtro`]]);
  });

  it("🔒 a carteira PESSOAL de outra pessoa não aparece nem em 'Tudo'", async () => {
    const r = await callers.outro!.financeiro.contas.list({ carteira: "TUDO", busca: PFX, porPagina: 200 });
    expect(r.itens.some((c) => c.escopo === "PESSOAL")).toBe(false);
    const pessoal = await callers.outro!.financeiro.contas.list({ carteira: "PESSOAL" });
    expect(pessoal.total).toBe(0);
  });
});

describe("relatório mês a mês (regime de caixa)", () => {
  beforeAll(async () => {
    const u = ids.relatorio!;
    // Venceu no mês passado e foi PAGO hoje → é saída DESTE mês (caixa), não do passado.
    await conta(u, { tipo: "PAGAR", valor: 1000, vencimento: noMes(-1, 10), pago: true, pagoEm: new Date() });
    await conta(u, { tipo: "RECEBER", valor: 2500.1, vencimento: noMes(0, 1), pago: true, pagoEm: new Date() });
    // A receber que venceu no mês passado e não entrou → "a receber vencido" do mês passado.
    await conta(u, { tipo: "RECEBER", valor: 300, vencimento: noMes(-1, 1) });
    // Excluída não conta.
    const apagada = await conta(u, { tipo: "RECEBER", valor: 9999, vencimento: noMes(0, 1), pago: true, pagoEm: new Date() });
    await prisma.conta.update({ where: { id: apagada.id }, data: { deletedAt: new Date() } });
  });

  it("devolve 12 meses terminando no corrente, com recebido/pago pelo mês do pagamento", async () => {
    const r = await callers.relatorio!.financeiro.relatorios.mensal({ carteira: "PESSOAL" });
    expect(r.meses).toHaveLength(12);
    expect(r.meses[11]!.mes).toBe(mesStr(0));
    expect(r.meses[11]).toMatchObject({ recebido: 2500.1, pago: 1000, resultado: 1500.1, vencidoAReceber: 0 });
    expect(r.meses[10]).toMatchObject({ mes: mesStr(-1), recebido: 0, pago: 0, vencidoAReceber: 300, qtdVencidoAReceber: 1 });
  });
});

describe("projeção de caixa", () => {
  beforeAll(async () => {
    const u = ids.projecao!;
    // Série mensal que começa no mês que vem: a parcela do mês seguinte AINDA NÃO EXISTE.
    await callers.projecao!.financeiro.contas.create({
      tipo: "PAGAR",
      escopo: "PESSOAL",
      descricao: `${PFX} aluguel`,
      valor: 900,
      vencimento: noMes(1, 15),
      recorrencia: "MENSAL",
    });
    // Outra série, com a parcela do mês +2 EXCLUÍDA à mão (exceção): não pode ser projetada.
    const s2 = await callers.projecao!.financeiro.contas.create({
      tipo: "RECEBER",
      escopo: "PESSOAL",
      descricao: `${PFX} mesada`,
      valor: 50,
      vencimento: noMes(1, 5),
      recorrencia: "MENSAL",
    });
    await prisma.conta.create({
      data: {
        tipo: "RECEBER", escopo: "PESSOAL", donoId: u, descricao: `${PFX} mesada`, valor: 50 as never,
        vencimento: noMes(2, 5), recorrencia: "MENSAL", recorrenteId: s2.id, deletedAt: new Date(),
      },
    });
    await conta(u, { tipo: "RECEBER", valor: 1200, vencimento: new Date(`${dia(0)}T00:00:00Z`) });
    await conta(u, { tipo: "PAGAR", valor: 80, vencimento: new Date(`${dia(-1)}T00:00:00Z`) });
  });

  it("soma o aberto do mês, projeta a recorrência futura e separa o vencido", async () => {
    const r = await callers.projecao!.financeiro.relatorios.projecao({ carteira: "PESSOAL" });
    expect(r.meses.map((m) => m.mes)).toEqual([mesStr(0), mesStr(1), mesStr(2)]);
    expect(r.meses[0]).toMatchObject({ receber: 1200, pagar: 0, saldo: 1200 });
    // Mês +1: as duas primeiras parcelas EXISTEM (não são projetadas).
    expect(r.meses[1]).toMatchObject({ receber: 50, pagar: 900, saldo: -850, receberProjetado: 0, pagarProjetado: 0 });
    // Mês +2: aluguel projetado; a mesada foi excluída à mão e NÃO volta pela projeção.
    expect(r.meses[2]).toMatchObject({ receber: 0, pagar: 900, saldo: -900, pagarProjetado: 900 });
    expect(r.vencido).toEqual({ receber: 0, qtdReceber: 0, pagar: 80, qtdPagar: 1 });
    // Nada foi gravado pela projeção.
    const serie = await prisma.conta.count({ where: { descricao: `${PFX} aluguel` } });
    expect(serie).toBe(1);
  });
});

describe("inadimplência por cliente", () => {
  it("lista quem deve, do maior valor ao menor, com o atraso da conta mais antiga", async () => {
    const a = await prisma.cliente.create({ data: { nome: `${PFX}-clinica-a` } });
    const b = await prisma.cliente.create({ data: { nome: `${PFX}-clinica-b` } });
    const venc = (n: number) => new Date(`${dia(-n)}T00:00:00Z`);
    await conta(null, { tipo: "RECEBER", valor: 100, vencimento: venc(10), clienteId: a.id });
    await conta(null, { tipo: "RECEBER", valor: 50, vencimento: venc(40), clienteId: a.id });
    await conta(null, { tipo: "RECEBER", valor: 400, vencimento: venc(5), clienteId: b.id });
    // Não contam: paga, a vencer, e a pagar.
    await conta(null, { tipo: "RECEBER", valor: 5000, vencimento: venc(3), clienteId: b.id, pago: true });
    await conta(null, { tipo: "RECEBER", valor: 5000, vencimento: venc(-3), clienteId: b.id });
    await conta(null, { tipo: "PAGAR", valor: 5000, vencimento: venc(3), clienteId: b.id });

    const r = await callers.filtro!.financeiro.relatorios.inadimplencia({ carteira: "EMPRESA" });
    const meus = r.filter((i) => i.clienteId === a.id || i.clienteId === b.id);
    expect(meus.map((i) => [i.clienteNome, i.total, i.quantidade, i.diasEmAtraso])).toEqual([
      [`${PFX}-clinica-b`, 400, 1, 5],
      [`${PFX}-clinica-a`, 150, 2, 40],
    ]);
  });
});

describe("exportação para o contador", () => {
  it("respeita o filtro, protege contra fórmula e não leva a carteira pessoal de outro", async () => {
    await conta(null, { tipo: "PAGAR", valor: 42.5, vencimento: noMes(0, 7), descricao: "=cmd|' /C calc'!A0" });
    const r = await callers.outro!.financeiro.contas.exportar({ carteira: "TUDO", busca: PFX, tipo: "PAGAR" });
    const linhas = r.csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(r.linhas).toBe(linhas.length - 1);
    expect(r.csv).toContain(`"${PFX} =cmd|' /C calc'!A0"`);
    expect(r.csv).toContain("42,50");
    // Nenhuma conta PESSOAL (as dos outros usuários do teste) e nenhuma a receber (filtro de tipo).
    expect(r.csv).not.toContain('"Pessoal"');
    expect(r.csv).not.toContain('"A receber"');

    // Célula começando com "=": o apóstrofo neutraliza a fórmula.
    await conta(ids.outro!, { tipo: "PAGAR", valor: 1, vencimento: noMes(0, 7) });
    await prisma.conta.updateMany({
      where: { descricao: `${PFX} conta`, donoId: ids.outro! },
      data: { descricao: "=HYPERLINK(1)" },
    });
    const pessoal = await callers.outro!.financeiro.contas.exportar({ carteira: "PESSOAL", busca: "HYPERLINK" });
    expect(pessoal.linhas).toBe(1);
    expect(pessoal.csv).toContain(`"'=HYPERLINK(1)"`);
    await prisma.conta.deleteMany({ where: { descricao: "=HYPERLINK(1)", donoId: ids.outro! } });
  });
});

describe("categorias: quantas contas ficam sem categoria ao excluir", () => {
  it("conta só as contas vivas", async () => {
    const u = ids.outro!;
    const cat = await prisma.categoria.create({ data: { nome: `${PFX}-lazer`, tipo: "DESPESA", escopo: "PESSOAL", donoId: u } });
    await conta(u, { tipo: "PAGAR", valor: 10, vencimento: noMes(0, 1), categoriaId: cat.id });
    const apagada = await conta(u, { tipo: "PAGAR", valor: 10, vencimento: noMes(0, 1), categoriaId: cat.id });
    await prisma.conta.update({ where: { id: apagada.id }, data: { deletedAt: new Date() } });
    const lista = await callers.outro!.financeiro.categorias.list({ escopo: "PESSOAL" });
    expect(lista.find((c) => c.id === cat.id)?.contasVinculadas).toBe(1);
  });
});

describe("🔒 permissão: o Financeiro inteiro é ADMIN+", () => {
  it("FUNCIONARIO leva FORBIDDEN em TODA rota do router (inclusive as que nascerem depois)", async () => {
    const caminhos = Object.keys(financeiroRouter._def.procedures);
    expect(caminhos).toEqual(expect.arrayContaining(["relatorios.mensal", "relatorios.projecao", "relatorios.inadimplencia", "contas.exportar"]));
    for (const caminho of caminhos) {
      const proc = caminho.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], callers.func!.financeiro) as (
        i: unknown,
      ) => Promise<unknown>;
      await expect(proc({}), caminho).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
