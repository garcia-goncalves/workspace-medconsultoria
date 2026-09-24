import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

process.env.EMAIL_CRYPTO_KEY ??= randomBytes(32).toString("base64");
process.env.PACIENTE_CRYPTO_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@app/db");
const { appRouter } = await import("../trpc/router.js");
const { importarCirurgias } = await import("../modules/conciliacao/cirurgias.service.js");

/**
 * O filtro de operadora das cirurgias — e o "Particular" que faltava nele.
 *
 * ⚠️ Particular ligado tem `operadoraId` NULO, igual ao convênio que ninguém ligou. Por isso o
 * filtro é um campo próprio (`particular: true`), e este teste prova que ele NÃO devolve o
 * convênio pendente junto — que é exatamente o erro de quem filtra por "operadora nula".
 */

const SUFIXO = randomBytes(4).toString("hex");
let clienteId = "";
let usuarioId = "";
let unimedId = "";
let caller: ReturnType<typeof appRouter.createCaller>;

const CAB_TASY =
  '"Data";"Hora (UTC)";"Sala";"Duração prev (min)";"Paciente";"Prontuário";"Atendimento";"Nº Cirurgia";"Seq Cirurgia";"Convênio";"Tipo Conv";"Médico";"Anestesista";"Tipo Anestesia";"Procedimento";"Status";"Autorização";"Cód Aut";"Unid. Internação";"Setor";"Cód Pessoa";"OPME";"Tempo (min)";"Técnica"';

function cir(n: string, conv: string, paciente = `PACIENTE ${n}`) {
  return [
    "2026-05-04",
    "2026-05-04T10:00:00Z",
    "Sala 08",
    "240",
    paciente,
    "",
    `9${n}`,
    n,
    "7900000000",
    conv,
    "2",
    "Sergio Almeida de Oliveira",
    "",
    "",
    "Revascularização Miocárdica",
    "Executada",
    "Autorizado",
    "A",
    "",
    "",
    "",
    "",
    "240",
    "",
  ]
    .map((x) => `"${x}"`)
    .join(";");
}

const buf = (...linhas: string[]) => Buffer.from(linhas.join("\n"), "utf8");

beforeAll(async () => {
  clienteId = (await prisma.cliente.create({ data: { nome: `Clínica filtro ${SUFIXO}` } })).id;
  unimedId = (await prisma.operadora.create({ data: { nome: `Unimed filtro ${SUFIXO}` } })).id;
  const u = await prisma.user.create({ data: { nome: `F ${SUFIXO}`, email: `ffiltro-${SUFIXO}@teste.local`, role: "FUNCIONARIO" } });
  usuarioId = u.id;
  await prisma.cliente.update({ where: { id: clienteId }, data: { responsavelId: usuarioId } });
  caller = appRouter.createCaller({ user: { id: u.id, role: "FUNCIONARIO", nome: u.nome, email: u.email }, req: {}, res: {} } as never);

  await importarCirurgias({
    clienteId,
    bytes: buf(
      CAB_TASY,
      cir("201", "Central Nacional Unimed", "MARIA SOUZA"),
      cir("202", "PARTICULAR"),
      cir("203", "Convênio Que Ninguém Ligou"),
    ),
    nomeArquivo: "tasy.csv",
    usuarioId,
  });
  await caller.conciliacao.ligarConvenio({ clienteId, textoBruto: "Central Nacional Unimed", operadoraId: unimedId });
  await caller.conciliacao.ligarConvenio({ clienteId, textoBruto: "PARTICULAR", operadoraId: null, particular: true });
});

afterAll(async () => {
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.operadora.deleteMany({ where: { id: unimedId } });
  await prisma.user.deleteMany({ where: { id: usuarioId } });
  await prisma.$disconnect();
});

const numeros = (r: { linhas: { numeroCirurgia: string }[] }) => r.linhas.map((l) => l.numeroCirurgia).sort();

describe("filtro 'Particular' das cirurgias", () => {
  it("o resumo diz que há particular — é o que acende a opção na tela", async () => {
    const r = await caller.conciliacao.resumoCirurgias({ clienteId });
    expect(r.porOperadora.some((o) => o.particular && o.operadoraId === null)).toBe(true);
  });

  it("devolve só o particular, e NÃO o convênio pendente de ligação (os dois têm operadora nula)", async () => {
    const r = await caller.conciliacao.cirurgias({ clienteId, particular: true });
    expect(numeros(r)).toEqual(["202"]);
    expect(r.totais.cirurgias).toBe(1);
  });

  it("o filtro por operadora continua valendo como antes", async () => {
    expect(numeros(await caller.conciliacao.cirurgias({ clienteId, operadoraId: unimedId }))).toEqual(["201"]);
  });

  it("a exportação leva o mesmo recorte", async () => {
    expect((await caller.conciliacao.exportar({ clienteId, particular: true })).linhas).toBe(1);
    expect((await caller.conciliacao.exportar({ clienteId, operadoraId: unimedId })).linhas).toBe(1);
    expect((await caller.conciliacao.exportar({ clienteId })).linhas).toBe(3);
  });
});

describe("a exportação leva TODOS os filtros da lista", () => {
  it("busca pelo paciente: a tela e a planilha contam a mesma coisa", async () => {
    const naTela = await caller.conciliacao.cirurgias({ clienteId, busca: "maria" });
    const exportado = await caller.conciliacao.exportar({ clienteId, busca: "maria" });
    expect(naTela.total).toBe(1);
    expect(exportado.linhas).toBe(naTela.total);
  });

  it("situação no TASY também recorta a exportação", async () => {
    // As três têm atendimento: "sem número de atendimento" não sobra nenhuma — nem na planilha.
    const exportado = await caller.conciliacao.exportar({ clienteId, situacao: "SEM_ATENDIMENTO" });
    expect(exportado.linhas).toBe((await caller.conciliacao.cirurgias({ clienteId, situacao: "SEM_ATENDIMENTO" })).total);
    expect(exportado.linhas).toBe(0);
  });
});
