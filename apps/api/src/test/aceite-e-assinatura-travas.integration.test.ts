import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { PORTAL_SO_RESPONSAVEL } from "@app/shared";
import { appRouter } from "../trpc/router";
import { destinatarioDeAssinatura } from "../modules/documentos/destinatario-de-assinatura";
import { hashConteudo } from "../lib/hash";
import { hashPassword } from "../lib/password";

/**
 * AS DUAS TRAVAS QUE NÃO COBRIAM O CAMINHO QUE ASSINA (C6 da descoberta de 28/08).
 *
 * `propostas.responder` e `assinaturas.assinar` eram `publicProcedure` puro. Como o Portal
 * entregava o token de cada proposta e de cada assinatura no `portal.resumo`, quem estava
 * logado e **não** podia assinar — a secretária EQUIPE (ADR-131) e a sessão de suporte da Med
 * (ADR-128) — dava a volta pela rota pública e assinava o contrato pela clínica. As duas
 * travas existiam, cada uma no seu lugar, e nenhuma das duas ficava no caminho.
 *
 * Roda contra o MySQL de verdade e **pelo `createCaller`**, não pelo serviço: o guarda mora no
 * middleware do procedure, então chamar o serviço direto passaria verde com o buraco aberto —
 * que é exatamente o engano que deixou isto escapar até agora.
 *
 * O que fica guardado aqui:
 *  1. quem não está logado continua assinando (é o link de e-mail, o caminho normal);
 *  2. a EQUIPE é recusada nas duas ações, em português;
 *  3. a sessão de suporte da Med é recusada nas duas ações;
 *  4. o responsável assina, e fica gravado QUEM assinou;
 *  5. o `portal.resumo` não entrega o token a quem não pode usá-lo — senão a tela mostraria
 *     um botão que o servidor recusa, que é o modo de falha da ADR-133.
 */

const PFX = `trava-${randomBytes(4).toString("hex")}`;
const CONTEUDO = "# Proposta\n\nConteúdo de teste.";

type Sessao = {
  id: string;
  nome: string;
  email: string;
  role: "CLIENTE";
  clienteId: string;
  papelPortal?: "RESPONSAVEL" | "EQUIPE" | null;
  operador?: { id: string; nome: string } | null;
};

const caller = (u: Sessao | null) => appRouter.createCaller({ user: u, req: { ip: "1.2.3.4", headers: {} }, res: {} } as never);

let clienteId: string;
let documentoId: string;
let responsavel: Sessao;
let equipe: Sessao;
let suporte: Sessao;
/** Um token de assinatura por cenário — assinar é ação de uma vez só. */
const tokenAssinatura: Record<string, string> = {};
let tokenProposta: string;

async function novaAssinatura(chave: string) {
  const a = await prisma.assinatura.create({
    data: {
      documentoId,
      papel: "CLIENTE",
      nome: `${PFX}-signatario`,
      token: `${PFX}-ass-${chave}`,
      hashDocumento: hashConteudo(CONTEUDO),
    },
  });
  tokenAssinatura[chave] = a.token;
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "os testes devem usar o banco _test").toContain("_test");
  const senha = await hashPassword("x");

  const cliente = await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } });
  clienteId = cliente.id;

  const mk = async (suf: string, papel: "RESPONSAVEL" | "EQUIPE"): Promise<Sessao> => {
    const u = await prisma.user.create({
      data: {
        nome: `${PFX}-${suf}`,
        email: `${PFX}-${suf}@example.test`,
        passwordHash: senha,
        role: "CLIENTE",
        clienteId,
        papelPortal: papel,
      },
    });
    return { id: u.id, nome: u.nome, email: u.email, role: "CLIENTE", clienteId, papelPortal: papel, operador: null };
  };
  responsavel = await mk("dono", "RESPONSAVEL");
  equipe = await mk("secretaria", "EQUIPE");
  // Sessão de suporte: a conta é a do CLIENTE (responsável), mas quem está ao volante é a Med.
  suporte = { ...responsavel, operador: { id: `${PFX}-med`, nome: "Thaís" } };

  tokenProposta = `${PFX}-prop`;
  const doc = await prisma.documento.create({
    data: {
      clienteId,
      titulo: `${PFX}-proposta`,
      conteudo: CONTEUDO,
      status: "ENVIADO",
      propostaToken: tokenProposta,
      propostaStatus: "PENDENTE",
      propostaHash: hashConteudo(CONTEUDO),
    },
  });
  documentoId = doc.id;

  for (const chave of ["equipe", "suporte", "anonimo", "responsavel"]) await novaAssinatura(chave);
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { entidadeId: documentoId } });
  await prisma.assinatura.deleteMany({ where: { documentoId } });
  await prisma.documento.deleteMany({ where: { clienteId } });
  await prisma.user.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.cliente.deleteMany({ where: { nome: { startsWith: PFX } } });
});

