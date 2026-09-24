import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

/**
 * ARQUIVO DE CLIENTE OBEDECE À RÉGUA DO PAINEL (ADR-128) — download, lista e envio.
 *
 * Antes, "equipe acessa qualquer um": qualquer funcionário baixava qualquer arquivo de qualquer
 * clínica, inclusive o relatório original do TASY (prontuário e Cód. Pessoa dentro), que a tela
 * da Conciliação se recusa a mostrar. Aqui se prova, pelo Fastify de verdade (`app.inject`) e
 * pelo `createCaller` — chamar o serviço direto pularia a porta onde a trava mora:
 *
 *  - funcionário SEM o cliente → 403 no download, na lista e no envio;
 *  - funcionário responsável e ADMIN → passam;
 *  - todo download da EQUIPE grava `arquivo.baixado`; o do próprio cliente, não;
 *  - o cliente do Portal continua como estava (só o próprio `clienteId`).
 */

const { prisma } = await import("@app/db");
const { config } = await import("../config.js");
const { appRouter } = await import("../trpc/router.js");
const { createSession, SESSION_COOKIE } = await import("../lib/session.js");
const { caminhoAbsoluto } = await import("../lib/storage.js");
const { registrarRotasArquivos } = await import("../http/uploads.js");

const PFX = `arqregua-${randomBytes(4).toString("hex")}`;

let app: FastifyInstance;
let clienteDoDono: string;
let outroCliente: string;
let dono: string;
let estranho: string;
let chefe: string;
let portal: string;
let arquivoId: string;
let arquivoDoOutro: string;
const sid: Record<string, string> = {};
const caminhos: string[] = [];

const cookieDe = (quem: string) => `${SESSION_COOKIE}=${app.signCookie(sid[quem]!)}`;
const baixar = (quem: string, id: string) =>
  app.inject({ method: "GET", url: `/arquivos/${id}`, headers: { cookie: cookieDe(quem) } });

/** Multipart feito à mão: campos ANTES do arquivo, como o `/upload` exige. */
function corpoDeUpload(clienteId: string) {
  const limite = `----${PFX}`;
  const partes = [
    `--${limite}\r\nContent-Disposition: form-data; name="clienteId"\r\n\r\n${clienteId}\r\n`,
    `--${limite}\r\nContent-Disposition: form-data; name="arquivo"; filename="${PFX}-up.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 teste\r\n`,
    `--${limite}--\r\n`,
  ];
  return { payload: partes.join(""), contentType: `multipart/form-data; boundary=${limite}` };
}
const enviar = (quem: string, clienteId: string) => {
  const { payload, contentType } = corpoDeUpload(clienteId);
  return app.inject({ method: "POST", url: "/upload", payload, headers: { cookie: cookieDe(quem), "content-type": contentType } });
};

const como = (id: string, role: "FUNCIONARIO" | "ADMIN") =>
  appRouter.createCaller({ user: { id, role, nome: id, email: `${id}@x` }, req: {}, res: {} } as never);

async function arquivoNoDisco(clienteId: string, nome: string) {
  const caminho = `clientes/${clienteId}/${PFX}-${nome}`;
  await mkdir(dirname(caminhoAbsoluto(caminho)), { recursive: true });
  await writeFile(caminhoAbsoluto(caminho), "conteudo");
  caminhos.push(caminho);
  const a = await prisma.arquivo.create({
    data: { clienteId, nome: `${PFX}-${nome}`, mimetype: "application/pdf", tamanho: 8, caminho, enviadoPorTipo: "CLIENTE" },
  });
  return a.id;
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "os testes devem usar o banco _test").toContain("_test");
  const u = (nome: string, role: "FUNCIONARIO" | "ADMIN" | "CLIENTE", clienteId?: string) =>
    prisma.user.create({ data: { nome: `${PFX}-${nome}`, email: `${PFX}-${nome}@teste.local`, role, ativo: true, clienteId } });

  dono = (await u("dono", "FUNCIONARIO")).id;
  estranho = (await u("estranho", "FUNCIONARIO")).id;
  chefe = (await u("chefe", "ADMIN")).id;
  clienteDoDono = (await prisma.cliente.create({ data: { nome: `${PFX}-A`, responsavelId: dono } })).id;
  outroCliente = (await prisma.cliente.create({ data: { nome: `${PFX}-B` } })).id;
  portal = (await u("portal", "CLIENTE", clienteDoDono)).id;

  arquivoId = await arquivoNoDisco(clienteDoDono, "a.pdf");
  arquivoDoOutro = await arquivoNoDisco(outroCliente, "b.pdf");

  for (const [k, id] of Object.entries({ dono, estranho, chefe, portal })) sid[k] = await createSession(id);

  app = Fastify({ logger: false });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await registrarRotasArquivos(app);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  const ids = [dono, estranho, chefe, portal].filter(Boolean);
  await prisma.activityLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  const enviados = await prisma.arquivo.findMany({ where: { nome: { startsWith: PFX } }, select: { caminho: true } });
  for (const c of [...caminhos, ...enviados.map((e) => e.caminho)]) await rm(caminhoAbsoluto(c), { force: true });
  await prisma.arquivo.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.updateMany({ where: { id: portal }, data: { clienteId: null } });
  await prisma.cliente.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.$disconnect();
});

