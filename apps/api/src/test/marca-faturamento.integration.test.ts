import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { TRPCError } from "@trpc/server";
import {
  PRECO_PERCENTUAL_SO_NO_FATURAMENTO,
  MARCA_FATURAMENTO_E_CREDENCIAMENTO,
} from "@app/shared";
import { exigirBancoDeTeste } from "./guarda-banco-de-teste.js";
import { criarServico, atualizarServico } from "../modules/servicos/servicos.service.js";
import {
  ativarServicoCliente,
  atualizarContratacaoCliente,
  sincronizarServicosContratados,
} from "../modules/servicos/servicos-cliente.service.js";

/**
 * SÓ O FATURAMENTO MÉDICO É COBRADO POR PERCENTUAL — ordem do dono, 31/08/2026.
 *
 * O caso que originou: em *Ajustes → Serviços → Credenciamento → Configurar*, a tela oferecia o
 * botão "% do faturamento". O credenciamento é valor fixo, pago só quando a operadora aprova
 * (ADR-104/108); e o mesmo botão aparecia nos outros nove serviços do catálogo.
 *
 * Por que contra o MySQL de verdade, e não só contra a função pura: a trava do percentual não é
 * uma só — ela precisa valer nas DUAS portas que gravam preço (o catálogo e a ficha do cliente),
 * e a da edição precisa olhar o ANTES + o DEPOIS, porque a edição é parcial e o `refine` do Zod
 * só vê o que veio no pedido. Nada disso aparece numa leitura de código: um pedido com só
 * `percentual` passaria batido e o serviço mudaria de forma de cobrança em silêncio — sem erro,
 * sem log, e com o preço novo saindo no papel do cliente.
 *
 * ⚠️ A marca é lida do BANCO (`Servico.ehFaturamento`), nunca do nome nem da categoria. A
 * comparação `categoria === "Faturamento"` já foi escrita e removida CINCO vezes neste código.
 */

const PFX = `mfat-${randomBytes(4).toString("hex")}`;
let fixoId: string;
let semPrecoId: string;
let marcadoId: string;
let clienteId: string;
let atorId: string;

beforeAll(async () => {
  exigirBancoDeTeste();
  const u = await prisma.user.create({
    data: { nome: `${PFX}-u`, email: `${PFX}@example.test`, passwordHash: "x", role: "ADMIN" },
  });
  atorId = u.id;
  const c = await prisma.cliente.create({ data: { nome: `${PFX}-clinica` } });
  clienteId = c.id;

  const fixo = await criarServico({ nome: `${PFX}-gestao`, valor: 3500, valorRecorrencia: "MENSAL" });
  fixoId = fixo.id;
  // Um serviço SEM preço nenhum e sem marca. Serve para isolar a trava da MARCA: no serviço com
  // valor, quem barra primeiro é a trava das duas cobranças juntas (ADR-138), e o teste passaria
  // verde pela razão errada.
  const semPreco = await criarServico({ nome: `${PFX}-sem-preco` });
  semPrecoId = semPreco.id;

  // ⚠️ Criado direto no banco, e não por `criarServico`: a guarda da marca única é global (ela
  // olha o catálogo inteiro), e semear pela porta do catálogo faria este arquivo depender de
  // quantos serviços marcados os OUTROS arquivos de teste criaram enquanto ele roda.
  const marcado = await prisma.servico.create({
    data: { nome: `${PFX}-faturamento`, valor: null, percentual: 5, percentualRecorrencia: "MENSAL", ehFaturamento: true },
  });
  marcadoId = marcado.id;
});