const assinatura = (chave: string) => ({
  token: tokenAssinatura[chave]!,
  metodo: "DIGITADO" as const,
  nomeDigitado: "Fulano de Tal",
  consentimento: true as const,
});

describe("aceitar proposta e assinar contrato — quem pode, pelo caminho de verdade", () => {
  it("a EQUIPE da clínica é recusada nas DUAS ações, em português", async () => {
    const c = caller(equipe);
    await expect(c.propostas.responder({ token: tokenProposta, decisao: "ACEITA" })).rejects.toThrow(
      PORTAL_SO_RESPONSAVEL,
    );
    await expect(c.assinaturas.assinar(assinatura("equipe"))).rejects.toThrow(PORTAL_SO_RESPONSAVEL);

    // E nada foi gravado: a recusa é ANTES do efeito, não um desfazer depois.
    const doc = await prisma.documento.findUniqueOrThrow({ where: { id: documentoId } });
    expect(doc.propostaStatus).toBe("PENDENTE");
    const a = await prisma.assinatura.findUniqueOrThrow({ where: { token: tokenAssinatura["equipe"]! } });
    expect(a.status).toBe("PENDENTE");
  });

  it("a sessão de suporte da Med é recusada nas DUAS ações — vê tudo, não assina nada", async () => {
    const c = caller(suporte);
    await expect(c.propostas.responder({ token: tokenProposta, decisao: "ACEITA" })).rejects.toThrow(/suporte/i);
    await expect(c.assinaturas.assinar(assinatura("suporte"))).rejects.toThrow(/suporte/i);
  });

  it("quem NÃO está logado assina — é o link de e-mail, o caminho normal de quem assina", async () => {
    const r = await caller(null).assinaturas.assinar(assinatura("anonimo"));
    expect(r.ok).toBe(true);
    const a = await prisma.assinatura.findUniqueOrThrow({ where: { token: tokenAssinatura["anonimo"]! } });
    expect(a.status).toBe("ASSINADO");
    // Ninguém logado, ninguém a registrar: IP diz de onde veio, nunca quem foi.
    expect(a.assinadoPorId).toBeNull();
  });

  it("o responsável assina, e fica gravado QUEM assinou (ADR-137)", async () => {
    const r = await caller(responsavel).assinaturas.assinar(assinatura("responsavel"));
    expect(r.ok).toBe(true);
    const a = await prisma.assinatura.findUniqueOrThrow({ where: { token: tokenAssinatura["responsavel"]! } });
    expect(a.assinadoPorId).toBe(responsavel.id);
  });

  it("o responsável aceita a proposta, e fica gravado quem aceitou", async () => {
    const r = await caller(responsavel).propostas.responder({ token: tokenProposta, decisao: "ACEITA" });
    expect(r.ok).toBe(true);
    const doc = await prisma.documento.findUniqueOrThrow({ where: { id: documentoId } });
    expect(doc.propostaStatus).toBe("ACEITA");
    expect(doc.propostaRespPorId).toBe(responsavel.id);
  });
});

