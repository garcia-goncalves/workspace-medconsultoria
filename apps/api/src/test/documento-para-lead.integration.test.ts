import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import {
  destinatariosDeDocumento,
  clienteDoLeadParaDocumento,
} from "../modules/documentos/documentos.service.js";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";

/**
 * DOCUMENTO PARA QUEM AINDA É LEAD (27/08/2026, ordem do dono).
 *
 * Roda contra o MySQL de VERDADE porque o que se prova é **quem aparece na lista** e
 * **quantas linhas nascem** — as duas coisas são consulta e escrita, e typecheck verde não
 * diz nada sobre nenhuma delas (a lição das ADR-118/119).
 *
 * O que estes testes guardam:
 *  1. lead ativo APARECE entre os destinatários; cliente de verdade continua aparecendo;
 *  2. lead convertido NÃO aparece de novo — o cliente dele já está na outra lista, e mostrar
 *     os dois seria a armadilha das duas contas de Portal da ADR-128;
 *  3. lead perdido e lead removido ficam de fora;
 *  4. traduzir o lead em cliente é IDEMPOTENTE — duas chamadas, um cliente só — e o lead
 *     continua lead: emitir proposta NÃO pode converter pelas costas;
 *  5. o nome que vai IMPRESSO é o da clínica, sem o nome da pessoa entre parênteses.
 */

const PFX = `docl-${randomBytes(4).toString("hex")}`;
let stageId: string;
let clienteRealId: string;
let leadAtivoId: string;
let leadPerdidoId: string;
let leadConvertidoId: string;
let leadSemEmpresaId: string;
const clientesCriados: string[] = [];
const leadsCriados: string[] = [];

beforeAll(async () => {
  exigirBancoDeTeste();
  const stage = await prisma.pipelineStage.findFirst({ orderBy: { ordem: "asc" } });
  if (!stage) throw new Error("Pipeline não configurado no banco de teste.");
  stageId = stage.id;

  const cliente = await prisma.cliente.create({
    data: { nome: `${PFX}-cliente-real`, situacaoComercial: "ATIVO" },
  });
  clienteRealId = cliente.id;
  clientesCriados.push(cliente.id);

  const convertidoEm = await prisma.cliente.create({
    data: { nome: `${PFX}-ja-convertido`, situacaoComercial: "ATIVO" },
  });
  clientesCriados.push(convertidoEm.id);

  const [ativo, perdido, convertido, semEmpresa] = await Promise.all([
    prisma.lead.create({
      data: { pipelineStageId: stageId, nome: `${PFX} Pessoa`, empresa: `${PFX} Clinica`, email: `${PFX}-a@example.test` },
    }),
    prisma.lead.create({
      data: { pipelineStageId: stageId, nome: `${PFX} Perdido`, empresa: `${PFX} Perdida`, perdidoEm: new Date() },
    }),
    prisma.lead.create({
      data: { pipelineStageId: stageId, nome: `${PFX} Convertido`, empresa: `${PFX} Convertida`, convertidoEmClienteId: convertidoEm.id },
    }),
    prisma.lead.create({
      data: { pipelineStageId: stageId, nome: `${PFX} SoPessoa` },
    }),
  ]);
  leadAtivoId = ativo.id;
  leadPerdidoId = perdido.id;
  leadConvertidoId = convertido.id;
  leadSemEmpresaId = semEmpresa.id;
  leadsCriados.push(ativo.id, perdido.id, convertido.id, semEmpresa.id);
});

afterAll(async () => {
  await prisma.documento.deleteMany({ where: { clienteId: { in: clientesCriados } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadsCriados } } });
  await prisma.activityLog.deleteMany({
    where: { entidadeId: { in: [...leadsCriados, ...clientesCriados] } },
  });
  await prisma.user.deleteMany({ where: { clienteId: { in: clientesCriados } } });
  await prisma.cliente.deleteMany({ where: { id: { in: clientesCriados } } });
});

describe("destinatários de documento", () => {
  it("mostra o lead ativo E o cliente de verdade, cada um na sua lista", async () => {
    const r = await destinatariosDeDocumento();
    expect(r.clientes.some((c) => c.id === clienteRealId)).toBe(true);
    expect(r.leads.some((l) => l.id === leadAtivoId)).toBe(true);
    // O lead NÃO pode vazar para a lista de clientes: são coisas diferentes na tela.
    expect(r.clientes.some((c) => c.id === leadAtivoId)).toBe(false);
  });

  it("não oferece lead perdido, convertido nem removido", async () => {
    const r0 = await destinatariosDeDocumento();
    expect(r0.leads.some((l) => l.id === leadPerdidoId)).toBe(false);
    expect(r0.leads.some((l) => l.id === leadConvertidoId)).toBe(false);

    await prisma.lead.update({ where: { id: leadAtivoId }, data: { deletedAt: new Date() } });
    const r1 = await destinatariosDeDocumento();
    expect(r1.leads.some((l) => l.id === leadAtivoId), "lead removido não pode aparecer").toBe(false);
    await prisma.lead.update({ where: { id: leadAtivoId }, data: { deletedAt: null } });
  });

  it("o rótulo ajuda a ESCOLHER e o nome impresso é só a clínica", async () => {
    const r = await destinatariosDeDocumento();
    const l = r.leads.find((x) => x.id === leadAtivoId);
    expect(l?.rotulo).toBe(`${PFX} Clinica (${PFX} Pessoa)`);
    // O que sai no papel não pode ter parêntese: "Prezado(a) Clínica X (Fulano)" não se manda.
    expect(l?.nomeNoDocumento).toBe(`${PFX} Clinica`);

    const semEmp = r.leads.find((x) => x.id === leadSemEmpresaId);
    expect(semEmp?.rotulo).toBe(`${PFX} SoPessoa`);
    expect(semEmp?.nomeNoDocumento).toBe(`${PFX} SoPessoa`);
  });
});

describe("traduzir o lead no cliente do documento", () => {
  it("é idempotente: duas chamadas, UM cliente — e o lead continua lead", async () => {
    const a = await clienteDoLeadParaDocumento(leadAtivoId);
    const b = await clienteDoLeadParaDocumento(leadAtivoId);
    expect(a.clienteId).toBe(b.clienteId);
    clientesCriados.push(a.clienteId);

    const cliente = await prisma.cliente.findUniqueOrThrow({
      where: { id: a.clienteId },
      select: { situacaoComercial: true },
    });
    // PROSPECT, não ATIVO: emitir proposta não é fechar negócio, e a página Clientes
    // continua mostrando só quem é cliente de verdade (ADR-24).
    expect(cliente.situacaoComercial).toBe("PROSPECT");

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadAtivoId },
      select: { convertidoEmClienteId: true, clienteId: true },
    });
    expect(lead.convertidoEmClienteId, "propor NÃO converte o lead").toBeNull();
    expect(lead.clienteId).toBe(a.clienteId);
  });

  it("recusa lead que não existe", async () => {
    await expect(clienteDoLeadParaDocumento("nao-existe-mesmo")).rejects.toThrow();
  });
});
