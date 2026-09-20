import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

process.env.EMAIL_CRYPTO_KEY ??= randomBytes(32).toString("base64");
process.env.PACIENTE_CRYPTO_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@app/db");
const { appRouter } = await import("../trpc/router.js");
const { importarProducao } = await import("../modules/conciliacao/conciliacao.service.js");

/**
 * A trava de privacidade da Conciliação, exercida pelo ROUTER — não pelo serviço.
 *
 * Este é o teste mais importante do módulo. A decisão do dono em 11/09/2026 (spec §5) é que CPF,
 * telefone e e-mail do paciente **nunca** saem no retorno do tRPC. Uma regressão aqui não é bug de
 * tela: é vazamento de dado pessoal de terceiro, e a MedConsultoria é operadora desse dado.
 *
 * Ele varre o JSON de TODA rota de leitura atrás dos valores gravados e das chaves proibidas —
 * assim pega tanto um `select` que cresceu por descuido quanto um campo novo com outro nome.
 */

const SUFIXO = randomBytes(4).toString("hex");
const CPF = "123.456.789-09";
const TELEFONE = "(11) 96067-6368";
const EMAIL = "paciente-secreto@exemplo.test";

let clienteId = "";
let usuarioId = "";
let caller: ReturnType<typeof appRouter.createCaller>;

/** Chaves que jamais podem aparecer no JSON, em qualquer nível. */
const CHAVES_PROIBIDAS = [
  "cpf",
  "pacienteCpf",
  "pacienteCpfCifrado",
  "pacienteCpfApelido",
  "telefone",
  "pacienteTelefoneCifrado",
  "email",
  "pacienteEmailCifrado",
];

function chavesDe(valor: unknown, achadas = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) {
    for (const v of valor) chavesDe(v, achadas);
  } else if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) {
      achadas.add(k);
      chavesDe(v, achadas);
    }
  }
  return achadas;
}

/** A conferência completa: nem o valor gravado, nem uma chave com nome de dado pessoal. */
function exigirSemPII(rotulo: string, retorno: unknown) {
  const json = JSON.stringify(retorno ?? null);
  expect(json, `${rotulo}: vazou o CPF`).not.toContain("123.456.789-09");
  expect(json, `${rotulo}: vazou o CPF sem pontuação`).not.toContain("12345678909");
  expect(json, `${rotulo}: vazou o telefone`).not.toContain("96067-6368");
  expect(json, `${rotulo}: vazou o e-mail`).not.toContain(EMAIL);
  // A cifra também não deve viajar: é inútil para a tela e é superfície a mais.
  expect(json, `${rotulo}: vazou texto cifrado`).not.toContain("v1:");

  const chaves = chavesDe(retorno);
  for (const proibida of CHAVES_PROIBIDAS) {
    expect([...chaves], `${rotulo}: apareceu a chave "${proibida}"`).not.toContain(proibida);
  }
}

beforeAll(async () => {
  const cliente = await prisma.cliente.create({ data: { nome: `Clínica router ${SUFIXO}` } });
  clienteId = cliente.id;
  const usuario = await prisma.user.create({
    data: { nome: `Func ${SUFIXO}`, email: `func-${SUFIXO}@teste.local`, role: "FUNCIONARIO" },
  });
  usuarioId = usuario.id;
  // ⚠️ A Conciliação exige que o funcionário seja o RESPONSÁVEL pelo cliente (a régua do Painel
  // do Cliente, ADR-128). Sem esta linha o `caller` leva FORBIDDEN em toda rota — que é a trava
  // funcionando, não defeito do teste.
  await prisma.cliente.update({ where: { id: clienteId }, data: { responsavelId: usuarioId } });

  caller = appRouter.createCaller({
    user: { id: usuarioId, role: "FUNCIONARIO", nome: usuario.nome, email: usuario.email },
    req: {},
    res: {},
  } as never);

  const cabecalho =
    "Data da agenda;Data do atendimento;Paciente;CPF do paciente;Telefone do Paciente;E-mail;Tipo de atendimento;Plano de convênio;Profissional";
  const linha = `31/08/2026;31/08/2026;WILMA SAVINI;${CPF};${TELEFONE};${EMAIL};Consulta;PORTO SEGURO - BÁSICO;DR. LEONARDO GIGLIO DRAGONE`;

  await importarProducao({
    clienteId,
    competencia: "2026-08",
    bytes: Buffer.from(`${cabecalho}\n${linha}`, "utf8"),
    nomeArquivo: "producao.csv",
    usuarioId,
  });
});

