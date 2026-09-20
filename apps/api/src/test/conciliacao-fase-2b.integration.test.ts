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

/**
 * O TEMPO — o que separa "esperando" de "travado".
 *
 * ⚠️ Roda no OUTRO cliente da fixture, que não tem cirurgia nenhuma: acrescentar linhas ao
 * cliente principal mudaria as contagens que os testes acima afirmam.
 */
describe("o que passou do prazo de pagamento", () => {
  const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    await importarCirurgias({
      clienteId: outroClienteId,
      bytes: buf(
        CAB_TASY,
        // Uma bem antiga (muito além da defasagem de ~3,5 meses) e uma de ontem.
        cir("900").replace("2026-05-04", diasAtras(400)),
        cir("901").replace("2026-05-04", diasAtras(1)),
      ),
      nomeArquivo: "prazo.csv",
      usuarioId,
    });
  });

  it("a antiga está atrasada; a de ontem está apenas esperando", async () => {
    const r = await caller.conciliacao.cirurgias({ clienteId: outroClienteId });
    const porNumero = new Map(r.linhas.map((l) => [l.numeroCirurgia, l]));
    expect(porNumero.get("900")!.atrasada).toBe(true);
    expect(porNumero.get("901")!.atrasada).toBe(false);
    // ⚠️ As duas estão SEM_VALOR (sem de-para neste cliente) — e o atraso vale para elas também:
    // não saber quanto cobrar há um ano é justamente o caso que ninguém percebe.
    expect(porNumero.get("900")!.statusConciliacao).toBe("SEM_VALOR");
    expect(r.totais.atrasadas).toBe(1);
  });

  it("o filtro devolve só o que travou, e a contagem acompanha", async () => {
    const r = await caller.conciliacao.cirurgias({ clienteId: outroClienteId, soAtrasadas: true });
    expect(r.linhas.map((l) => l.numeroCirurgia)).toEqual(["900"]);
    expect(r.total).toBe(1);
  });

  it("a visão geral mostra o atraso do cliente", async () => {
    const v = await caller.conciliacao.visaoGeral();
    const deste = v.clientes.find((c) => c.clienteId === outroClienteId)!;
    expect(deste.atrasadas).toBe(1);
    // Sem de-para não há valor para somar — o dinheiro atrasado é zero, mas a CONTAGEM não.
    expect(deste.aReceberAtrasado).toBe(0);
  });
});

/**
 * FASE 2c — o recurso de glosa: o que se faz DEPOIS de achar o problema.
 *
 * ⚠️ A asserção que mais importa não é "o recurso foi criado": é que o recurso **não guarda
 * dinheiro**. Quando a operadora acata, o valor entra por um repasse novo e a glosa se recalcula
 * sozinha — se algum dia alguém puser um campo de valor aqui, os dois números vão divergir.
 */
