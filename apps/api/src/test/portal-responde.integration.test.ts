import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { hashPassword } from "../lib/password";
import { hojeBRT, somarDiasUTC } from "../lib/datas";

/**
 * ONDA 3B — O PORTAL QUE RESPONDE O QUE O CLIENTE PERGUNTA POR WHATSAPP, contra o MySQL de verdade.
 *
 * Três perguntas, três recortes que só o banco prova:
 *  1. "quanto eu devo?" — `portal.pagamentos` mostra as contas a RECEBER da Med DESTA clínica e
 *     nada mais: nem a carteira PESSOAL, nem conta a pagar, nem outra clínica, nem observação;
 *  2. "em que pé está na operadora?" — `portal.credenciamento.andamento` diz a situação da
 *     tentativa mais recente, sem honorário, sem motivo da negativa, sem observação interna;
 *  3. o e-mail de pendência nova — primeira vez calada, depois um por dia e só com novidade.
 *
 * Pelo `createCaller` (o isolamento mora no `portalProcedure`): chamar o serviço direto passaria
 * verde mesmo que a rota recebesse `clienteId` do pedido.
 */

// O envio real fica de fora: o `.env` desta máquina pode ter SMTP, e teste não manda e-mail.
const envio = vi.hoisted(() => ({ enviados: [] as { para: string; assunto: string; texto?: string }[], falhar: false }));
vi.mock("../lib/email.js", () => ({
  enviarEmail: vi.fn(async (msg: { para: string; assunto: string; texto?: string }) => {
    if (envio.falhar) return { enviado: false, erro: "servidor fora do ar (simulado)" };
    envio.enviados.push({ para: msg.para, assunto: msg.assunto, texto: msg.texto });
    return { enviado: true };
  }),
}));

const { appRouter } = await import("../trpc/router");
const aviso = await import("../modules/portal/aviso-de-pendencias");

const PFX = `o3b-${randomBytes(4).toString("hex")}`;
const SEGREDO_CONTA = `${PFX}-SEGREDO-DA-CONTA`;
const SEGREDO_NEGATIVA = `${PFX}-MOTIVO-INTERNO`;
const SEGREDO_OBS = `${PFX}-OBS-INTERNA`;

type Sessao = {
  id: string;
  nome: string;
  email: string;
  role: "CLIENTE";
  clienteId: string;
  papelPortal?: "RESPONSAVEL" | "EQUIPE" | null;
  operador?: { id: string; nome: string } | null;
};
const caller = (u: Sessao) => appRouter.createCaller({ user: u, req: { ip: "1.2.3.4", headers: {} }, res: {} } as never);

let clinicaA: string;
let clinicaB: string;
let responsavelA: Sessao;
let equipeA: Sessao;
let suporteA: Sessao;
let donoPessoal: string;
const contas: Record<string, string> = {};
let operadora: string;

const hoje = hojeBRT();

