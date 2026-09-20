import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.EMAIL_CRYPTO_KEY ??= randomBytes(32).toString("base64");
process.env.PACIENTE_CRYPTO_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@app/db");
const { appRouter } = await import("../trpc/router.js");
const { importarCirurgias } = await import("../modules/conciliacao/cirurgias.service.js");
const { decidirConferenciaDeCliente } = await import("../modules/conciliacao/conciliacao.router.js");

/**
 * QUEM VÊ O DINHEIRO DE QUEM.
 *
 * A Conciliação é a tela com mais dinheiro de TERCEIRO do sistema: quanto cada clínica cobrou,
 * recebeu e teve glosado, com nome de paciente ao lado. Até 20/09/2026 ela era
 * `funcionarioProcedure` puro — qualquer pessoa da equipe via a de **todos** os clientes.
 *
 * A régua agora é a mesma do Painel do Cliente (ADR-128): ADMIN+ vê tudo, funcionário vê os
 * clientes sob a responsabilidade dele. Estes testes exercem as DUAS pontas, contra MySQL de
 * verdade e pelo `createCaller` — chamar o serviço direto pularia o procedure, que é onde a
 * trava mora, e passaria verde com o buraco aberto (a lição da ADR-137).
 */

const SUFIXO = randomBytes(4).toString("hex");
let meuCliente = "";
let clienteAlheio = "";
let dono = "";
let estranho = "";
let chefe = "";
let caller: ReturnType<typeof appRouter.createCaller>;
let callerEstranho: ReturnType<typeof appRouter.createCaller>;
let callerChefe: ReturnType<typeof appRouter.createCaller>;

const CAB =
  '"Data";"Hora (UTC)";"Sala";"Duração prev (min)";"Paciente";"Prontuário";"Atendimento";"Nº Cirurgia";"Seq Cirurgia";"Convênio";"Tipo Conv";"Médico";"Anestesista";"Tipo Anestesia";"Procedimento";"Status";"Autorização";"Cód Aut";"Unid. Internação";"Setor";"Cód Pessoa";"OPME";"Tempo (min)";"Técnica"';

const cir = (n: string) =>
  [
    "2026-05-04",
    "2026-05-04T10:00:00Z",
    "S1",
    "60",
    `PAC ${n}`,
    "P",
    `9${n}`,
    n,
    "1",
    "Unimed",
    "2",
    "Dr X",
    "",
    "",
    "Proc",
    "Executada",
    "Autorizado",
    "A",
    "L",
    "",
    "",
    "",
    "60",
    "",
  ]
    .map((x) => `"${x}"`)
    .join(";");

const como = (id: string, nome: string, email: string, role: "FUNCIONARIO" | "ADMIN") =>
  appRouter.createCaller({ user: { id, role, nome, email }, req: {}, res: {} } as never);

beforeAll(async () => {
  const u1 = await prisma.user.create({ data: { nome: `Dono ${SUFIXO}`, email: `dono-${SUFIXO}@teste.local`, role: "FUNCIONARIO" } });
  const u2 = await prisma.user.create({ data: { nome: `Estranho ${SUFIXO}`, email: `est-${SUFIXO}@teste.local`, role: "FUNCIONARIO" } });
  const u3 = await prisma.user.create({ data: { nome: `Chefe ${SUFIXO}`, email: `chefe-${SUFIXO}@teste.local`, role: "ADMIN" } });
  dono = u1.id;
  estranho = u2.id;
  chefe = u3.id;

  meuCliente = (await prisma.cliente.create({ data: { nome: `Meu ${SUFIXO}`, responsavelId: dono } })).id;
  clienteAlheio = (await prisma.cliente.create({ data: { nome: `Alheio ${SUFIXO}`, responsavelId: estranho } })).id;

  caller = como(dono, u1.nome, u1.email, "FUNCIONARIO");
  callerEstranho = como(estranho, u2.nome, u2.email, "FUNCIONARIO");
  callerChefe = como(chefe, u3.nome, u3.email, "ADMIN");

  for (const [cl, quem] of [
    [meuCliente, dono],
    [clienteAlheio, estranho],
  ] as const) {
    await importarCirurgias({
      clienteId: cl,
      bytes: Buffer.from([CAB, cir("777")].join("\n"), "utf8"),
      nomeArquivo: "t.csv",
      usuarioId: quem,
    });
  }
});

afterAll(async () => {
  await prisma.cliente.deleteMany({ where: { id: { in: [meuCliente, clienteAlheio] } } });
  await prisma.user.deleteMany({ where: { id: { in: [dono, estranho, chefe] } } });
  await prisma.$disconnect();
});

