import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

// As chaves precisam existir ANTES de o config.ts ser importado (ele valida no boot).
process.env.EMAIL_CRYPTO_KEY ??= randomBytes(32).toString("base64");
process.env.PACIENTE_CRYPTO_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@app/db");
const { apelidoCpf, cifrarDadoPaciente, decifrarDadoPaciente } = await import("../lib/cripto-paciente.js");

/**
 * Conciliação — Fase 1: as travas que só o BANCO DE VERDADE prova.
 *
 * Typecheck verde não prova nada aqui (lição das ADR-118/119): índice único, `SET NULL` de chave
 * estrangeira e o tipo `DATE` só existem no MySQL. Este arquivo é `.integration` de propósito —
 * precisa do MySQL de teste no ar (`pnpm db:up`), como manda a ADR-124.
 */

const SUFIXO = randomBytes(4).toString("hex");
let clienteId = "";

beforeAll(async () => {
  const cliente = await prisma.cliente.create({
    data: { nome: `Clínica de teste ${SUFIXO}`, cnpj: null },
  });
  clienteId = cliente.id;
});

afterAll(async () => {
  // Cascade leva lotes, consultas e mapeamentos junto.
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.$disconnect();
});

function loteBase(competencia: string, hash: string) {
  return {
    clienteId,
    competencia,
    competenciaVigente: competencia,
    nomeArquivo: `producao-${competencia}.xlsx`,
    formato: "xlsx",
    hashArquivo: hash.padEnd(64, "0").slice(0, 64),
    status: "IMPORTADO" as const,
  };
}

describe("ProducaoLote — um lote vigente por competência", () => {
  it("recusa DOIS lotes vigentes para o mesmo cliente/mês", async () => {
    await prisma.producaoLote.create({ data: loteBase("2026-01", "a") });
    // Sem esta trava, importar duas vezes duplicaria a produção do mês inteiro em silêncio.
    await expect(prisma.producaoLote.create({ data: loteBase("2026-01", "b") })).rejects.toThrow();
  });

  it("deixa conviver o SUBSTITUÍDO com o novo — é assim que o histórico sobrevive", async () => {
    const antigo = await prisma.producaoLote.create({ data: loteBase("2026-02", "c") });

    // Substituir = tirar o antigo de cena (competenciaVigente vira nulo) e pôr o novo.
    await prisma.producaoLote.update({
      where: { id: antigo.id },
      data: { competenciaVigente: null, status: "SUBSTITUIDO", substituidoEm: new Date() },
    });
    const novo = await prisma.producaoLote.create({ data: loteBase("2026-02", "d") });
    await prisma.producaoLote.update({ where: { id: antigo.id }, data: { substituidoPorId: novo.id } });

    const doMes = await prisma.producaoLote.findMany({ where: { clienteId, competencia: "2026-02" } });
    expect(doMes).toHaveLength(2);
    expect(doMes.filter((l) => l.competenciaVigente !== null)).toHaveLength(1);
  });

  it("competências diferentes convivem sem esbarrar na trava", async () => {
    await prisma.producaoLote.create({ data: loteBase("2026-03", "e") });
    await prisma.producaoLote.create({ data: loteBase("2026-04", "f") });
    const vigentes = await prisma.producaoLote.count({ where: { clienteId, competenciaVigente: { not: null } } });
    expect(vigentes).toBeGreaterThanOrEqual(3);
  });
});

