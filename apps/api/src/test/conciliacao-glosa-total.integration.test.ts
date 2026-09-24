import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

process.env.EMAIL_CRYPTO_KEY ??= randomBytes(32).toString("base64");
process.env.PACIENTE_CRYPTO_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@app/db");
const { appRouter } = await import("../trpc/router.js");
const { importarCirurgias } = await import("../modules/conciliacao/cirurgias.service.js");
const { importarRepasse } = await import("../modules/conciliacao/recebido.service.js");

/**
 * Conciliação — a GLOSA TOTAL POR AUSÊNCIA, contra o gabarito das planilhas fictícias
 * (`docs/amostras/ficticias/`, gerador `gerar-ficticias.mjs`; cópia dos CSV em `fixtures/`).
 *
 * A operadora não manda linha dizendo "não paguei": o atendimento simplesmente não vem no repasse.
 * Sem a regra (provisória, `ehGlosaTotalPorAusencia`), os atendimentos 5550107, 5550114 e 5550122
 * ficavam "a receber" para sempre e a glosa do cliente aparecia como R$ 3.420 em vez de R$ 15.720.
 *
 * ⚠️ As cirurgias são de mar–mai/2026: com a defasagem de 105 dias, a partir de 10/09/2026 todas
 * já passaram do prazo, então o teste não depende do dia em que roda (daqui para a frente).
 */

const SUFIXO = randomBytes(4).toString("hex");
let clienteId = "";
let usuarioId = "";
let operadoraId = "";
let caller: ReturnType<typeof appRouter.createCaller>;

const fixture = (nome: string) => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url));

/** O de-para do LEIA-ME das fictícias — sem ele o cobrado fica vazio. */
const DE_PARA = [
  { textoBruto: "30715016 - ARTROSCOPIA DE JOELHO", codigo: "30715016", valor: 2800 },
  { textoBruto: "31009166 - COLECISTECTOMIA POR VIDEO", codigo: "31009166", valor: 3500 },
  { textoBruto: "30602246 - HERNIORRAFIA INGUINAL", codigo: "30602246", valor: 1900 },
  { textoBruto: "30912040 - FACECTOMIA COM IMPLANTE DE LIO", codigo: "30912040", valor: 2200 },
  { textoBruto: "31303293 - HISTEROSCOPIA CIRURGICA", codigo: "31303293", valor: 1600 },
];

const GLOSA_TOTAL_ESPERADA = ["5550107", "5550114", "5550122"];

beforeAll(async () => {
  clienteId = (await prisma.cliente.create({ data: { nome: `Clínica Fictícia ${SUFIXO}` } })).id;
  operadoraId = (await prisma.operadora.create({ data: { nome: `Bradesco Fictício ${SUFIXO}` } })).id;
  const u = await prisma.user.create({ data: { nome: `F ${SUFIXO}`, email: `fgt-${SUFIXO}@teste.local`, role: "FUNCIONARIO" } });
  usuarioId = u.id;
  // A régua do Painel do Cliente (ADR-128): funcionário só mexe no cliente de que é responsável.
  await prisma.cliente.update({ where: { id: clienteId }, data: { responsavelId: usuarioId } });
  caller = appRouter.createCaller({ user: { id: u.id, role: "FUNCIONARIO", nome: u.nome, email: u.email }, req: {}, res: {} } as never);

  await importarCirurgias({ clienteId, bytes: fixture("conciliacao-ficticia-mapa-cirurgico.csv"), nomeArquivo: "mapa.csv", usuarioId });
  for (const d of DE_PARA) await caller.conciliacao.salvarProcedimento({ clienteId, operadoraId: null, ...d });
  await importarRepasse({ clienteId, bytes: fixture("conciliacao-ficticia-repasse.csv"), nomeArquivo: "repasse.csv", usuarioId });
});

afterAll(async () => {
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.operadora.deleteMany({ where: { id: operadoraId } });
  await prisma.user.deleteMany({ where: { id: usuarioId } });
  await prisma.$disconnect();
});

/** Todas as linhas, atravessando a paginação da tela. */
async function todas() {
  const primeira = await caller.conciliacao.cirurgias({ clienteId });
  const paginas = Math.ceil(primeira.total / primeira.porPagina);
  const resto = await Promise.all(
    Array.from({ length: Math.max(paginas - 1, 0) }, (_, i) => caller.conciliacao.cirurgias({ clienteId, pagina: i + 2 })),
  );
  return [...primeira.linhas, ...resto.flatMap((r) => r.linhas)];
}