describe("portal.resumo — o token só sai para quem pode usá-lo", () => {
  it("o responsável recebe o token e consegue abrir o link", async () => {
    const r = await caller(responsavel).portal.resumo();
    expect(r.podeAssinar).toBe(true);
    expect(r.paraAssinar.every((a) => typeof a.token === "string")).toBe(true);
  });

  it("a EQUIPE VÊ que há documento para assinar, mas não recebe o token", async () => {
    const r = await caller(equipe).portal.resumo();
    expect(r.podeAssinar).toBe(false);
    // A trava é sobre assinar, não sobre ver (ADR-131): o item continua na lista.
    expect(r.paraAssinar.length).toBeGreaterThan(0);
    expect(r.paraAssinar.every((a) => a.token === null)).toBe(true);
  });

  it("a sessão de suporte da Med também não recebe o token", async () => {
    const r = await caller(suporte).portal.resumo();
    expect(r.podeAssinar).toBe(false);
    expect(r.paraAssinar.every((a) => a.token === null)).toBe(true);
  });
});

/**
 * PARA QUEM VAI O LINK — o degrau seguinte da mesma trava (achado da revisão de segurança).
 *
 * Barrar a sessão não adianta se o link chega numa caixa que a pessoa barrada abre. O e-mail ia
 * para `Cliente.email`, a caixa cadastral da clínica (tipicamente a da recepção): a secretária
 * clicava **deslogada** e assinava, porque deslogado é justamente o caminho do signatário
 * legítimo. E, pior, esse caminho é o único que NÃO deixa nome na trilha.
 */
describe("destinatarioDeAssinatura — o link vai para quem fala pela clínica", () => {
  const CAIXA_DA_CLINICA = { nome: "Clínica", email: "recepcao@clinica.test" };

  it("com responsável no Portal, o link vai para ele — não para a caixa da clínica", async () => {
    const d = await destinatarioDeAssinatura(clienteId, CAIXA_DA_CLINICA);
    expect(d.email).toBe(responsavel.email);
  });

  it("a conta EQUIPE nunca é escolhida, mesmo sendo a única com acesso", async () => {
    const outra = await prisma.cliente.create({ data: { nome: `${PFX}-so-equipe` } });
    await prisma.user.create({
      data: {
        nome: `${PFX}-so-secretaria`,
        email: `${PFX}-so-secretaria@example.test`,
        role: "CLIENTE",
        clienteId: outra.id,
        papelPortal: "EQUIPE",
      },
    });
    const d = await destinatarioDeAssinatura(outra.id, CAIXA_DA_CLINICA);
    expect(d.email).toBe(CAIXA_DA_CLINICA.email);
  });

  it("cliente sem ninguém no Portal continua recebendo na caixa da clínica — nada muda para ele", async () => {
    const semPortal = await prisma.cliente.create({ data: { nome: `${PFX}-sem-portal` } });
    const d = await destinatarioDeAssinatura(semPortal.id, CAIXA_DA_CLINICA);
    expect(d).toEqual(CAIXA_DA_CLINICA);
  });

  it("acesso REVOGADO não recebe link — mas conta convidada e ainda sem senha recebe", async () => {
    const c = await prisma.cliente.create({ data: { nome: `${PFX}-revogado` } });
    await prisma.user.create({
      data: {
        nome: `${PFX}-ex-dono`,
        email: `${PFX}-ex-dono@example.test`,
        role: "CLIENTE",
        clienteId: c.id,
        papelPortal: "RESPONSAVEL",
        ativo: false,
        acessoRevogadoEm: new Date(),
      },
    });
    expect((await destinatarioDeAssinatura(c.id, CAIXA_DA_CLINICA)).email).toBe(CAIXA_DA_CLINICA.email);

    // `ativo = false` é ambíguo (ADR-131): convidado e ainda sem senha também é inativo, e esse
    // recebe — senão a clínica cujo dono acabou de ser convidado ficaria sem receber a proposta.
    await prisma.user.create({
      data: {
        nome: `${PFX}-dono-convidado`,
        email: `${PFX}-dono-convidado@example.test`,
        role: "CLIENTE",
        clienteId: c.id,
        papelPortal: "RESPONSAVEL",
        ativo: false,
      },
    });
    expect((await destinatarioDeAssinatura(c.id, CAIXA_DA_CLINICA)).email).toBe(`${PFX}-dono-convidado@example.test`);
  });
});