describe("recurso de glosa", () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  let glosada = "";

  beforeAll(async () => {
    const r = await caller.conciliacao.cirurgias({ clienteId, statusConciliacao: "GLOSA_PARCIAL" });
    glosada = r.linhas[0]!.id;
  });

  it("não se recorre do que NÃO foi glosado — e a recusa vem do servidor", async () => {
    const paga = (await caller.conciliacao.cirurgias({ clienteId, statusConciliacao: "PAGO" })).linhas[0];
    if (paga) {
      await expect(caller.conciliacao.abrirRecurso({ clienteId, cirurgiaId: paga.id, abertoEm: hoje })).rejects.toThrow(
        /só dá para recorrer de cirurgia com glosa/i,
      );
    }
  });

  it("abre o recurso, e a linha passa a dizer que está em disputa", async () => {
    await caller.conciliacao.abrirRecurso({
      clienteId,
      cirurgiaId: glosada,
      abertoEm: diasAtras(45),
      canal: "Portal da operadora",
      protocolo: "PROT-123",
      motivoDaGlosa: "OPME não autorizado",
    });

    const linha = (await caller.conciliacao.cirurgias({ clienteId })).linhas.find((l) => l.id === glosada)!;
    expect(linha.recurso).toMatchObject({ status: "ABERTO", tentativa: 1, protocolo: "PROT-123" });
    // 45 dias sem resposta, com prazo de 30: é o que precisa de telefonema.
    expect(linha.recurso!.semResposta).toBe(true);
  });

  it("⚠️ dois recursos abertos para a mesma cirurgia seriam dois protocolos disputando a mesma glosa", async () => {
    await expect(caller.conciliacao.abrirRecurso({ clienteId, cirurgiaId: glosada, abertoEm: hoje })).rejects.toThrow(
      /já existe um recurso aberto/i,
    );
  });

  it("os totais separam o que está em disputa do que ninguém cuidou", async () => {
    const t = (await caller.conciliacao.cirurgias({ clienteId })).totais;
    expect(t.emRecurso).toBeGreaterThan(0);
    expect(t.recursosSemResposta).toBe(1);
    // A glosa desta cirurgia saiu de "ninguém recorreu" e entrou em "em disputa" — nunca as duas.
    const linha = (await caller.conciliacao.cirurgias({ clienteId })).linhas.find((l) => l.id === glosada)!;
    expect(t.emRecurso).toBe(linha.glosa);
  });

  it("o filtro do que ninguém cuidou não devolve o que já tem recurso", async () => {
    const semRecurso = await caller.conciliacao.cirurgias({ clienteId, recurso: "SEM_RECURSO" });
    expect(semRecurso.linhas.map((l) => l.id)).not.toContain(glosada);
    // E tudo o que ele devolve É glosa — senão a pergunta se afoga em cirurgia paga.
    for (const l of semRecurso.linhas) expect(["GLOSA_PARCIAL", "GLOSA_TOTAL"]).toContain(l.statusConciliacao);

    const semResposta = await caller.conciliacao.cirurgias({ clienteId, recurso: "SEM_RESPOSTA" });
    expect(semResposta.linhas.map((l) => l.id)).toEqual([glosada]);
  });

  it("responder é IDEMPOTENTE no sentido certo: não reescreve o desfecho já registrado", async () => {
    const recursos = await caller.conciliacao.recursosDaCirurgia({ clienteId, cirurgiaId: glosada });
    const id = recursos[0]!.id;
    await caller.conciliacao.responderRecurso({ clienteId, recursoId: id, status: "NEGADO", respondidoEm: hoje });

    await expect(caller.conciliacao.responderRecurso({ clienteId, recursoId: id, status: "ACATADO", respondidoEm: hoje })).rejects.toThrow(
      /já foi registrada/i,
    );

    const depois = await caller.conciliacao.recursosDaCirurgia({ clienteId, cirurgiaId: glosada });
    expect(depois[0]!.status).toBe("NEGADO");
  });

  it("recorrer de novo é LINHA NOVA — a prova de que a primeira foi negada não some", async () => {
    await caller.conciliacao.abrirRecurso({ clienteId, cirurgiaId: glosada, abertoEm: hoje, protocolo: "PROT-456" });

    const historico = await caller.conciliacao.recursosDaCirurgia({ clienteId, cirurgiaId: glosada });
    expect(historico).toHaveLength(2);
    expect(historico.map((r) => [r.tentativa, r.status])).toEqual([
      [2, "ABERTO"],
      [1, "NEGADO"],
    ]);

    // A linha da tabela fala do estado de AGORA: a tentativa 2, aberta.
    const linha = (await caller.conciliacao.cirurgias({ clienteId })).linhas.find((l) => l.id === glosada)!;
    expect(linha.recurso).toMatchObject({ tentativa: 2, status: "ABERTO", protocolo: "PROT-456" });
  });

  it("⚠️ o recurso NÃO guarda dinheiro — quem paga é o repasse", async () => {
    // A régua é sobre CAMPO DE VALOR, não sobre a palavra "glosa": `motivoDaGlosa` é texto do que
    // a operadora alegou, e precisa existir. O que não pode existir é um número que concorra com
    // o repasse pela verdade do dinheiro — no dia em que a operadora pagar diferente do que
    // respondeu, os dois divergem e ninguém sabe qual está certo.
    const recursos = await caller.conciliacao.recursosDaCirurgia({ clienteId, cirurgiaId: glosada });
    const campos = new Set(recursos.flatMap((r) => Object.keys(r)));
    for (const campo of campos) {
      expect(campo, `${campo} parece guardar dinheiro no recurso`).not.toMatch(/valor|cobrado|recebido|montante/i);
    }
  });

  it("e a posse é conferida: recurso de outro cliente não responde", async () => {
    const recursos = await caller.conciliacao.recursosDaCirurgia({ clienteId, cirurgiaId: glosada });
    await expect(
      caller.conciliacao.responderRecurso({
        clienteId: outroClienteId,
        recursoId: recursos[0]!.id,
        status: "ACATADO",
        respondidoEm: hoje,
      }),
    ).rejects.toThrow(/não encontrado/i);
  });
});

/**
 * FECHAR A COMPETÊNCIA — "este mês está conferido".
 *
 * ⚠️ A asserção que mais importa é a da §2 da spec: fechar **não congela número nenhum**. O mês
 * fechado continua sendo calculado, e o que o fechamento guarda é um RETRATO — para dizer que os
 * números mudaram depois, não para exibi-los no lugar do cálculo.
 */