beforeAll(async () => {
  exigirBancoDeTeste();
  const senha = await hashPassword("x");
  clinicaA = (await prisma.cliente.create({ data: { nome: `${PFX}-Clínica A` } })).id;
  clinicaB = (await prisma.cliente.create({ data: { nome: `${PFX}-Clínica B` } })).id;

  const mk = async (suf: string, clienteId: string, papel: "RESPONSAVEL" | "EQUIPE", extra: object = {}) => {
    const u = await prisma.user.create({
      data: {
        nome: `${PFX}-${suf}`,
        email: `${PFX}-${suf}@example.test`,
        passwordHash: senha,
        role: "CLIENTE",
        clienteId,
        papelPortal: papel,
        ativo: true,
        ...extra,
      },
    });
    return { id: u.id, nome: u.nome, email: u.email, role: "CLIENTE" as const, clienteId, papelPortal: papel, operador: null };
  };
  responsavelA = await mk("dono-a", clinicaA, "RESPONSAVEL");
  equipeA = await mk("secretaria-a", clinicaA, "EQUIPE");
  suporteA = { ...responsavelA, operador: { id: `${PFX}-med`, nome: "Thaís" } };
  // Não podem receber o aviso: convidado que nunca entrou e acesso revogado.
  await mk("convidado-a", clinicaA, "EQUIPE", { ativo: false });
  await mk("revogado-a", clinicaA, "EQUIPE", { acessoRevogadoEm: new Date() });

  donoPessoal = (
    await prisma.user.create({
      data: { nome: `${PFX}-thais`, email: `${PFX}-thais@example.test`, passwordHash: senha, role: "ADMIN" },
    })
  ).id;

  const conta = async (chave: string, data: Record<string, unknown>) => {
    const c = await prisma.conta.create({
      data: {
        tipo: "RECEBER",
        descricao: `${PFX} ${chave}`,
        valor: 100,
        vencimento: hoje,
        clienteId: clinicaA,
        observacoes: SEGREDO_CONTA,
        ...data,
      } as never,
    });
    contas[chave] = c.id;
  };
  await conta("aberta-futura", { descricao: `Gestão Operacional — ${PFX}-Clínica A`, valor: 3500, vencimento: somarDiasUTC(hoje, 10), recorrencia: "MENSAL" });
  await conta("vence-hoje", { valor: 50.1, vencimento: hoje });
  await conta("vencida", { valor: 200.2, vencimento: somarDiasUTC(hoje, -5) });
  await conta("paga-recente", { pago: true, pagoEm: somarDiasUTC(hoje, -20), vencimento: somarDiasUTC(hoje, -20) });
  await conta("paga-antiga", { pago: true, pagoEm: somarDiasUTC(hoje, -400), vencimento: somarDiasUTC(hoje, -400) });
  await conta("apagada", { deletedAt: new Date() });
  await conta("a-pagar", { tipo: "PAGAR" });
  await conta("pessoal", { escopo: "PESSOAL", donoId: donoPessoal });
  await conta("outra-clinica", { clienteId: clinicaB });

  operadora = (await prisma.operadora.create({ data: { nome: `${PFX}-Unimed` } })).id;
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { entidadeTipo: "cliente", entidadeId: { in: [clinicaA, clinicaB] } } });
  await prisma.emailEnviado.deleteMany({ where: { para: { startsWith: PFX } } });
  await prisma.conta.deleteMany({ where: { OR: [{ clienteId: { in: [clinicaA, clinicaB] } }, { donoId: donoPessoal }] } });
  await prisma.credenciamento.deleteMany({ where: { clienteId: { in: [clinicaA, clinicaB] } } });
  await prisma.profissional.deleteMany({ where: { clienteId: { in: [clinicaA, clinicaB] } } });
  await prisma.operadora.deleteMany({ where: { id: operadora } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
  await prisma.cliente.deleteMany({ where: { id: { in: [clinicaA, clinicaB] } } });
  await prisma.$disconnect();
});

