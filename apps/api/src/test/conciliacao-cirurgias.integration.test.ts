import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

process.env.EMAIL_CRYPTO_KEY ??= randomBytes(32).toString("base64");
process.env.PACIENTE_CRYPTO_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@app/db");
const { appRouter } = await import("../trpc/router.js");
const { importarCirurgias, previsualizarCirurgias } = await import("../modules/conciliacao/cirurgias.service.js");
const { importarProducao, ligarConvenio } = await import("../modules/conciliacao/conciliacao.service.js");

/**
 * Conciliação Fase 2a — o mapa cirúrgico do TASY, contra MySQL de verdade.
 *
 * O que só existe com banco: reimportar um período sobreposto ATUALIZA em vez de duplicar, o
 * de-para é o mesmo das consultas (ligar uma vez vale para as duas), e nenhuma rota devolve o que
 * não devia — inclusive o prontuário, que nem é gravado.
 */

const SUFIXO = randomBytes(4).toString("hex");
let clienteId = "";
let usuarioId = "";
let operadoraId = "";
let profissionalId = "";
let caller: ReturnType<typeof appRouter.createCaller>;

const CABECALHO =
  '"Data";"Hora (UTC)";"Sala";"Duração prev (min)";"Paciente";"Prontuário";"Atendimento";"Nº Cirurgia";"Seq Cirurgia";"Convênio";"Tipo Conv";"Médico";"Anestesista";"Tipo Anestesia";"Procedimento";"Status";"Autorização";"Cód Aut";"Unid. Internação";"Setor";"Cód Pessoa";"OPME";"Tempo (min)";"Técnica"';

/** Uma linha sintética. Prontuário e leito marcados para o teste de que NÃO são gravados. */
function cir(
  n: string,
  o: { data?: string; atend?: string; conv?: string; tipo?: string; status?: string; cod?: string; aut?: string } = {},
) {
  const v = { data: "2026-05-04", atend: `9${n}`, conv: "Sul América", tipo: "2", status: "Executada", cod: "A", aut: "Autorizado", ...o };
  return [
    v.data,
    `${v.data}T10:00:00Z`,
    "Sala 08",
    "240",
    `PACIENTE ${n}`,
    "PRONTUARIO-SECRETO",
    v.atend,
    n,
    "7900000000",
    v.conv,
    v.tipo,
    "Sergio Almeida de Oliveira",
    "",
    "",
    "Revascularização Miocárdica",
    v.status,
    v.aut,
    v.cod,
    "LEITO-SECRETO",
    "",
    "PESSOA-SECRETA",
    "Com OPME",
    "240",
    "Convencional",
  ]
    .map((x) => `"${x}"`)
    .join(";");
}

const arquivo = (...linhas: string[]) => Buffer.from([CABECALHO, ...linhas].join("\n"), "utf8");

beforeAll(async () => {
  const cliente = await prisma.cliente.create({ data: { nome: `Clínica cirurgias ${SUFIXO}` } });
  clienteId = cliente.id;
  const operadora = await prisma.operadora.create({ data: { nome: `Sul América ${SUFIXO}` } });
  operadoraId = operadora.id;
  const prof = await prisma.profissional.create({ data: { clienteId, nome: "Sergio Almeida de Oliveira", conselho: "CRM" } });
  profissionalId = prof.id;
  const usuario = await prisma.user.create({
    data: { nome: `Func ${SUFIXO}`, email: `func-cir-${SUFIXO}@teste.local`, role: "FUNCIONARIO" },
  });
  usuarioId = usuario.id;
  caller = appRouter.createCaller({
    user: { id: usuarioId, role: "FUNCIONARIO", nome: usuario.nome, email: usuario.email },
    req: {},
    res: {},
  } as never);
});

afterAll(async () => {
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.operadora.deleteMany({ where: { id: operadoraId } });
  await prisma.user.deleteMany({ where: { id: usuarioId } });
  await prisma.$disconnect();
});

