import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { registrarRotasDoAgente } from "../http/agent-v1.js";
import { config } from "../config.js";
import { criarClienteDeAgente, emitirDelegacao } from "../modules/agente/agente.service.js";
import { emitirAprovacao } from "../modules/agente/aprovacao.js";
import {
  criarTarefaDoAgente,
  FERRAMENTA,
} from "../modules/agente/criar-tarefa-do-agente.service.js";

/**
 * A ESCRITA DA API DO AGENTE (ADR-150) — os dezesseis testes que o ticket CORA-003 exige
 * comprovados (W1..W16).
 *
 * ⚠️ Roda contra o **Fastify de verdade** (`app.inject`) e contra o **MySQL de verdade**. O que
 * se prova aqui é comportamento de PORTA HTTP e de BANCO — código de status, o corpo do `409`,
 * e sobretudo a **atomicidade**, que não se prova lendo código.
 *
 * ⚠️ **O W2 é conferido PELO EFEITO**, como a CORA pediu: conta as tarefas antes e depois, não
 * confia na resposta. Resposta que diz "não criei" enquanto o banco criou é exatamente o
 * defeito que a idempotência existe para impedir.
 *
 * ⚠️ Dados 100% SINTÉTICOS, com prefixo sorteado, criados e apagados por este arquivo.
 */

const PFX = `agw-${randomBytes(4).toString("hex")}`;

let app: FastifyInstance;
let clientId = "";
let clientSecret = "";
let outroClientId = "";
let outroClientSecret = "";
let userA = "";
let userB = "";
let tokenA = "";
let tokenB = "";
let tokenSoLeitura = "";
let tokenDeOutroServico = "";
let clienteUnico = "";
let clienteHom1 = "";
let clienteHom2 = "";
let clienteRenomeavel = "";
let projetoUnico = "";

const NOME_UNICO = `${PFX} Clinica Unica`;
const NOME_HOMONIMO = `${PFX} Clinica Homonima`;
const NOME_RENOMEAVEL = `${PFX} Clinica Renomeavel`;
const NOME_PROJETO = `${PFX} Projeto Unico`;

function cabecalhos(token: string, extras: Record<string, string> = {}) {
  return {
    "x-agent-client": clientId,
    "x-agent-secret": clientSecret,
    authorization: `Bearer ${token}`,
    "x-request-id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    ...extras,
  };
}

async function previa(corpo: unknown, token = tokenA, extras: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/agent/v1/tasks/preview",
    headers: { ...cabecalhos(token, extras), "content-type": "application/json" },
    payload: JSON.stringify(corpo),
  });
}

async function criar(corpo: unknown, chave: string, token = tokenA, extras: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/agent/v1/tasks",
    headers: {
      ...cabecalhos(token, extras),
      "content-type": "application/json",
      "idempotency-key": chave,
    },
    payload: JSON.stringify(corpo),
  });
}

/** A prévia feliz: título só nosso, sem referência nenhuma. Devolve `{ token, task }`. */
async function previaSimples(titulo: string, token = tokenA) {
  const r = await previa({ titulo }, token);
  expect(r.statusCode).toBe(200);
  const corpo = r.json();
  expect(corpo.approvalToken).toBeTruthy();
  return {
    approvalToken: corpo.approvalToken as string,
    resolutionHash: corpo.resolutionHash as string,
    task: {
      titulo: corpo.previa.titulo,
      prioridade: corpo.previa.prioridade,
      prazo: corpo.previa.prazo.valor,
      clienteId: corpo.previa.cliente.id,
      projetoId: corpo.previa.projeto.id,
      responsavelIds: corpo.previa.responsaveis.map((r: { id: string }) => r.id),
    },
  };
}

const contarPorTitulo = (titulo: string) => prisma.tarefa.count({ where: { titulo } });