describe("fechar a competência", () => {
  const MES = "2026-05";
  let callerAdmin: ReturnType<typeof appRouter.createCaller>;
  let adminId = "";
  let alvo = "";

  beforeAll(async () => {
    const a = await prisma.user.create({
      data: { nome: `Chefe ${SUFIXO}`, email: `chefe-2b-${SUFIXO}@teste.local`, role: "ADMIN" },
    });
    adminId = a.id;
    callerAdmin = appRouter.createCaller({
      user: { id: a.id, role: "ADMIN", nome: a.nome, email: a.email },
      req: {},
      res: {},
    } as never);
    alvo = (await caller.conciliacao.cirurgias({ clienteId, competencia: MES })).linhas[0]!.id;
  });

  afterAll(async () => {
    await prisma.competenciaFechada.deleteMany({ where: { clienteId } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  it("o FUNCIONÁRIO concilia o mês, mas não declara que ele está conferido", async () => {
    await expect(caller.conciliacao.fecharCompetencia({ clienteId, competencia: MES })).rejects.toThrow(/responde pela conta/i);
  });

  it("o ADMIN fecha, e o retrato guarda o que foi conferido", async () => {
    const antes = (await caller.conciliacao.cirurgias({ clienteId, competencia: MES })).totais;
    await callerAdmin.conciliacao.fecharCompetencia({ clienteId, competencia: MES, observacao: "conferido com a Juliana" });

    const [f] = await caller.conciliacao.competenciasFechadas({ clienteId });
    expect(f).toMatchObject({ competencia: MES, fechadoPor: expect.stringContaining("Chefe"), divergiu: false });
    expect(f!.retrato.cobrado).toBe(antes.cobrado);
    expect(f!.retrato.glosa).toBe(antes.glosa);
  });

  it("⚠️ e o mês fechado NÃO muda por edição manual — nem a cirurgia, nem o recurso dela", async () => {
    await expect(caller.conciliacao.editarCirurgia({ clienteId, cirurgiaId: alvo, observacao: "x" })).rejects.toThrow(
      /conferida e fechada/i,
    );
    await expect(caller.conciliacao.abrirRecurso({ clienteId, cirurgiaId: alvo, abertoEm: "2026-09-01" })).rejects.toThrow(
      /conferida e fechada/i,
    );
  });

  it("⚠️ mas o número CONTINUA sendo calculado — fechar não congela nada", async () => {
    // Mudar o de-para do procedimento muda o cobrado de todas as cirurgias dele, inclusive as do
    // mês fechado. É o comportamento certo (o dinheiro é o de hoje) e a razão de o retrato existir.
    await callerAdmin.conciliacao.salvarProcedimento({
      clienteId,
      textoBruto: "Revascularização Miocárdica",
      // ⚠️ Pelo de-para DA OPERADORA: o valor por operadora ganha do padrão (Fase 2b), então
      // mexer no padrão não moveria nada — e o teste passaria verde sem exercer a divergência.
      operadoraId: unimedId,
      codigo: "40020045",
      valor: 11000,
    });

    const [f] = await caller.conciliacao.competenciasFechadas({ clienteId });
    expect(f!.divergiu, "o mês mudou depois de fechado e ninguém ficaria sabendo").toBe(true);
    expect(f!.agora.cobrado).not.toBe(f!.retrato.cobrado);
    // ⚠️ E o retrato NÃO foi reescrito: ele é a memória de quando se conferiu.
    expect(f!.retrato.cobrado).toBeGreaterThan(0);
  });

  it("reabrir devolve a edição, e não apaga quem conferiu", async () => {
    await callerAdmin.conciliacao.reabrirCompetencia({ clienteId, competencia: MES });
    await caller.conciliacao.editarCirurgia({ clienteId, cirurgiaId: alvo, observacao: "reaberto e editado" });

    // Some da lista de fechadas (é isso que "reaberto" significa para a tela)…
    expect(await caller.conciliacao.competenciasFechadas({ clienteId })).toEqual([]);
    // …mas a linha continua no banco, com quem fechou.
    const linha = await prisma.competenciaFechada.findFirst({ where: { clienteId, competencia: MES } });
    expect(linha).toMatchObject({ fechadoPorId: adminId, reabertoPorId: adminId });

    await expect(callerAdmin.conciliacao.reabrirCompetencia({ clienteId, competencia: MES })).rejects.toThrow(/não está fechada/i);
  });

  it("não se fecha mês sem cirurgia nenhuma", async () => {
    await expect(callerAdmin.conciliacao.fecharCompetencia({ clienteId, competencia: "2019-01" })).rejects.toThrow(
      /não há cirurgia importada/i,
    );
  });
});
