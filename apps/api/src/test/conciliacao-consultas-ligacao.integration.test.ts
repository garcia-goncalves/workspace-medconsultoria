import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

process.env.EMAIL_CRYPTO_KEY ??= randomBytes(32).toString("base64");
process.env.PACIENTE_CRYPTO_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@app/db");
const { ligarConvenio, ligarProfissional } = await import("../modules/conciliacao/conciliacao.service.js");
const { listarProducao, pendenciasDePara, resumoDaCompetencia } = await import("../modules/conciliacao/conciliacao-painel.service.js");
const { listarCirurgias } = await import("../modules/conciliacao/cirurgias.service.js");

/**
 * Conciliação — a LIGAÇÃO do que veio cru no relatório (profissional e convênio) e o que a tela
 * lê dela, contra MySQL de verdade. Linhas criadas direto no banco, sem passar pelo importador:
 * o que se prova aqui é a leitura e a retroação, não o parser.
 */

const SUFIXO = randomBytes(4).toString("hex");
const COMPETENCIA = "2026-06";
let clienteId = "";
let loteConsultasId = "";
let loteCirurgiasId = "";

type Tipo = "CONSULTA" | "CORTESIA" | "SEM_VINCULO_AGENDA" | "OUTRO";

async function consulta(linha: number, tipo: Tipo, convenioBruto: string, profissionalBruto: string) {
  await prisma.producaoConsulta.create({
    data: {
      loteId: loteConsultasId,
      clienteId,
      competencia: COMPETENCIA,
      linha,
      dataAtendimento: new Date("2026-06-10T00:00:00Z"),
      pacienteNome: `PACIENTE ${linha}`,
      tipoAtendimento: tipo,
      tipoAtendimentoBruto: tipo,
      convenioBruto,
      profissionalBruto,
    },
  });
}

async function cirurgia(n: number, convenioBruto: string, profissionalBruto: string) {
  await prisma.producaoCirurgia.create({
    data: {
      loteId: loteCirurgiasId,
      clienteId,
      competencia: "2026-05",
      linha: n,
      numeroCirurgia: `${SUFIXO}-${n}`,
      dataCirurgia: new Date("2026-05-10T00:00:00Z"),
      pacienteNome: `PACIENTE CIR ${n}`,
      procedimento: "30715016 - ARTROSCOPIA DE JOELHO",
      status: "EXECUTADA",
      statusBruto: "Executada",
      autorizacao: "AUTORIZADO",
      autorizacaoBruto: "Autorizado",
      categoriaConvenio: "CONVENIO",
      convenioBruto,
      profissionalBruto,
    },
  });
}

beforeAll(async () => {
  const cliente = await prisma.cliente.create({ data: { nome: `Clínica ligação ${SUFIXO}` } });
  clienteId = cliente.id;
  const base = { clienteId, nomeArquivo: "x.csv", formato: "csv", hashArquivo: SUFIXO.padEnd(64, "0"), status: "IMPORTADO" as const };
  loteConsultasId = (await prisma.producaoLote.create({ data: { ...base, competencia: COMPETENCIA, competenciaVigente: COMPETENCIA } })).id;
  loteCirurgiasId = (await prisma.producaoLote.create({ data: { ...base, competencia: "2026-05", origem: "CIRURGIAS_TASY" } })).id;

  // O mesmo médico com caixa diferente em cada produção — como vem de sistemas diferentes.
  await consulta(1, "CONSULTA", "AMIL 400", "DR. RAFAEL FICTÍCIO MENDES");
  await consulta(2, "CONSULTA", "AMIL 400", "Dr. Rafael Fictício Mendes");
  await cirurgia(1, "UNIMED SEGUROS", "DR. RAFAEL FICTICIO MENDES");
  // Particular, com caixa diferente em cada produção.
  await consulta(3, "CONSULTA", "PARTICULAR", "DR. RAFAEL FICTÍCIO MENDES");
  await cirurgia(2, "Particular", "DR. RAFAEL FICTICIO MENDES");
});

afterAll(async () => {
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.$disconnect();
});

describe("#3 — ligar profissional", () => {
  it("cliente sem médico cadastrado: a pendência existe e não há a quem ligar", async () => {
    // É o estado que deixava o "Ligar a…" vazio na tela: não é filtro errado, é cadastro vazio.
    const p = await pendenciasDePara(clienteId);
    expect(p.profissionais).toHaveLength(1);
    expect(p.profissionais[0]!.atendimentos).toBe(5);
    expect(await prisma.profissional.count({ where: { clienteId } })).toBe(0);
  });

  it("depois de cadastrar e ligar, retroage em consultas E cirurgias, de qualquer caixa", async () => {
    const prof = await prisma.profissional.create({ data: { clienteId, nome: "Rafael Fictício Mendes", conselho: "CRM" } });
    const r = await ligarProfissional({ clienteId, textoBruto: "DR. RAFAEL FICTÍCIO MENDES", profissionalId: prof.id });
    expect(r.linhasAtualizadas).toBe(5);

    expect(await prisma.producaoConsulta.count({ where: { clienteId, profissionalId: null } })).toBe(0);
    expect(await prisma.producaoCirurgia.count({ where: { clienteId, profissionalId: null } })).toBe(0);
    expect((await pendenciasDePara(clienteId)).profissionais).toHaveLength(0);
  });
});

describe("#7 — particular ligado não é \"(a ligar)\"", () => {
  it("antes de ligar, a linha é pendente nas duas produções", async () => {
    const c = await listarProducao({ clienteId, competencia: COMPETENCIA });
    expect(c.linhas.find((l) => l.convenioBruto === "PARTICULAR")!.convenioParticular).toBe(false);
  });

  it("depois de ligar como particular, consultas, cirurgias e resumo dizem a MESMA coisa", async () => {
    await ligarConvenio({ clienteId, textoBruto: "PARTICULAR", operadoraId: null, particular: true });

    const c = await listarProducao({ clienteId, competencia: COMPETENCIA });
    const consultaParticular = c.linhas.find((l) => l.convenioBruto === "PARTICULAR")!;
    expect(consultaParticular.operadora).toBeNull();
    expect(consultaParticular.convenioParticular).toBe(true);
    // Convênio que ninguém ligou continua pendente — a régua não "aprova" todo nulo.
    expect(c.linhas.find((l) => l.convenioBruto === "AMIL 400")!.convenioParticular).toBe(false);

    const cir = await listarCirurgias({ clienteId });
    expect(cir.linhas.find((l) => l.convenioBruto === "Particular")!.convenioParticular).toBe(true);
    expect(cir.linhas.find((l) => l.convenioBruto === "UNIMED SEGUROS")!.convenioParticular).toBe(false);

    const r = await resumoDaCompetencia(clienteId, COMPETENCIA);
    const linhaParticular = r.porOperadora.find((o) => o.particular)!;
    expect(linhaParticular.rotulo).toBe("Particular");
    expect(linhaParticular.pendente).toBe(false);
  });
});