describe("a trava por cliente", () => {
  it("o funcionário abre a conciliação do cliente DELE", async () => {
    const r = await caller.conciliacao.cirurgias({ clienteId: meuCliente });
    expect(r.linhas).toHaveLength(1);
  });

  it("e leva FORBIDDEN, em português, no cliente de outra pessoa", async () => {
    await expect(caller.conciliacao.cirurgias({ clienteId: clienteAlheio })).rejects.toThrow(/sob a sua responsabilidade/i);
  });

  // ⚠️ Ler é o menor dos estragos. O que não pode acontecer de jeito nenhum é MEXER no dinheiro
  // de um cliente que não é seu — daí a trava valer para leitura e escrita, e este teste existir.
  it("a trava também barra ESCRITA no cliente alheio", async () => {
    await expect(
      caller.conciliacao.salvarProcedimento({ clienteId: clienteAlheio, textoBruto: "Proc", operadoraId: null, codigo: "1", valor: 10 }),
    ).rejects.toThrow(/sob a sua responsabilidade/i);
    await expect(caller.conciliacao.exportar({ clienteId: clienteAlheio })).rejects.toThrow(/sob a sua responsabilidade/i);
  });

  it("ADMIN passa nos dois — quem responde pela casa vê a casa toda", async () => {
    expect((await callerChefe.conciliacao.cirurgias({ clienteId: meuCliente })).linhas).toHaveLength(1);
    expect((await callerChefe.conciliacao.cirurgias({ clienteId: clienteAlheio })).linhas).toHaveLength(1);
  });
});

/**
 * ⚠️ A OUTRA METADE DA RÉGUA DA ADR-128.
 *
 * A trava foi emprestada do Painel do Cliente porque o risco é o mesmo — dado de terceiro. Mas
 * lá a régua tem duas metades: a trava e o REGISTRO (`painel_cliente.entrou`), que é o que
 * permite responder *quem viu o quê, e quando*. Sem a segunda, não havia como saber quem mudou
 * o valor de um procedimento ou importou um repasse no cliente de outra pessoa.
 */
describe("quem mexeu no dinheiro de quem fica registrado", () => {
  it("a escrita grava no rastro de atividade, com a pessoa e o cliente", async () => {
    await caller.conciliacao.salvarProcedimento({
      clienteId: meuCliente,
      textoBruto: "Proc",
      operadoraId: null,
      codigo: "30917042",
      valor: 1234,
    });

    // O registro é best-effort (não pode derrubar a gravação), então é escrito FORA da transação
    // da rota — esperar por ele é o certo aqui, e não sinal de teste frouxo.
    await expect
      .poll(
        () =>
          prisma.activityLog.count({
            where: { userId: dono, acao: "conciliacao.salvarProcedimento", entidadeTipo: "cliente", entidadeId: meuCliente },
          }),
        { timeout: 5_000 },
      )
      .toBe(1);
  });

  it("LEITURA não entra no rastro — senão a tabela vira ruído e o expurgo volta a fazer falta", async () => {
    const antes = await prisma.activityLog.count({ where: { entidadeId: meuCliente } });
    await caller.conciliacao.cirurgias({ clienteId: meuCliente });
    await caller.conciliacao.procedimentos({ clienteId: meuCliente });
    expect(await prisma.activityLog.count({ where: { entidadeId: meuCliente } })).toBe(antes);
  });
});

describe("a visão geral — a rota sem clienteId", () => {
  it("cada funcionário vê só os clientes dele", async () => {
    const meus = (await caller.conciliacao.visaoGeral()).clientes.map((c) => c.clienteId);
    expect(meus).toContain(meuCliente);
    expect(meus).not.toContain(clienteAlheio);

    const dele = (await callerEstranho.conciliacao.visaoGeral()).clientes.map((c) => c.clienteId);
    expect(dele).toContain(clienteAlheio);
    expect(dele).not.toContain(meuCliente);
  });

  it("e o ADMIN vê os dois", async () => {
    const todos = (await callerChefe.conciliacao.visaoGeral()).clientes.map((c) => c.clienteId);
    expect(todos).toEqual(expect.arrayContaining([meuCliente, clienteAlheio]));
  });
});

/**
 * ⚠️ A RÉGUA QUE IMPEDE A TRAVA DE SER DESFEITA SEM QUERER.
 *
 * A trava mora no `conciliacaoProcedure`. Uma rota nova escrita com `funcionarioProcedure` — o
 * que é fácil, porque é o nome usado no resto do sistema — nasceria **sem trava nenhuma**, sem
 * erro, sem log e sem CI vermelha. É o mesmo modo de falha do freio por IP da ADR-149: a régua
 * precisa contar rota por rota, não procurar o nome em qualquer lugar do arquivo.
 */