const logsDe = (userId: string, id: string) =>
  prisma.activityLog.findMany({ where: { userId, acao: "arquivo.baixado", entidadeId: id } });

describe("download /arquivos/:id", () => {
  it("funcionário SEM o cliente leva 403 — e nada é registrado como baixado", async () => {
    const r = await baixar("estranho", arquivoId);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatch(/sob a sua responsabilidade/);
    expect(await logsDe(estranho, arquivoId)).toHaveLength(0);
  });

  it("funcionário responsável baixa, e o download fica registrado", async () => {
    const r = await baixar("dono", arquivoId);
    expect(r.statusCode).toBe(200);
    const logs = await logsDe(dono, arquivoId);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.dados).toMatchObject({ clienteId: clienteDoDono, viaSuporte: false });
  });

  it("ADMIN baixa de qualquer cliente, e fica registrado", async () => {
    const r = await baixar("chefe", arquivoDoOutro);
    expect(r.statusCode).toBe(200);
    expect(await logsDe(chefe, arquivoDoOutro)).toHaveLength(1);
  });

  it("cliente do Portal baixa o PRÓPRIO arquivo SEM gerar registro, e não baixa o de outra clínica", async () => {
    expect((await baixar("portal", arquivoId)).statusCode).toBe(200);
    expect(await prisma.activityLog.count({ where: { userId: portal, acao: "arquivo.baixado" } })).toBe(0);
    expect((await baixar("portal", arquivoDoOutro)).statusCode).toBe(403);
  });

  it("sessão de suporte (equipe vendo o Portal) registra no nome do OPERADOR", async () => {
    sid["suporte"] = await createSession(portal, { operadorId: chefe });
    expect((await baixar("suporte", arquivoId)).statusCode).toBe(200);
    const logs = await logsDe(chefe, arquivoId);
    expect(logs.some((l) => (l.dados as { viaSuporte?: boolean }).viaSuporte === true)).toBe(true);
  });

  it("se o registro do download falhar, o download segue — e a falha vai para SISTEMA → Erros", async () => {
    // ⚠️ Salvar/repor À MÃO, nunca `vi.spyOn`: nem `mockRestore` nem deixar o spy de pé
    // devolvem o delegate do Prisma — visto quebrando `activityLog.create` nos ARQUIVOS SEGUINTES
    // do mesmo fork (ADR-149).
    const original = prisma.activityLog.create;
    let recusou = false;
    (prisma.activityLog as { create: unknown }).create = (...args: unknown[]) => {
      if (!recusou) {
        recusou = true;
        return Promise.reject(new Error(`${PFX} banco recusou o registro`));
      }
      return (original as (...a: unknown[]) => unknown)(...args);
    };
    let r;
    try {
      r = await baixar("chefe", arquivoId);
    } finally {
      (prisma.activityLog as { create: unknown }).create = original;
    }
    expect(recusou).toBe(true);
    expect(r.statusCode, "o download não pode cair por causa do registro").toBe(200);

    const erro = await prisma.errorLog.findFirst({
      where: { rota: "arquivos.download.registro", mensagem: { contains: arquivoId } },
    });
    expect(erro, "a falha do registro fica visível no painel de erros").not.toBeNull();
    await prisma.errorLog.deleteMany({ where: { rota: "arquivos.download.registro", mensagem: { contains: PFX } } });
  });
});

describe("lista clientes.arquivos", () => {
  it("funcionário SEM o cliente leva FORBIDDEN", async () => {
    await expect(como(estranho, "FUNCIONARIO").clientes.arquivos({ id: clienteDoDono })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("funcionário responsável e ADMIN listam", async () => {
    expect((await como(dono, "FUNCIONARIO").clientes.arquivos({ id: clienteDoDono })).map((a) => a.id)).toContain(arquivoId);
    expect((await como(chefe, "ADMIN").clientes.arquivos({ id: outroCliente })).map((a) => a.id)).toContain(arquivoDoOutro);
  });
});

describe("envio /upload", () => {
  it("funcionário SEM o cliente leva 403 e nada é gravado", async () => {
    const antes = await prisma.arquivo.count({ where: { clienteId: outroCliente } });
    const r = await enviar("estranho", outroCliente);
    expect(r.statusCode).toBe(403);
    expect(await prisma.arquivo.count({ where: { clienteId: outroCliente } })).toBe(antes);
  });
  it("funcionário responsável e ADMIN enviam", async () => {
    expect((await enviar("dono", clienteDoDono)).statusCode).toBe(200);
    expect((await enviar("chefe", outroCliente)).statusCode).toBe(200);
  });
});