describe("portal.pagamentos — quanto eu devo e quando vence", () => {
  it("mostra só as contas a RECEBER da Med desta clínica, e separa vencida de em aberto", async () => {
    const r = await caller(equipeA).portal.pagamentos();
    const abertas = r.emAberto.map((c) => c.id);
    const pagas = r.pagas.map((c) => c.id);

    expect(new Set(abertas)).toEqual(new Set([contas["aberta-futura"], contas["vence-hoje"], contas["vencida"]]));
    expect(pagas).toEqual([contas["paga-recente"]]);
    // Nada do que não é dela: PESSOAL, a pagar, apagada, de outra clínica, paga há mais de 6 meses.
    for (const fora of ["pessoal", "a-pagar", "apagada", "outra-clinica", "paga-antiga"]) {
      expect([...abertas, ...pagas], `a conta "${fora}" não pode aparecer no Portal`).not.toContain(contas[fora]);
    }

    const vencida = r.emAberto.find((c) => c.id === contas["vencida"])!;
    const hojeC = r.emAberto.find((c) => c.id === contas["vence-hoje"])!;
    expect(vencida.vencida).toBe(true);
    // Vence hoje NÃO é atraso — o cliente tem o dia inteiro.
    expect(hojeC.vencida).toBe(false);
    expect(r.quantidadeVencidas).toBe(1);
    expect(r.totalVencido).toBe(200.2);
    expect(r.totalEmAberto).toBe(3750.3);
    expect(r.proximoVencimento?.id).toBe(contas["vence-hoje"]);
    // Valor é número, nunca `Decimal` cru atravessando o tRPC (ADR-118).
    expect(typeof r.emAberto[0]!.valor).toBe("number");
    expect(Array.isArray(r.dadosPagamento)).toBe(true);
  });

  it("tira o nome da própria clínica do fim da descrição", async () => {
    const r = await caller(responsavelA).portal.pagamentos();
    const futura = r.emAberto.find((c) => c.id === contas["aberta-futura"])!;
    expect(futura.descricao).toBe("Gestão Operacional");
    expect(futura.mensal).toBe(true);
  });

  it("não entrega observação interna, carteira, categoria nem origem — varredura do JSON", async () => {
    const json = JSON.stringify(await caller(equipeA).portal.pagamentos());
    expect(json).not.toContain(SEGREDO_CONTA);
    for (const campo of ["observacoes", "escopo", "donoId", "categoriaId", "origemServicoId", "recorrenteId", "clienteId"]) {
      expect(json, `o campo "${campo}" não pode sair pelo Portal`).not.toContain(`"${campo}"`);
    }
  });

  it("a clínica B não enxerga nada da A, e a sessão de suporte da Med lê (é leitura)", async () => {
    const senha = await hashPassword("x");
    const u = await prisma.user.create({
      data: { nome: `${PFX}-dono-b`, email: `${PFX}-dono-b@example.test`, passwordHash: senha, role: "CLIENTE", clienteId: clinicaB, papelPortal: "RESPONSAVEL" },
    });
    const b = await caller({ id: u.id, nome: u.nome, email: u.email, role: "CLIENTE", clienteId: clinicaB }).portal.pagamentos();
    expect(b.emAberto.map((c) => c.id)).toEqual([contas["outra-clinica"]]);

    const s = await caller(suporteA).portal.pagamentos();
    expect(s.emAberto.length).toBe(3);
  });
});

describe("portal.credenciamento.andamento — em que pé está na operadora", () => {
  it("diz a situação da tentativa MAIS RECENTE, sem honorário, motivo da negativa nem observação", async () => {
    const medico = await prisma.profissional.create({
      data: { clienteId: clinicaA, nome: `${PFX}-Dra. Helena`, conselho: "CRM" },
    });
    await prisma.credenciamento.create({
      data: {
        clienteId: clinicaA,
        profissionalId: medico.id,
        operadoraId: operadora,
        valor: 1234.56,
        status: "NEGADO",
        tentativa: 1,
        negadoEm: somarDiasUTC(hoje, -30),
        motivoNegativa: SEGREDO_NEGATIVA,
        observacoes: SEGREDO_OBS,
      },
    });
    const emAnaliseEm = somarDiasUTC(hoje, -3);
    await prisma.credenciamento.create({
      data: {
        clienteId: clinicaA,
        profissionalId: medico.id,
        operadoraId: operadora,
        valor: 1234.56,
        status: "EM_ANALISE",
        tentativa: 2,
        protocoladoEm: somarDiasUTC(hoje, -10),
        emAnaliseEm,
        observacoes: SEGREDO_OBS,
      },
    });

    const r = await caller(equipeA).portal.credenciamento();
    expect(r).not.toBeNull();
    const minhas = r!.andamento.filter((a) => a.profissionalId === medico.id);
    expect(minhas).toHaveLength(1);
    expect(minhas[0]!.status).toBe("EM_ANALISE");
    expect(minhas[0]!.operadora).toBe(`${PFX}-Unimed`);
    expect(new Date(minhas[0]!.desde!).getTime()).toBe(emAnaliseEm.getTime());

    const json = JSON.stringify(r);
    expect(json).not.toContain(SEGREDO_NEGATIVA);
    expect(json).not.toContain(SEGREDO_OBS);
    expect(json).not.toContain("1234.56");
    for (const campo of ["motivoNegativa", "observacoes", "contaId", "documentoId", "valor"]) {
      expect(json, `o campo "${campo}" não pode sair pelo Portal`).not.toContain(`"${campo}"`);
    }
  });
});

