import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

process.env.EMAIL_CRYPTO_KEY ??= randomBytes(32).toString("base64");
process.env.PACIENTE_CRYPTO_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@app/db");
const { appRouter } = await import("../trpc/router.js");
const { importarCirurgias } = await import("../modules/conciliacao/cirurgias.service.js");
const { importarRepasse, importarPlanilha, previsualizarRepasse } = await import("../modules/conciliacao/recebido.service.js");

/**
 * Conciliação Fase 2b — o dinheiro, de ponta a ponta, contra MySQL de verdade.
 *
 * Cobrado vem do de-para do procedimento; recebido vem do repasse (por atendimento) ou da planilha
 * preenchida (por Nº Cirurgia); glosa e status são calculados. E o dinheiro que entra sem cirurgia
 * (incremento, acordo) nunca some.
 */

const SUFIXO = randomBytes(4).toString("hex");
let clienteId = "";
let outroClienteId = "";
let usuarioId = "";
let unimedId = "";
let caller: ReturnType<typeof appRouter.createCaller>;

const CAB_TASY =
  '"Data";"Hora (UTC)";"Sala";"Duração prev (min)";"Paciente";"Prontuário";"Atendimento";"Nº Cirurgia";"Seq Cirurgia";"Convênio";"Tipo Conv";"Médico";"Anestesista";"Tipo Anestesia";"Procedimento";"Status";"Autorização";"Cód Aut";"Unid. Internação";"Setor";"Cód Pessoa";"OPME";"Tempo (min)";"Técnica"';

function cir(n: string, o: { atend?: string; conv?: string; proc?: string; status?: string } = {}) {
  const v = { atend: `9${n}`, conv: "Central Nacional Unimed", proc: "Revascularização Miocárdica", status: "Executada", ...o };
  return [
    "2026-05-04",
    "2026-05-04T10:00:00Z",
    "Sala 08",
    "240",
    `PACIENTE ${n}`,
    "PRONTUARIO-SECRETO",
    v.atend,
    n,
    "7900000000",
    v.conv,
    "2",
    "Sergio Almeida de Oliveira",
    "",
    "",
    v.proc,
    v.status,
    "Autorizado",
    "A",
    "LEITO",
    "",
    "PESSOA",
    "Com OPME",
    "240",
    "Convencional",
  ]
    .map((x) => `"${x}"`)
    .join(";");
}

const CAB_REPASSE = "Convênio;Atend;Medico Executor;Paciente;Dt Item;Código;Descrição;Data Pagamento;Vl Repasse";
const buf = (...linhas: string[]) => Buffer.from(linhas.join("\n"), "utf8");

beforeAll(async () => {
  clienteId = (await prisma.cliente.create({ data: { nome: `Clínica 2b ${SUFIXO}` } })).id;
  outroClienteId = (await prisma.cliente.create({ data: { nome: `Outra 2b ${SUFIXO}` } })).id;
  unimedId = (await prisma.operadora.create({ data: { nome: `Unimed 2b ${SUFIXO}` } })).id;
  await prisma.profissional.create({ data: { clienteId, nome: "Sergio Almeida de Oliveira", conselho: "CRM" } });
  const u = await prisma.user.create({ data: { nome: `F ${SUFIXO}`, email: `f2b-${SUFIXO}@teste.local`, role: "FUNCIONARIO" } });
  usuarioId = u.id;
  // ⚠️ A Conciliação exige que o funcionário seja o RESPONSÁVEL pelo cliente (a régua do Painel
  // do Cliente, ADR-128). Sem esta linha o `caller` leva FORBIDDEN em toda rota — que é a trava
  // funcionando, não defeito do teste.
  //
  // Os DOIS clientes, de propósito: o teste do `editarCirurgia` com o cliente errado prova a posse
  // conferida DENTRO do serviço (`WHERE clienteId`). Se a trava de fora barrasse antes, aquele
  // teste passaria a verde sem exercer nada — a trava nova escondendo a antiga.
  await prisma.cliente.updateMany({ where: { id: { in: [clienteId, outroClienteId] } }, data: { responsavelId: usuarioId } });
  caller = appRouter.createCaller({ user: { id: u.id, role: "FUNCIONARIO", nome: u.nome, email: u.email }, req: {}, res: {} } as never);

  // 101 e 102 no MESMO atendimento (acontece no arquivo real); 103 sem atendimento; 104 reservada.
  await importarCirurgias({
    clienteId,
    bytes: buf(
      CAB_TASY,
      cir("101", { atend: "5000" }),
      cir("102", { atend: "5000", proc: "Drenagem Do Pericárdio" }),
      cir("103", { atend: "" }),
      cir("104", { status: "Reservada" }),
    ),
    nomeArquivo: "tasy.csv",
    usuarioId,
  });
  await caller.conciliacao.ligarConvenio({ clienteId, textoBruto: "Central Nacional Unimed", operadoraId: unimedId });
});