describe("importar o mapa cirúrgico", () => {
  it("a prévia conta novas, sem atendimento e não executadas — e não grava nada", async () => {
    const p = await previsualizarCirurgias({
      clienteId,
      bytes: arquivo(cir("100"), cir("101", { atend: "" }), cir("102", { status: "Reservada" })),
    });
    expect(p.totalLinhas).toBe(3);
    expect(p.novas).toBe(3);
    expect(p.jaExistentes).toBe(0);
    expect(p.semAtendimento).toBe(1);
    expect(p.naoExecutadas).toBe(1);
    expect(p.periodo).toEqual({ inicio: "2026-05-04", fim: "2026-05-04" });
    expect(p.conveniosNovos).toEqual(["Sul América"]);
    // O médico casa sozinho com o cadastro pelo nome.
    expect(p.profissionaisNovos).toEqual([]);
    expect(await prisma.producaoCirurgia.count({ where: { clienteId } })).toBe(0);
  });

  it("grava, liga o médico sozinho e NÃO guarda prontuário, pessoa nem leito", async () => {
    const r = await importarCirurgias({
      clienteId,
      bytes: arquivo(cir("100"), cir("101", { atend: "" }), cir("102", { status: "Reservada", cod: "PA", aut: "Pendente de autorização" })),
      nomeArquivo: "tasy-maio.csv",
      usuarioId,
    });
    expect(r).toMatchObject({ novas: 3, atualizadas: 0, semAtendimento: 1, profissionaisLigadosAutomaticamente: 1 });

    const linhas = await prisma.producaoCirurgia.findMany({ where: { clienteId }, orderBy: { numeroCirurgia: "asc" } });
    expect(linhas.map((l) => l.profissionalId)).toEqual([profissionalId, profissionalId, profissionalId]);
    expect(linhas[1]!.atendimento).toBeNull();
    expect(linhas[2]!.status).toBe("RESERVADA");
    expect(JSON.stringify(linhas)).not.toMatch(/PRONTUARIO-SECRETO|LEITO-SECRETO|PESSOA-SECRETA/);

    const lote = await prisma.producaoLote.findUniqueOrThrow({ where: { id: r.loteId } });
    expect(lote.origem).toBe("CIRURGIAS_TASY");
    expect(lote.competenciaVigente).toBeNull();
  });

  it("o MESMO arquivo de novo é recusado", async () => {
    await expect(
      importarCirurgias({
        clienteId,
        bytes: arquivo(
          cir("100"),
          cir("101", { atend: "" }),
          cir("102", { status: "Reservada", cod: "PA", aut: "Pendente de autorização" }),
        ),
        nomeArquivo: "tasy-maio.csv",
        usuarioId,
      }),
    ).rejects.toThrow(/já foi importado/i);
  });

  it("período sobreposto ATUALIZA o que mudou e acrescenta o novo — nunca duplica", async () => {
    // O TASY do mês seguinte traz de novo a 101 (agora com atendimento) e a 102 (agora executada),
    // mais uma cirurgia nova.
    const r = await importarCirurgias({
      clienteId,
      bytes: arquivo(cir("101", { atend: "9101" }), cir("102"), cir("103", { data: "2026-06-02" })),
      nomeArquivo: "tasy-junho.csv",
      usuarioId,
    });
    expect(r).toMatchObject({ novas: 1, atualizadas: 2 });
    expect(await prisma.producaoCirurgia.count({ where: { clienteId } })).toBe(4);

    const c101 = await prisma.producaoCirurgia.findUniqueOrThrow({
      where: { clienteId_numeroCirurgia: { clienteId, numeroCirurgia: "101" } },
    });
    expect(c101.atendimento).toBe("9101");
    expect(c101.loteId).toBe(r.loteId);
    const c102 = await prisma.producaoCirurgia.findUniqueOrThrow({
      where: { clienteId_numeroCirurgia: { clienteId, numeroCirurgia: "102" } },
    });
    expect(c102.status).toBe("EXECUTADA");
    expect(c102.autorizacao).toBe("AUTORIZADO");
  });

  it("recusa o relatório de consultas", async () => {
    await expect(
      importarCirurgias({ clienteId, bytes: Buffer.from("Nome;Valor\nx;1", "utf8"), nomeArquivo: "x.csv", usuarioId }),
    ).rejects.toThrow(/mapa cirúrgico/i);
  });
});

