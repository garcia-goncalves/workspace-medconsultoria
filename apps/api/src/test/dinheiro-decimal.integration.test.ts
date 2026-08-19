import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { hashPassword } from "../lib/password.js";
import { ativarServicoCliente, cancelarServicoCliente, servicosDoCliente } from "../modules/servicos/servicos-cliente.service.js";
import { listServicos, listServicosAtivos, criarServico, atualizarServico } from "../modules/servicos/servicos.service.js";
import { listLeads, createLead, updateLead } from "../modules/leads/leads.service.js";
import { dashboard } from "../modules/dashboard/dashboard.service.js";

/**
 * ADR-118 — dinheiro em `Decimal`, e nunca um `Decimal` chegando à tela.
 *
 * Este teste existe por causa de dois defeitos distintos, um de cada lado da fronteira:
 *
 * 1. **O `Float` perdia centavo.** Guardar R$ 1.234,56 em ponto flutuante binário guarda
 *    um número *próximo*, não aquele. Somando, o erro aparece no total.
 * 2. **O `Decimal` vazando para o navegador é pior que o `Float`.** O `Decimal.js` vira
 *    objeto no JSON do tRPC, e a tela mostra "R$ NaN" — sem erro nenhum no console.
 *
 * Por isso o teste checa as DUAS coisas: o valor bate ao centavo, e o que sai de cada
 * função de serviço é `number` — verificado com `typeof`, não pela tipagem, que já foi
 * enganada uma vez.
 */

const PFX = `dec-${randomBytes(4).toString("hex")}`;
let atorId: string;
let clienteId: string;
let servicoId: string;
let leadId: string;
let criadoId: string | null = null;

/** Prova em runtime, não na tipagem: dinheiro que sai do serviço é número ou nulo. */
function ehDinheiroDaTela(v: unknown) {
  return v === null || typeof v === "number";
}

beforeAll(async () => {
  expect(process.env["DATABASE_URL"]).toContain("_test");
  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  atorId = u.id;
  const cliente = await prisma.cliente.create({ data: { nome: `${PFX}-clinica`, tipo: "PJ" } });
  clienteId = cliente.id;

  const s = await criarServico({ nome: `${PFX}-servico`, valor: 1234.56, percentual: 7.5, categoria: "Faturamento" });
  servicoId = s.id;

  const stage =
    (await prisma.pipelineStage.findFirst({ orderBy: { ordem: "asc" } })) ??
    (await prisma.pipelineStage.create({ data: { nome: `${PFX}-etapa`, ordem: 999, cor: "#000000" } }));
  const lead = await prisma.lead.create({
    data: { nome: `${PFX}-lead`, valorEstimado: 12000.99, pipelineStageId: stage.id },
  });
  leadId = lead.id;
});