afterAll(async () => {
  await prisma.cliente.deleteMany({ where: { id: { in: [clienteId, outroClienteId] } } });
  await prisma.operadora.deleteMany({ where: { id: unimedId } });
  await prisma.user.deleteMany({ where: { id: usuarioId } });
  await prisma.$disconnect();
});

const linha = async (numero: string) => {
  const r = await caller.conciliacao.cirurgias({ clienteId });
  return r.linhas.find((l) => l.numeroCirurgia === numero)!;
};

describe("cobrado — o de-para do procedimento", () => {
  it("sem de-para, a cirurgia com atendimento está SEM_VALOR", async () => {
    expect((await linha("101")).statusConciliacao).toBe("SEM_VALOR");
    expect((await linha("103")).statusConciliacao).toBe("SEM_ATENDIMENTO");
    expect((await linha("104")).statusConciliacao).toBe("NAO_REALIZADA");
  });

  it("valor padrão vale para todos; o da operadora ganha do padrão", async () => {
    await caller.conciliacao.salvarProcedimento({
      clienteId,
      textoBruto: "Revascularização Miocárdica",
      operadoraId: null,
      codigo: "30917042",
      valor: 8000,
    });
    expect(await linha("101")).toMatchObject({
      cobrado: 8000,
      cobradoOrigem: "DE_PARA",
      codigo: "30917042",
      statusConciliacao: "A_RECEBER",
    });

    await caller.conciliacao.salvarProcedimento({
      clienteId,
      textoBruto: "REVASCULARIZAÇÃO MIOCÁRDICA",
      operadoraId: unimedId,
      codigo: "40020045",
      valor: 10000,
    });
    expect(await linha("101")).toMatchObject({ cobrado: 10000, codigo: "40020045" });

    // Um procedimento só na lista, apesar das duas grafias.
    const procs = await caller.conciliacao.procedimentos({ clienteId });
    const revasc = procs.filter((p) => p.procedimento.toLowerCase().startsWith("revasc"));
    expect(revasc).toHaveLength(1);
    expect(revasc[0]!.padrao).toEqual({ codigo: "30917042", valor: 8000 });
    expect(revasc[0]!.porOperadora).toHaveLength(1);
  });

  it("apagar código e valor remove o de-para", async () => {
    await caller.conciliacao.salvarProcedimento({
      clienteId,
      textoBruto: "Drenagem Do Pericárdio",
      operadoraId: null,
      codigo: "X",
      valor: 2000,
    });
    const r = await caller.conciliacao.salvarProcedimento({
      clienteId,
      textoBruto: "Drenagem Do Pericárdio",
      operadoraId: null,
      codigo: null,
      valor: null,
    });
    expect(r.removido).toBe(true);
    await caller.conciliacao.salvarProcedimento({
      clienteId,
      textoBruto: "Drenagem Do Pericárdio",
      operadoraId: null,
      codigo: null,
      valor: 2000,
    });
  });
});