describe("ProducaoConsulta — o dado do paciente no banco", () => {
  it("grava CPF/telefone/e-mail CIFRADOS: o número não está lá em claro", async () => {
    const lote = await prisma.producaoLote.create({ data: loteBase("2026-05", "g") });
    const cpf = "123.456.789-09";

    const linha = await prisma.producaoConsulta.create({
      data: {
        loteId: lote.id,
        clienteId,
        competencia: "2026-05",
        linha: 5,
        dataAgenda: new Date("2026-05-25T00:00:00.000Z"),
        dataAtendimento: new Date("2026-05-28T00:00:00.000Z"),
        pacienteNome: "PACIENTE DE TESTE",
        pacienteCpfCifrado: cifrarDadoPaciente(cpf),
        pacienteCpfApelido: apelidoCpf(cpf),
        pacienteTelefoneCifrado: cifrarDadoPaciente("(11) 96067-6368, (11) 99340-4760"),
        pacienteEmailCifrado: cifrarDadoPaciente("paciente@exemplo.test"),
        tipoAtendimento: "CONSULTA",
        tipoAtendimentoBruto: "Consulta",
        convenioBruto: "PORTO SEGURO - BÁSICO",
        profissionalBruto: "DR. LEONARDO GIGLIO DRAGONE",
      },
    });

    const doBanco = await prisma.producaoConsulta.findUniqueOrThrow({ where: { id: linha.id } });

    // O que importa: quem abrir um dump do banco não lê o CPF.
    expect(doBanco.pacienteCpfCifrado).not.toContain("123");
    expect(doBanco.pacienteCpfCifrado).not.toContain("456789");
    expect(doBanco.pacienteCpfCifrado).toMatch(/^v1:/);
    expect(decifrarDadoPaciente(doBanco.pacienteCpfCifrado!)).toBe(cpf);

    // O nome fica em claro de propósito — é o que identifica o atendimento na tela.
    expect(doBanco.pacienteNome).toBe("PACIENTE DE TESTE");
  });

  it("o apelido do CPF acha o paciente sem que o CPF esteja gravado", async () => {
    // É este índice que vai casar produção com repasse na Fase 2.
    const achado = await prisma.producaoConsulta.findFirst({
      where: { clienteId, pacienteCpfApelido: apelidoCpf("12345678909") },
    });
    expect(achado?.pacienteNome).toBe("PACIENTE DE TESTE");
  });

  it("DATE não escorrega de dia — 28/05 continua 28/05 depois da ida e volta", async () => {
    // O modo de falha real: gravar com hora e ler em UTC-3 devolve o dia anterior, e o
    // atendimento do dia 1º cai no mês passado. A coluna é DATE justamente por isso.
    const linha = await prisma.producaoConsulta.findFirstOrThrow({ where: { clienteId, competencia: "2026-05" } });
    expect(linha.dataAtendimento.toISOString().slice(0, 10)).toBe("2026-05-28");
    expect(linha.dataAgenda?.toISOString().slice(0, 10)).toBe("2026-05-25");
  });

  it("data da agenda nula é aceita — é o caso de 'Sem vínculo com a agenda'", async () => {
    const lote = await prisma.producaoLote.create({ data: loteBase("2026-06", "h") });
    const linha = await prisma.producaoConsulta.create({
      data: {
        loteId: lote.id,
        clienteId,
        competencia: "2026-06",
        linha: 1,
        dataAgenda: null,
        dataAtendimento: new Date("2026-06-01T00:00:00.000Z"),
        pacienteNome: "SEM AGENDA",
        tipoAtendimento: "SEM_VINCULO_AGENDA",
        tipoAtendimentoBruto: "Sem vínculo com a agenda",
        convenioBruto: "Sul America - Semar",
        profissionalBruto: "DRA. LAYS JOSE MORESCHI",
      },
    });
    expect(linha.dataAgenda).toBeNull();
    // Sem CPF no arquivo → sem apelido, e isso é estado válido.
    expect(linha.pacienteCpfApelido).toBeNull();
  });

  it("apagar o lote leva as linhas junto (Cascade)", async () => {
    const lote = await prisma.producaoLote.create({ data: loteBase("2026-07", "i") });
    await prisma.producaoConsulta.create({
      data: {
        loteId: lote.id,
        clienteId,
        competencia: "2026-07",
        linha: 1,
        dataAtendimento: new Date("2026-07-01T00:00:00.000Z"),
        pacienteNome: "TEMPORÁRIO",
        tipoAtendimento: "CORTESIA",
        tipoAtendimentoBruto: "Cortesia",
        convenioBruto: "PARTICULAR DR. LÉO - MAESTRO CARDIM",
        profissionalBruto: "DR. LEONARDO GIGLIO DRAGONE",
      },
    });
    await prisma.producaoLote.delete({ where: { id: lote.id } });
    expect(await prisma.producaoConsulta.count({ where: { loteId: lote.id } })).toBe(0);
  });
});

describe("MapeamentoConvenio — o de-para", () => {
  it("não deixa o mesmo texto virar duas linhas para o mesmo cliente", async () => {
    await prisma.mapeamentoConvenio.create({
      data: {
        clienteId,
        textoBruto: "PORTO SEGURO - BÁSICO",
        textoNormalizado: "porto seguro - basico",
        plano: "Básico",
      },
    });
    // A segunda tentativa vem com o texto BRUTO diferente (outra caixa) mas o mesmo normalizado —
    // é exatamente assim que `Cassi` e `CASSI` virariam duas operadoras.
    await expect(
      prisma.mapeamentoConvenio.create({
        data: { clienteId, textoBruto: "Porto Seguro - Básico", textoNormalizado: "porto seguro - basico" },
      }),
    ).rejects.toThrow();
  });

  it("particular fica sem operadora, e isso é válido", async () => {
    const m = await prisma.mapeamentoConvenio.create({
      data: {
        clienteId,
        textoBruto: "PARTICULAR DR. LÉO - MAESTRO CARDIM",
        textoNormalizado: "particular dr. leo - maestro cardim",
        particular: true,
      },
    });
    expect(m.operadoraId).toBeNull();
    expect(m.particular).toBe(true);
  });
});
