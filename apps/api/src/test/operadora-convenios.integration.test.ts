import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { UMA_OPERADORA_POR_PROPOSTA } from "@app/shared";
import { hashPassword } from "../lib/password.js";
import { criarOperadora, listOperadoras, atualizarOperadora, removerOperadora } from "../modules/documentos/operadoras.service.js";
import { criarProposta, contextoClienteDoc } from "../modules/documentos/documentos.service.js";
import { criarServico } from "../modules/servicos/servicos.service.js";
import { sincronizarServicosContratados, servicosDoCliente } from "../modules/servicos/servicos-cliente.service.js";
import { createLead } from "../modules/leads/leads.service.js";

/**
 * ADR-126 — a operadora é UM cadastro com marcação por serviço; a proposta de credenciamento é
 * de UMA operadora; a de faturamento leva convênios e faturamento médio; e os convênios ficam
 * com o CLIENTE.
 *
 * Roda contra o MySQL de VERDADE, e não contra tipos, pelo motivo de sempre nesta casa: campo
 * novo já sumiu em silêncio duas vezes com o typecheck verde (ADR-118, o `Decimal` virando
 * "R$ NaN"; ADR-119, o `cnpj` descartado por quem monta os campos um a um). Relação N-N é o
 * caso mais fácil de escrever e nunca gravar.
 *
 * O que se prova aqui:
 *  1. operadora nasce marcada nas DUAS listas, e o filtro por uso realmente recorta;
 *  2. duas operadoras na mesma proposta são RECUSADAS, na grade e no formato antigo;
 *  3. a proposta de faturamento NÃO escreve a conta no papel (ADR-127) e traz o bloco de
 *     dados para pagamento e a frase de quando o repasse é pago;
 *  4. os convênios viajam DENTRO do item e chegam ao `ClienteServico` pela sincronização do
 *     aceite (o mesmo caminho que serviço e preço já percorrem);
 *  5. o faturamento informado na proposta volta para o LEAD e recalcula o valor do negócio;
 *  6. o contexto do cliente devolve o que o funil já sabe, para a proposta nascer preenchida.
 */

const PFX = `opc-${randomBytes(4).toString("hex")}`;
let atorId: string;
let clienteId: string;
let leadId: string;
let servicoPercentualId: string;
let modeloId: string;
let opA: string;
let opB: string;
let opSoFaturamento: string;
const documentos: string[] = [];

beforeAll(async () => {
  expect(process.env["DATABASE_URL"]).toContain("_test");

  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: await hashPassword("x"), role: "ADMIN" },
  });
  atorId = u.id;

  const cliente = await prisma.cliente.create({
    data: { nome: `${PFX}-clinica`, cnpj: null, email: `${PFX}-cli@example.test`, responsavelId: atorId },
  });
  clienteId = cliente.id;

  const servico = await criarServico({
    nome: `${PFX}-faturamento`,
    valor: null,
    percentual: 5,
    percentualRecorrencia: "MENSAL",
    categoria: "Faturamento",
  });
  servicoPercentualId = servico.id;

  const stage =
    (await prisma.pipelineStage.findFirst({ where: { chaveAuto: "qualificacao" } })) ??
    (await prisma.pipelineStage.create({ data: { nome: `${PFX}-qualificacao`, ordem: 997, chaveAuto: "qualificacao" } }));
  const lead = await createLead(
    { nome: `${PFX}-lead`, servicoIds: [servicoPercentualId], pipelineStageId: stage.id } as never,
    atorId,
  );
  leadId = lead.id;
  await prisma.lead.update({ where: { id: leadId }, data: { clienteId } });

  const [a, b, c] = await Promise.all([
    criarOperadora({ nome: `${PFX}-Unimed` }),
    criarOperadora({ nome: `${PFX}-Bradesco` }),
    criarOperadora({ nome: `${PFX}-SoFaturamento`, usoCredenciamento: false, usoFaturamento: true }),
  ]);
  opA = a.id;
  opB = b.id;
  opSoFaturamento = c.id;

  // Um modelo de proposta de FATURAMENTO: é o corpo que declara {{convenios}} que faz o
  // documento ser desse tipo — nunca o nome do serviço nem a categoria.
  const modelo = await prisma.modeloDocumento.create({
    data: {
      nome: `${PFX}-modelo-faturamento`,
      tipo: "PROPOSTA",
      corpo: `Prezado(a) {{cliente.nome}},\n\n## Convênios\n\n{{convenios}}\n\nRemuneração: {{percentual}}.\n\n{{dadosPagamento}}\n\n{{servicos}}`,
      editadoManualmente: true,
    },
  });
  modeloId = modelo.id;
});