describe("recebido — o repasse do TASY", () => {
  const repasse = buf(
    CAB_REPASSE,
    "Unimed Seguros Saúde;5000;Sergio;PACIENTE X;04/05/2026;40020045;Revasc;31/08/2026;9.000,00",
    "Unimed Seguros Saúde;5000;Gustavo;PACIENTE X;04/05/2026;40020045;Aux;31/08/2026;1.200,00",
    ";0;;;;0;MC - JUNHO/26;31/08/2026;12.106,64",
  );

  it("a prévia separa o que casa do que entrou sem produção, e não grava", async () => {
    const p = await previsualizarRepasse({ clienteId, bytes: repasse });
    expect(p.casadas).toEqual({ linhas: 2, total: 10200 });
    expect(p.semProducao).toEqual({ linhas: 1, total: 12106.64 });
    expect(await prisma.repasseLinha.count({ where: { clienteId } })).toBe(0);
  });

  it("importa, reparte o atendimento entre as duas cirurgias pelo cobrado, e o incremento NÃO some", async () => {
    await importarRepasse({ clienteId, bytes: repasse, nomeArquivo: "repasse-08.csv", usuarioId });
    const a = await linha("101"); // cobrado 10.000
    const b = await linha("102"); // cobrado 2.000
    expect(a.recebido! + b.recebido!).toBe(10200); // bate no centavo com o repasse
    expect(a.recebido).toBe(8500);
    expect(b.recebido).toBe(1700);
    expect(a).toMatchObject({
      recebidoOrigem: "REPASSE",
      repasseCompartilhado: true,
      dataPagamento: "2026-08-31",
      glosa: 1500,
      statusConciliacao: "GLOSA_PARCIAL",
    });

    const resumo = await caller.conciliacao.resumoCirurgias({ clienteId });
    expect(resumo.recebidoSemProducao).toEqual({ total: 12106.64, linhas: 1, naoAtribuido: 0 });
    // Cobrado inclui a 103: sem atendimento ela não casa com o repasse, mas foi realizada e é
    // dinheiro que deveria entrar (10.000 + 2.000 + 10.000). A 104, reservada, fica fora.
    expect(resumo.dinheiro).toMatchObject({ cobrado: 22000, recebido: 10200, glosa: 1800, aReceber: 0 });
    expect(resumo.dinheiro.porStatus.SEM_ATENDIMENTO).toBe(1);

    const sem = await caller.conciliacao.recebidoSemProducao({ clienteId });
    expect(sem).toHaveLength(1);
    expect(sem[0]!.descricao).toBe("MC - JUNHO/26");
  });

  it("o mesmo pagamento de novo: mesmo arquivo recusa; o relatório corrigido do MESMO médico pede confirmação e substitui", async () => {
    await expect(importarRepasse({ clienteId, bytes: repasse, nomeArquivo: "x.csv", usuarioId })).rejects.toThrow(/já foi importado/i);

    const corrigido = buf(
      CAB_REPASSE,
      "Unimed;5000;Sergio;X;04/05/2026;1;R;31/08/2026;10.800,00",
      "Unimed;5000;Gustavo;X;04/05/2026;1;Aux;31/08/2026;1.200,00",
    );
    await expect(importarRepasse({ clienteId, bytes: corrigido, nomeArquivo: "y.csv", usuarioId })).rejects.toThrow(
      /Confirme a substituição/i,
    );
    const r = await importarRepasse({ clienteId, bytes: corrigido, nomeArquivo: "y.csv", usuarioId, substituir: true });
    // Troca as 2 linhas daqueles médicos naquele período — e o incremento (outro "executor") fica.
    expect(r.substituidas).toBe(2);
    expect(await prisma.repasseLinha.count({ where: { clienteId } })).toBe(3);
    expect((await linha("101")).statusConciliacao).toBe("PAGO"); // 12.000 repartidos: 10.000 + 2.000
  });

  it("o repasse de OUTRO médico no mesmo período não apaga o deste — e linha idêntica sem data é repetição", async () => {
    const outroMedico = buf(CAB_REPASSE, "Unimed;7777;Outro Medico;X;04/05/2026;1;R;31/08/2026;500,00");
    const r = await importarRepasse({ clienteId, bytes: outroMedico, nomeArquivo: "outro.csv", usuarioId });
    expect(r.substituidas).toBe(0);
    expect(await prisma.repasseLinha.count({ where: { clienteId } })).toBe(4);

    // Sem coluna de data, a trava do período não existe — a da linha idêntica, sim.
    const semData = "Convênio;Atend;Medico Executor;Vl Repasse";
    await importarRepasse({ clienteId, bytes: buf(semData, "Amil;8888;Z;300,00"), nomeArquivo: "s1.csv", usuarioId });
    await expect(
      importarRepasse({ clienteId, bytes: buf(semData, "Amil;8888;Z;300,00", ""), nomeArquivo: "s2.csv", usuarioId }),
    ).rejects.toThrow(/Confirme a substituição/i);
    // Limpa para não mexer nos testes seguintes.
    await prisma.repasseLinha.deleteMany({ where: { clienteId, atendimento: { in: ["7777", "8888"] } } });
  });

  it("recebido DIGITADO numa cirurgia é abatido do repasse do atendimento — nunca conta duas vezes", async () => {
    const a = await linha("101");
    await caller.conciliacao.editarCirurgia({ clienteId, cirurgiaId: a.id, valorRecebido: 10000 });
    // Repasse do atendimento 5000 = 12.000; 10.000 digitados na 101 → sobram 2.000 para a 102.
    expect((await linha("102")).recebido).toBe(2000);
    const resumo = await caller.conciliacao.resumoCirurgias({ clienteId });
    expect(resumo.dinheiro.recebido).toBe(12000);

    // Digitado além do repasse: nada sobra para a 102, e nada é inventado.
    await caller.conciliacao.editarCirurgia({ clienteId, cirurgiaId: a.id, valorRecebido: 12000 });
    expect((await linha("102")).recebido).toBe(0);
    await caller.conciliacao.editarCirurgia({ clienteId, cirurgiaId: a.id, valorRecebido: null });
  });

  it("repasse de atendimento sem cirurgia COBRÁVEL não some: vira 'não atribuído'", async () => {
    const [a, b] = [await linha("101"), await linha("102")];
    await caller.conciliacao.editarCirurgia({ clienteId, cirurgiaId: a.id, naoCobrar: true });
    await caller.conciliacao.editarCirurgia({ clienteId, cirurgiaId: b.id, naoCobrar: true });
    const resumo = await caller.conciliacao.resumoCirurgias({ clienteId });
    expect(resumo.recebidoSemProducao.naoAtribuido).toBe(12000);
    await caller.conciliacao.editarCirurgia({ clienteId, cirurgiaId: a.id, naoCobrar: false });
    await caller.conciliacao.editarCirurgia({ clienteId, cirurgiaId: b.id, naoCobrar: false });
  });
});