describe("aviso de pendência nova ao cliente — resumo diário, só com novidade", () => {
  const T0 = new Date("2031-03-10T13:00:00Z");
  const mais = (h: number) => new Date(T0.getTime() + h * 3_600_000);
  const paraA = () => envio.enviados.filter((e) => e.para.startsWith(`${PFX}-`) && e.para.includes("-a@"));

  beforeEach(() => {
    envio.enviados.length = 0;
    envio.falhar = false;
    aviso.esquecerVerificacoesEmMemoria();
  });

  it("a primeira rodada só marca a base, calada", async () => {
    await aviso.avisarPendenciasNovasAosClientes(T0);
    expect(paraA()).toHaveLength(0);
    const base = await prisma.activityLog.findFirst({
      where: { acao: aviso.ACAO_AVISO_PENDENCIAS, entidadeId: clinicaA },
    });
    expect(base, "a base precisa ficar gravada para a próxima rodada comparar").not.toBeNull();
  });

  it("médico novo abre vagas: UM e-mail para o responsável e a secretária, e só para eles", async () => {
    await prisma.profissional.create({ data: { clienteId: clinicaA, nome: `${PFX}-Dr. Novo`, conselho: "CRM" } });
    await aviso.avisarPendenciasNovasAosClientes(mais(24));

    const recebidos = paraA();
    expect(new Set(recebidos.map((e) => e.para))).toEqual(new Set([responsavelA.email, equipeA.email]));
    expect(recebidos).toHaveLength(2);
    expect(recebidos[0]!.texto ?? "").toContain(`${PFX}-Dr. Novo`);
    // A lista traz o que é NOVO — o médico antigo já estava na base.
    expect(recebidos[0]!.texto ?? "").not.toContain(`${PFX}-Dra. Helena`);
  });

  it("no mesmo dia não manda de novo, mesmo com novidade; no dia seguinte, sem novidade, também não", async () => {
    await prisma.profissional.create({ data: { clienteId: clinicaA, nome: `${PFX}-Dr. Terceiro`, conselho: "CRM" } });
    await aviso.avisarPendenciasNovasAosClientes(mais(30));
    expect(paraA(), "menos de 23 h desde o último aviso: espera").toHaveLength(0);

    await aviso.avisarPendenciasNovasAosClientes(mais(48));
    expect(paraA(), "passou o dia: agora sai, com o que surgiu").toHaveLength(2);

    envio.enviados.length = 0;
    aviso.esquecerVerificacoesEmMemoria();
    await aviso.avisarPendenciasNovasAosClientes(mais(96));
    expect(paraA(), "nada novo: nada sai").toHaveLength(0);
  });

  it("servidor de e-mail fora do ar não dá o aviso por dado: tenta de novo na rodada seguinte", async () => {
    await prisma.profissional.create({ data: { clienteId: clinicaA, nome: `${PFX}-Dr. Quarto`, conselho: "CRM" } });
    envio.falhar = true;
    await aviso.avisarPendenciasNovasAosClientes(mais(200));
    expect(paraA()).toHaveLength(0);

    envio.falhar = false;
    aviso.esquecerVerificacoesEmMemoria();
    await aviso.avisarPendenciasNovasAosClientes(mais(201));
    const recebidos = paraA();
    expect(recebidos).toHaveLength(2);
    expect(recebidos[0]!.texto ?? "").toContain(`${PFX}-Dr. Quarto`);
  });
});