afterAll(async () => {
  await prisma.clienteServico.deleteMany({ where: { clienteId } });
  await prisma.conta.deleteMany({ where: { clienteId } });
  await prisma.projeto.deleteMany({ where: { clienteId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await prisma.servico.deleteMany({ where: { id: { in: [fixoId, marcadoId] } } });
  await prisma.user.deleteMany({ where: { id: atorId } });
});

describe("o catálogo recusa percentual fora do faturamento", () => {
  it("criar serviço com percentual e sem a marca é recusado, em português", async () => {
    await expect(criarServico({ nome: `${PFX}-novo`, percentual: 5 })).rejects.toThrow(
      PRECO_PERCENTUAL_SO_NO_FATURAMENTO,
    );
  });

  it("⚠️ EDIÇÃO PARCIAL: mandar só o percentual num serviço de valor fixo é recusado", async () => {
    // Este é o caso que o Zod NÃO consegue ver — o pedido não diz que o serviço é fixo, o banco
    // é que diz. Sem esta trava, o serviço ficaria com valor E percentual gravados, que é o
    // estado que reconfigura preço, proposta, funil e provisão de uma vez só.
    await expect(atualizarServico(semPrecoId, { percentual: 5 })).rejects.toThrow(
      PRECO_PERCENTUAL_SO_NO_FATURAMENTO,
    );
    const depois = await prisma.servico.findUniqueOrThrow({ where: { id: semPrecoId } });
    expect(depois.percentual).toBeNull();
  });

  it("o serviço MARCADO aceita percentual normalmente", async () => {
    const editado = await atualizarServico(marcadoId, { percentual: 7 });
    expect(editado.percentual).toBe(7);
  });

  it("desmarcar sem limpar o percentual é recusado — o dado não fica preso", async () => {
    await expect(atualizarServico(marcadoId, { ehFaturamento: false })).rejects.toThrow(
      PRECO_PERCENTUAL_SO_NO_FATURAMENTO,
    );
    // Desmarcar LIMPANDO o percentual, no mesmo pedido, é o caminho legítimo — e volta atrás.
    const limpo = await atualizarServico(marcadoId, { ehFaturamento: false, percentual: null, valor: 900 });
    expect(limpo.percentual).toBeNull();
    // ⚠️ A restauração vai DIRETO ao banco: o catálogo de teste já traz o "Faturamento" semeado e
    // marcado (o backfill da migração), então remarcar por `atualizarServico` bateria — com
    // razão — na guarda da marca única. Que ela bata é a prova de que a guarda existe; o teste
    // dela é o de baixo.
    await prisma.servico.update({
      where: { id: marcadoId },
      data: { valor: null, percentual: 5, ehFaturamento: true },
    });
  });

  it("um serviço não pode ser faturamento E credenciamento — e nada é gravado", async () => {
    // ⚠️ A MENSAGEM AQUI DEPENDE DE QUEM BARRA PRIMEIRO, e isso é comportamento legítimo: se já
    // existe um credenciamento marcado no catálogo (o caso normal, e o do banco de teste), quem
    // recusa é a guarda da marca única do credenciamento, com a mensagem dela. Num catálogo sem
    // credenciamento nenhum, quem recusa é a combinação impossível.
    //
    // Por isso o teste cobra o CONTRATO — o pedido é recusado e o serviço não muda —, e não uma
    // frase específica. Cobrar a frase faria este teste reprovar por causa da ordem das guardas,
    // que é detalhe de implementação, e não por causa do estado proibido, que é o que importa.
    await expect(
      atualizarServico(fixoId, { ehFaturamento: true, ehCredenciamento: true }),
    ).rejects.toThrow(TRPCError);
    const depois = await prisma.servico.findUniqueOrThrow({ where: { id: fixoId } });
    expect(depois.ehFaturamento).toBe(false);
    expect(depois.ehCredenciamento).toBe(false);
  });

  it("a combinação impossível tem mensagem própria quando é ela que barra", () => {
    // A frase existe e é a que a Thaís lê; o caminho que a produz é o catálogo sem credenciamento
    // marcado. Guardá-la aqui impede que alguém a apague achando que ninguém a usa.
    expect(MARCA_FATURAMENTO_E_CREDENCIAMENTO).toMatch(/faturamento médico e o credenciamento/);
  });

  it("a marca única: com um já marcado, o catálogo recusa marcar outro e diz qual é", async () => {
    await expect(criarServico({ nome: `${PFX}-outro`, percentual: 3, ehFaturamento: true })).rejects.toThrow(
      /já está marcado como faturamento médico|Já existe um serviço marcado/,
    );
  });
});

describe("⚠️ A SEGUNDA PORTA: o preço na ficha do cliente", () => {
  it("contratar um serviço fixo e tentar pôr percentual nele é recusado", async () => {
    // Travar só o catálogo deixaria a ficha fazer, cliente por cliente, exatamente o que a tela
    // de Serviços passou a recusar — o modo de falha da "segunda porta" (ADR-140).
    await ativarServicoCliente(clienteId, fixoId, { valor: 3500 }, { id: atorId });
    await expect(
      atualizarContratacaoCliente(clienteId, fixoId, { valor: null, percentual: 5 }),
    ).rejects.toThrow(PRECO_PERCENTUAL_SO_NO_FATURAMENTO);
  });

  it("⚠️ A TERCEIRA PORTA: o aceite da proposta recusa item percentual em serviço sem a marca", async () => {
    // Achado pelos revisores: o aceite copia o item do documento para `ClienteServico` sem passar
    // por trava nenhuma. Travar o catálogo e o editor da ficha e deixar esta aberta é o modo de
    // falha da "segunda porta" (ADR-140) outra vez — e por aqui o preço errado entra vindo do
    // papel que o cliente assinou.
    await expect(
      sincronizarServicosContratados(clienteId, [{ servicoId: fixoId, valor: 0, percentual: 5 }], { id: atorId }),
    ).rejects.toThrow(PRECO_PERCENTUAL_SO_NO_FATURAMENTO);
  });

  it("o aceite continua funcionando para o serviço marcado e para valor fixo", async () => {
    await sincronizarServicosContratados(
      clienteId,
      [
        { servicoId: marcadoId, valor: 0, recorrencia: "MENSAL", percentual: 5 },
        { servicoId: fixoId, valor: 3500, recorrencia: "MENSAL" },
      ],
      { id: atorId },
    );
    const linhas = await prisma.clienteServico.findMany({ where: { clienteId } });
    expect(linhas.find((l) => l.servicoId === marcadoId)?.percentual?.toString()).toBe("5");
    expect(linhas.find((l) => l.servicoId === fixoId)?.percentual).toBeNull();
  });

  it("no serviço marcado, a mesma ficha aceita o percentual", async () => {
    await ativarServicoCliente(clienteId, marcadoId, {}, { id: atorId });
    const r = await atualizarContratacaoCliente(clienteId, marcadoId, { valor: null, percentual: 6 });
    expect(r.percentual).toBe(6);
  });
});