describe("nenhuma rota da Conciliação escapa da trava", () => {
  const arquivo = readFileSync(fileURLToPath(new URL("../modules/conciliacao/conciliacao.router.ts", import.meta.url)), "utf8");
  const corpo = arquivo.slice(arquivo.indexOf("export const conciliacaoRouter"));

  it("toda rota usa conciliacaoProcedure, e nenhuma usa funcionarioProcedure", () => {
    const rotas = [...corpo.matchAll(/^ {2}(\w+):\s*(\w+Procedure)/gm)].map((m) => ({ rota: m[1]!, procedure: m[2]! }));
    expect(rotas.length).toBeGreaterThan(20); // se alguém reescrever o arquivo, a régua avisa
    const fora = rotas.filter((r) => r.procedure !== "conciliacaoProcedure");
    expect(fora, `rota(s) sem a trava por cliente: ${fora.map((f) => f.rota).join(", ")}`).toEqual([]);
  });

  /**
   * ⚠️ A RÉGUA DE TEXTO ACIMA NÃO BASTA, E A REVISÃO PROVOU ISSO COM CINCO SABOTAGENS.
   *
   * Ela só enxerga rota com exatamente dois espaços de indentação, chave sem aspas e o procedure
   * nomeado ali mesmo. Passavam VERDE: rota em sub-router aninhado (`repasse: router({...})`, o
   * padrão que o `clientes.router.ts` já usa), chave entre aspas, `const alias =
   * funcionarioProcedure`, e rota declarada fora e só referenciada. A mais provável delas é a
   * primeira — é como a Fase 2c vai nascer.
   *
   * Por isso a trava de verdade é em TEMPO DE EXECUÇÃO e com padrão NEGAR: `decidirConferenciaDeCliente`
   * recusa qualquer rota fora da lista fechada cujo input não traga `clienteId` legível. Estes
   * testes exercem a decisão direto, com os formatos de input que a 1ª versão deixava passar em
   * silêncio.
   */
  describe("e a decisão RECUSA por padrão, em vez de deixar passar", () => {
    it("input normal manda conferir aquele cliente", () => {
      expect(decidirConferenciaDeCliente("cirurgias", { clienteId: "abc" })).toEqual({ conferir: "abc" });
    });

    it("rota da lista fechada, sem cliente, é liberada", () => {
      for (const rota of ["disponivel", "clientes", "visaoGeral"]) {
        expect(decidirConferenciaDeCliente(rota, undefined)).toBe("liberado");
      }
    });

    it("os formatos que a 1ª versão PULAVA agora são recusados", () => {
      // Cada um destes rodava com zero autorização: o `safeParse` falhava e o middleware seguia.
      expect(decidirConferenciaDeCliente("cirurgias", { filtro: { clienteId: "abc" } })).toBe("recusado");
      expect(decidirConferenciaDeCliente("editarEmLote", [{ clienteId: "abc" }])).toBe("recusado");
      expect(decidirConferenciaDeCliente("cirurgias", { clienteIds: ["a", "b"] })).toBe("recusado");
      expect(decidirConferenciaDeCliente("cirurgias", { clienteId: "" })).toBe("recusado");
      expect(decidirConferenciaDeCliente("cirurgias", undefined)).toBe("recusado");
    });

    it("rota dentro de sub-router é recusada — é assim que a próxima fase vai nascer", () => {
      // `path` vem como `conciliacao.repasse.listar`; o que chega aqui é `repasse.listar`, que
      // não está na lista fechada. Sem isto, a régua de texto acima nem a contaria.
      expect(decidirConferenciaDeCliente("repasse.listar", { competencia: "2026-05" })).toBe("recusado");
      expect(decidirConferenciaDeCliente("repasse.listar", { clienteId: "abc" })).toEqual({ conferir: "abc" });
    });
  });

  it("e a única rota sem clienteId é a visão geral, que filtra sozinha", () => {
    const semCliente = [...corpo.matchAll(/^ {2}(\w+):\s*conciliacaoProcedure((?:.|\n)*?)(?=^ {2}\w+:\s*conciliacaoProcedure|\n\}\);)/gm)]
      .filter((m) => !m[2]!.includes("clienteId"))
      .map((m) => m[1]!);
    expect(semCliente.sort()).toEqual(["clientes", "disponivel", "visaoGeral"]);
  });
});
