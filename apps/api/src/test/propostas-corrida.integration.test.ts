import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { listModelos } from "../modules/documentos/modelos.service.js";
import { criarPropostaPersonalizada } from "../modules/documentos/proposta-personalizada.service.js";
import { getPorToken, habilitarAceite, responder, statusDoDocumento } from "../modules/propostas/propostas.service.js";
import { duplicarProposta } from "../modules/documentos/documentos.service.js";
import { PROPOSTA_SUBSTITUIDA } from "@app/shared";

/**
 * RESPOSTAS SIMULTÂNEAS À PROPOSTA (achado M2 da revisão da onda 4), contra o MySQL de verdade.
 *
 * O defeito: a conferência "ainda está PENDENTE?" era uma LEITURA, e a gravação não era
 * condicional. Aceitar e recusar ao mesmo tempo (duas abas, o link do e-mail e o Portal) passavam
 * os dois pela conferência: a automação do aceite rodava — criando a conta a receber da linha
 * avulsa — numa proposta que terminava RECUSADA; e dois aceites rodavam a automação duas vezes.
 */

const PFX = `o4corr-${randomBytes(4).toString("hex")}`;
let atorId: string;
const clientes: string[] = [];

beforeAll(async () => {
  expect(process.env["DATABASE_URL"]).toContain("_test");
  atorId = (await prisma.user.create({ data: { nome: `${PFX}-ator`, email: `${PFX}@teste.local`, role: "ADMIN" } })).id;
  await listModelos();
});

afterAll(async () => {
  await prisma.documentoVersao.deleteMany({ where: { documento: { clienteId: { in: clientes } } } });
  await prisma.documento.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.conta.deleteMany({ where: { clienteId: { in: clientes } } });
  await prisma.activityLog.deleteMany({ where: { OR: [{ userId: atorId }, { entidadeId: { in: clientes } }] } });
  await prisma.cliente.deleteMany({ where: { id: { in: clientes } } });
  await prisma.user.deleteMany({ where: { id: atorId } });
});

/** Cliente novo + proposta personalizada com UMA linha avulsa cobrável, com o aceite habilitado. */
async function propostaPendente(sufixo: string) {
  const clienteId = (
    await prisma.cliente.create({ data: { nome: `${PFX}-${sufixo}`, situacaoComercial: "ATIVO", responsavelId: atorId } })
  ).id;
  clientes.push(clienteId);
  const doc = await criarPropostaPersonalizada(
    {
      clienteId,
      itens: [{ descricao: `${PFX} Treinamento`, valor: 400, quantidade: 1, recorrencia: "AVULSO" }],
      secoes: [{ titulo: "A", corpo: "Texto." }],
      clausulas: [],
      validadeDias: 15,
      formaPagamento: "PIX",
    },
    atorId,
  );
  await habilitarAceite(doc.id, { id: atorId, nome: "ator" }, false);
  const { propostaToken } = await prisma.documento.findUniqueOrThrow({ where: { id: doc.id }, select: { propostaToken: true } });
  return { clienteId, documentoId: doc.id, token: propostaToken! };
}

const contratos = (clienteId: string) => prisma.documento.count({ where: { clienteId, modelo: { tipo: "CONTRATO" } } });