beforeAll(async () => {
  exigirBancoDeTeste();

  app = Fastify({ logger: false });
  // O freio existe na aplicação real; sem ele aqui, o teste não exerceria a rota como ela é.
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
  registrarRotasDoAgente(app);
  await app.ready();

  const [a, b] = await Promise.all([
    prisma.user.create({
      data: { nome: `${PFX}-a`, email: `${PFX}-a@example.test`, role: "FUNCIONARIO" },
    }),
    prisma.user.create({
      data: { nome: `${PFX}-b`, email: `${PFX}-b@example.test`, role: "FUNCIONARIO" },
    }),
  ]);
  userA = a.id;
  userB = b.id;

  const servico = await criarClienteDeAgente(`${PFX}-cora`);
  clientId = servico.id;
  clientSecret = servico.segredo;
  const outro = await criarClienteDeAgente(`${PFX}-outro`);
  outroClientId = outro.id;
  outroClientSecret = outro.segredo;

  const escrita = ["tasks:read", "tasks:write"];
  const [dA, dB, dLeitura, dOutro] = await Promise.all([
    emitirDelegacao({ clientId, userId: userA, escopos: escrita, minutos: 60 }),
    emitirDelegacao({ clientId, userId: userB, escopos: escrita, minutos: 60 }),
    emitirDelegacao({ clientId, userId: userA, escopos: ["tasks:read"], minutos: 60 }),
    emitirDelegacao({ clientId: outroClientId, userId: userA, escopos: escrita, minutos: 60 }),
  ]);
  tokenA = dA.token;
  tokenB = dB.token;
  tokenSoLeitura = dLeitura.token;
  tokenDeOutroServico = dOutro.token;

  const [cu, ch1, ch2, cr] = await Promise.all([
    prisma.cliente.create({ data: { nome: NOME_UNICO, cnpj: "11.111.111/0001-11" } }),
    prisma.cliente.create({ data: { nome: NOME_HOMONIMO, cnpj: "22.222.222/0001-22" } }),
    prisma.cliente.create({
      data: { nome: `${NOME_HOMONIMO} Norte`, cnpj: "33.333.333/0001-33", situacaoComercial: "PROSPECT" },
    }),
    prisma.cliente.create({ data: { nome: NOME_RENOMEAVEL, cnpj: "44.444.444/0001-44" } }),
  ]);
  clienteUnico = cu.id;
  clienteHom1 = ch1.id;
  clienteHom2 = ch2.id;
  clienteRenomeavel = cr.id;

  const p = await prisma.projeto.create({ data: { nome: NOME_PROJETO, clienteId: clienteUnico } });
  projetoUnico = p.id;
});

afterAll(async () => {
  const usuarios = [userA, userB].filter(Boolean);
  const clientes = [clienteUnico, clienteHom1, clienteHom2, clienteRenomeavel].filter(Boolean);
  // ⚠️ A ordem segue as chaves estrangeiras: idempotência → tarefa → projeto → cliente.
  await prisma.agentIdempotency.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: PFX } } });
  await prisma.tarefa.deleteMany({ where: { criadoPorId: { in: usuarios } } });
  await prisma.projeto.deleteMany({ where: { id: projetoUnico } });
  await prisma.cliente.deleteMany({ where: { id: { in: clientes } } });
  await prisma.agentDelegation.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.agentClient.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await app.close();
});

// ─────────────────────────────────────────────────────────────
// W1, W2, W3, W4 — criação e idempotência
// ─────────────────────────────────────────────────────────────