afterAll(async () => {
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.conta.deleteMany({ where: { clienteId } });
  await prisma.lead.deleteMany({ where: { OR: [{ id: leadId }, ...(criadoId ? [{ id: criadoId }] : [])] } });
  await prisma.projeto.deleteMany({ where: { clienteId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.servico.deleteMany({ where: { id: servicoId } });
  await prisma.user.deleteMany({ where: { id: atorId } });
});

describe("ADR-118 — o dinheiro guardado em Decimal e entregue em number", () => {
  it("guarda o centavo exato que o Float arredondava", async () => {
    const bruto = await prisma.servico.findUniqueOrThrow({ where: { id: servicoId } });
    expect(bruto.valor?.toFixed(2)).toBe("1234.56");
    expect(bruto.percentual?.toFixed(2)).toBe("7.50");
  });

  it("criarServico e atualizarServico devolvem número, não Decimal", async () => {
    const editado = await atualizarServico(servicoId, { valor: 1234.56 });
    expect(ehDinheiroDaTela(editado.valor)).toBe(true);
    expect(editado.valor).toBe(1234.56);
    expect(ehDinheiroDaTela(editado.percentual)).toBe(true);
  });

  it("as duas listagens do catálogo devolvem número", async () => {
    const todos = await listServicos();
    const meu = todos.find((s) => s.id === servicoId);
    expect(meu && ehDinheiroDaTela(meu.valor)).toBe(true);
    expect(meu?.valor).toBe(1234.56);

    const ativos = await listServicosAtivos();
    const meuAtivo = ativos.find((s) => s.id === servicoId);
    expect(meuAtivo && ehDinheiroDaTela(meuAtivo.valor)).toBe(true);
    expect(meuAtivo && ehDinheiroDaTela(meuAtivo.percentual)).toBe(true);
  });

  it("contratar herda o preço do catálogo ao centavo e responde em número", async () => {
    const cs = await ativarServicoCliente(clienteId, servicoId, {}, { id: atorId });
    expect(ehDinheiroDaTela(cs.valor)).toBe(true);
    expect(cs.valor).toBe(1234.56);
    expect(ehDinheiroDaTela(cs.percentual)).toBe(true);
    expect(cs.percentual).toBe(7.5);

    // E o que ficou no banco continua exato (a herança Decimal→Decimal não arredondou).
    const gravado = await prisma.clienteServico.findFirstOrThrow({ where: { clienteId, servicoId } });
    expect(gravado.valor?.toFixed(2)).toBe("1234.56");
  });

  it("o card da ficha (servicosDoCliente) devolve número", async () => {
    const linhas = await servicosDoCliente(clienteId);
    const meu = linhas.find((l) => l.servico.id === servicoId);
    expect(meu?.contratacao && ehDinheiroDaTela(meu.contratacao.valor)).toBe(true);
    expect(meu?.contratacao?.valor).toBe(1234.56);
    expect(meu?.contratacao && ehDinheiroDaTela(meu.contratacao.percentual)).toBe(true);
  });

  it("cancelar (equipe e Portal usam a mesma função) devolve número", async () => {
    const cs = await cancelarServicoCliente(clienteId, servicoId, "EQUIPE", "teste", atorId);
    expect(ehDinheiroDaTela(cs.valor)).toBe(true);
    expect(cs.valor).toBe(1234.56);
  });

  it("o board do funil devolve a estimativa em número", async () => {
    const leads = await listLeads();
    const meu = leads.find((l) => l.id === leadId);
    expect(meu && ehDinheiroDaTela(meu.valorEstimado)).toBe(true);
    expect(meu?.valorEstimado).toBe(12000.99);
  });

  /**
   * O retorno das mutations hoje não é lido por nenhuma tela — mas é a porta por onde o
   * defeito volta: basta alguém escrever `onSuccess: (data) => setValor(data.valorEstimado)`.
   * O teste fecha a porta antes.
   */
  it("criar e editar lead respondem com a estimativa em número", async () => {
    const criado = await createLead({ nome: `${PFX}-lead2`, valorEstimado: 7777.77 } as never, atorId);
    criadoId = criado.id;
    expect(ehDinheiroDaTela(criado.valorEstimado)).toBe(true);
    expect(criado.valorEstimado).toBe(7777.77);

    const editado = await updateLead({ id: criado.id, valorEstimado: 8888.88 } as never, atorId);
    expect(ehDinheiroDaTela(editado.valorEstimado)).toBe(true);
    expect(editado.valorEstimado).toBe(8888.88);
  });

  /** O `_sum` de um agregado também vem Decimal — o Início somava isso. */
  it("o total do funil no Início é número", async () => {
    const d = await dashboard(atorId, "ADMIN");
    const funil = d.gestao?.funil;
    expect(funil).toBeTruthy();
    expect(funil!.etapas.length).toBeGreaterThan(0);
    for (const e of funil!.etapas) expect(typeof e.valor).toBe("number");
    // O total é a SOMA das etapas — se uma delas viesse Decimal, o `+` daria string.
    expect(typeof funil!.valor).toBe("number");
    expect(funil!.valor).toBeGreaterThan(0);
  });
});
