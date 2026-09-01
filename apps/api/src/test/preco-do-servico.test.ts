/**
 * A regra que decide COMO um serviço é cobrado — e, por consequência, quais campos a proposta
 * mostra (ADR-126).
 *
 * O caso que originou: o `PropostaServicosPicker` ainda decidia por `categoria === "Faturamento"`
 * em dois lugares, depois de a ADR-125 já ter trocado a mesma checagem em outros três. Casar por
 * NOME quebra em dois dias previsíveis: quando a Thaís renomeia a categoria na tela de Serviços,
 * e quando ela cria um segundo serviço percentual. Nos dois, a tela volta a pedir valor e
 * quantidade para um serviço que não tem nem um nem outro — e ninguém lembraria desta linha.
 *
 * O que estes testes guardam, e não pode regredir:
 *  - a regra lê o PREÇO, não a categoria (nenhum "Faturamento" no código da regra);
 *  - serviço percentual PURO não tem valor fixo nem quantidade — é sempre mensal;
 *  - serviço MISTURADO (valor + %) continua com os dois campos: esconder o valor fixo sumiria
 *    com dinheiro real do documento.
 */
import { describe, it, expect } from "vitest";
import {
  atualizarContratacaoClienteSchema,
  createServicoSchema,
  documentoServicoItemSchema,
  ehServicoDeFaturamento,
  ehServicoSomentePercentual,
  percentualForaDoFaturamento,
  PRECO_PERCENTUAL_SO_NO_FATURAMENTO,
  PRECO_VALOR_E_PERCENTUAL,
  temPercentual,
  temValorEPercentual,
  temValorFixo,
  updateServicoSchema,
} from "@app/shared";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FATURAMENTO = { valor: null, percentual: 5 };
const GESTAO = { valor: 3500, percentual: null };
const MISTURADO = { valor: 1200, percentual: 3 };
const SEM_PRECO = { valor: null, percentual: null };

describe("ehServicoSomentePercentual", () => {
  it("serviço só com percentual → sem valor, sem quantidade, sempre mensal", () => {
    expect(ehServicoSomentePercentual(FATURAMENTO)).toBe(true);
  });

  it("serviço de preço fixo → segue com valor e quantidade", () => {
    expect(ehServicoSomentePercentual(GESTAO)).toBe(false);
  });

  it("serviço MISTURADO (valor + %) mantém os dois campos — o valor fixo não pode sumir", () => {
    expect(ehServicoSomentePercentual(MISTURADO)).toBe(false);
    expect(temValorFixo(MISTURADO)).toBe(true);
    expect(temPercentual(MISTURADO)).toBe(true);
  });

  it("serviço sem preço nenhum não vira percentual por omissão", () => {
    expect(ehServicoSomentePercentual(SEM_PRECO)).toBe(false);
  });

  it("zero e negativo não são preço — não ligam nem valor nem percentual", () => {
    expect(temValorFixo({ valor: 0, percentual: null })).toBe(false);
    expect(temPercentual({ valor: null, percentual: 0 })).toBe(false);
    expect(ehServicoSomentePercentual({ valor: 0, percentual: 5 })).toBe(true);
    expect(ehServicoSomentePercentual({ valor: null, percentual: -1 })).toBe(false);
  });

  it("undefined é tratado como ausente (o item da proposta pode não trazer o campo)", () => {
    expect(ehServicoSomentePercentual({ valor: undefined, percentual: 5 })).toBe(true);
    expect(temValorFixo({ valor: undefined, percentual: undefined })).toBe(false);
  });
});