describe("o de-para é o mesmo das consultas", () => {
  it("a pendência lista o convênio uma vez, somando consulta e cirurgia", async () => {
    await importarProducao({
      clienteId,
      competencia: "2026-05",
      bytes: Buffer.from(
        "Data da agenda;Data do atendimento;Paciente;Tipo de atendimento;Plano de convênio;Profissional\n04/05/2026;04/05/2026;PACIENTE C;Consulta;SUL AMERICA;DR. SERGIO ALMEIDA DE OLIVEIRA",
        "utf8",
      ),
      nomeArquivo: "consultas-maio.csv",
      usuarioId,
    });
    const p = await caller.conciliacao.pendencias({ clienteId });
    const sul = p.convenios.filter((c) => c.textoBruto.toLowerCase().includes("sul am"));
    expect(sul).toHaveLength(1);
    expect(sul[0]!.atendimentos).toBe(5); // 4 cirurgias + 1 consulta
  });

  it("ligar o convênio retroage nas cirurgias E nas consultas", async () => {
    const r = await ligarConvenio({ clienteId, textoBruto: "Sul América", operadoraId });
    expect(r.linhasAtualizadas).toBe(5);
    expect(await prisma.producaoCirurgia.count({ where: { clienteId, operadoraId: null } })).toBe(0);
    expect(await prisma.producaoConsulta.count({ where: { clienteId, operadoraId: null } })).toBe(0);
  });

  it("os meses das CONSULTAS não listam o lote de cirurgia", async () => {
    const meses = await caller.conciliacao.competencias({ clienteId });
    expect(meses.map((m) => m.competencia)).toEqual(["2026-05"]);
    expect(meses[0]!.nomeArquivo).toBe("consultas-maio.csv");
  });
});

describe("leitura pela tela", () => {
  it("resumo conta só executadas e separa o que não casa com o repasse", async () => {
    await importarCirurgias({
      clienteId,
      bytes: arquivo(cir("104", { atend: "", status: "Reservada" }), cir("105", { conv: "SUS - BP Paulista", tipo: "3" })),
      nomeArquivo: "tasy-extra.csv",
      usuarioId,
    });
    const r = await caller.conciliacao.resumoCirurgias({ clienteId });
    expect(r.executadas).toBe(5); // 100, 101, 102, 103, 105
    expect(r.naoExecutadas).toBe(1); // 104
    expect(r.semAtendimento).toBe(0); // a 104 sem atendimento é reservada — não conta
    expect(r.porCategoria.SUS).toBe(1);
    expect(r.porCategoria.CONVENIO).toBe(4);
    expect(r.porProfissional).toEqual([expect.objectContaining({ profissionalId, atendimentos: 5, pendente: false })]);
  });

  it("filtros por situação e por mês", async () => {
    const semAtend = await caller.conciliacao.cirurgias({ clienteId, situacao: "SEM_ATENDIMENTO" });
    expect(semAtend.linhas.map((l) => l.numeroCirurgia)).toEqual(["104"]);
    const naoExec = await caller.conciliacao.cirurgias({ clienteId, situacao: "NAO_EXECUTADA" });
    expect(naoExec.total).toBe(1);
    const junho = await caller.conciliacao.cirurgias({ clienteId, competencia: "2026-06" });
    expect(junho.linhas.map((l) => l.numeroCirurgia)).toEqual(["103"]);

    const meses = await caller.conciliacao.mesesCirurgias({ clienteId });
    expect(meses.meses).toEqual([
      { competencia: "2026-06", cirurgias: 1 },
      { competencia: "2026-05", cirurgias: 5 },
    ]);
    expect(meses.ultimaImportacao?.nomeArquivo).toBe("tasy-extra.csv");
  });

  it("nenhuma rota de cirurgia devolve prontuário, pessoa, leito ou chave de dado pessoal", async () => {
    const retornos = await Promise.all([
      caller.conciliacao.cirurgias({ clienteId }),
      caller.conciliacao.resumoCirurgias({ clienteId }),
      caller.conciliacao.mesesCirurgias({ clienteId }),
    ]);
    const json = JSON.stringify(retornos);
    expect(json).not.toMatch(/PRONTUARIO-SECRETO|LEITO-SECRETO|PESSOA-SECRETA/);
    expect(json).not.toMatch(/"(prontuario|codPessoa|cpf|telefone|email)"/i);
  });

  it("CLIENTE do Portal não entra", async () => {
    const doPortal = appRouter.createCaller({
      user: { id: usuarioId, role: "CLIENTE", nome: "Cliente", email: "c@teste.local", clienteId },
      req: {},
      res: {},
    } as never);
    await expect(doPortal.conciliacao.cirurgias({ clienteId })).rejects.toThrow();
  });
});