describe("criação e idempotência", () => {
  it("W1 · cria, e a tarefa APARECE no GET /tasks da Fase 1", async () => {
    const titulo = `${PFX} W1 criar simples`;
    const p = await previaSimples(titulo);
    const r = await criar({ approvalToken: p.approvalToken, task: p.task }, randomUUID());

    expect(r.statusCode).toBe(201);
    expect(r.json().created).toBe(true);
    const taskId = r.json().taskId as string;

    const gravada = await prisma.tarefa.findUnique({ where: { id: taskId } });
    expect(gravada?.titulo).toBe(titulo);
    // ⚠️ O critério não é "gravou", é "a Cora consegue ver de novo pela porta da Fase 1".
    const lista = await app.inject({
      method: "GET",
      url: "/api/agent/v1/tasks?scope=mine&status=open&limit=100",
      headers: cabecalhos(tokenA),
    });
    expect(lista.statusCode).toBe(200);
    expect(lista.json().items.map((t: { id: string }) => t.id)).toContain(taskId);
  });

  it("W2 · mesma chave e mesmos argumentos devolve 200 e A MESMA tarefa — conferido pelo EFEITO", async () => {
    const titulo = `${PFX} W2 repeticao`;
    const p = await previaSimples(titulo);
    const chave = randomUUID();

    const antes = await contarPorTitulo(titulo);
    const primeira = await criar({ approvalToken: p.approvalToken, task: p.task }, chave);
    expect(primeira.statusCode).toBe(201);
    const depoisDaPrimeira = await contarPorTitulo(titulo);

    const segunda = await criar({ approvalToken: p.approvalToken, task: p.task }, chave);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json().created).toBe(false);
    expect(segunda.json().taskId).toBe(primeira.json().taskId);

    // A prova que importa: a CONTAGEM não mexeu.
    expect(antes).toBe(0);
    expect(depoisDaPrimeira).toBe(1);
    expect(await contarPorTitulo(titulo)).toBe(1);
  });

  it("W3 · mesma chave com argumentos diferentes é 409 IDEMPOTENCY_CONFLICT", async () => {
    const chave = randomUUID();
    const p1 = await previaSimples(`${PFX} W3 primeiro`);
    expect((await criar({ approvalToken: p1.approvalToken, task: p1.task }, chave)).statusCode).toBe(201);

    const p2 = await previaSimples(`${PFX} W3 SEGUNDO diferente`);
    const r = await criar({ approvalToken: p2.approvalToken, task: p2.task }, chave);

    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    // E nada do segundo entrou.
    expect(await contarPorTitulo(`${PFX} W3 SEGUNDO diferente`)).toBe(0);
  });

  it("W4 · a chave de A reapresentada por B nunca devolve a tarefa de A", async () => {
    const chave = randomUUID();
    const pA = await previaSimples(`${PFX} W4 de A`, tokenA);
    const rA = await criar({ approvalToken: pA.approvalToken, task: pA.task }, chave, tokenA);
    expect(rA.statusCode).toBe(201);

    const pB = await previaSimples(`${PFX} W4 de B`, tokenB);
    const rB = await criar({ approvalToken: pB.approvalToken, task: pB.task }, chave, tokenB);

    // A mesma chave, no escopo de OUTRA pessoa, é uma chave livre: B cria a dele.
    expect(rB.statusCode).toBe(201);
    expect(rB.json().taskId).not.toBe(rA.json().taskId);
    const deB = await prisma.tarefa.findUnique({ where: { id: rB.json().taskId as string } });
    expect(deB?.titulo).toBe(`${PFX} W4 de B`);
    expect(deB?.criadoPorId).toBe(userB);
  });
});

// ─────────────────────────────────────────────────────────────
// W5..W8 — a aprovação
// ─────────────────────────────────────────────────────────────