describe("a decisão da TELA não casa por nome de categoria", () => {
  const picker = readFileSync(
    fileURLToPath(new URL("../../../web/src/features/documentos/PropostaServicosPicker.tsx", import.meta.url)),
    "utf-8",
  );

  it('o seletor de serviços da proposta não compara com "Faturamento"', () => {
    // O texto APARECE em comentário, contando a história — é o código que não pode voltar a
    // comparar. Por isso os comentários saem antes da conferência: guardar a regra e proibir a
    // explicação dela seria trocar uma armadilha por outra.
    const semComentarios = picker
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(semComentarios).not.toMatch(/categoria\s*===\s*["']Faturamento["']/);
  });

  it("o seletor usa a regra de preço compartilhada", () => {
    expect(picker).toContain("ehServicoSomentePercentual");
  });
});

describe("a decisão do SERVIDOR de documentos também não casa por nome de categoria", () => {
  // Quarta vez que esta comparação precisou sair daqui (ADR-125, 126 e 127). Em 26/08/2026 ela
  // estava de volta em QUATRO lugares do `documentos.service.ts`, montando o item da proposta a
  // partir do cliente e do lead: `categoria === "Faturamento" ? emReais(percentual) : null`
  // jogava fora o percentual de qualquer serviço de outra categoria. Ninguém tinha sido mordido
  // ainda; seria mordido no dia em que a Thaís pusesse % num serviço de Gestão, ou renomeasse a
  // categoria na tela — a proposta sairia sem o percentual, sem erro nenhum.
  const servidor = readFileSync(
    fileURLToPath(new URL("../modules/documentos/documentos.service.ts", import.meta.url)),
    "utf-8",
  );

  it('o servidor de documentos não compara com "Faturamento"', () => {
    const semComentarios = servidor
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(semComentarios).not.toMatch(/categoria\s*===\s*["']Faturamento["']/);
  });

  it("o servidor usa a regra de preço compartilhada para decidir a frase do repasse", () => {
    expect(servidor).toContain("ehServicoSomentePercentual");
  });
});

/**
 * AS DUAS TELAS QUE FICAVAM DE FORA (F4/F3 da descoberta de 28/08).
 *
 * O guarda acima cobria o seletor da proposta e o servidor de documentos — e deixava passar
 * justamente o lugar mais **a montante** de todos: a tela de Serviços, onde o campo de % só
 * existia se a categoria se chamasse "Faturamento". Era a QUINTA aparição da comparação. Ela
 * impedia um segundo serviço percentual de existir, sumia com o % no dia em que alguém
 * renomeasse a categoria, e deixava o campo Valor visível no serviço que não tem valor. A
 * quinta cópia sobrevivia também no editor de preço da ficha do cliente.
 */
describe("as TELAS de preço não casam por nome de categoria", () => {
  const semComentarios = (caminho: string) =>
    readFileSync(fileURLToPath(new URL(caminho, import.meta.url)), "utf-8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");

  const TELAS = [
    ["a tela de Serviços (catálogo)", "../../../web/src/features/crm/servicos/ServicosPage.tsx"],
    ["o editor de preço da ficha do cliente", "../../../web/src/features/crm/clientes/ServicosContratadosCard.tsx"],
  ] as const;

  for (const [nome, caminho] of TELAS) {
    it(`${nome} não compara com "Faturamento"`, () => {
      expect(semComentarios(caminho)).not.toMatch(/categoria\s*===\s*["']Faturamento["']/);
    });

    it(`${nome} usa a regra de preço compartilhada`, () => {
      expect(semComentarios(caminho)).toContain("ehServicoSomentePercentual");
    });
  }
});

/**
 * A TRAVA QUE NUNCA EXISTIU: valor fixo + percentual no mesmo serviço.
 *
 * Nada impedia esse estado — nem banco, nem Zod, nem servidor, nem tela. E ele quebra em
 * silêncio tudo o que lê `ehServicoSomentePercentual`: a linha da proposta volta a mostrar valor
 * e quantidade, a estimativa do funil troca de pergunta sozinha, a conversão passa a provisionar
 * dinheiro fixo. Nenhum desses caminhos avisa; eles só mudam de comportamento.
 */
describe("temValorEPercentual — a trava das duas cobranças juntas", () => {
  it("recusa os dois preenchidos", () => {
    expect(temValorEPercentual({ valor: 3500, percentual: 5 })).toBe(true);
  });

  it("aceita cada um sozinho, e o serviço sem preço nenhum", () => {
    expect(temValorEPercentual({ valor: 3500, percentual: null })).toBe(false);
    expect(temValorEPercentual({ valor: null, percentual: 5 })).toBe(false);
    expect(temValorEPercentual({ valor: null, percentual: null })).toBe(false);
  });

  it("zero não é cobrança — não trava serviço com valor 0 e percentual 5", () => {
    expect(temValorEPercentual({ valor: 0, percentual: 5 })).toBe(false);
    expect(temValorEPercentual({ valor: 3500, percentual: 0 })).toBe(false);
  });

  it("os três schemas recusam o envio com as duas cobranças, em português", () => {
    const base = { nome: "Faturamento", valor: 3500, percentual: 5 };
    const r1 = createServicoSchema.safeParse(base);
    const r2 = updateServicoSchema.safeParse({ id: "s1", ...base });
    const r3 = atualizarContratacaoClienteSchema.safeParse({ clienteId: "c1", servicoId: "s1", valor: 3500, percentual: 5 });
    for (const r of [r1, r2, r3]) {
      expect(r.success).toBe(false);
      expect(r.success === false && r.error.issues[0]?.message).toBe(PRECO_VALOR_E_PERCENTUAL);
    }
  });

  it("os três schemas aceitam cada cobrança sozinha", () => {
    // ⚠️ O percentual agora exige a MARCA do faturamento (ordem do dono, 31/08/2026). Sem ela,
    // este mesmo pedido é recusado — é o caso do bloco seguinte.
    expect(createServicoSchema.safeParse({ nome: "Faturamento", percentual: 5, ehFaturamento: true }).success).toBe(true);
    expect(createServicoSchema.safeParse({ nome: "Gestão", valor: 3500 }).success).toBe(true);
    expect(updateServicoSchema.safeParse({ id: "s1", percentual: 5 }).success).toBe(true);
    expect(atualizarContratacaoClienteSchema.safeParse({ clienteId: "c1", servicoId: "s1", valor: 2500 }).success).toBe(true);
  });
});

/**
 * A MARCA DO FATURAMENTO — quem PODE ser cobrado por percentual.
 *
 * Ordem do dono (31/08/2026): a Med recebe percentual do que a clínica fatura **somente** no
 * faturamento médico; todo o resto do catálogo é valor fixo, avulso ou mensal — inclusive o
 * credenciamento, que é valor fixo cobrado só quando a operadora aprova.
 *
 * O caso que originou: em Ajustes → Serviços, o botão "% do faturamento" aparecia nos DEZ
 * serviços. Trocar a forma de cobrança de um serviço por engano não produz erro nenhum — muda o
 * preço no papel do cliente, na conta a receber e na estimativa do funil, tudo em silêncio.
 *
 * O que estes testes guardam, e não pode regredir:
 *  - quem libera é a MARCA (`ehFaturamento`), nunca a categoria nem o nome — a comparação
 *    `categoria === "Faturamento"` já voltou cinco vezes;
 *  - a pergunta "quem pode ser percentual" (identidade, do banco) é DIFERENTE de "como esta
 *    linha está sendo cobrada" (preço, do registro): `ehServicoSomentePercentual` não mudou.
 */
describe("percentualForaDoFaturamento — só o faturamento médico é percentual", () => {
  it("recusa percentual em serviço sem a marca, e aceita com ela", () => {
    expect(percentualForaDoFaturamento({ valor: null, percentual: 5 }, false)).toBe(true);
    expect(percentualForaDoFaturamento({ valor: null, percentual: 5 }, true)).toBe(false);
  });

  it("marca ausente vale como NÃO — o lado que recusa", () => {
    // `undefined` acontece de verdade: é o que chega quando alguém esquece o campo no `select`.
    // Errar para o lado de recusar devolve uma mensagem em português; errar para o outro deixa
    // um serviço virar percentual sem ninguém ter decidido isso.
    expect(percentualForaDoFaturamento({ valor: null, percentual: 5 }, undefined)).toBe(true);
    expect(percentualForaDoFaturamento({ valor: null, percentual: 5 }, null)).toBe(true);
  });

  it("serviço de valor fixo não é afetado, marcado ou não", () => {
    expect(percentualForaDoFaturamento({ valor: 1500, percentual: null }, false)).toBe(false);
    expect(percentualForaDoFaturamento({ valor: 1500, percentual: 0 }, false)).toBe(false);
    expect(percentualForaDoFaturamento({ valor: 1500, percentual: null }, true)).toBe(false);
  });

  it("a marca lê o campo, nunca o nome nem a categoria", () => {
    expect(ehServicoDeFaturamento({ ehFaturamento: true })).toBe(true);
    expect(ehServicoDeFaturamento({ ehFaturamento: false })).toBe(false);
    expect(ehServicoDeFaturamento(null)).toBe(false);
    expect(ehServicoDeFaturamento(undefined)).toBe(false);
  });

  it("o schema de criação recusa percentual sem a marca, em português", () => {
    const r = createServicoSchema.safeParse({ nome: "Credenciamento médico e odontológico", percentual: 5 });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0]?.message).toBe(PRECO_PERCENTUAL_SO_NO_FATURAMENTO);
  });

  it("⚠️ a régua do PREÇO não mudou: quem já é percentual continua sendo lido como percentual", () => {
    // Esta é a separação que não pode ser perdida. `ehServicoSomentePercentual` responde COMO a
    // linha está cobrada e continua olhando só o preço — misturá-la com a marca faria a linha de
    // uma proposta antiga mudar de forma sozinha no dia em que alguém desmarcasse o serviço.
    expect(ehServicoSomentePercentual({ valor: null, percentual: 5 })).toBe(true);
    expect(ehServicoSomentePercentual({ valor: 3500, percentual: null })).toBe(false);
  });
});

/**
 * O ITEM DA PROPOSTA/CONTRATO ERA A PORTA SEM TRAVA.
 *
 * A ADR-138 pôs o `refine` nos três schemas de PREÇO e deixou de fora justamente o schema que
 * grava a linha do documento que vai ao cliente — e que o ACEITE copia para `ClienteServico`.
 */
describe("documentoServicoItemSchema — valor e percentual juntos no papel do cliente", () => {
  it("recusa o item com as duas cobranças, em português", () => {
    const r = documentoServicoItemSchema.safeParse({ servicoId: "s1", valor: 3500, percentual: 5 });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0]?.message).toBe(PRECO_VALOR_E_PERCENTUAL);
  });

  it("aceita cada cobrança sozinha", () => {
    expect(documentoServicoItemSchema.safeParse({ servicoId: "s1", valor: 3500 }).success).toBe(true);
    expect(documentoServicoItemSchema.safeParse({ servicoId: "s1", valor: 0, percentual: 5 }).success).toBe(true);
  });
});