describe("recebido — a planilha preenchida volta", () => {
  it("grava o que veio preenchido, casando pelo Nº Cirurgia, e o digitado manda sobre o repasse", async () => {
    const CAB =
      '"Data";"Nº Cirurgia";"Atendimento";"Paciente";"Prontuário";"Convênio";"Médico";"Procedimento (Tasy)";"Status Tasy";"Autorização Tasy";"Cód. Procedimento (De-Para)";"Valor cobrado (R$)";"Valor recebido (R$)";"Glosa (R$)";"Data pagamento";"Status conciliação";"Observação"';
    const planilha = buf(
      CAB,
      '"2026-05-04";"103";"";"";"";"";"";"";"";"";"";"5.000,00";"4.000,00";"";"10/09/2026";"";"sem atendimento no TASY, pago à parte"',
      '"2026-05-04";"999999";"";"";"";"";"";"";"";"";"";"";"1,00";"";"";"";""',
    );
    const r = await importarPlanilha({ clienteId, bytes: planilha, nomeArquivo: "conciliacao.csv", usuarioId });
    expect(r).toMatchObject({ atualizadas: 1, desconhecidas: 1 });
    expect(await linha("103")).toMatchObject({
      cobrado: 5000,
      cobradoOrigem: "MANUAL",
      recebido: 4000,
      recebidoOrigem: "MANUAL",
      glosa: 1000,
      statusConciliacao: "GLOSA_PARCIAL",
      dataPagamento: "2026-09-10",
      observacao: "sem atendimento no TASY, pago à parte",
    });
  });

  it("exportar e devolver SEM mexer não congela nada — o cobrado continua vindo do de-para", async () => {
    const e = await caller.conciliacao.exportar({ clienteId });
    await expect(
      importarPlanilha({ clienteId, bytes: Buffer.from(e.modelo, "utf8"), nomeArquivo: "ida-e-volta.csv", usuarioId }),
    ).rejects.toThrow(/nada diferente/i);
    // E o de-para segue mandando: mudar o preço do pacote muda o cobrado da 101 na hora.
    await caller.conciliacao.salvarProcedimento({
      clienteId,
      textoBruto: "Revascularização Miocárdica",
      operadoraId: unimedId,
      codigo: "40020045",
      valor: 11000,
    });
    expect(await linha("101")).toMatchObject({ cobrado: 11000, cobradoOrigem: "DE_PARA" });
    await caller.conciliacao.salvarProcedimento({
      clienteId,
      textoBruto: "Revascularização Miocárdica",
      operadoraId: unimedId,
      codigo: "40020045",
      valor: 10000,
    });
  });

  it("planilha de OUTRO cliente não grava nada", async () => {
    const CAB = '"Nº Cirurgia";"Valor recebido (R$)"';
    await expect(
      importarPlanilha({ clienteId: outroClienteId, bytes: buf(CAB, '"101";"1,00"'), nomeArquivo: "z.csv", usuarioId }),
    ).rejects.toThrow(/cliente certo/i);
  });
});