describe("a aprovação", () => {
  it("W5 · criar sem approvalToken é recusado", async () => {
    const p = await previaSimples(`${PFX} W5 sem token`);
    const r = await criar({ task: p.task }, randomUUID());
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("APPROVAL_INVALID");
    expect(await contarPorTitulo(`${PFX} W5 sem token`)).toBe(0);
  });

  it("W6 · token com argumentos alterados é recusado, e NÃO executa o novo", async () => {
    const p = await previaSimples(`${PFX} W6 original`);
    const alterado = { ...p.task, titulo: `${PFX} W6 ALTERADO pela Cora` };
    const r = await criar({ approvalToken: p.approvalToken, task: alterado }, randomUUID());

    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("APPROVAL_MISMATCH");
    // ⚠️ A parte que mais importa: nem o alterado NEM o original foram gravados.
    expect(await contarPorTitulo(`${PFX} W6 ALTERADO pela Cora`)).toBe(0);
    expect(await contarPorTitulo(`${PFX} W6 original`)).toBe(0);
  });

  it("W7 · token já usado é recusado ao ser reapresentado com outra chave", async () => {
    const p = await previaSimples(`${PFX} W7 uso unico`);
    expect((await criar({ approvalToken: p.approvalToken, task: p.task }, randomUUID())).statusCode).toBe(201);

    const r = await criar({ approvalToken: p.approvalToken, task: p.task }, randomUUID());
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("APPROVAL_ALREADY_USED");
    expect(await contarPorTitulo(`${PFX} W7 uso unico`)).toBe(1);
  });

  it("W8 · token expirado é recusado", async () => {
    const titulo = `${PFX} W8 expirado`;
    const task = {
      titulo,
      prioridade: "NORMAL" as const,
      prazo: null,
      clienteId: null,
      projetoId: null,
      responsavelIds: [userA],
    };
    // Emitido com o relógio uma hora atrás: vence sem esperar os 15 minutos de verdade.
    const vencido = emitirAprovacao(
      {
        requesterUserId: userA,
        clientId,
        argumentos: task,
        referencias: [{ tipo: "responsavel", id: userA, rotulo: `${PFX}-a` }],
      },
      config.SESSION_SECRET,
      new Date(Date.now() - 60 * 60 * 1000),
    );

    const r = await criar({ approvalToken: vencido.token, task }, randomUUID());
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("APPROVAL_EXPIRED");
    expect(await contarPorTitulo(titulo)).toBe(0);
  });

  it("token emitido para OUTRO serviço não vale aqui", async () => {
    const p = await previaSimples(`${PFX} token de outro servico`);
    const r = await app.inject({
      method: "POST",
      url: "/api/agent/v1/tasks",
      headers: {
        "x-agent-client": outroClientId,
        "x-agent-secret": outroClientSecret,
        authorization: `Bearer ${tokenDeOutroServico}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      payload: JSON.stringify({ approvalToken: p.approvalToken, task: p.task }),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("APPROVAL_INVALID");
  });
});

// ─────────────────────────────────────────────────────────────
// W9 — o mundo mudou
// ─────────────────────────────────────────────────────────────

describe("revalidação", () => {
  it("W9 · dado que mudou entre a prévia e a execução dá 409 dizendo O QUE divergiu", async () => {
    const titulo = `${PFX} W9 mundo mudou`;
    const r1 = await previa({ titulo, cliente: { id: clienteRenomeavel } });
    expect(r1.statusCode).toBe(200);
    const c1 = r1.json();
    expect(c1.previa.cliente.rotulo).toBe(NOME_RENOMEAVEL);

    // O mundo muda: a clínica é renomeada depois de a Thaís ter lido o nome antigo.
    const nomeNovo = `${PFX} Clinica Com Outro Nome`;
    await prisma.cliente.update({ where: { id: clienteRenomeavel }, data: { nome: nomeNovo } });

    const task = {
      titulo,
      prioridade: c1.previa.prioridade,
      prazo: c1.previa.prazo.valor,
      clienteId: c1.previa.cliente.id,
      projetoId: c1.previa.projeto.id,
      responsavelIds: c1.previa.responsaveis.map((r: { id: string }) => r.id),
    };
    const r2 = await criar({ approvalToken: c1.approvalToken, task }, randomUUID());

    expect(r2.statusCode).toBe(409);
    const erro = r2.json().error;
    expect(erro.code).toBe("PRECONDITION_CHANGED");
    expect(erro.divergencias).toEqual([
      {
        campo: "cliente",
        aprovado: { id: clienteRenomeavel, rotulo: NOME_RENOMEAVEL },
        atual: { id: clienteRenomeavel, rotulo: nomeNovo },
        motivo: "ROTULO_MUDOU",
      },
    ]);
    expect(await contarPorTitulo(titulo)).toBe(0);

    await prisma.cliente.update({ where: { id: clienteRenomeavel }, data: { nome: NOME_RENOMEAVEL } });
  });
});

// ─────────────────────────────────────────────────────────────
// W10..W13 — a prévia
// ─────────────────────────────────────────────────────────────

describe("a prévia", () => {
  it("W10 · dois candidatos: 200, approvalToken null e o fato que os distingue", async () => {
    const r = await previa({ titulo: `${PFX} W10 ambiguo`, cliente: { texto: NOME_HOMONIMO } });

    expect(r.statusCode).toBe(200);
    const c = r.json();
    // ⚠️ 200 e não 400: um erro faria a Cora tratar como falha e repetir com os mesmos dados,
    // em laço. A máquina fez o trabalho dela; o resultado é "precisa de gente".
    expect(c.approvalToken).toBeNull();
    expect(c.previa.cliente.motivo).toBe("AMBIGUO");
    expect(c.ambiguidades).toHaveLength(1);
    expect(c.ambiguidades[0].campo).toBe("cliente");
    expect(c.ambiguidades[0].total).toBe(2);
    const ids = c.ambiguidades[0].candidatos.map((x: { id: string }) => x.id).sort();
    expect(ids).toEqual([clienteHom1, clienteHom2].sort());
    // Cada candidato traz um fato que o distingue, e os fatos são DIFERENTES entre si.
    const distincoes = c.ambiguidades[0].candidatos.map((x: { distincao: string }) => x.distincao);
    expect(new Set(distincoes).size).toBe(2);
    expect(distincoes.join(" ")).toContain("CNPJ");
  });

  it("escolhido o id na segunda prévia, a ambiguidade some e o token nasce", async () => {
    const r = await previa({ titulo: `${PFX} W10b escolhido`, cliente: { id: clienteHom2 } });
    const c = r.json();
    expect(c.ambiguidades).toHaveLength(0);
    expect(c.previa.cliente.id).toBe(clienteHom2);
    expect(c.previa.cliente.origem).toBe("ID");
    expect(c.approvalToken).toBeTruthy();
  });

  it("W11 · referência não encontrada vem como null COM MOTIVO, nunca omitida", async () => {
    const r = await previa({
      titulo: `${PFX} W11 inexistente`,
      cliente: { texto: `${PFX} clinica que nao existe` },
    });

    expect(r.statusCode).toBe(200);
    const c = r.json();
    expect(c.previa).toHaveProperty("cliente");
    expect(c.previa.cliente).toEqual({
      id: null,
      rotulo: null,
      encontrado: false,
      motivo: "NAO_ENCONTRADO",
      origem: "TEXTO",
    });
    // ⚠️ Decisão nossa, mais estrita que o pedido: referência PEDIDA que não resolve também zera
    // o token. Gravar sem o cliente seria gravar calado uma coisa diferente da que foi pedida.
    expect(c.approvalToken).toBeNull();
  });

  it("W12 · sem prazo, a ausência é VISÍVEL na estrutura", async () => {
    const c = (await previa({ titulo: `${PFX} W12 sem prazo` })).json();
    expect(c.previa.prazo).toEqual({ presente: false, valor: null, rotulo: "sem prazo" });

    const comPrazo = (
      await previa({ titulo: `${PFX} W12 com prazo`, prazo: "2026-12-31T12:00:00-03:00" })
    ).json();
    expect(comPrazo.previa.prazo.presente).toBe(true);
    expect(comPrazo.previa.prazo.valor).toBe("2026-12-31T15:00:00.000Z");
  });

  it("W13 · previousResolutionHash devolve `mudou` com o que saiu e o que entrou", async () => {
    const titulo = `${PFX} W13 comparacao`;
    const antes = (await previa({ titulo, cliente: { id: clienteUnico } })).json();
    expect(antes.mudou).toBeNull();

    const nomeNovo = `${PFX} Clinica Unica RENOMEADA`;
    await prisma.cliente.update({ where: { id: clienteUnico }, data: { nome: nomeNovo } });

    const depois = (
      await previa({
        titulo,
        cliente: { id: clienteUnico },
        previousResolutionHash: antes.resolutionHash,
      })
    ).json();

    expect(depois.mudou).toEqual([
      {
        campo: "cliente",
        de: { id: clienteUnico, rotulo: NOME_UNICO },
        para: { id: clienteUnico, rotulo: nomeNovo },
      },
    ]);
    // O selo é determinístico: resolução igual ⇒ valor igual; resolução diferente ⇒ diferente.
    expect(depois.resolutionHash).not.toBe(antes.resolutionHash);

    await prisma.cliente.update({ where: { id: clienteUnico }, data: { nome: NOME_UNICO } });
  });

  it("o padrão de responsável é a própria pessoa, e ele APARECE na prévia", async () => {
    const c = (await previa({ titulo: `${PFX} responsavel padrao` })).json();
    expect(c.previa.responsaveis).toHaveLength(1);
    expect(c.previa.responsaveis[0].id).toBe(userA);
    expect(c.previa.responsaveis[0].origem).toBe("PADRAO");
  });

  it("o projeto resolve por texto e entra na prévia", async () => {
    const c = (await previa({ titulo: `${PFX} com projeto`, projeto: { texto: NOME_PROJETO } })).json();
    expect(c.previa.projeto.id).toBe(projetoUnico);
    expect(c.previa.projeto.rotulo).toBe(NOME_PROJETO);
    expect(c.approvalToken).toBeTruthy();
  });

  it("`id` e `texto` juntos na mesma referência é entrada inválida", async () => {
    const r = await previa({
      titulo: `${PFX} os dois juntos`,
      cliente: { id: clienteUnico, texto: NOME_UNICO },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("INVALID_INPUT");
  });

  it("`previousResolutionHash` que não emitimos é ERRO, não `sem comparação`", async () => {
    const r = await previa({
      titulo: `${PFX} selo forjado`,
      previousResolutionHash: "ZmFsc28.assinaturaInventada",
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toContain("previousResolutionHash");
  });

  it("⚠️ duas referências que resolvem para A MESMA pessoa criam UM responsável, não um 503", async () => {
    // Achado do revisor de TypeScript, e é o padrão desta casa de novo: o defeito nasceu da
    // própria correção. O `argsHash` já deduplicava; a lista que ia para o banco, não. Dois
    // textos apontando a mesma conta ("a Ana" e "a Ana Paula", quando são a mesma pessoa)
    // passavam pela aprovação e estouravam no `@@unique([tarefaId, userId])` DENTRO da
    // transação — `P2002` lido como colisão de chave de idempotência, `503` na cara da Cora,
    // "reserva de idempotência sem tarefa" no log, e o `approvalToken` queimado para sempre.
    const titulo = `${PFX} responsavel repetido`;
    const r = await previa({
      titulo,
      responsaveis: [{ id: userA }, { id: userA }],
    });
    expect(r.statusCode).toBe(200);
    const c = r.json();
    expect(c.approvalToken).toBeTruthy();

    const task = {
      titulo,
      prioridade: c.previa.prioridade,
      prazo: c.previa.prazo.valor,
      clienteId: c.previa.cliente.id,
      projetoId: c.previa.projeto.id,
      // A Cora manda de volta o que a prévia mostrou — e a prévia mostrou as DUAS linhas.
      responsavelIds: c.previa.responsaveis.map((x: { id: string }) => x.id),
    };
    const criada = await criar({ approvalToken: c.approvalToken, task }, randomUUID());

    expect(criada.statusCode).toBe(201);
    const vinculos = await prisma.tarefaResponsavel.count({
      where: { tarefaId: criada.json().taskId as string },
    });
    expect(vinculos).toBe(1);
    expect(await contarPorTitulo(titulo)).toBe(1);
  });

  it("a prévia NÃO escreve nada", async () => {
    const titulo = `${PFX} previa nao escreve`;
    const antesTarefas = await contarPorTitulo(titulo);
    const antesReservas = await prisma.agentIdempotency.count({ where: { userId: userA } });
    await previa({ titulo });
    await previa({ titulo });
    expect(await contarPorTitulo(titulo)).toBe(antesTarefas);
    expect(await prisma.agentIdempotency.count({ where: { userId: userA } })).toBe(antesReservas);
  });
});

// ─────────────────────────────────────────────────────────────
// W14 — o escopo
// ─────────────────────────────────────────────────────────────

describe("escopo de escrita", () => {
  it("W14 · delegação sem o escopo de escrita leva 403 nas DUAS rotas", async () => {
    const p = await previa({ titulo: `${PFX} W14 sem escopo` }, tokenSoLeitura);
    expect(p.statusCode).toBe(403);
    expect(p.json().error.code).toBe("FORBIDDEN");

    const c = await criar(
      { approvalToken: "qualquer.coisa", task: {} },
      randomUUID(),
      tokenSoLeitura,
    );
    expect(c.statusCode).toBe(403);
    expect(c.json().error.code).toBe("FORBIDDEN");
  });

  it("a `Idempotency-Key` é obrigatória e tem forma conferida", async () => {
    const p = await previaSimples(`${PFX} sem chave`);
    const sem = await app.inject({
      method: "POST",
      url: "/api/agent/v1/tasks",
      headers: { ...cabecalhos(tokenA), "content-type": "application/json" },
      payload: JSON.stringify({ approvalToken: p.approvalToken, task: p.task }),
    });
    expect(sem.statusCode).toBe(400);
    expect(sem.json().error.message).toContain("Idempotency-Key");

    const torta = await criar({ approvalToken: p.approvalToken, task: p.task }, "nao-e-uuid");
    expect(torta.statusCode).toBe(400);
    expect(await contarPorTitulo(`${PFX} sem chave`)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// W15, W16 — atomicidade. É o que não se prova lendo código.
// ─────────────────────────────────────────────────────────────

describe("atomicidade", () => {
  it("W15 · duas criações SIMULTÂNEAS com a mesma chave: uma cria, a outra recebe a mesma. Nunca duas.", async () => {
    const titulo = `${PFX} W15 concorrencia`;
    const p = await previaSimples(titulo);
    const chave = randomUUID();

    // ⚠️ Disparadas de verdade em paralelo, contra o Fastify de verdade. Este é o caso que a
    // reserva atômica existe para cobrir, e o único que não se prova por leitura de código.
    const [r1, r2] = await Promise.all([
      criar({ approvalToken: p.approvalToken, task: p.task }, chave),
      criar({ approvalToken: p.approvalToken, task: p.task }, chave),
    ]);

    const codigos = [r1.statusCode, r2.statusCode].sort();
    expect(codigos).toEqual([200, 201]);
    expect(r1.json().taskId).toBe(r2.json().taskId);

    // A prova pelo EFEITO: existe UMA tarefa e UMA reserva.
    expect(await contarPorTitulo(titulo)).toBe(1);
    expect(
      await prisma.agentIdempotency.count({
        where: { clientId, userId: userA, ferramenta: FERRAMENTA, chave },
      }),
    ).toBe(1);
  });

  it("W16 · queda ENTRE a reserva e a criação não deixa tarefa órfã nem chave órfã", async () => {
    const titulo = `${PFX} W16 queda no meio`;
    const chave = randomUUID();

    const resultado = criarTarefaDoAgente(
      {
        clientId,
        requesterUserId: userA,
        chave,
        jti: randomUUID(),
        argumentos: {
          titulo,
          prioridade: "NORMAL",
          prazo: null,
          clienteId: null,
          projetoId: null,
          responsavelIds: [userA],
        },
      },
      new Date(),
      // A queda: a reserva já entrou, e a criação da tarefa estoura.
      {
        criar: async () => {
          throw new Error("queda simulada entre a reserva e a criação");
        },
      },
    );

    await expect(resultado).rejects.toThrow("queda simulada");

    // ⚠️ Os dois lados: nem tarefa sem chave (repetir criaria a segunda), nem chave sem tarefa
    // (repetir nunca mais criaria).
    expect(await contarPorTitulo(titulo)).toBe(0);
    expect(
      await prisma.agentIdempotency.count({
        where: { clientId, userId: userA, ferramenta: FERRAMENTA, chave },
      }),
    ).toBe(0);

    // E a chave continua livre: repetir agora cria de verdade.
    const p = await previaSimples(titulo);
    const r = await criar({ approvalToken: p.approvalToken, task: p.task }, chave);
    expect(r.statusCode).toBe(201);
    expect(await contarPorTitulo(titulo)).toBe(1);
  });
});
