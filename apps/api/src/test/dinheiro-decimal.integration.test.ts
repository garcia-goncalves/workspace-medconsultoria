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
/**
 * Um SEGUNDO serviço, só percentual — a ADR-138 passou a recusar valor fixo + percentual na
 * mesma linha, e este teste guardava os dois campos num serviço só. A cobertura que importa aqui
 * não é a combinação (que agora é estado proibido): é o `Decimal` de CADA campo chegando à tela
 * como número. Dois serviços provam a mesma coisa sem fabricar um estado que o sistema recusa.
 */
let servicoPctId: string;
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
  const cliente = await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } });
  clienteId = cliente.id;

  const s = await criarServico({ nome: `${PFX}-servico`, valor: 1234.56, categoria: "Gestão" });
  servicoId = s.id;
  const sPct = await criarServico({ nome: `${PFX}-servico-pct`, percentual: 7.5, categoria: "Faturamento" });
  servicoPctId = sPct.id;

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
  await prisma.servico.deleteMany({ where: { id: { in: [servicoId, servicoPctId] } } });
  await prisma.user.deleteMany({ where: { id: atorId } });
});

describe("ADR-118 — o dinheiro guardado em Decimal e entregue em number", () => {
  it("guarda o centavo exato que o Float arredondava", async () => {
    const bruto = await prisma.servico.findUniqueOrThrow({ where: { id: servicoId } });
    expect(bruto.valor?.toFixed(2)).toBe("1234.56");
    const brutoPct = await prisma.servico.findUniqueOrThrow({ where: { id: servicoPctId } });
    expect(brutoPct.percentual?.toFixed(2)).toBe("7.50");
  });

  it("criarServico e atualizarServico devolvem número, não Decimal", async () => {
    const editado = await atualizarServico(servicoId, { valor: 1234.56 });
    expect(ehDinheiroDaTela(editado.valor)).toBe(true);
    expect(editado.valor).toBe(1234.56);
    // O percentual pelo outro serviço: os dois no mesmo é estado proibido desde a ADR-138.
    const editadoPct = await atualizarServico(servicoPctId, { percentual: 7.5 });
    expect(ehDinheiroDaTela(editadoPct.percentual)).toBe(true);
    expect(editadoPct.percentual).toBe(7.5);
  });

  it("as duas listagens do catálogo devolvem número", async () => {
    const todos = await listServicos();
    const meu = todos.find((s) => s.id === servicoId);
    expect(meu && ehDinheiroDaTela(meu.valor)).toBe(true);
    expect(meu?.valor).toBe(1234.56);

    const ativos = await listServicosAtivos();
    const meuAtivo = ativos.find((s) => s.id === servicoId);
    expect(meuAtivo && ehDinheiroDaTela(meuAtivo.valor)).toBe(true);
    const meuAtivoPct = ativos.find((s) => s.id === servicoPctId);
    expect(meuAtivoPct && ehDinheiroDaTela(meuAtivoPct.percentual)).toBe(true);
  });

  it("contratar herda o preço do catálogo ao centavo e responde em número", async () => {
    const cs = await ativarServicoCliente(clienteId, servicoId, {}, { id: atorId });
    expect(ehDinheiroDaTela(cs.valor)).toBe(true);
    expect(cs.valor).toBe(1234.56);
    expect(ehDinheiroDaTela(cs.percentual)).toBe(true);
    // O percentual pelo serviço percentual — os dois na mesma linha é estado proibido (ADR-138).
    const csPct = await ativarServicoCliente(clienteId, servicoPctId, {}, { id: atorId });
    expect(ehDinheiroDaTela(csPct.percentual)).toBe(true);
    expect(csPct.percentual).toBe(7.5);

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

  /**
   * O dinheiro dos leads vem `Decimal` do banco — o Início somava isso.
   *
   * O funil devolve DOIS totais desde o F8 (recorrente × avulso), porque somar mensalidade com
   * cobrança única dava um número que não responde nem "por mês" nem "no total". Os dois passam
   * pela mesma exigência de sempre: chegam à tela como `number`.
   */
  it("os totais do funil no Início são números", async () => {
    const d = await dashboard(atorId, "ADMIN");
    const funil = d.gestao?.funil;
    expect(funil).toBeTruthy();
    expect(funil!.etapas.length).toBeGreaterThan(0);
    for (const e of funil!.etapas) {
      expect(typeof e.mensal).toBe("number");
      expect(typeof e.avulso).toBe("number");
    }
    // O total é a SOMA das etapas — se uma delas viesse Decimal, o `+` daria string.
    expect(typeof funil!.mensal).toBe("number");
    expect(typeof funil!.avulso).toBe("number");
    // O lead deste teste tem R$ 12.000,99 de estimativa e nenhum serviço com preço: cai no
    // avulso, que é o que a conversão provisionaria (conta única).
    expect(funil!.avulso).toBeGreaterThan(0);
  });
});
