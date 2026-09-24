import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.EMAIL_CRYPTO_KEY ??= randomBytes(32).toString("base64");
process.env.PACIENTE_CRYPTO_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@app/db");
const { appRouter } = await import("../trpc/router.js");
const { importarCirurgias } = await import("../modules/conciliacao/cirurgias.service.js");

/**
 * O HISTÓRICO DO FECHAMENTO DE COMPETÊNCIA.
 *
 * O defeito relatado no teste de 23/09: fechar 2026-03 e reabrir não deixava registro visível de
 * quem tinha fechado, e fechar de novo escrevia por cima do fechamento anterior. `CompetenciaFechada`
 * é uma linha por mês — o ESTADO — e continua sendo; o histórico mora em
 * `CompetenciaFechamentoEvento`, append-only, gravado na MESMA transação do estado.
 *
 * Pelo `createCaller`, não pelo serviço: a trava de cliente e o registro no `ActivityLog` moram no
 * procedure, e chamar o serviço direto passaria verde sem exercê-los (a lição da ADR-137).
 */

const SUFIXO = randomBytes(4).toString("hex");
const MES = "2026-03";
let clienteId = "";
let thais = "";
let andre = "";
let estranho = "";
let callerThais: ReturnType<typeof appRouter.createCaller>;
let callerAndre: ReturnType<typeof appRouter.createCaller>;
let callerEstranho: ReturnType<typeof appRouter.createCaller>;

const CAB =
  '"Data";"Hora (UTC)";"Sala";"Duração prev (min)";"Paciente";"Prontuário";"Atendimento";"Nº Cirurgia";"Seq Cirurgia";"Convênio";"Tipo Conv";"Médico";"Anestesista";"Tipo Anestesia";"Procedimento";"Status";"Autorização";"Cód Aut";"Unid. Internação";"Setor";"Cód Pessoa";"OPME";"Tempo (min)";"Técnica"';
const LINHA = [
  "2026-03-04",
  "2026-03-04T10:00:00Z",
  "S1",
  "60",
  "PAC 1",
  "P",
  "91",
  "1",
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
  const t = await prisma.user.create({ data: { nome: `Thaís ${SUFIXO}`, email: `thais-hf-${SUFIXO}@teste.local`, role: "ADMIN" } });
  const a = await prisma.user.create({ data: { nome: `André ${SUFIXO}`, email: `andre-hf-${SUFIXO}@teste.local`, role: "ADMIN" } });
  const e = await prisma.user.create({
    data: { nome: `Estranho ${SUFIXO}`, email: `est-hf-${SUFIXO}@teste.local`, role: "FUNCIONARIO" },
  });
  thais = t.id;
  andre = a.id;
  estranho = e.id;
  // O cliente é da Thaís — o funcionário "Estranho" não responde por ele.
  clienteId = (await prisma.cliente.create({ data: { nome: `Hist ${SUFIXO}`, responsavelId: thais } })).id;
  callerThais = como(t.id, t.nome, t.email, "ADMIN");
  callerAndre = como(a.id, a.nome, a.email, "ADMIN");
  callerEstranho = como(e.id, e.nome, e.email, "FUNCIONARIO");

  await importarCirurgias({ clienteId, bytes: Buffer.from([CAB, LINHA].join("\n"), "utf8"), nomeArquivo: "t.csv", usuarioId: thais });
});

afterAll(async () => {
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.user.deleteMany({ where: { id: { in: [thais, andre, estranho] } } });
  await prisma.$disconnect();
});

