import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { prisma } from "@app/db";
import { caminhoAbsoluto, removerArquivo } from "../lib/storage.js";

/**
 * O EXPURGO NÃO PODE DAR "APAGADO" A UMA PLANILHA QUE FICOU NO DISCO.
 *
 * Antes, `apagarArquivosOriginais` usava `removerArquivo`, que engole qualquer erro: o disco
 * recusava, a linha do banco sumia mesmo assim, e a planilha com o paciente em claro ficava no
 * disco sem nada que levasse a ela — e o ActivityLog contava como eliminada.
 *
 * A falha é provocada com um `caminho` fora da pasta de uploads: `caminhoAbsoluto` recusa, que é
 * um erro de verdade (não ENOENT) do mesmo caminho de código que um disco sem permissão.
 *
 * `registrarErro` é espionado: além de provar que o erro chega a SISTEMA → Erros, evita que o
 * teste avise ROOTs reais por e-mail.
 */
const registrarErro = vi.hoisted(() => vi.fn(async (_dados: { rota?: string | null; mensagem: string }) => undefined));
vi.mock("../modules/sistema/sistema.service.js", async (original) => ({
  ...(await original<typeof import("../modules/sistema/sistema.service.js")>()),
  registrarErro,
}));

const { apagarArquivosOriginais } = await import("../modules/conciliacao/retencao-paciente.service.js");
const { anonimizarCliente } = await import("../modules/clientes/anonimizar.service.js");

const PFX = `ret-disco-${randomBytes(4).toString("hex")}`;
let usuarioId = "";

async function arquivoDaConciliacao(clienteId: string, caminho: string, noDisco: boolean) {
  if (noDisco) {
    const abs = caminhoAbsoluto(caminho);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, "Paciente;CPF\nFulano;123.456.789-09\n", "utf8");
  }
  const a = await prisma.arquivo.create({
    data: { nome: `${PFX}.csv`, mimetype: "text/csv", tamanho: 30, caminho, clienteId, enviadoPorTipo: "EQUIPE" },
  });
  await prisma.producaoLote.create({
    data: {
      clienteId,
      competencia: "2020-01",
      origem: "CONSULTAS_NUVENS",
      arquivoId: a.id,
      nomeArquivo: "x.csv",
      formato: "csv",
      hashArquivo: randomBytes(32).toString("hex"),
      status: "IMPORTADO",
    },
  });
  return a.id;
}

/** Caminho que `caminhoAbsoluto` recusa: o disco "não consegue" apagar. */
const caminhoRecusado = () => `../${PFX}-fora-${randomUUID()}.csv`;

beforeAll(async () => {
  usuarioId = (await prisma.user.create({ data: { nome: `${PFX}-root`, email: `${PFX}-root@teste.local`, role: "ROOT" } })).id;
});

afterAll(async () => {
  const clientes = await prisma.cliente.findMany({ where: { nome: { startsWith: PFX } }, select: { id: true } });
  const ids = clientes.map((c) => c.id);
  const restantes = await prisma.arquivo.findMany({ where: { clienteId: { in: ids } }, select: { caminho: true } });
  await Promise.all(restantes.map((a) => removerArquivo(a.caminho)));
  await prisma.cliente.deleteMany({ where: { id: { in: ids } } });
  await prisma.activityLog.deleteMany({ where: { userId: usuarioId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
});

describe("apagarArquivosOriginais — o disco recusou", () => {
  it("a linha FICA, o erro é registrado, e só o que saiu de verdade é contado; os outros seguem", async () => {
    registrarErro.mockClear();
    const c = await prisma.cliente.create({ data: { nome: `${PFX}-expurgo` } });
    const bomCaminho = `clientes/${c.id}/${randomUUID()}.csv`;
    const bom = await arquivoDaConciliacao(c.id, bomCaminho, true);
    const teimoso = await arquivoDaConciliacao(c.id, caminhoRecusado(), false);

    const r = await apagarArquivosOriginais({ clienteId: c.id });

    expect(r).toEqual({ apagados: 1, falhas: 1 });
    expect(await prisma.arquivo.findUnique({ where: { id: bom } })).toBeNull();
    expect(existsSync(caminhoAbsoluto(bomCaminho))).toBe(false);
    // A linha do teimoso continua — a próxima varredura tenta de novo.
    expect(await prisma.arquivo.findUnique({ where: { id: teimoso } })).not.toBeNull();
    expect(registrarErro).toHaveBeenCalledTimes(1);
    expect(registrarErro.mock.calls[0]?.[0]).toMatchObject({ rota: "conciliacao.expurgo.arquivo" });
  });

  it("arquivo que já não está no disco (ENOENT) conta como apagado — a linha sai sem erro", async () => {
    registrarErro.mockClear();
    const c = await prisma.cliente.create({ data: { nome: `${PFX}-sumido` } });
    const id = await arquivoDaConciliacao(c.id, `clientes/${c.id}/${randomUUID()}.csv`, false);

    expect(await apagarArquivosOriginais({ clienteId: c.id })).toEqual({ apagados: 1, falhas: 0 });
    expect(await prisma.arquivo.findUnique({ where: { id } })).toBeNull();
    expect(registrarErro).not.toHaveBeenCalled();
  });
});

describe("anonimizarCliente — planilha que não saiu do disco", () => {
  it("recusa marcar o cliente como anonimizado, para o botão poder ser apertado de novo", async () => {
    registrarErro.mockClear();
    const c = await prisma.cliente.create({ data: { nome: `${PFX}-anon`, deletedAt: new Date() } });
    const teimoso = await arquivoDaConciliacao(c.id, caminhoRecusado(), false);

    await expect(anonimizarCliente(c.id, usuarioId)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const depois = await prisma.cliente.findUnique({ where: { id: c.id }, select: { anonimizadoEm: true, nome: true } });
    expect(depois?.anonimizadoEm).toBeNull();
    expect(depois?.nome).toBe(`${PFX}-anon`);
    expect(await prisma.arquivo.findUnique({ where: { id: teimoso } })).not.toBeNull();
    expect(registrarErro).toHaveBeenCalledTimes(1);
  });
});