describe("edição, filtros, exportação e visão geral", () => {
  it("editar pela tela, e a posse é conferida", async () => {
    const alvo = await linha("102");
    await caller.conciliacao.editarCirurgia({ clienteId, cirurgiaId: alvo.id, naoCobrar: true, observacao: "cortesia" });
    expect((await linha("102")).statusConciliacao).toBe("NAO_COBRAR");
    await expect(caller.conciliacao.editarCirurgia({ clienteId: outroClienteId, cirurgiaId: alvo.id, naoCobrar: false })).rejects.toThrow(
      /não encontrada/i,
    );
    await expect(caller.conciliacao.editarCirurgia({ clienteId, cirurgiaId: alvo.id, valorRecebido: -5 })).rejects.toThrow();
  });

  it("filtro por status e totais do filtro inteiro", async () => {
    const r = await caller.conciliacao.cirurgias({ clienteId, statusConciliacao: "GLOSA_PARCIAL" });
    expect(r.linhas.map((l) => l.numeroCirurgia)).toEqual(["103"]);
    expect(r.totais).toMatchObject({ cirurgias: 1, cobrado: 5000, recebido: 4000, glosa: 1000 });
  });

  it("exporta o MODELO com as colunas de sempre, prontuário vazio, e os dois resumos", async () => {
    const e = await caller.conciliacao.exportar({ clienteId });
    expect(e.linhas).toBe(4);
    const [cab, ...corpo] = e.modelo
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n");
    expect(cab).toBe(
      '"Data";"Nº Cirurgia";"Atendimento";"Paciente";"Prontuário";"Convênio";"Médico";"Procedimento (Tasy)";"Status Tasy";"Autorização Tasy";"Cód. Procedimento (De-Para)";"Valor cobrado (R$)";"Valor recebido (R$)";"Glosa (R$)";"Data pagamento";"Status conciliação";"Observação"',
    );
    const l103 = corpo.find((l) => l.includes('"103"'))!;
    expect(l103).toContain(';5000,00;4000,00;1000,00;"10/09/2026";"Glosa parcial"');
    expect(e.modelo).not.toContain("PRONTUARIO-SECRETO");
    expect(e.porConvenio).toContain('"Central Nacional Unimed";4;');
    expect(e.porMesMedico).toContain('"2026-05";"Sergio Almeida de Oliveira";4;');
  });

  it("visão geral traz o cliente com o placar", async () => {
    const v = await caller.conciliacao.visaoGeral();
    const deste = v.clientes.find((c) => c.clienteId === clienteId)!;
    expect(deste).toMatchObject({ cirurgias: 4, recebidoSemProducao: 12106.64 });
    expect(deste.cobrado).toBeGreaterThan(0);
  });

  it("nenhuma rota nova devolve prontuário, pessoa ou leito", async () => {
    const json = JSON.stringify([
      await caller.conciliacao.cirurgias({ clienteId }),
      await caller.conciliacao.resumoCirurgias({ clienteId }),
      await caller.conciliacao.procedimentos({ clienteId }),
      await caller.conciliacao.recebidoSemProducao({ clienteId }),
      await caller.conciliacao.visaoGeral(),
    ]);
    expect(json).not.toMatch(/PRONTUARIO-SECRETO|"LEITO"|"PESSOA"|PACIENTE X/);
  });
});