describe("fechar → reabrir → fechar deixa rastro", () => {
  it("grava um evento a cada ato, em ordem, com o autor certo", async () => {
    await callerThais.conciliacao.fecharCompetencia({ clienteId, competencia: MES, observacao: "conferido com a Juliana" });
    await callerAndre.conciliacao.reabrirCompetencia({ clienteId, competencia: MES });
    await callerThais.conciliacao.fecharCompetencia({ clienteId, competencia: MES });

    const h = await callerThais.conciliacao.historicoFechamento({ clienteId, competencia: MES });
    expect(h.map((e) => e.tipo)).toEqual(["FECHOU", "REABRIU", "FECHOU"]);
    expect(h.map((e) => e.por)).toEqual([`Thaís ${SUFIXO}`, `André ${SUFIXO}`, `Thaís ${SUFIXO}`]);
    // ⚠️ O PRIMEIRO fechamento, com a observação dele, sobreviveu ao segundo — era isto que o
    // estado de uma linha só apagava.
    expect(h[0]!.observacao).toBe("conferido com a Juliana");
    expect(h[2]!.observacao).toBeNull();
    expect(h[0]!.retrato?.cirurgias).toBe(1);
    expect(h[1]!.retrato).toBeNull();
    expect(new Date(h[0]!.em).getTime()).toBeLessThanOrEqual(new Date(h[2]!.em).getTime());
  });

  it("o ESTADO segue coerente: o mês está fechado, pela Thaís, e a trava de edição vale", async () => {
    const [f] = await callerThais.conciliacao.competenciasFechadas({ clienteId });
    expect(f).toMatchObject({ competencia: MES, fechadoPor: `Thaís ${SUFIXO}` });
    const estado = await prisma.competenciaFechada.findMany({ where: { clienteId } });
    expect(estado).toHaveLength(1);
    expect(estado[0]).toMatchObject({ reabertoEm: null, reabertoPorId: null, fechadoPorId: thais });

    const alvo = (await callerThais.conciliacao.cirurgias({ clienteId, competencia: MES })).linhas[0]!.id;
    await expect(callerThais.conciliacao.editarCirurgia({ clienteId, cirurgiaId: alvo, observacao: "x" })).rejects.toThrow(
      /conferida e fechada/i,
    );
  });

  it("⚠️ fechar o que JÁ está fechado é recusado — e não grava evento nem escreve por cima", async () => {
    await expect(callerAndre.conciliacao.fecharCompetencia({ clienteId, competencia: MES })).rejects.toThrow(/já está fechada/i);
    const h = await callerThais.conciliacao.historicoFechamento({ clienteId, competencia: MES });
    expect(h).toHaveLength(3);
    expect((await prisma.competenciaFechada.findFirst({ where: { clienteId } }))!.fechadoPorId).toBe(thais);
  });

  it("reabrir o que já está aberto também não gera evento", async () => {
    await callerAndre.conciliacao.reabrirCompetencia({ clienteId, competencia: MES });
    await expect(callerAndre.conciliacao.reabrirCompetencia({ clienteId, competencia: MES })).rejects.toThrow(/não está fechada/i);
    const h = await callerThais.conciliacao.historicoFechamento({ clienteId, competencia: MES });
    expect(h.map((e) => e.tipo)).toEqual(["FECHOU", "REABRIU", "FECHOU", "REABRIU"]);
    // Reaberto, o mês some de `competenciasFechadas` — e o histórico continua respondendo.
    expect(await callerThais.conciliacao.competenciasFechadas({ clienteId })).toEqual([]);
  });

  it("fechar e reabrir continuam registrando `conciliacao.<rota>` no ActivityLog", async () => {
    // O registro é melhor-esforço e sai DEPOIS da resposta — espera ele chegar.
    let acoes: string[] = [];
    for (let i = 0; i < 20; i++) {
      acoes = (await prisma.activityLog.findMany({ where: { entidadeId: clienteId }, select: { acao: true } })).map((l) => l.acao);
      if (acoes.filter((x) => x === "conciliacao.reabrirCompetencia").length >= 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(acoes.filter((x) => x === "conciliacao.fecharCompetencia")).toHaveLength(2);
    expect(acoes.filter((x) => x === "conciliacao.reabrirCompetencia")).toHaveLength(2);
    // Leitura NÃO entra no registro.
    expect(acoes).not.toContain("conciliacao.historicoFechamento");
  });
});

describe("append-only e acesso", () => {
  it("o router não oferece rota nenhuma que edite ou apague evento", () => {
    const rotas = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures).filter((r) =>
      r.startsWith("conciliacao."),
    );
    expect(rotas).toContain("conciliacao.historicoFechamento");
    expect(rotas.filter((r) => /evento|historico/i.test(r))).toEqual(["conciliacao.historicoFechamento"]);
  });

  it("⚠️ e nenhum código da API escreve em evento a não ser `create`", () => {
    // Varre `src/` inteiro (menos os testes): um `update`/`delete`/`upsert` na tabela, em qualquer
    // lugar, transformaria o histórico em algo que se corrige — e deixaria de ser prova.
    const raiz = fileURLToPath(new URL("..", import.meta.url));
    const arquivos: string[] = [];
    const andar = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) {
          if (n !== "test") andar(p);
        } else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) arquivos.push(p);
      }
    };
    andar(raiz);
    const proibidos = arquivos.filter((p) =>
      /competenciaFechamentoEvento\s*\.\s*(update|updateMany|delete|deleteMany|upsert)\b/.test(readFileSync(p, "utf8")),
    );
    expect(proibidos).toEqual([]);
  });

  it("funcionário sem o cliente leva FORBIDDEN no histórico", async () => {
    await expect(callerEstranho.conciliacao.historicoFechamento({ clienteId, competencia: MES })).rejects.toThrow(
      /sob a sua responsabilidade/i,
    );
  });
});