afterAll(async () => {
  await prisma.documentoVersao.deleteMany({ where: { documentoId: { in: documentos } } });
  await prisma.documento.deleteMany({ where: { id: { in: documentos } } });
  await prisma.modeloDocumento.deleteMany({ where: { id: modeloId } });
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.leadPasso.deleteMany({ where: { leadId } });
  await prisma.lead.deleteMany({ where: { id: leadId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.servico.deleteMany({ where: { id: servicoPercentualId } });
  await prisma.operadora.deleteMany({ where: { id: { in: [opA, opB, opSoFaturamento] } } });
  await prisma.user.deleteMany({ where: { id: atorId } });
});

describe("um cadastro só, com marcação por serviço", () => {
  it("operadora nasce marcada nas DUAS listas", async () => {
    const todas = await listOperadoras();
    const unimed = todas.find((o) => o.id === opA);
    expect(unimed?.usoCredenciamento).toBe(true);
    expect(unimed?.usoFaturamento).toBe(true);
  });

  it("o filtro por uso recorta de verdade", async () => {
    const credenciamento = await listOperadoras("CREDENCIAMENTO");
    const faturamento = await listOperadoras("FATURAMENTO");
    expect(credenciamento.map((o) => o.id)).not.toContain(opSoFaturamento);
    expect(faturamento.map((o) => o.id)).toContain(opSoFaturamento);
  });

  it("desmarcar as duas é recusado — operadora invisível parece dado perdido", async () => {
    await expect(
      atualizarOperadora({ id: opA, usoCredenciamento: false, usoFaturamento: false }),
    ).rejects.toThrow(/ao menos um serviço/i);
    // E não gravou nada pela metade.
    const depois = await prisma.operadora.findUnique({ where: { id: opA } });
    expect(depois?.usoCredenciamento).toBe(true);
    expect(depois?.usoFaturamento).toBe(true);
  });
});

describe("a proposta de credenciamento é de UMA operadora", () => {
  it("duas operadoras no formato antigo são recusadas", async () => {
    await expect(
      criarProposta(
        { clienteId, itens: [], operadoras: [`${PFX}-Unimed`, `${PFX}-Bradesco`], valorPorOperadora: 1500 } as never,
        atorId,
      ),
    ).rejects.toThrow(UMA_OPERADORA_POR_PROPOSTA);
  });

  it("duas operadoras na GRADE são recusadas", async () => {
    const prof = await prisma.profissional.create({
      data: { clienteId, nome: `${PFX}-dr`, especialidade: "cardiologia", conselho: "CRM" },
    });
    await expect(
      criarProposta(
        {
          clienteId,
          itens: [],
          grade: [
            { profissionalId: prof.id, operadoraId: opA, valor: 1500 },
            { profissionalId: prof.id, operadoraId: opB, valor: 1500 },
          ],
        } as never,
        atorId,
      ),
    ).rejects.toThrow(UMA_OPERADORA_POR_PROPOSTA);
    await prisma.profissional.deleteMany({ where: { id: prof.id } });
  });
});

describe("a proposta de faturamento", () => {
  it("NÃO escreve a conta no papel, e guarda os convênios dentro do item", async () => {
    const doc = await criarProposta(
      {
        clienteId,
        modeloId,
        itens: [{ servicoId: servicoPercentualId, valor: 0, quantidade: 1, recorrencia: "MENSAL", percentual: 5 }],
        conveniosIds: [opA, opSoFaturamento],
        faturamentoMensal: 120000,
      } as never,
      atorId,
    );
    documentos.push(doc.id);

    // O `toLocaleString` do pt-BR separa "R$" do número com espaço NÃO separável (U+00A0) —
    // comparar com espaço comum falharia contra um documento CORRETO, que é o pior tipo de
    // teste vermelho.
    const papel = doc.conteudo.replace(/\u00a0/g, " ");
    // ADR-127: nem a conta feita, nem o faturamento da clínica saem no papel do cliente. Eram
    // promessa que envelhece no mês seguinte — o faturamento sobe e desce, a proposta assinada
    // não. O número continua vivo do lado de dentro (ver o teste seguinte).
    expect(papel).not.toContain("R$ 6.000,00");
    expect(papel).not.toContain("R$ 120.000,00");
    // O que o papel diz sobre dinheiro: o percentual, e QUANDO o repasse é pago.
    expect(papel).toContain("5%");
    expect(papel).toContain("após o crédito na conta da Clínica");
    // E o marcador dos dados para pagamento foi CONSUMIDO — nunca sai cru no papel.
    expect(papel).not.toContain("{{dadosPagamento}}");
    expect(papel).toContain(`${PFX}-Unimed`);
    expect(papel).toContain(`${PFX}-SoFaturamento`);
    // E NÃO cita a operadora que não foi escolhida.
    expect(papel).not.toContain(`${PFX}-Bradesco`);

    // Os convênios viajam DENTRO do item — é assim que atravessam o aceite.
    const itens = doc.itens as { servicoId: string; conveniosIds?: string[] }[];
    expect(itens[0]?.conveniosIds).toHaveLength(2);
    expect(new Set(itens[0]?.conveniosIds)).toEqual(new Set([opA, opSoFaturamento]));
  });

  it("o faturamento informado VOLTA para o lead e recalcula o valor do negócio", async () => {
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { faturamentoMensalEstimado: true, valorEstimado: true },
    });
    expect(lead.faturamentoMensalEstimado?.toFixed(2)).toBe("120000.00");
    // 5% de 120.000 = 6.000 — a mesma conta do papel, calculada pela regra do funil.
    expect(lead.valorEstimado?.toFixed(2)).toBe("6000.00");
  });

  it("o contexto do cliente devolve o que o funil já sabe, para a proposta nascer preenchida", async () => {
    const ctx = await contextoClienteDoc({ clienteId, tipo: "PROPOSTA" });
    expect(ctx.faturamentoMensal).toBe(120000);
    // Dinheiro chega à tela como NÚMERO, nunca como Decimal (ADR-118).
    expect(typeof ctx.faturamentoMensal).toBe("number");
  });
});

describe("os convênios ficam com o cliente", () => {
  it("a sincronização do aceite grava os convênios no serviço contratado", async () => {
    const doc = await prisma.documento.findUniqueOrThrow({ where: { id: documentos[0]! }, select: { itens: true } });
    const itens = doc.itens as {
      servicoId: string;
      valor?: number | null;
      recorrencia?: "AVULSO" | "MENSAL";
      percentual?: number | null;
      conveniosIds?: string[];
    }[];
    await sincronizarServicosContratados(clienteId, itens, { id: atorId });

    const cs = await prisma.clienteServico.findUniqueOrThrow({
      where: { clienteId_servicoId: { clienteId, servicoId: servicoPercentualId } },
      include: { operadoras: { select: { id: true } } },
    });
    expect(new Set(cs.operadoras.map((o) => o.id))).toEqual(new Set([opA, opSoFaturamento]));
  });

  it("a ficha do cliente mostra os convênios — e como NOMES, não ids", async () => {
    const lista = await servicosDoCliente(clienteId);
    const item = lista.find((s) => s.servico.id === servicoPercentualId);
    expect(item?.contratado).toBe(true);
    expect(item?.contratacao?.convenios.map((o) => o.nome).sort()).toEqual(
      [`${PFX}-SoFaturamento`, `${PFX}-Unimed`].sort(),
    );
  });

  it("operadora presa a um serviço contratado não é excluída em silêncio", async () => {
    await expect(removerOperadora(opA)).rejects.toThrow(/serviço\(s\) contratado\(s\)/i);
  });
});
