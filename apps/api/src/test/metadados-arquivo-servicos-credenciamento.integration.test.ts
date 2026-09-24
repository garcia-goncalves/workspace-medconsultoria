import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { appRouter } from "../trpc/router.js";
import { NOME_SERVICO_CREDENCIAMENTO, sincronizarRequisitosCredenciamento } from "../modules/servicos/credenciamento.service.js";

/**
 * OS METADADOS DE ARQUIVO SEGUEM A RÉGUA DO RESPONSÁVEL — a "segunda porta" (ADR-128/ADR-133).
 *
 * O commit `9b90aac` fechou download (`/arquivos/:id`), lista (`clientes.arquivos`) e envio
 * (`/upload`): qualquer funcionário deixou de baixar/enviar arquivo de qualquer clínica. Mas
 * `clientes.servicos` e `credenciamento.porCliente` continuavam devolvendo nome, tamanho e id de
 * CADA documento — a lista fechada, o conteúdo aberto por outra porta.
 *
 * Aqui se prova, pela ROTA (`appRouter.createCaller`, não a função direto — é onde a trava do
 * commit anterior mora e onde esta precisa morar também):
 *
 *  - funcionário SEM o cliente: os metadados de arquivo somem do retorno
 *    (`arquivosRestritos: true`, listas vazias), mas status/progresso/veredito continuam —
 *    são contagem e regra de negócio, não conteúdo;
 *  - funcionário responsável e ADMIN: recebem tudo, como sempre;
 *  - nenhum nome nem id de arquivo aparece no JSON de quem não pode ver.
 */

const PFX = `metaarq-${randomBytes(4).toString("hex")}`;
const NOME_ARQUIVO_SERVICO = `${PFX}-comprovante.pdf`;
const NOME_ARQUIVO_CREDENCIAMENTO = `${PFX}-diploma.pdf`;

let clienteId: string;
let dono: string;
let estranho: string;
let chefe: string;

let servicoNormalId: string;
let requisitoNormalId: string;
let arquivoServicoId: string;

let profissionalId: string;
let requisitoCredenciamentoId: string;
let arquivoCredenciamentoId: string;
// A marca `ehCredenciamento` é ÚNICA no sistema inteiro: este arquivo a liga no serviço canônico e
// precisa devolvê-la como achou. Sem isso, o arquivo seguinte da suíte (que roda no mesmo banco,
// em sequência) encontra a marca ocupada — foi o que reprovou `marca-credenciamento-na-criacao`.
let servicoCredId: string;
let marcaAntes: boolean;