describe("glosa total por ausência — o gabarito das fictícias", () => {
  it("a GLOSA do cliente é R$ 15.720,00: 3.420 de parcial + 12.300 de total", async () => {
    const r = await caller.conciliacao.cirurgias({ clienteId });
    expect(r.totais.glosa).toBe(15720);
    expect(r.totais.porStatus.GLOSA_TOTAL).toBe(5);
    expect(r.totais.porStatus.GLOSA_PARCIAL).toBe(4);
  });

  it("o filtro 'Glosa total' lista as 5 cirurgias dos 3 atendimentos que não vieram no repasse", async () => {
    const r = await caller.conciliacao.cirurgias({ clienteId, statusConciliacao: "GLOSA_TOTAL" });
    expect(r.total).toBe(5);
    expect([...new Set(r.linhas.map((l) => l.atendimento))].sort()).toEqual(GLOSA_TOTAL_ESPERADA);
    const cobrado = r.linhas.reduce((s, l) => s + (l.cobrado ?? 0), 0);
    expect(cobrado).toBe(12300);
    for (const l of r.linhas) {
      // ⚠️ É leitura: nada foi gravado, e o recebido continua "desconhecido" — a glosa é o cobrado.
      expect(l.recebido).toBeNull();
      expect(l.recebidoOrigem).toBeNull();
      expect(l.glosa).toBe(l.cobrado);
      expect(l.atrasada).toBe(false);
    }
    const noBanco = await prisma.producaoCirurgia.count({ where: { clienteId, valorRecebido: { not: null } } });
    expect(noBanco).toBe(0);
  });

  it("maio (o repasse não pagou nada do mês) fica 'passou do prazo', não glosa", async () => {
    const r = await caller.conciliacao.cirurgias({ clienteId, competencia: "2026-05" });
    const executadasComAtend = r.linhas.filter((l) => l.status === "EXECUTADA" && l.atendimento && l.cobrado !== null);
    expect(executadasComAtend.length).toBeGreaterThan(0);
    for (const l of executadasComAtend) {
      expect(l.statusConciliacao).toBe("A_RECEBER");
      expect(l.atrasada).toBe(true);
    }
    expect(r.totais.porStatus.GLOSA_TOTAL ?? 0).toBe(0);
    expect(r.totais.glosa).toBe(0);
  });

  it("o atendimento com duas cirurgias pago integral reparte o recebido em proporção ao cobrado", async () => {
    const linhas = (await todas()).filter((l) => l.atendimento === "5550100");
    expect(linhas).toHaveLength(2);
    expect(linhas.reduce((s, l) => s + (l.recebido ?? 0), 0)).toBe(4700);
    for (const l of linhas) {
      expect(l.statusConciliacao).toBe("PAGO");
      expect(l.recebido).toBe(l.cobrado);
      expect(l.repasseCompartilhado).toBe(true);
    }
  });

  it("o recebido sem produção (9990001 + incremento de R$ 350,50) continua aparecendo", async () => {
    const r = await caller.conciliacao.resumoCirurgias({ clienteId });
    expect(r.recebidoSemProducao.total).toBe(2250.5);
    expect(r.dinheiro.glosa).toBe(15720);
  });

  it("entra em 'glosa sem recurso', na visão geral e aceita recurso como a parcial", async () => {
    const r = await caller.conciliacao.cirurgias({ clienteId });
    expect(r.totais.glosaSemRecurso).toBe(15720);
    const vg = await caller.conciliacao.visaoGeral();
    const deste = vg.clientes.find((c) => c.clienteId === clienteId)!;
    expect(deste.glosa).toBe(15720);
    expect(deste.glosaSemRecurso).toBe(15720);

    const alvo = (await caller.conciliacao.cirurgias({ clienteId, statusConciliacao: "GLOSA_TOTAL" })).linhas[0]!;
    await caller.conciliacao.abrirRecurso({ clienteId, cirurgiaId: alvo.id, abertoEm: "2026-09-20", protocolo: "P-1" });
    const depois = await caller.conciliacao.cirurgias({ clienteId });
    expect(depois.totais.glosaSemRecurso).toBe(15720 - alvo.cobrado!);
    expect(depois.totais.emRecurso).toBe(alvo.cobrado);
  });

  it("a exportação leva o status e a glosa, e o MODELO reimportado sem mudança não congela recebido 0", async () => {
    const e = await caller.conciliacao.exportar({ clienteId, statusConciliacao: "GLOSA_TOTAL" });
    expect(e.linhas).toBe(5);
    expect(e.modelo).toContain('"Glosa total"');
    // Recebido vai VAZIO: devolver a planilha sem mexer não grava "recebido 0 digitado à mão".
    const linha5550122 = e.modelo.split("\r\n").find((l) => l.includes('"5550122"'))!;
    expect(linha5550122).toContain(";1900,00;;1900,00;");
  });
});