describe("respostas simultâneas à mesma proposta", () => {
  it("aceitar + recusar ao mesmo tempo: uma vence, e a cobrança só existe se a vencedora for ACEITA", async () => {
    const { clienteId, documentoId, token } = await propostaPendente("ar");
    const r = await Promise.allSettled([
      responder({ token, decisao: "ACEITA" }, "127.0.0.1", null),
      responder({ token, decisao: "RECUSADA", motivo: "caro" }, "127.0.0.1", null),
    ]);
    const venceu = r.filter((x) => x.status === "fulfilled" && !(x.value as { jaRespondida?: boolean }).jaRespondida);
    expect(venceu).toHaveLength(1);
    const perdeu = r.find((x) => x !== venceu[0]);
    expect(perdeu?.status === "rejected" ? String((perdeu.reason as Error).message) : "").toMatch(/já foi respondida/);

    const final = (await prisma.documento.findUniqueOrThrow({ where: { id: documentoId } })).propostaStatus;
    const logs = await prisma.activityLog.count({
      where: { entidadeId: documentoId, acao: { in: ["proposta.aceita", "proposta.recusada"] } },
    });
    expect(logs).toBe(1);
    if (final === "ACEITA") {
      await vi.waitFor(async () => expect(await contratos(clienteId)).toBe(1), { timeout: 15_000, interval: 250 });
      expect(await prisma.conta.count({ where: { origemDocumentoId: documentoId } })).toBe(1);
    } else {
      expect(final).toBe("RECUSADA");
      // Dá tempo a uma automação que (indevidamente) tivesse disparado terminar.
      await new Promise((res) => setTimeout(res, 2000));
      expect(await prisma.conta.count({ where: { origemDocumentoId: documentoId } })).toBe(0);
      expect(await contratos(clienteId)).toBe(0);
    }
  });

  it("dois aceites ao mesmo tempo: a automação roda uma vez — um contrato, uma conta", async () => {
    const { clienteId, documentoId, token } = await propostaPendente("aa");
    const r = await Promise.allSettled([
      responder({ token, decisao: "ACEITA" }, "127.0.0.1", null),
      responder({ token, decisao: "ACEITA" }, "127.0.0.1", null),
    ]);
    expect(r.filter((x) => x.status === "fulfilled" && !(x.value as { jaRespondida?: boolean }).jaRespondida)).toHaveLength(1);
    expect(await prisma.activityLog.count({ where: { entidadeId: documentoId, acao: "proposta.aceita" } })).toBe(1);
    await vi.waitFor(async () => expect(await contratos(clienteId)).toBe(1), { timeout: 15_000, interval: 250 });
    await new Promise((res) => setTimeout(res, 1500));
    expect(await contratos(clienteId)).toBe(1);
    expect(await prisma.conta.count({ where: { origemDocumentoId: documentoId } })).toBe(1);
  });
});

/**
 * DUPLICAR DEIXAVA A ORIGINAL VIVA (achado M3). Duplicar para o mesmo cliente é "mudar o preço";
 * a original seguia PENDENTE com o link valendo, e aceitar as duas cobrava a mesma linha avulsa
 * duas vezes (a chave da conta inclui o id do documento).
 */
describe("duplicar proposta que aguarda aceite", () => {
  it("para o MESMO cliente: a original vira substituída e o link dela não aceita mais", async () => {
    const { clienteId, documentoId, token } = await propostaPendente("dup");
    const copia = await duplicarProposta(documentoId, {}, atorId);

    const orig = await prisma.documento.findUniqueOrThrow({ where: { id: documentoId } });
    expect(orig.propostaStatus).toBe(PROPOSTA_SUBSTITUIDA);
    await expect(responder({ token, decisao: "ACEITA" }, "127.0.0.1", null)).rejects.toThrow(/substituída/);
    await expect(getPorToken(token)).rejects.toThrow(/substituída/);
    // Reenviar a original a faria aceitável de novo ao lado da cópia.
    await expect(habilitarAceite(documentoId, { id: atorId, nome: "ator" }, false)).rejects.toThrow(/substituída/);
    expect((await statusDoDocumento(documentoId))?.substituidaPor).toEqual({ id: copia.id, numero: copia.numero });
    await new Promise((res) => setTimeout(res, 500));
    expect(await prisma.conta.count({ where: { clienteId } })).toBe(0);

    // A cópia segue o caminho normal: habilitada, ela aceita.
    await habilitarAceite(copia.id, { id: atorId, nome: "ator" }, false);
    const t2 = (await prisma.documento.findUniqueOrThrow({ where: { id: copia.id } })).propostaToken!;
    expect((await responder({ token: t2, decisao: "ACEITA" }, "127.0.0.1", null)).decisao).toBe("ACEITA");
  });

  it("para OUTRO cliente: a original continua aceitável", async () => {
    const { documentoId, token } = await propostaPendente("dup-outro");
    const outroId = (await prisma.cliente.create({ data: { nome: `${PFX}-destino`, situacaoComercial: "ATIVO" } })).id;
    clientes.push(outroId);
    await duplicarProposta(documentoId, { clienteId: outroId }, atorId);
    expect((await prisma.documento.findUniqueOrThrow({ where: { id: documentoId } })).propostaStatus).toBe("PENDENTE");
    expect((await responder({ token, decisao: "RECUSADA", motivo: "x" }, "127.0.0.1", null)).decisao).toBe("RECUSADA");
  });
});