const como = (id: string, role: "FUNCIONARIO" | "ADMIN") =>
  appRouter.createCaller({ user: { id, role, nome: id, email: `${id}@x` }, req: {}, res: {} } as never);

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "os testes devem usar o banco _test").toContain("_test");

  const u = (nome: string, role: "FUNCIONARIO" | "ADMIN") =>
    prisma.user.create({ data: { nome: `${PFX}-${nome}`, email: `${PFX}-${nome}@teste.local`, role, ativo: true } });

  dono = (await u("dono", "FUNCIONARIO")).id;
  estranho = (await u("estranho", "FUNCIONARIO")).id;
  chefe = (await u("chefe", "ADMIN")).id;
  clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica`, responsavelId: dono } })).id;

  // ── um serviço qualquer, contratado, com um documento enviado ──────────────
  servicoNormalId = (
    await prisma.servico.create({ data: { nome: `${PFX}-servico`, valor: 500, valorRecorrencia: "AVULSO" } })
  ).id;
  requisitoNormalId = (
    await prisma.servicoRequisito.create({
      data: { servicoId: servicoNormalId, titulo: `${PFX}-comprovante`, tipo: "DOCUMENTO", obrigatorio: true },
    })
  ).id;
  await prisma.clienteServico.create({ data: { clienteId, servicoId: servicoNormalId, status: "ATIVO" } });
  arquivoServicoId = (
    await prisma.arquivo.create({
      data: {
        nome: NOME_ARQUIVO_SERVICO,
        mimetype: "application/pdf",
        tamanho: 10,
        caminho: `${PFX}/comprovante.pdf`,
        clienteId,
        servicoId: servicoNormalId,
        requisitoId: requisitoNormalId,
        enviadoPorTipo: "CLIENTE",
      },
    })
  ).id;

  // ── o credenciamento: profissional cadastrado + um documento dele enviado ──
  const servicoCred = await prisma.servico.findFirst({
    where: { nome: NOME_SERVICO_CREDENCIAMENTO },
    select: { id: true, ehCredenciamento: true },
  });
  if (!servicoCred) {
    marcaAntes = false;
    servicoCredId = (await prisma.servico.create({ data: { nome: NOME_SERVICO_CREDENCIAMENTO, ehCredenciamento: true } })).id;
  } else {
    marcaAntes = servicoCred.ehCredenciamento;
    servicoCredId = servicoCred.id;
    await prisma.servico.update({ where: { id: servicoCred.id }, data: { ehCredenciamento: true } });
  }
  await sincronizarRequisitosCredenciamento(true);

  profissionalId = (
    await prisma.profissional.create({ data: { clienteId, nome: `${PFX}-medico`, conselho: "CRM" } })
  ).id;
  const requisitoDiploma = await prisma.servicoRequisito.findFirst({
    where: { titulo: { contains: "Diploma" }, escopo: "PROFISSIONAL" },
    select: { id: true },
  });
  if (!requisitoDiploma) throw new Error("Exigência 'Diploma' não encontrada — sincronização não rodou.");
  requisitoCredenciamentoId = requisitoDiploma.id;
  arquivoCredenciamentoId = (
    await prisma.arquivo.create({
      data: {
        nome: NOME_ARQUIVO_CREDENCIAMENTO,
        mimetype: "application/pdf",
        tamanho: 20,
        caminho: `${PFX}/diploma.pdf`,
        clienteId,
        requisitoId: requisitoCredenciamentoId,
        profissionalId,
        lado: "FRENTE",
        enviadoPorTipo: "CLIENTE",
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.arquivo.deleteMany({ where: { clienteId } });
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.profissional.deleteMany({ where: { clienteId } });
  await prisma.servicoRequisito.deleteMany({ where: { servicoId: servicoNormalId } });
  await prisma.servico.deleteMany({ where: { id: servicoNormalId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  if (servicoCredId) await prisma.servico.update({ where: { id: servicoCredId }, data: { ehCredenciamento: marcaAntes } });
  await prisma.$disconnect();
});

describe("clientes.servicos — metadados de arquivo seguem a régua do responsável", () => {
  it("funcionário SEM o cliente não recebe metadados de arquivo, mas o resto continua", async () => {
    const itens = await como(estranho, "FUNCIONARIO").clientes.servicos({ id: clienteId });
    const item = itens.find((i) => i.servico.id === servicoNormalId);
    expect(item, "o serviço contratado tem de aparecer na lista").toBeTruthy();
    expect(item!.arquivosRestritos).toBe(true);
    expect(item!.arquivosAvulsos).toHaveLength(0);
    const requisito = item!.requisitos.find((r) => r.id === requisitoNormalId);
    expect(requisito!.arquivos).toHaveLength(0);
    // Contagem, não conteúdo: o documento existe, então continua "atendido" — só o objeto
    // do arquivo em si é que some.
    expect(requisito!.atendido).toBe(true);
    expect(item!.pendentes).toBe(0);
    expect(item!.contratado).toBe(true);

    // Nenhum rastro do arquivo no JSON de quem não pode ver.
    const bruto = JSON.stringify(itens);
    expect(bruto).not.toContain(NOME_ARQUIVO_SERVICO);
    expect(bruto).not.toContain(arquivoServicoId);
  });

  it("funcionário responsável recebe os metadados normalmente", async () => {
    const itens = await como(dono, "FUNCIONARIO").clientes.servicos({ id: clienteId });
    const item = itens.find((i) => i.servico.id === servicoNormalId)!;
    expect(item.arquivosRestritos).toBe(false);
    const requisito = item.requisitos.find((r) => r.id === requisitoNormalId)!;
    expect(requisito.arquivos.map((a) => a.id)).toContain(arquivoServicoId);
    expect(JSON.stringify(itens)).toContain(NOME_ARQUIVO_SERVICO);
  });

  it("ADMIN recebe os metadados de qualquer cliente", async () => {
    const itens = await como(chefe, "ADMIN").clientes.servicos({ id: clienteId });
    const item = itens.find((i) => i.servico.id === servicoNormalId)!;
    expect(item.arquivosRestritos).toBe(false);
    const requisito = item.requisitos.find((r) => r.id === requisitoNormalId)!;
    expect(requisito.arquivos.map((a) => a.id)).toContain(arquivoServicoId);
  });
});

describe("credenciamento.porCliente — metadados de arquivo seguem a régua do responsável", () => {
  it("funcionário SEM o cliente não recebe metadados de arquivo, mas triagem e progresso continuam", async () => {
    const v = await como(estranho, "FUNCIONARIO").credenciamento.porCliente({ clienteId });
    expect(v.arquivosRestritos).toBe(true);
    expect(v.emCurso).toBe(true);
    // O progresso é calculado ANTES de ocultar — continua contando o documento como enviado.
    expect(v.progresso.atendidas).toBeGreaterThan(0);

    const doProfissional = v.porProfissional.find((p) => p.profissional.id === profissionalId)!;
    const vagaDoDiploma = doProfissional.requisitos.find((r) => r.id === requisitoCredenciamentoId)!.vagas;
    const vagaFrente = vagaDoDiploma.find((vg) => vg.lado === "FRENTE")!;
    expect(vagaFrente.arquivo).toBeNull();
    // Mas a contagem sabe que a vaga está preenchida — é o que sustenta "X de Y documentos".
    expect(vagaFrente.preenchida).toBe(true);

    const bruto = JSON.stringify(v);
    expect(bruto).not.toContain(NOME_ARQUIVO_CREDENCIAMENTO);
    expect(bruto).not.toContain(arquivoCredenciamentoId);
  });

  it("funcionário responsável recebe os metadados normalmente", async () => {
    const v = await como(dono, "FUNCIONARIO").credenciamento.porCliente({ clienteId });
    expect(v.arquivosRestritos).toBe(false);
    const doProfissional = v.porProfissional.find((p) => p.profissional.id === profissionalId)!;
    const vagaFrente = doProfissional.requisitos
      .find((r) => r.id === requisitoCredenciamentoId)!
      .vagas.find((vg) => vg.lado === "FRENTE")!;
    expect(vagaFrente.arquivo?.id).toBe(arquivoCredenciamentoId);
    expect(vagaFrente.preenchida).toBe(true);
    expect(JSON.stringify(v)).toContain(NOME_ARQUIVO_CREDENCIAMENTO);
  });

  it("ADMIN recebe os metadados de qualquer cliente", async () => {
    const v = await como(chefe, "ADMIN").credenciamento.porCliente({ clienteId });
    expect(v.arquivosRestritos).toBe(false);
    const doProfissional = v.porProfissional.find((p) => p.profissional.id === profissionalId)!;
    const vagaFrente = doProfissional.requisitos
      .find((r) => r.id === requisitoCredenciamentoId)!
      .vagas.find((vg) => vg.lado === "FRENTE")!;
    expect(vagaFrente.arquivo?.id).toBe(arquivoCredenciamentoId);
  });
});