afterAll(async () => {
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.user.deleteMany({ where: { id: usuarioId } });
  await prisma.$disconnect();
});

describe("o dado do paciente está no banco, cifrado", () => {
  it("gravou mesmo — senão o teste abaixo passaria por não haver dado nenhum", async () => {
    // Sem esta conferência, um bug que simplesmente NÃO gravasse o CPF faria a suíte inteira
    // passar e ninguém saberia que a trava nunca foi exercida.
    const linha = await prisma.producaoConsulta.findFirstOrThrow({ where: { clienteId } });
    expect(linha.pacienteCpfCifrado).toMatch(/^v1:/);
    expect(linha.pacienteCpfApelido).toHaveLength(64);
    expect(linha.pacienteTelefoneCifrado).not.toBeNull();
    expect(linha.pacienteEmailCifrado).not.toBeNull();
  });
});

describe("NENHUMA rota do router devolve dado pessoal do paciente", () => {
  it("conciliacao.producao", async () => {
    const r = await caller.conciliacao.producao({ clienteId, competencia: "2026-08" });
    expect(r.linhas).toHaveLength(1);
    // O nome FICA — é o que identifica o atendimento na tela (spec §5).
    expect(r.linhas[0]!.pacienteNome).toBe("WILMA SAVINI");
    exigirSemPII("producao", r);
  });

  it("conciliacao.resumo", async () => {
    exigirSemPII("resumo", await caller.conciliacao.resumo({ clienteId, competencia: "2026-08" }));
  });

  it("conciliacao.competencias", async () => {
    exigirSemPII("competencias", await caller.conciliacao.competencias({ clienteId }));
  });

  it("conciliacao.pendencias", async () => {
    exigirSemPII("pendencias", await caller.conciliacao.pendencias({ clienteId }));
  });

  it("conciliacao.producao com busca por nome", async () => {
    const r = await caller.conciliacao.producao({ clienteId, busca: "WILMA" });
    expect(r.total).toBe(1);
    exigirSemPII("producao+busca", r);
  });
});

describe("guardas do router", () => {
  it("recusa competência fora do formato AAAA-MM", async () => {
    await expect(caller.conciliacao.resumo({ clienteId, competencia: "08/2026" })).rejects.toThrow(/AAAA-MM/);
    await expect(caller.conciliacao.resumo({ clienteId, competencia: "2026-13" })).rejects.toThrow(/AAAA-MM/);
  });

  it("importar recusa arquivo que não é do cliente", async () => {
    await expect(caller.conciliacao.importar({ clienteId, competencia: "2026-08", arquivoId: "inexistente" })).rejects.toThrow(
      /não encontrado/i,
    );
  });

  it("sem sessão, nada responde", async () => {
    const anonimo = appRouter.createCaller({ user: null, req: {}, res: {} } as never);
    await expect(anonimo.conciliacao.producao({ clienteId })).rejects.toThrow();
    await expect(anonimo.conciliacao.pendencias({ clienteId })).rejects.toThrow();
  });

  it("CLIENTE do Portal não entra na Conciliação", async () => {
    // A produção é ferramenta da equipe nesta fase (spec §3). O Portal fica de fora.
    const doPortal = appRouter.createCaller({
      user: { id: usuarioId, role: "CLIENTE", nome: "Cliente", email: "c@teste.local", clienteId },
      req: {},
      res: {},
    } as never);
    await expect(doPortal.conciliacao.producao({ clienteId })).rejects.toThrow();
  });
});
